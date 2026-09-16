"""Component agent: one instance is fanned out per planned component."""

from __future__ import annotations

import json
from typing import Any, Mapping

from ..envelope import AgentResult, EnvelopeError
from ..render import bullet_list
from ..merge import MergeError, read_contributions
from ..workspaces import component_scopes, foundation_scopes
from ..style_parity import validate_targets
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
        component_id = result.output("component_id", result.raw.get("component_id"))
        if component_id != (kwargs.get("component") or {}).get("id"):
            raise EnvelopeError("Component result does not belong to the assigned component.")
        result.outputs["component_id"] = component_id
        paths = result.output("changed_files")
        if not isinstance(paths, list) or any(not isinstance(path, str) or not path for path in paths):
            raise EnvelopeError("Component changed_files must be a list of paths.")
        if result.passed:
            try:
                _, missing = read_contributions(self.context.settings, self.context.evidence_dir, [kwargs["component"]])
            except MergeError as error:
                raise EnvelopeError(str(error)) from error
            if missing:
                raise EnvelopeError("Component did not provide its authored contribution.")
            validate_targets(result.output("parity_targets"), kwargs["component"])

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
                "foundation_token_manifest": self.context.state.get("foundations", {}).get("token_manifest") or "(dry run: shared token manifest)",
                "component_json": json.dumps(component, indent=2, ensure_ascii=False),
                "attempt": attempt,
                "source_order": component.get("source_order", ""),
                "contribution_path": self.context.rel(contribution),
                "owned_paths": bullet_list([f"`{path}`" for path in component_scopes(self.context.settings, {**component, "id": component_id})]),
                "protected_files": bullet_list(
                    [f"`{path}`" for path in [*migration.get("shared_files.protected", []), *foundation_scopes(self.context.settings)]]
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
