"""The JSON envelope every agent writes, and its config-driven validation."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Mapping

from .config import AgentSpec

_JSON_OBJECT = re.compile(r"\{.*\}", re.DOTALL)


class EnvelopeError(RuntimeError):
    """Raised when an agent's result file is missing, unparseable, or incomplete."""


@dataclass
class AgentResult:
    agent: str
    run_id: str
    status: str
    outputs: dict[str, Any] = field(default_factory=dict)
    checks: list[dict[str, Any]] = field(default_factory=list)
    failures: list[Any] = field(default_factory=list)
    raw: dict[str, Any] = field(default_factory=dict)
    path: str | None = None

    @property
    def passed(self) -> bool:
        return self.status in {"PASS", "COMPLETE"}

    @property
    def blocked(self) -> bool:
        return self.status == "BLOCKED"

    def output(self, key: str, default: Any = None) -> Any:
        return self.outputs.get(key, default)

    def failed_checks(self) -> list[dict[str, Any]]:
        return [check for check in self.checks if str(check.get("status", "")).upper() != "PASS"]

    def summary(self) -> str:
        detail = ""
        if self.failures:
            detail = f" — {len(self.failures)} failure(s)"
        elif not self.passed:
            failed = self.failed_checks()
            if failed:
                detail = " — failed checks: " + ", ".join(str(c.get("name", "?")) for c in failed)
        return f"{self.agent}: {self.status}{detail}"

    def to_dict(self) -> dict[str, Any]:
        return {
            "agent": self.agent,
            "run_id": self.run_id,
            "status": self.status,
            "outputs": self.outputs,
            "checks": self.checks,
            "failures": self.failures,
            "result_path": self.path,
        }


def _load_json(path: Path) -> dict[str, Any]:
    text = path.read_text(encoding="utf-8").strip()
    if not text:
        raise EnvelopeError(f"Agent result file is empty: {path}")
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        # Agents occasionally wrap the envelope in a fenced block or prose.
        match = _JSON_OBJECT.search(text)
        if not match:
            raise EnvelopeError(f"Agent result file is not JSON: {path}") from None
        try:
            parsed = json.loads(match.group(0))
        except json.JSONDecodeError as error:
            raise EnvelopeError(f"Agent result file is not JSON: {path} ({error})") from error
    if not isinstance(parsed, Mapping):
        raise EnvelopeError(f"Agent result must be a JSON object: {path}")
    return dict(parsed)


def _lookup(data: Mapping[str, Any], dotted: str) -> Any:
    node: Any = data
    for part in dotted.split("."):
        if not isinstance(node, Mapping) or part not in node:
            return None
        node = node[part]
    return node


def read_result(path: Path, spec: AgentSpec, run_id: str) -> AgentResult:
    """Parse and validate the envelope an agent wrote, per its ``agents.yaml`` entry."""
    if not path.is_file():
        raise EnvelopeError(
            f"Agent '{spec.id}' did not write its result file: {path}. "
            "Treating the agent as not run."
        )
    data = _load_json(path)

    missing = [
        key
        for key in spec.required_result_keys
        # Required keys may be declared either at the top level or under outputs.
        if _lookup(data, key) is None and _lookup(data, f"outputs.{key}") is None
    ]
    if missing:
        raise EnvelopeError(
            f"Agent '{spec.id}' result {path} is missing required key(s): {', '.join(missing)}"
        )

    status = str(data.get("status", "")).upper()
    allowed = {value.upper() for value in spec.status_values}
    if status not in allowed:
        raise EnvelopeError(
            f"Agent '{spec.id}' returned status {status!r}; allowed values are {sorted(allowed)}."
        )

    reported_run = str(data.get("run_id", run_id))
    if reported_run != run_id:
        raise EnvelopeError(
            f"Agent '{spec.id}' reported run_id {reported_run!r} but this run is {run_id!r}."
        )

    outputs = data.get("outputs") or {}
    if not isinstance(outputs, Mapping):
        raise EnvelopeError(f"Agent '{spec.id}' result 'outputs' must be an object.")

    checks = data.get("checks") or []
    failures = data.get("failures") or []

    return AgentResult(
        agent=str(data.get("agent", spec.id)),
        run_id=run_id,
        status=status,
        outputs=dict(outputs),
        checks=[dict(check) for check in checks if isinstance(check, Mapping)],
        failures=list(failures) if isinstance(failures, list) else [failures],
        raw=data,
        path=str(path),
    )


def validate_components(
    components: Any,
    schema: Mapping[str, Any],
    *,
    minimum: int,
    maximum: int,
) -> list[dict[str, Any]]:
    """Validate the planner's component plan against the schema in ``agents.yaml``."""
    if not isinstance(components, list) or not components:
        raise EnvelopeError("The planner returned no components; nothing can be fanned out.")
    if len(components) < minimum:
        raise EnvelopeError(
            f"The planner returned {len(components)} component(s); the configured minimum is {minimum}."
        )
    if len(components) > maximum:
        raise EnvelopeError(
            f"The planner returned {len(components)} component(s), above the configured "
            f"fanout.max_components of {maximum}. Raise the limit or tighten the plan."
        )

    required = list(schema.get("required", []))
    id_pattern = schema.get("id_pattern")
    tier_values = schema.get("tier_values")
    delivery_values = schema.get("delivery_values")
    compiled = re.compile(str(id_pattern)) if id_pattern else None

    seen: set[str] = set()
    validated: list[dict[str, Any]] = []
    for index, component in enumerate(components):
        if not isinstance(component, Mapping):
            raise EnvelopeError(f"Component #{index} is not an object.")
        missing = [key for key in required if component.get(key) in (None, "", [])]
        if missing:
            raise EnvelopeError(
                f"Component #{index} ({component.get('id', 'unnamed')}) is missing: {', '.join(missing)}"
            )
        component_id = str(component["id"])
        if compiled and not compiled.match(component_id):
            raise EnvelopeError(
                f"Component id {component_id!r} does not match the required pattern {id_pattern!r}."
            )
        if component_id in seen:
            raise EnvelopeError(f"Duplicate component id in the plan: {component_id!r}")
        seen.add(component_id)
        if tier_values is not None and component.get("tier") not in tier_values:
            raise EnvelopeError(
                f"Component {component_id!r} has tier {component.get('tier')!r}; "
                f"allowed tiers are {tier_values}."
            )
        if delivery_values is not None and component.get("delivery") not in delivery_values:
            raise EnvelopeError(
                f"Component {component_id!r} has delivery {component.get('delivery')!r}; "
                f"allowed values are {delivery_values}."
            )
        validated.append(dict(component))
    return validated
