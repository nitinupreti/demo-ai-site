"""Establish shared files after planning, without changing the accepted plan."""

from __future__ import annotations

import json
from typing import Any, Iterable, Mapping

from ..envelope import AgentResult, EnvelopeError
from ..render import bullet_list
from ..workspaces import foundation_scopes
from .base import Agent


class FoundationsAgent(Agent):
    agent_id = "foundations"

    def slug(self, repair: bool = False, attempt: int = 1, **_: Any) -> str:
        return f"foundations-repair-attempt-{attempt}" if repair else self.agent_id

    def prompt_values(
        self, components: Iterable[Mapping[str, Any]] | None = None,
        feedback: Mapping[str, Any] | None = None, repair: bool = False, **kwargs: Any,
    ) -> dict[str, Any]:
        values = super().prompt_values(**kwargs)
        values.update({
            "operation": "repair" if repair else "establish",
            "plan_result_path": str(self.result_path("planner")),
            "components_json": json.dumps(list(components or []), indent=2),
            "feedback_json": json.dumps(feedback or {}, indent=2),
            "owned_paths": bullet_list([f"`{path}`" for path in foundation_scopes(self.context.settings)]),
        })
        return values

    def validate_result(self, result: AgentResult, **kwargs: Any) -> None:
        super().validate_result(result, **kwargs)
        components = list(kwargs.get("components") or [])
        if self.context.dry_run:
            result.outputs["components"] = components
            result.outputs["changed_files"] = []
        elif result.passed:
            if result.output("components") != components:
                raise EnvelopeError("Shared foundations must preserve the validated component plan.")
            self.context.evidence_file(result.output("token_manifest"))