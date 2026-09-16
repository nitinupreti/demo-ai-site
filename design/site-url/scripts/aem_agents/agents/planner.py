"""Interpret frozen discovery and produce a read-only migration plan."""

from __future__ import annotations

from pathlib import Path
import time
from typing import Any

from ..envelope import AgentResult, EnvelopeError, validate_components
from ..discovery import DiscoveryEvidence, collect_discovery, validate_collection
from ..browser import browser_paths
from ..console import emit
from ..workspaces import digest, normalize_scope, validate_contribution_targets, validate_ownership
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
    """Collect once and plan without editing repository sources."""

    agent_id = "planner"
    discovery: DiscoveryEvidence | None = None

    def run(self, **kwargs: Any) -> AgentResult:
        started = time.monotonic()
        self.discovery = None
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
            "discovery_summary": str(self.discovery.summary) if self.discovery else "(dry run: prepared source summary)",
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
            result.outputs["components"] = list(kwargs.get("components") or _DRY_RUN_PLAN)
        elif result.passed:
            if result.output("changed_files", []):
                raise EnvelopeError("Planner is read-only; shared source changes belong to the foundations agent.")
            manifest = self.context.evidence_file(result.output("discovery_manifest"))
            collector = (self.context.browser or browser_paths(self.context.settings)).tools_dir / "discover.mjs"
            _, artifacts = validate_collection(manifest, self.context.run_id, self.context.contract.site_url,
                                               self.context.contract.breakpoints, digest(collector))
            self.context.evidence_file(result.output("discovery_summary"))
            self.context.evidence_file(result.output("discovery_inventory"))
            self.context.evidence_file(result.output("design_tokens"))
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
        corrections = self.route_content_ownership(components)
        validate_ownership(self.context.settings, components)
        if corrections:
            result.outputs["ownership_corrections"] = corrections
            for correction in corrections:
                message = f"{correction['component_id']}: routed {correction['target']} to required merge contributions (not worker edits)."
                emit(f"  plan ownership: {message}", "yellow")
                self.context.logger.warning("Plan ownership correction: %s", message)
        plan_path = self.context.evidence_dir / str(migration.get("run.plan_file", "component-plan.json"))
        dump_json(plan_path, {"run_id": self.context.run_id, "components": components})
        self.context.logger.info("Planner produced %d component(s) -> %s", len(components), plan_path)
        return components

    def route_content_ownership(self, components: list[dict[str, Any]]) -> list[dict[str, str]]:
        settings = self.context.settings
        pattern = str(settings.migration.require("shared_files.authored_page.file"))
        prefix, marker, suffix = pattern.partition("{page_path}")
        if not marker or not suffix or "{page_path}" in suffix:
            raise EnvelopeError("The authored-page file pattern needs one {page_path} and a file suffix.")
        corrections = []
        for component in components:
            targets = validate_contribution_targets(settings, component)
            declared = component.get("owned_paths", [])
            if not isinstance(declared, list):
                raise EnvelopeError(f"{component['id']}: owned_paths must be a list of source paths.")
            owned = []
            for value in declared:
                path = normalize_scope(value)
                if path.startswith(prefix) and path.endswith(suffix):
                    target = path[len(prefix):-len(suffix)]
                    targets = validate_contribution_targets(settings, {**component, "contribution_targets": [*targets, target]})
                    corrections.append({"component_id": component["id"], "path": path, "target": target, "owner": "merge"})
                else:
                    owned.append(path)
            if "owned_paths" in component:
                component["owned_paths"] = owned
            if targets:
                component["contribution_targets"] = targets
        return corrections

    def prioritize(self, components: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Move shared-chrome components first; they usually own shared tokens."""
        prefixes = tuple(
            str(prefix) for prefix in self.context.settings.migration.get("fanout.priority_prefixes", [])
        )
        if not prefixes:
            return components
        return sorted(components, key=lambda c: 0 if str(c["id"]).startswith(prefixes) else 1)
