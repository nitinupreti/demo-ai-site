"""Planner agent: resolves the source page and decides the fan-out width."""

from __future__ import annotations

from typing import Any

from ..envelope import AgentResult, validate_components
from ..workspaces import validate_ownership
from .base import Agent, dump_json

# Stand-in plan so --dry-run still renders and validates every downstream prompt.
_DRY_RUN_PLAN = [
    {
        "id": "dry-run-component",
        "name": "Dry run component",
        "tier": 4,
        "delivery": "component",
        "source_order": 0,
        "resource_type": "dry-run/components/example",
        "source_selectors": [{"instance_id": "dry-run-1", "selector": "main", "match_index": 0}],
        "instances": 1,
        "visible_breakpoints": [],
    }
]


class PlannerAgent(Agent):
    """Runs source discovery once and returns the component plan."""

    agent_id = "planner"

    def validate_result(self, result: AgentResult, **kwargs: Any) -> None:
        super().validate_result(result, **kwargs)
        if self.context.dry_run:
            result.outputs["components"] = _DRY_RUN_PLAN
        elif result.passed:
            result.outputs["components"] = self.validate_plan(result)

    def validate_plan(self, result: AgentResult) -> list[dict[str, Any]]:
        """Fail fast on a malformed plan, before any implementation agent starts."""
        migration = self.context.settings.migration
        components = validate_components(
            result.output("components") or result.raw.get("components"),
            self.spec.get("component_schema", {}),
            minimum=int(migration.get("fanout.min_components", 1)),
            maximum=int(migration.get("fanout.max_components", 40)),
        )
        components = self.prioritize(components)
        validate_ownership(self.context.settings, components)
        plan_path = self.context.evidence_dir / str(migration.get("run.plan_file", "component-plan.json"))
        dump_json(plan_path, {"run_id": self.context.run_id, "components": components})
        self.context.logger.info("Planner produced %d component(s) -> %s", len(components), plan_path)
        return components

    def prioritize(self, components: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Move shared-chrome components first; they usually own shared tokens."""
        prefixes = tuple(
            str(prefix) for prefix in self.context.settings.migration.get("fanout.priority_prefixes", [])
        )
        if not prefixes:
            return components
        return sorted(components, key=lambda c: 0 if str(c["id"]).startswith(prefixes) else 1)
