"""Component agent: one instance is fanned out per planned component."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any, Mapping

from ..config import AgentSpec, Settings
from ..envelope import AgentResult, EnvelopeError
from ..handoff import component_svg_recoveries, prepare_component_handoff
from ..render import bullet_list
from ..merge import MergeError, read_contributions
from ..workspaces import component_scopes, digest, foundation_scopes
from ..style_parity import validate_targets
from ..assets import AssetDeclarationError, validate_asset_declarations
from .base import Agent, dump_json

_NO_REMEDIATION = (
    "This is the first implementation pass for this component. There is no prior "
    "parity feedback to act on."
)


class ComponentAgent(Agent):
    """Implements exactly one component; several run in parallel."""

    agent_id = "component"

    def validate_result(self, result: AgentResult, **kwargs: Any) -> None:
        self.contribution_failure = None
        super().validate_result(result, **kwargs)
        if self.context.dry_run:
            return
        if getattr(self, "reuse_components", None):
            if any(digest(Path(path)) != checksum for path, checksum in self.reuse_input_hashes.items()):
                raise EnvelopeError("Reuse authoring inputs changed during execution.")
            entries = result.output("results")
            if not isinstance(entries, dict) or set(entries) != {component["id"] for component in self.reuse_components}:
                raise EnvelopeError("Reuse authoring must return exactly one result per assigned component.")
            return
        handoff = getattr(self, "handoff", {})
        if any(not Path(path).is_file() or digest(Path(path)) != checksum
               for path, checksum in handoff.get("hashes", {}).items()):
            raise EnvelopeError("Prepared component inputs changed during implementation.")
        if handoff:
            result.outputs["handoff_artifacts"] = handoff["artifacts"]
            result.outputs["handoff_metrics"] = {key: handoff[key] for key in (
                "packet_count", "source_record_count", "selected_record_count", "elapsed_seconds",
                "input_bytes", "prepared_bytes", "cache_hits", "cache_misses")}
        component_id = result.output("component_id", result.raw.get("component_id"))
        if component_id != (kwargs.get("component") or {}).get("id"):
            raise EnvelopeError("Component result does not belong to the assigned component.")
        result.outputs["component_id"] = component_id
        paths = result.output("changed_files")
        if not isinstance(paths, list) or any(not isinstance(path, str) or not path for path in paths):
            raise EnvelopeError("Component changed_files must be a list of paths.")
        if result.passed:
            try:
                _, missing = read_contributions(self.context.settings, self.context.evidence_dir, [kwargs["component"]], attempt=kwargs.get("attempt"))
                if missing:
                    raise MergeError("Component did not provide its authored contribution.")
            except MergeError as error:
                self.contribution_failure = str(error)
                result.status = "FAIL"
                result.failures.append(str(error))
                return
            try:
                settings = self.context.settings
                if self.context.browser is not None:
                    settings = Settings(settings.repo_root, settings.migration.merged({"parity": {
                        "tools_dir": str(self.context.browser.tools_dir), "browsers_path": str(self.context.browser.browsers_path),
                    }}), settings._agents_config)
                component = {**kwargs["component"], "svg_recoveries": component_svg_recoveries(self.context, kwargs["component"])}
                validate_asset_declarations(settings, self.context.evidence_dir, [component], attempt=kwargs.get("attempt"))
            except AssetDeclarationError as error:
                result.status = "FAIL"
                result.failures.append(str(error))
                result.outputs["asset_failures"] = [{"component_id": component_id, "owning_layer": "component",
                                                    "phase": "assets", "hypothesis": str(error)}]
                result.outputs["critical_asset_failure"] = error.critical
                return
            validate_targets(result.output("parity_targets"), kwargs["component"])
            tests = result.output("focused_tests") or result.output("focused_test")
            for test in tests if isinstance(tests, list) else [tests]:
                if isinstance(test, Mapping) and "argv" in test:
                    raise EnvelopeError(f"{component_id}: focused_test must use command, not argv, for its test command.")

    def completion_summary(self, result: AgentResult) -> str:
        if getattr(self, "reuse_components", None) and result.passed:
            return "results recorded; coordinator validation pending"
        return super().completion_summary(result)

    def slug(self, component: Mapping[str, Any] | None = None, attempt: int = 1, **_: Any) -> str:
        if getattr(self, "reuse_components", None):
            identity = hashlib.sha256(json.dumps(sorted(entry["id"] for entry in self.reuse_components)).encode("utf-8")).hexdigest()[:12]
            return f"component-reuse-{identity}-attempt-{attempt}"
        component_id = str((component or {}).get("id", "unknown"))
        return f"component-{component_id}-attempt-{attempt}"

    def render_prompt(self, slug: str, **kwargs: Any) -> str:
        if getattr(self, "contribution_repair", None):
            self.spec = AgentSpec(self.agent_id, self.spec.get("contribution_repair"), self.spec._config.data)
        elif getattr(self, "reuse_components", None):
            self.spec = AgentSpec(self.agent_id, self.spec.get("reuse"), self.spec._config.data)
        return super().render_prompt(slug, **kwargs)

    def prompt_values(
        self,
        component: Mapping[str, Any] | None = None,
        attempt: int = 1,
        feedback: Mapping[str, Any] | None = None,
        **_: Any,
    ) -> dict[str, Any]:
        component = dict(component or {})
        component_id = str(component.get("id", "unknown"))
        repair = getattr(self, "contribution_repair", None)
        if repair:
            values = super().prompt_values()
            values.update(component_id=component_id, component_json=json.dumps(component, indent=2),
                          repair_json=json.dumps(repair, indent=2), contribution_path=repair["contribution"],
                          candidate_result_path=repair["candidate_result"])
            return values
        if getattr(self, "reuse_components", None):
            return self.reuse_prompt_values(attempt, feedback or {})
        migration = self.context.settings.migration
        contribution = self.workspace(self.slug(component=component, attempt=attempt)) / str(
            migration.get("shared_files.contribution_file", "contributions.json")
        )
        self.handoff = prepare_component_handoff(self.context, contribution.parent / "discovery-inputs", component)
        if self.handoff:
            self.context.logger.info("Component %s inputs: %d/%d source records, %d cache hits/%d misses (%.3fs)",
                                     component_id, self.handoff["selected_record_count"], self.handoff["source_record_count"],
                                     self.handoff["cache_hits"], self.handoff["cache_misses"], self.handoff["elapsed_seconds"])
        values = super().prompt_values()
        values.update(
            {
                "component_id": component_id,
                "foundation_token_manifest": self.context.state.get("foundations", {}).get("token_manifest") or "(dry run: shared token manifest)",
                "component_json": json.dumps(component, indent=2, ensure_ascii=False),
                "component_handoff_index": self.handoff.get("index_path", "(no prepared discovery inputs)"),
                "svg_recovery_json": json.dumps(self.handoff.get("svg_recoveries", []), indent=2),
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

    def reuse_prompt_values(self, attempt: int, feedback: Mapping[str, Any]) -> dict[str, Any]:
        directory = self.workspace(self.slug(attempt=attempt))
        tasks = []
        self.reuse_handoffs = {}
        self.reuse_input_hashes = {}
        for component in self.reuse_components:
            member_directory = self.workspace(f"component-{component['id']}-attempt-{attempt}")
            handoff = prepare_component_handoff(self.context, member_directory / "discovery-inputs", component)
            self.reuse_handoffs[component["id"]] = handoff
            self.reuse_input_hashes.update(handoff.get("hashes", {}))
            scopes = component_scopes(self.context.settings, component)
            sources = []
            for scope in scopes:
                source = self.context.repo_root / (scope[:-3] if scope.endswith("/**") else scope)
                if source.exists():
                    sources.append(str(source.resolve()))
            contribution_path = str(member_directory / str(self.context.settings.migration.get("shared_files.contribution_file", "contributions.json")))
            instances = dict.fromkeys(entry["instance_id"] for entry in component.get("source_selectors", [])
                                      if isinstance(entry.get("instance_id"), str) and entry["instance_id"])
            template = {
                "agent": "component", "run_id": self.context.run_id, "status": "BLOCKED",
                "outputs": {"component_id": component["id"], "resource_type": component.get("resource_type"),
                            "tier": component.get("tier"), "changed_files": [], "contributions": contribution_path,
                            "authored_paths": [], "parity_targets": [
                                {"instance_id": identity, "selector": "", "roles": [], "interactions": []} for identity in instances],
                            "focused_test": {"command": [], "working_directory": "."},
                            "runtime_contract": {"model_probes": [], "clientlibs": []}, "skills_loaded": []},
                "checks": [{"name": name, "status": "BLOCKED", "evidence": [], "details": ""}
                           for name in self.context.settings.agent("component").get("required_checks")],
                "failures": ["Complete the authoring fields and validation evidence before reporting PASS."],
            }
            task = directory / "tasks" / f"{component['id']}.json"
            dump_json(task, {"component": dict(component), "existing_sources": sources,
                             "discovery_index": handoff.get("index_path"), "svg_recoveries": handoff.get("svg_recoveries", []),
                             "captured_assets": handoff.get("captured_assets", []), "result_template": template,
                             "contribution_path": contribution_path,
                             "result_path": str(member_directory / str(self.context.settings.migration.get("run.result_file", "result.json"))),
                             "evidence_directory": str(member_directory), "feedback": feedback.get(component["id"], {})})
            self.reuse_input_hashes[str(task)] = digest(task)
            tasks.append({"component_id": component["id"], "input": str(task)})
        index = directory / "authoring-inputs.json"
        dump_json(index, {"run_id": self.context.run_id, "tasks": tasks})
        self.reuse_index = str(index)
        self.reuse_input_hashes[str(index)] = digest(index)
        values = super().prompt_values()
        values.update(reuse_index=str(index), member_required_checks=json.dumps(self.context.settings.agent("component").get("required_checks")))
        return values

    def remediation_block(self, feedback: Mapping[str, Any] | None) -> str:
        if not feedback:
            return _NO_REMEDIATION
        diagnostic = json.dumps(dict(feedback), indent=2, ensure_ascii=False)
        if feedback.get("phase") == "assets":
            return (
                "## Asset declaration repair\n\n"
                "Repair your asset contributions using captured source evidence. For inline SVGs copy the collector's "
                "source_file and sha256, never a description in source_url. Do not redraw logos, alter discovery evidence, "
                "download assets, or redeploy. Keep the accepted component work and rerun focused validation.\n\n"
                f"```json\n{diagnostic}\n```"
            )
        if feedback.get("phase") == "deploy":
            return (
                "## Deployment repair feedback\n\n"
                "The deterministic deployment worker found a defect assigned to this component. "
                "Read the referenced diagnostics and repair only your owned source or authored contributions. "
                "Address all reported defects together, then run focused checks. Do not deploy, change shared "
                "files or repair environment prerequisites; return foundation_requests for shared defects.\n\n"
                f"```json\n{diagnostic}\n```"
            )
        if feedback.get("phase") in ("implement", "merge", "frontend", "foundations"):
            return (
                "## Scoped recovery feedback\n\n"
                "A validation or build step failed. This is not a visual score. Read the actual command, "
                "exit code and referenced evidence, repair only owned source or contributions, and rerun "
                "focused checks. Preserve accepted work. Return foundation_requests for shared source "
                "defects; do not deploy or change tooling, credentials, ownership or acceptance gates.\n\n"
                f"```json\n{diagnostic}\n```"
            )
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
