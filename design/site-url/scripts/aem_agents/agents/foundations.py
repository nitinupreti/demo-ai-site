"""The single writer for shared design tokens, site styles and policies."""

from __future__ import annotations

import json
from typing import Any, Iterable, Mapping

from ..envelope import AgentResult
from ..render import bullet_list
from ..workspaces import foundation_scopes
from .base import Agent


class FoundationsAgent(Agent):
    agent_id = "foundations"

    def slug(self, attempt: int = 1, **_: Any) -> str:
        return f"foundations-attempt-{attempt}"

    def validate_result(self, result: AgentResult, **kwargs: Any) -> None:
        super().validate_result(result, **kwargs)
        if result.passed and not self.context.dry_run:
            self.context.evidence_file(result.output("token_manifest"))

    def prompt_values(
        self, components: Iterable[Mapping[str, Any]] | None = None,
        feedback: Mapping[str, Any] | None = None, **_: Any,
    ) -> dict[str, Any]:
        values = super().prompt_values()
        values.update(
            components_json=json.dumps(list(components or []), indent=2),
            feedback_json=json.dumps(feedback or {}, indent=2),
            owned_paths=bullet_list([f"`{path}`" for path in foundation_scopes(self.context.settings)]),
        )
        return values