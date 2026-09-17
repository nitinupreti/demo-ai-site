"""Plan from frozen discovery, then establish shared files in a separate pass."""

from __future__ import annotations

import json
from pathlib import Path
import time
from typing import Any

from ..config import AgentSpec
from ..envelope import AgentResult, EnvelopeError, validate_components
from ..discovery import DiscoveryEvidence, collect_discovery, validate_collection
from ..browser import browser_paths
from ..console import emit
from ..handoff import prepare_planner_handoff, prepare_shared_handoff
from ..render import bullet_list
from ..workspaces import digest, foundation_scopes, normalize_scope, validate_contribution_targets, validate_ownership
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
    """Keep planning and shared implementation separately validated and ordered."""

    agent_id = "planner"
    discovery: DiscoveryEvidence | None = None
    handoff: dict[str, Any] | None = None
    planning_handoff: dict[str, Any] | None = None

    def __init__(self, context: Any, *, shared: bool = False) -> None:
        super().__init__(context)
        self.shared = shared
        if shared:
            self.spec = AgentSpec(self.agent_id, self.spec.get("shared"), self.spec._config.data)

    def slug(self, repair: bool = False, attempt: int = 1, **_: Any) -> str:
        if self.shared:
            return f"planner-shared-repair-attempt-{attempt}" if repair else "planner-shared"
        return self.agent_id

    def prepare_handoff(self, components: list[dict[str, Any]], **kwargs: Any) -> dict[str, Any]:
        self.handoff = prepare_shared_handoff(self.context, self.workspace(self.slug(**kwargs)) / "handoff", list(components))
        return self.handoff

    def run(self, **kwargs: Any) -> AgentResult:
        started = time.monotonic()
        self.discovery = None
        self.handoff = None
        self.planning_handoff = None
        if not self.context.dry_run and self.shared:
            self.prepare_handoff(components=kwargs.get("components") or [], repair=kwargs.get("repair", False), attempt=kwargs.get("attempt", 1))
        if not self.context.dry_run and not self.shared:
            self.discovery = collect_discovery(self.context)
            self.planning_handoff = prepare_planner_handoff(self.context, self.workspace(self.slug(**kwargs)) / "planning-inputs", self.discovery)
            emit(f"  planner inputs: {self.planning_handoff['packet_count']} bounded packets prepared in {self.planning_handoff['elapsed_seconds']:.2f}s", "green")
        result = super().run(**kwargs)
        if not self.context.dry_run and self.discovery is not None:
            if result.path:
                dump_json(Path(result.path), result.to_dict())
            saved = self.context.state.get("agent_results", {}).get(self.slug(**kwargs), {})
            self.context.state.record_agent_result(self.slug(**kwargs), {
                **saved, **result.to_dict(),
                "discovery_seconds": self.discovery.elapsed_seconds,
                "input_preparation_seconds": self.planning_handoff["elapsed_seconds"] if self.planning_handoff else 0,
                "planner_total_seconds": time.monotonic() - started,
            })
        return result

    def prompt_values(self, **kwargs: Any) -> dict[str, Any]:
        values = super().prompt_values(**kwargs)
        if self.shared:
            values.update({
                "operation": "repair" if kwargs.get("repair") else "establish",
                "plan_result_path": str(self.result_path("planner")),
                "handoff_brief": json.dumps({key: value for key, value in (self.handoff or {
                    "index_path": "(dry run: prepared shared-work handoff)",
                    "plan_path": "(dry run: complete accepted plan)",
                }).items() if key not in ("artifacts", "hashes")}, indent=2),
                "feedback_json": json.dumps(kwargs.get("feedback") or {}, indent=2),
                "owned_paths": bullet_list([f"`{path}`" for path in foundation_scopes(self.context.settings)]),
            })
            return values
        values.update({
            "planning_index": self.planning_handoff["index_path"] if self.planning_handoff else "(dry run: bounded planner input index)",
            "discovery_summary": str(self.discovery.summary) if self.discovery else "(dry run: prepared source summary)",
            "discovery_manifest": str(self.discovery.manifest) if self.discovery else "(dry run: collector manifest)",
            "discovery_inventory": str(self.discovery.inventory) if self.discovery else "(dry run: cached repository inventory)",
        })
        return values

    def validate_result(self, result: AgentResult, **kwargs: Any) -> None:
        if self.shared:
            super().validate_result(result, **kwargs)
            components = list(kwargs.get("components") or [])
            if self.context.dry_run:
                result.outputs.update(components=components, changed_files=[])
            elif result.passed:
                if result.output("components") != components:
                    raise EnvelopeError("Shared foundations must preserve the validated component plan.")
                self.context.evidence_file(result.output("token_manifest"))
                if self.handoff:
                    for name, expected in self.handoff["hashes"].items():
                        if digest(Path(name)) != expected:
                            raise EnvelopeError(f"Prepared shared evidence changed: {name}")
                    result.outputs["handoff_artifacts"] = self.handoff["artifacts"]
                    result.outputs["handoff_metrics"] = {key: self.handoff[key] for key in (
                        "component_count", "token_records", "packet_count", "input_token_bytes")}
            return
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
                raise EnvelopeError("Planning is read-only; shared source changes belong to the planner's later shared pass.")
            if self.planning_handoff:
                if any(digest(Path(name)) != checksum for name, checksum in self.planning_handoff["hashes"].items()):
                    raise EnvelopeError("Prepared planner inputs or discovery evidence changed during planning.")
                result.outputs["planning_artifacts"] = self.planning_handoff["artifacts"]
                result.outputs["planning_metrics"] = {name: self.planning_handoff[name] for name in ("input_bytes", "packet_count", "elapsed_seconds")}
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
