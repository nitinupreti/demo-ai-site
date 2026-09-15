"""Planner agent: resolves the source page and decides the fan-out width."""

from __future__ import annotations

from pathlib import Path
import time
from typing import Any

from ..envelope import AgentResult, validate_components
from ..discovery import DiscoveryEvidence, collect_discovery, validate_collection
from ..browser import browser_paths
from ..workspaces import digest, validate_ownership
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
    discovery: DiscoveryEvidence | None = None

    def run(self, **kwargs: Any) -> AgentResult:
        started = time.monotonic()
        if not self.context.dry_run:
            self.discovery = collect_discovery(self.context)
        result = super().run(**kwargs)
        if not self.context.dry_run and self.discovery is not None:
            if result.path:
                dump_json(Path(result.path), result.to_dict())
            saved = self.context.state.get("agent_results", {}).get(self.slug(**kwargs), {})
            self.context.state.record_agent_result(self.slug(**kwargs), {
                **saved, **result.to_dict(),
                "discovery_seconds": self.discovery.elapsed_seconds,
                "planner_total_seconds": time.monotonic() - started,
            })
        return result

    def prompt_values(self, **kwargs: Any) -> dict[str, Any]:
        values = super().prompt_values(**kwargs)
        values.update({
            "discovery_summary": str(self.discovery.summary) if self.discovery else "(dry run: source summary is prepared before a real planner invocation)",
            "discovery_manifest": str(self.discovery.manifest) if self.discovery else "(dry run: collector manifest)",
            "discovery_inventory": str(self.discovery.inventory) if self.discovery else "(dry run: cached repository inventory)",
        })
        return values

    def validate_result(self, result: AgentResult, **kwargs: Any) -> None:
        if self.discovery is not None:
            result.outputs.update({
                "discovery_manifest": str(self.discovery.manifest),
                "discovery_summary": str(self.discovery.summary),
                "discovery_inventory": str(self.discovery.inventory),
                "discovery_artifacts": [str(path) for path in self.discovery.artifacts],
            })
        super().validate_result(result, **kwargs)
        if self.context.dry_run:
            result.outputs["components"] = _DRY_RUN_PLAN
        elif result.passed:
            manifest = self.context.evidence_file(result.output("discovery_manifest"))
            collector = (self.context.browser or browser_paths(self.context.settings)).tools_dir / "discover.mjs"
            _, artifacts = validate_collection(manifest, self.context.run_id, self.context.contract.site_url,
                                               self.context.contract.breakpoints, digest(collector))
            self.context.evidence_file(result.output("discovery_summary"))
            self.context.evidence_file(result.output("discovery_inventory"))
            result.outputs["discovery_artifacts"] = [str(path) for path in artifacts]
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
