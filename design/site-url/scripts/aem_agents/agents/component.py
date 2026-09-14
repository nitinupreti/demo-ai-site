"""Component agent: one instance is fanned out per planned component."""

from __future__ import annotations

import json
from typing import Any, Mapping

from ..envelope import AgentResult, EnvelopeError
from ..render import bullet_list
from .base import Agent

_NO_REMEDIATION = (
    "This is the first implementation pass for this component. There is no prior "
    "parity feedback to act on."
)


class ComponentAgent(Agent):
    """Implements exactly one component; several run in parallel."""

    agent_id = "component"

    def validate_result(self, result: AgentResult, **kwargs: Any) -> None:
        super().validate_result(result, **kwargs)
        if self.context.dry_run:
            return
        if result.output("component_id") != (kwargs.get("component") or {}).get("id"):
            raise EnvelopeError("Component result does not belong to the assigned component.")
        paths = result.output("changed_files")
        if not isinstance(paths, list) or any(not isinstance(path, str) or not path for path in paths):
            raise EnvelopeError("Component changed_files must be a list of paths.")

    def slug(self, component: Mapping[str, Any] | None = None, attempt: int = 1, **_: Any) -> str:
        component_id = str((component or {}).get("id", "unknown"))
        return f"component-{component_id}-attempt-{attempt}"

    def prompt_values(
        self,
        component: Mapping[str, Any] | None = None,
        attempt: int = 1,
        feedback: Mapping[str, Any] | None = None,
        **_: Any,
    ) -> dict[str, Any]:
        component = dict(component or {})
        component_id = str(component.get("id", "unknown"))
        migration = self.context.settings.migration
        contribution = self.workspace(self.slug(component=component, attempt=attempt)) / str(
            migration.get("shared_files.contribution_file", "contributions.json")
        )
        values = super().prompt_values()
        values.update(
            {
                "component_id": component_id,
                "component_json": json.dumps(component, indent=2, ensure_ascii=False),
                "attempt": attempt,
                "source_order": component.get("source_order", ""),
                "contribution_path": self.context.rel(contribution),
                "protected_files": bullet_list(
                    [f"`{path}`" for path in migration.get("shared_files.protected", [])]
                ),
                "remediation_block": self.remediation_block(feedback),
            }
        )
        return values

    def remediation_block(self, feedback: Mapping[str, Any] | None) -> str:
        if not feedback:
            return _NO_REMEDIATION
        diagnostic = json.dumps(dict(feedback), indent=2, ensure_ascii=False)
        return (
            "## Parity feedback — act on these measured deltas\n\n"
            "The previous deploy scored this component below the contract threshold. "
            "Start from the diagnostic below, not from values inferred off class names. "
            "If `rect.w` or `rect.h` is non-zero, close the geometry gap "
            "(container / grid / full-bleed) **before** touching typography or color. "
            "Test exactly one falsifiable root-cause hypothesis and state it in your "
            "result. If the same gap has already failed twice, stop tuning CSS and "
            "reassess the component's block boundary, structure, or reuse tier instead.\n\n"
            f"```json\n{diagnostic}\n```"
        )
