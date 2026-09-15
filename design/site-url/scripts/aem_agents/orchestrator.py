"""The orchestration agent.

Drives the configured pipeline: plan once, fan out one implementation agent per
planned component, hand the union of code changes to the deployer, gate on visual
parity against the threshold in the prompt contract, and remediate within the
attempt budget before reporting.
"""

from __future__ import annotations

import concurrent.futures
import json
import re
import urllib.error
import urllib.request
import uuid
from dataclasses import dataclass, field, replace
from pathlib import Path
from typing import Any, Iterable, Mapping

from .config import ConfigError, Settings
from .browser import ensure_browser
from .checkpoints import capture_checkpoint, evidence_paths, validate_artifacts, validate_checkpoint
from .console import emit
from .contract import RunContract
from .envelope import AgentResult, EnvelopeError, affected_components, dependency_waves, read_result
from .assets import AssetError, fetch_assets
from .merge import MergeError, latest_contribution_path, merge_contributions
from .render import markdown_table, to_text
from .runner import BackendError, create_backend
from .scoring import PixelScorer
from .state import RunState
from .toolchain import check_maven, check_node, resolve_java_home
from .agents import AGENT_CLASSES, RunContext
from .agents.base import dump_json
from .workspaces import ChangeSet, WorkerWorkspace, WorkspaceError, apply_changes, component_scopes, digest, foundation_scopes, source_manifest, validate_ownership


class PipelineError(RuntimeError):
    """Raised when the pipeline cannot continue."""


@dataclass
class PhaseOutcome:
    phase_id: str
    status: str
    results: list[AgentResult] = field(default_factory=list)

    @property
    def passed(self) -> bool:
        return self.status in {"PASS", "COMPLETE"} and all(result.passed for result in self.results)


def probe(url: str, label: str, timeout: int) -> int:
    """Reachability check. Follows redirects; tries HEAD then GET."""
    last_error = ""
    for method in ("HEAD", "GET"):
        request = urllib.request.Request(  # noqa: S310 - scheme validated by the contract
            url, method=method, headers={"User-Agent": "aem-migration-orchestrator/1.0"}
        )
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:  # noqa: S310
                return int(response.status)
        except urllib.error.HTTPError as error:
            if error.code < 400:
                return int(error.code)
            last_error = f"{method} returned HTTP {error.code}"
        except (urllib.error.URLError, OSError, ValueError) as error:
            last_error = f"{method} failed: {error}"
    raise PipelineError(f"{label} is not reachable ({last_error}): {url}")


class Orchestrator:
    def __init__(
        self,
        settings: Settings,
        contract: RunContract,
        *,
        run_id: str | None = None,
        dry_run: bool = False,
        skip_probe: bool = False,
        only_phases: list[str] | None = None,
        evidence_dir: Path | None = None,
        logger: Any = None,
        resume: bool = False,
        bootstrap: bool = True,
    ) -> None:
        self.settings = settings
        self.contract = contract
        self.run_id = run_id or str(uuid.uuid4())
        self.dry_run = dry_run
        self.skip_probe = skip_probe
        self.only_phases = only_phases
        self.logger = logger
        self.resume = resume
        self.bootstrap = bootstrap
        if run_id and not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]*", run_id):
            raise ConfigError("run_id must contain only letters, digits, dots, underscores, and hyphens.")
        if resume and (dry_run or not (run_id or evidence_dir)):
            raise ConfigError("--resume needs --run-id or --evidence-dir and cannot be combined with --dry-run.")
        known_phases = {str(phase["id"]) for phase in settings.phases()}
        if only_phases and (set(only_phases) - known_phases or (not resume and "plan" not in only_phases)):
            raise ConfigError("--only must name valid phases; skipping plan requires --resume.")

        self.evidence_dir = evidence_dir.resolve() if evidence_dir else self._evidence_dir()
        self.evidence_dir.mkdir(parents=True, exist_ok=True)

        self.max_attempts = int(
            settings.migration.get("pipeline.remediation.max_attempts", None)
            or contract.max_attempts_per_component
        )
        self.max_parallel = max(1, int(settings.migration.get("fanout.max_parallel", 3)))
        self.stop_on_first_failure = bool(
            settings.migration.get("fanout.stop_on_first_failure", False)
        )

        state_path = self.evidence_dir / str(settings.migration.get("run.state_file", "run-state.json"))
        if resume:
            self.state = RunState.load(state_path)
            if run_id and self.state.get("run_id") != run_id:
                raise ConfigError("The stored run id does not match --run-id.")
            self.run_id = self.state.get("run_id")
            if self.state.get("dry_run") or self.state.get("status") == "DRY_RUN":
                raise ConfigError("A dry run cannot be resumed as a real migration.")
            if self.state.get("contract") != contract.as_dict():
                raise ConfigError("Resume inputs or contract changed; start a new run instead.")
            saved_inputs = self.state.get("inputs", {})
            for key in ("AEM_HOST", "AEM_PORT"):
                if saved_inputs.get(key) != self._inputs()[key]:
                    raise ConfigError(f"Resume target {key} differs from the checkpoint.")
            if self.state.get("orchestrator", {}).get("max_attempts_per_component") != self.max_attempts:
                raise ConfigError("Resume cannot change or reset the saved attempt budget.")
        else:
            if any(self.evidence_dir.iterdir()):
                raise ConfigError("Evidence directory is not empty; use --resume or a new directory.")
            self.state = RunState.create(
                state_path,
                run_id=self.run_id,
                contract=contract.as_dict(),
                inputs=self._inputs(),
                phases=settings.phases(),
                orchestrator={
                    "name": "aem-migration-orchestrator",
                    "backend": str(settings.migration.get("backend.kind", "copilot-cli")),
                    "max_parallel": self.max_parallel,
                    "max_attempts_per_component": self.max_attempts,
                    "working_directory": str(settings.repo_root),
                },
            )
            self.state.update(dry_run=dry_run)
        self.context: RunContext | None = None
        if resume:
            validate_checkpoint(self.state.get("checkpoint"), settings, contract, self.evidence_dir)
        else:
            self._save_checkpoint()

    # -- setup -------------------------------------------------------------

    def _save_checkpoint(self) -> None:
        if self.dry_run:
            return
        previous = self.state.get("checkpoint", {})
        validate_artifacts(previous, self.evidence_dir)
        active = {"planner"}
        artifacts = set()
        foundation = self.state.get("foundations", {})
        if foundation.get("attempt"):
            active.add(f"planner-repair-attempt-{foundation['attempt']}")
        for component in self.state.component_rows():
            if component.get("status") == "PASS":
                active.add(f"component-{component['id']}-attempt-{component['attempts']}")
                contribution = latest_contribution_path(self.settings, self.evidence_dir, component["id"])
                if contribution and contribution.is_file():
                    artifacts.add(contribution.resolve())
        for slug, result in self.state.get("agent_results", {}).items():
            if slug in active and result.get("status") in {"PASS", "COMPLETE"}:
                artifacts.update(evidence_paths(result, self.settings, self.evidence_dir))
        plan = self.evidence_dir / str(self.settings.migration.get("run.plan_file", "component-plan.json"))
        if plan.is_file():
            artifacts.add(plan.resolve())
        artifacts.discard(self.state.path.resolve())
        checkpoint = capture_checkpoint(self.settings, self.contract, self.evidence_dir, artifacts)
        self.state.update(checkpoint=checkpoint)

    def _evidence_dir(self) -> Path:
        root = self.settings.resolve(str(self.settings.migration.require("run.evidence_root")))
        pattern = str(self.settings.migration.require("run.evidence_dir_pattern"))
        return root / pattern.format(run_id=self.run_id)

    def _inputs(self) -> dict[str, Any]:
        host = self.settings.env_value("aem.host_env", "aem.default_host")
        port = self.settings.env_value("aem.port_env", "aem.default_port")
        return {
            "SITE_URL": self.contract.site_url,
            "TARGET_PAGE_PATH": self.contract.target_page_path,
            "BREAKPOINTS": self.contract.breakpoints,
            "VISUAL_PASS_RATIO": str(self.contract.visual_pass_ratio),
            "AEM_HOST": host,
            "AEM_PORT": port,
            "EVIDENCE_DIR": self.settings.relative_to_repo(self.evidence_dir),
            "MODEL": self.settings.migration.get("model.default", None),
            "EFFORT": self.settings.migration.get("model.effort", None),
        }

    def preflight(self) -> None:
        if self.dry_run:
            self.context = RunContext(
                self.settings, self.contract, None, self.state, self.run_id,
                self.evidence_dir, self.logger, dry_run=True,
            )
            return
        node_version = check_node()
        toolchain = check_maven(resolve_java_home(self.settings))
        emit(f"  Node.js: {node_version}; Maven: {toolchain.maven_version}", "green")
        emit(f"  JAVA_HOME: {toolchain.java_home} (from {toolchain.source})", "green")
        self.state.update(toolchain={
            "java_home": str(toolchain.java_home), "source": toolchain.source,
            "node_version": node_version, "maven_version": toolchain.maven_version,
        })
        browser = ensure_browser(self.settings, bootstrap=self.bootstrap)
        emit(f"  Playwright {browser.playwright_version}: cached Chromium {browser.chromium_revision} ready ({browser.elapsed_ms} ms)", "green")
        scorer = PixelScorer()
        timeout = int(self.settings.migration.get("run.source_probe_timeout_seconds", 20))
        if self.skip_probe:
            emit("Preflight probes skipped.", "dim")
        else:
            emit(f"Checking source: {self.contract.site_url}")
            status = probe(self.contract.site_url, "SITE_URL", timeout)
            emit(f"  source reachable: HTTP {status}", "green")

            host = self.settings.env_value("aem.host_env", "aem.default_host")
            port = self.settings.env_value("aem.port_env", "aem.default_port")
            probe_path = str(self.settings.migration.require("aem.author_probe_path"))
            aem_url = f"http://{host}:{port}{probe_path}"
            emit(f"Checking AEM: http://{host}:{port}")
            status = probe(aem_url, "AEM author", timeout)
            emit(f"  AEM reachable: HTTP {status}", "green")

        backend = create_backend(self.settings)
        emit(f"  agent backend: {backend.version}", "green")

        self.context = RunContext(
            settings=self.settings,
            contract=self.contract,
            backend=backend,
            state=self.state,
            run_id=self.run_id,
            evidence_dir=self.evidence_dir,
            logger=self.logger,
            dry_run=self.dry_run,
            toolchain=toolchain,
            scorer=scorer,
            browser=browser,
        )

    # -- phase dispatch ----------------------------------------------------

    def _cached_result(self, phase: Mapping[str, Any], **kwargs: Any) -> AgentResult:
        agent = self._agent(phase)
        result = read_result(agent.result_path(agent.slug(**kwargs)), agent.spec, self.run_id)
        agent.validate_result(result, **kwargs)
        if not result.passed:
            raise PipelineError(f"Cached {agent.agent_id} result is not valid for reuse.")
        emit(f"  reusing validated {agent.slug(**kwargs)}", "dim")
        return result

    def _agent(self, phase: Mapping[str, Any]):
        agent_id = str(phase["agent"])
        try:
            factory = AGENT_CLASSES[agent_id]
        except KeyError as error:
            raise PipelineError(
                f"Pipeline phase '{phase['id']}' names agent '{agent_id}', which has no "
                "Python implementation. Add a class in aem_agents/agents/ and register it."
            ) from error
        assert self.context is not None
        return factory(self.context)

    def _wants(self, phase_id: str) -> bool:
        return self.only_phases is None or phase_id in self.only_phases

    def run_single(self, phase: Mapping[str, Any], **kwargs: Any) -> PhaseOutcome:
        phase_id = str(phase["id"])
        self.state.set_phase(phase_id, "RUNNING")
        agent = self._agent(phase)
        emit(f"\n[{phase_id}] {agent.spec.title}", "cyan")
        readonly = phase["agent"] != "deployer" and not self.dry_run
        baseline = source_manifest(self.settings.repo_root, excluded=[self.evidence_dir]) if readonly else {}
        try:
            result = agent.run(**kwargs)
        except (EnvelopeError, BackendError, OSError, ValueError) as error:
            result = AgentResult(str(phase["agent"]), self.run_id, "FAIL", failures=[str(error)])
            self.state.record_agent_result(agent.slug(**kwargs), result.to_dict())
            emit(f"  !! {phase_id}: {error}", "red")
        changed_readonly = readonly and source_manifest(self.settings.repo_root, excluded=[self.evidence_dir]) != baseline
        if changed_readonly:
            result = AgentResult(str(phase["agent"]), self.run_id, "FAIL", failures=["Read-only agent changed repository sources; changes were not accepted."])
            self.state.record_agent_result(agent.slug(**kwargs), result.to_dict())
        self.state.set_phase(phase_id, result.status)
        if not changed_readonly:
            self._save_checkpoint()
        return PhaseOutcome(phase_id=phase_id, status=result.status, results=[result])

    def run_assets(
        self, phase: Mapping[str, Any], components: list[Mapping[str, Any]]
    ) -> PhaseOutcome:
        """Download every declared asset once and upload it straight to DAM."""
        phase_id = str(phase["id"])
        self.state.set_phase(phase_id, "RUNNING")
        emit(f"\n[{phase_id}] fetching and uploading assets", "cyan")
        if self.dry_run:
            emit("  -- assets skipped (dry run)", "dim")
            self.state.set_phase(phase_id, "PASS")
            return PhaseOutcome(phase_id=phase_id, status="PASS")

        host = self.settings.env_value("aem.host_env", "aem.default_host")
        port = self.settings.env_value("aem.port_env", "aem.default_port")
        try:
            report = fetch_assets(
                self.settings, self.evidence_dir, components, f"http://{host}:{port}"
            )
        except AssetError as error:
            emit(f"  !! asset phase failed: {error}", "red")
            self.state.set_phase(phase_id, "FAIL", error=str(error))
            return PhaseOutcome(phase_id=phase_id, status="FAIL")

        emit(
            f"  {len(report.uploaded)} uploaded, {len(report.skipped)} already present, "
            f"{len(report.failed)} failed",
            "green" if report.ok else "yellow",
        )
        for record in report.failed:
            emit(f"  !! {record.source_url} -> {record.detail}", "red")
        status = "PASS" if report.ok else "FAIL"
        self.state.set_phase(phase_id, status, **report.to_dict())
        return PhaseOutcome(phase_id=phase_id, status=status)

    def run_merge(
        self, phase: Mapping[str, Any], components: list[Mapping[str, Any]]
    ) -> PhaseOutcome:
        """Apply every component's contribution to the shared files, single-threaded."""
        phase_id = str(phase["id"])
        self.state.set_phase(phase_id, "RUNNING")
        emit(f"\n[{phase_id}] merging component contributions", "cyan")
        if self.dry_run:
            emit("  -- merge skipped (dry run)", "dim")
            self.state.set_phase(phase_id, "PASS")
            return PhaseOutcome(phase_id=phase_id, status="PASS")
        try:
            report = merge_contributions(self.settings, self.evidence_dir, components)
        except MergeError as error:
            emit(f"  !! merge failed: {error}", "red")
            self.state.set_phase(phase_id, "FAIL", error=str(error))
            return PhaseOutcome(phase_id=phase_id, status="FAIL")

        for path in report.merged_files:
            emit(f"  merged {path}", "dim")
        emit(f"  {len(report.nodes_written)} authored node(s) written in source order", "green")
        if report.filter_roots_added:
            emit(f"  {len(report.filter_roots_added)} filter root(s) added", "dim")

        status = "PASS"
        if report.missing_components:
            # A component that contributed nothing would silently vanish from the page.
            emit(
                "  !! no contribution from: " + ", ".join(report.missing_components),
                "red",
            )
            status = "FAIL"
        self.state.set_phase(phase_id, status, **report.to_dict())
        result = AgentResult("merge", self.run_id, status, outputs={"changed_files": report.merged_files})
        self._save_checkpoint()
        return PhaseOutcome(phase_id=phase_id, status=status, results=[result])

    def _run_worker(self, phase: Mapping[str, Any], **kwargs: Any) -> tuple[AgentResult, ChangeSet | None]:
        agent = self._agent(phase)
        if self.dry_run:
            return agent.run(**kwargs), None
        slug = agent.slug(**kwargs)
        worker = WorkerWorkspace.create(
            self.settings.repo_root, self.evidence_dir / "workspaces" / slug,
            foundation_scopes(self.settings) if agent.agent_id == "planner" else component_scopes(self.settings, kwargs["component"]),
            evidence_dir=self.evidence_dir,
        )
        migration = self.settings.migration
        if agent.agent_id == "planner":
            cache = self.settings.resolve(str(migration.get("discovery.inventory_cache_dir", "design/site-url/scripts/.tools/inventory")))
            migration = migration.merged({"discovery": {"inventory_cache_dir": str(cache)}})
        isolated_settings = Settings(worker.root, migration, self.settings._agents_config)
        agent.context = replace(agent.context, settings=isolated_settings)
        result = agent.run(**kwargs)
        changes = worker.collect()
        result.outputs["changed_files"] = sorted(changes.changed)
        result.outputs["worker_directory"] = str(worker.root)
        return result, changes if result.passed else None

    def run_planner(self, phase: Mapping[str, Any], **kwargs: Any) -> PhaseOutcome:
        phase_id = str(phase["id"])
        self.state.set_phase(phase_id, "RUNNING")
        operation = "repairing shared foundations" if kwargs.get("repair") else "planning and establishing shared foundations"
        emit(f"\n[{phase_id}] {operation}", "cyan")
        try:
            baseline = source_manifest(self.settings.repo_root, excluded=[self.evidence_dir]) if not self.dry_run else {}
            result, changes = self._run_worker(phase, **kwargs)
            if not self.dry_run:
                if source_manifest(self.settings.repo_root, excluded=[self.evidence_dir]) != baseline:
                    raise WorkspaceError("The shared checkout changed during planning/foundation work; no changes were applied.")
                if result.passed and changes is not None:
                    apply_changes(self.settings.repo_root, [changes])
        except (EnvelopeError, BackendError, ConfigError, OSError, ValueError) as error:
            result = AgentResult("planner", self.run_id, "FAIL", failures=[str(error)])
        if result.path:
            dump_json(Path(result.path), result.to_dict())
        slug = self._agent(phase).slug(**kwargs)
        saved = self.state.get("agent_results", {}).get(slug, {})
        self.state.record_agent_result(slug, {**saved, **result.to_dict()})
        self.state.set_phase(phase_id, result.status)
        return PhaseOutcome(phase_id, result.status, [result])

    def _persist_worker(self, result: AgentResult, component: Mapping[str, Any], attempt: int) -> None:
        slug = f"component-{component['id']}-attempt-{attempt}"
        self.state.record_agent_result(slug, result.to_dict())
        if result.path:
            dump_json(Path(result.path), result.to_dict())

    def run_fanout(
        self,
        phase: Mapping[str, Any],
        components: list[Mapping[str, Any]],
        feedback: Mapping[str, Mapping[str, Any]] | None = None,
        attempt: int = 1,
    ) -> PhaseOutcome:
        rows = self.state.component_rows()
        plan = [row["plan"] for row in rows]
        validate_ownership(self.settings, plan)
        pending = {str(component["id"]) for component in components}
        completed = {row["id"] for row in rows if row.get("status") == "PASS" and row["id"] not in pending}
        waves = dependency_waves(plan, completed)
        if any(component["id"] not in pending for wave in waves for component in wave):
            raise PipelineError("Implementation was requested without its unfinished dependencies.")
        for component_id in pending:
            self.state.update_component(component_id, status="PLANNED")
        results = []
        for wave in waves:
            outcome = self._run_component_batch(phase, wave, feedback, attempt)
            results.extend(outcome.results)
            if not outcome.passed:
                return PhaseOutcome(str(phase["id"]), outcome.status, results)
        return PhaseOutcome(str(phase["id"]), "PASS", results)

    def _run_component_batch(
        self,
        phase: Mapping[str, Any],
        components: list[Mapping[str, Any]],
        feedback: Mapping[str, Mapping[str, Any]] | None = None,
        attempt: int = 1,
    ) -> PhaseOutcome:
        phase_id = str(phase["id"])
        self.state.set_phase(phase_id, "RUNNING", fanout=len(components), attempt=attempt)
        emit(
            f"\n[{phase_id}] fanning out {len(components)} agent(s), "
            f"{self.max_parallel} at a time (attempt {attempt}/{self.max_attempts})",
            "cyan",
        )

        results: list[AgentResult] = []
        errors: list[str] = []
        feedback = feedback or {}
        validate_ownership(self.settings, components)
        baseline = source_manifest(self.settings.repo_root, excluded=[self.evidence_dir]) if not self.dry_run else {}
        validated: list[tuple[Mapping[str, Any], AgentResult, ChangeSet | None]] = []

        pool = concurrent.futures.ThreadPoolExecutor(
            max_workers=self.max_parallel, thread_name_prefix="component"
        )
        futures = {}
        try:
            for component in components:
                self.state.update_component(str(component["id"]), status="RUNNING", attempts=attempt)
            futures = {
                pool.submit(
                    self._run_worker,
                    phase,
                    component=component,
                    attempt=attempt,
                    feedback=feedback.get(str(component.get("id"))),
                ): component
                for component in components
            }
            for future in concurrent.futures.as_completed(futures):
                component = futures[future]
                component_id = str(component.get("id"))
                try:
                    result, changes = future.result()
                except (EnvelopeError, BackendError, ConfigError, OSError, ValueError,
                    concurrent.futures.CancelledError) as error:
                    errors.append(f"{component_id}: {error}")
                    self.state.update_component(component_id, status="ERROR", error=str(error))
                    emit(f"  !! {component_id} failed: {error}", "red")
                    if self.stop_on_first_failure:
                        for pending in futures:
                            pending.cancel()
                    continue
                results.append(result)
                validated.append((component, result, changes))
                self.state.update_component(
                    component_id,
                    status="VALIDATED" if result.passed else result.status,
                    attempts=attempt,
                    changed_files=result.output("changed_files", []),
                    resource_type=result.output("resource_type"),
                )
        except KeyboardInterrupt:
            for pending in futures:
                pending.cancel()
            if self.context is not None and self.context.backend is not None:
                self.context.backend.cancel_all()
            raise
        finally:
            pool.shutdown(wait=True, cancel_futures=True)

        changes_applied = True
        try:
            if not self.dry_run:
                if source_manifest(self.settings.repo_root, excluded=[self.evidence_dir]) != baseline:
                    raise WorkspaceError("The shared checkout changed during fan-out; no worker changes were applied.")
                apply_changes(self.settings.repo_root, [changes for _, result, changes in validated if result.passed and changes is not None])
        except WorkspaceError as error:
            changes_applied = False
            errors.append(str(error))
            for _, result, _ in validated:
                if result.passed:
                    result.status = "FAIL"
                    result.failures.append(str(error))
        for component, result, _ in validated:
            self.state.update_component(str(component["id"]), status=result.status, changed_files=result.output("changed_files", []))
            self._persist_worker(result, component, attempt)

        status = "PASS" if results and not errors and all(r.passed for r in results) else "FAIL"
        if any(r.blocked for r in results):
            status = "BLOCKED"
        self.state.set_phase(phase_id, status, errors=errors)
        if changes_applied:
            self._save_checkpoint()
        return PhaseOutcome(phase_id=phase_id, status=status, results=results)

    # -- pipeline ----------------------------------------------------------

    def run(self) -> str:
        emit(f"\nRun ID:   {self.run_id}")
        emit(f"Evidence: {self.evidence_dir}")
        emit(f"Source:   {self.contract.site_url}")
        emit(f"Gate:     visualMatchRatio {self.contract.visual_pass_ratio}")

        phases = {str(phase["id"]): phase for phase in self.settings.phases()}
        remediation_ids = [
            str(pid) for pid in self.settings.migration.get("pipeline.remediation.phases", [])
        ]
        terminal_status = str(
            self.settings.migration.get("pipeline.remediation.terminal_status", "FAILED-FINAL")
        )

        components: list[Mapping[str, Any]] = []
        pipeline_status = "FAIL"

        try:
            self.preflight()
            # 1 — plan
            plan_phase = self._phase(phases, "plan", remediation_ids)
            saved_plan = self.state.get("agent_results", {}).get("planner", {})
            if self.resume and saved_plan.get("status") == "PASS":
                result = self._cached_result(plan_phase)
                components = list(result.output("components"))
                if not self.state.component_rows():
                    self.state.set_components(components)
                elif {row["id"]: row["plan"] for row in self.state.component_rows()} != {row["id"]: row for row in components}:
                    raise PipelineError("Saved component state does not match the validated plan.")
                self.state.set_phase("plan", "PASS")
            elif self._wants(plan_phase["id"]):
                outcome = self.run_planner(plan_phase)
                if not outcome.passed:
                    return self._finish(phases, outcome.status, terminal_status)
                result = outcome.results[0]
                components = list(result.output("components") or [])
                self.state.set_components(components)
                self.state.update(foundations={"attempt": 0, "changed_files": result.output("changed_files", [])})
                self._save_checkpoint()
                emit(f"  plan: {len(components)} component(s)", "green")
            else:
                raise PipelineError("There is no validated plan to resume.")

            # 2 — implement, deploy, score, remediate
            pipeline_status = self._implement_and_gate(
                phases, components, remediation_ids, terminal_status
            )
        except (PipelineError, EnvelopeError, BackendError, ConfigError, OSError, ValueError) as error:
            emit(f"\nERROR: {error}", "red")
            if self.logger:
                self.logger.exception("Pipeline error")
            self.state.update(status="FAIL", error=str(error))
            current = self.state.get("current_phase")
            if current:
                self.state.set_phase(current, "FAIL", error=str(error))
            pipeline_status = "FAIL"
        except KeyboardInterrupt:
            self.state.update(status="INTERRUPTED")
            current = self.state.get("current_phase")
            if current:
                self.state.set_phase(current, "INTERRUPTED")
            raise

        return self._finish(phases, pipeline_status, terminal_status)

    def _phase(
        self, phases: Mapping[str, Any], phase_id: str, _remediation: list[str]
    ) -> Mapping[str, Any]:
        if phase_id not in phases:
            raise PipelineError(
                f"migration.yaml has no pipeline phase '{phase_id}'. "
                f"Declared phases: {', '.join(phases)}"
            )
        return phases[phase_id]

    def _implement_and_gate(
        self,
        phases: Mapping[str, Any],
        components: list[Mapping[str, Any]],
        remediation_ids: list[str],
        terminal_status: str,
    ) -> str:
        implement = self._phase(phases, "implement", remediation_ids)
        plan_phase = self._phase(phases, "plan", remediation_ids)
        assets = phases.get("assets")
        merge = phases.get("merge")
        deploy = self._phase(phases, "deploy", remediation_ids)
        parity = self._phase(phases, "parity", remediation_ids)

        by_id = {str(component["id"]): component for component in components}
        pending = list(components)
        feedback: dict[str, Mapping[str, Any]] = {}
        attempts: dict[str, int] = {str(component["id"]): 0 for component in components}
        changed_files: set[str] = {path for row in self.state.component_rows() for path in row.get("changed_files", [])}
        saved_foundations = self.state.get("foundations", {})
        if not saved_foundations:
            raise PipelineError("No validated planner foundations are available.")
        changed_files.update(saved_foundations.get("changed_files", []))
        needs_implementation = True
        foundations_ready = True
        first_attempt = 1
        if self.resume:
            if saved_foundations["attempt"]:
                result = self._cached_result(plan_phase, components=components, repair=True, attempt=saved_foundations["attempt"])
                changed_files.update(result.output("changed_files", []))
            history = self.state.get("remediation_history", [])
            first_attempt = max((int(entry["attempt"]) for entry in history), default=0) + 1
            if history:
                feedback = {entry["component_id"]: entry for entry in history[-1].get("failing", []) if entry.get("component_id") in by_id}
                if any(entry.get("owning_layer") == "foundation" for entry in feedback.values()):
                    foundations_ready = False
            reusable = set()
            for row in self.state.component_rows():
                if row.get("status") == "PASS":
                    result = self._cached_result(implement, component=by_id[row["id"]], attempt=int(row["attempts"]))
                    changed_files.update(result.output("changed_files", []))
                    reusable.add(row["id"])
            pending = [component for component in components if component["id"] not in reusable]
            unfinished_attempt = max((int(row.get("attempts", 0)) for row in self.state.component_rows() if row["id"] not in reusable), default=0)
            first_attempt = max(first_attempt, unfinished_attempt + 1)
            needs_implementation = bool(pending) and (not feedback or any(entry.get("owning_layer") != "evidence" for entry in feedback.values()))
            if history and history[-1].get("status") == "PASS" and not pending:
                first_attempt = min(first_attempt, self.max_attempts)

        for attempt in range(first_attempt, self.max_attempts + 1):
            if not foundations_ready:
                if not self._wants(plan_phase["id"]):
                    return "FAIL"
                outcome = self.run_planner(plan_phase, components=components, feedback=feedback, repair=True, attempt=attempt)
                if outcome.status == "BLOCKED":
                    return "BLOCKED"
                if not outcome.passed:
                    self._record_attempt(attempt, pending, "FOUNDATIONS_FAILED")
                    continue
                foundation_changes = {path for result in outcome.results for path in result.output("changed_files", [])}
                changed_files.update(foundation_changes)
                shared_changes = set(self.state.get("foundations", {}).get("changed_files", [])) | foundation_changes
                self.state.update(foundations={"attempt": attempt, "changed_files": sorted(shared_changes)})
                self._save_checkpoint()
                foundations_ready = True
                if foundation_changes and (attempt > 1 or self.resume):
                    pending = list(components)
                    needs_implementation = True
            for component in pending:
                attempts[str(component["id"])] = attempt

            if needs_implementation and self._wants(implement["id"]):
                outcome = self.run_fanout(implement, pending, feedback, attempt)
                if outcome.status == "BLOCKED":
                    return "BLOCKED"
                for result in outcome.results:
                    changed_files.update(result.output("changed_files", []) or [])
                if not outcome.passed:
                    for result in outcome.results:
                        requests = result.output("foundation_requests", [])
                        component_id = result.output("component_id")
                        if requests and component_id in by_id:
                            foundations_ready = False
                            feedback[component_id] = {"component_id": component_id, "owning_layer": "foundation", "requests": requests}
                    self._record_attempt(attempt, pending, "IMPLEMENT_FAILED", list(feedback.values()))
                    failed_ids = {row["id"] for row in self.state.component_rows() if row.get("status") != "PASS"}
                    pending = [component for component in pending if component["id"] in failed_ids]
                    if not pending:
                        return "FAIL"
                    continue
                needs_implementation = False

            if assets is not None and self._wants(str(assets["id"])):
                outcome = self.run_assets(assets, components)
                if not outcome.passed:
                    emit("  asset upload failed; the page would render broken media.", "red")
                    self._record_attempt(attempt, pending, "ASSETS_FAILED")
                    continue

            if merge is not None and self._wants(str(merge["id"])):
                outcome = self.run_merge(merge, components)
                if not outcome.passed:
                    emit("  merge failed; deploying now would ship a page missing components.", "red")
                    self._record_attempt(attempt, pending, "MERGE_FAILED")
                    needs_implementation = True
                    continue
                for result in outcome.results:
                    changed_files.update(result.output("changed_files", []))

            if self._wants(deploy["id"]):
                outcome = self.run_single(deploy, changed_files=sorted(changed_files), attempt=attempt)
                if outcome.status == "BLOCKED":
                    return "BLOCKED"
                if not outcome.passed:
                    emit("  deploy failed; parity cannot be scored on a stale target.", "red")
                    self._record_attempt(attempt, pending, "DEPLOY_FAILED")
                    continue
                self.state.update(target_url=outcome.results[0].output("target_url"))

            if not self._wants(parity["id"]):
                return "FAIL"

            outcome = self.run_single(parity, components=components, attempt=attempt)
            if outcome.status == "BLOCKED":
                return "BLOCKED"

            failing = list(outcome.results[0].output("failing_components") or []) if outcome.results else []
            self._record_attempt(attempt, pending, outcome.status, failing)

            if outcome.passed and outcome.results and not failing:
                if self.dry_run:
                    return "DRY_RUN"
                for component_id in by_id:
                    self.state.update_component(component_id, status="PASS")
                emit(
                    f"\nVisual parity gate passed on attempt {attempt} "
                    f"(threshold {self.contract.visual_pass_ratio}).",
                    "green",
                )
                return "COMPLETE"

            if not failing:
                continue

            feedback = {
                str(item.get("component_id")): item
                for item in failing
                if isinstance(item, Mapping) and item.get("component_id") in by_id
            }
            unknown = {
                str(item.get("component_id"))
                for item in failing
                if isinstance(item, Mapping) and item.get("component_id") not in by_id
            }
            if unknown:
                emit(
                    "  parity reported components that are not in the plan: "
                    + ", ".join(sorted(unknown)),
                    "yellow",
                )
                return "FAIL"
            pending = affected_components(components, set(feedback))
            needs_implementation = any(item.get("owning_layer") != "evidence" for item in feedback.values())
            if any(item.get("owning_layer") == "foundation" for item in feedback.values()):
                foundations_ready = False
            emit(
                f"  {len(pending)} component(s) below threshold: "
                + ", ".join(sorted(feedback)),
                "yellow",
            )
            for component_id in feedback:
                self.state.update_component(component_id, status="FAILED", attempts=attempt)

        for component_id in (str(c["id"]) for c in pending):
            self.state.update_component(component_id, status=terminal_status)
        if pending:
            emit(
                f"\nAttempt budget of {self.max_attempts} exhausted; "
                f"{len(pending)} component(s) marked {terminal_status}.",
                "red",
            )
        return "FAIL"

    def _record_attempt(
        self,
        attempt: int,
        components: Iterable[Mapping[str, Any]],
        status: str,
        failing: list[Any] | None = None,
    ) -> None:
        self.state.append_remediation(
            {
                "attempt": attempt,
                "status": status,
                "components": [str(component["id"]) for component in components],
                "failing": failing or [],
            }
        )

    def run_report(self, phase: Mapping[str, Any], *, pipeline_status: str) -> PhaseOutcome:
        phase_id = str(phase["id"])
        self.state.set_phase(phase_id, "RUNNING")
        state = self.state.data
        results = {key: value for key, value in state["agent_results"].items() if key != "report"}

        def latest(agent_id: str) -> tuple[str, Mapping[str, Any]]:
            candidates = [(key, value) for key, value in results.items() if value.get("agent") == agent_id]
            def attempt(entry: tuple[str, Mapping[str, Any]]) -> int:
                match = re.search(r"-attempt-(\d+)$", entry[0])
                return int(match.group(1)) if match else 0
            return max(candidates, key=attempt, default=("not recorded", {}))

        def records(value: Any) -> list[Mapping[str, Any]]:
            return [row for row in value if isinstance(row, Mapping)] if isinstance(value, list) else []

        def valid_score(row: Mapping[str, Any]) -> bool:
            ratio = row.get("ratio")
            recorded = verified_rows.get(score_key(row))
            return (
                row.get("screenshot_validation") == "PASS" and type(ratio) in (int, float) and 0 <= ratio <= 1
                and type(row.get("matched_pixels")) is int and type(row.get("total_pixels")) is int
                and 0 <= row["matched_pixels"] <= row["total_pixels"] and row["total_pixels"] > 0
                and recorded is not None
                and all(row.get(key) == recorded.get(key) for key in ("ratio", "matched_pixels", "total_pixels", "image_hashes", "scorer_revision"))
            )

        parity_slug, parity_result = latest("parity")
        parity = parity_result.get("outputs", {}) if parity_result.get("run_id") == self.run_id else {}
        def score_key(row: Mapping[str, Any]) -> tuple[str, ...]:
            return tuple(str(row.get(key, "")) for key in ("component_id", "instance_id", "breakpoint", "mode", "source_image", "target_image"))

        verified_rows = {}
        receipt_error = None
        verification = parity.get("verification")
        if isinstance(verification, Mapping):
            try:
                receipt_path = self.settings.resolve(verification["path"]).resolve()
                if not receipt_path.is_relative_to(self.evidence_dir) or digest(receipt_path) != verification.get("sha256"):
                    raise ValueError("The scoring receipt is missing, changed or outside this run.")
                receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
                if not isinstance(receipt, Mapping) or receipt.get("run_id") != self.run_id:
                    raise ValueError("The scoring receipt belongs to a different run.")
                verified_rows = {score_key(row): row for row in records(receipt.get("measurements"))}
            except (KeyError, TypeError, ValueError, OSError, WorkspaceError) as error:
                receipt_error = str(error)
        scores = records(parity.get("scores"))
        composites = records(parity.get("page_composites"))
        rows = state["components"]
        expected = [results.get("planner", {}), latest("deployer")[1], parity_result]
        expected.extend(results.get(f"component-{row['id']}-attempt-{row['attempts']}", {}) for row in rows)
        if pipeline_status == "COMPLETE" and (
            any(result.get("run_id") != self.run_id or result.get("status") != "PASS" for result in expected)
            or not scores or not composites or not parity.get("verification") or parity.get("failing_components")
            or any(not valid_score(row) or not self.contract.visual_pass_ratio.passes(row["ratio"]) for row in scores + composites)
        ):
            pipeline_status = "FAIL"
            self.state.update(error="Completion report is missing current-run passing results or verified visual scores.")

        diagnostics = {}
        for entry in state["remediation_history"]:
            diagnostics.update({row.get("component_id"): row for row in records(entry.get("failing"))})
        diagnostics.update({row.get("component_id"): row for row in records(parity.get("failing_components"))})
        gaps = []
        if pipeline_status not in {"COMPLETE", "DRY_RUN"}:
            for component in rows:
                component_id = component["id"]
                detail = diagnostics.get(component_id, {})
                if component.get("status") == "PASS" and parity_result.get("run_id") == self.run_id and parity_result.get("status") == "PASS" and scores and composites and all(valid_score(row) for row in scores + composites) and not detail:
                    continue
                measured = [row["ratio"] for row in scores if row.get("component_id") == component_id and valid_score(row)]
                gaps.append({
                    "component_id": component_id, "status": component.get("status"),
                    "attempts": component.get("attempts", 0), "breakpoints": detail.get("breakpoints", self.contract.breakpoints),
                    "worst_ratio": min(measured) if measured else None,
                    "owning_layer": detail.get("owning_layer", "evidence"),
                    "reason": detail.get("hypothesis") or self.state.get("error") or f"Run ended with {pipeline_status}; visual completion was not established.",
                    "evidence": detail.get("evidence", []),
                })

        attempts = max((entry.get("attempt", 0) for entry in state["remediation_history"]), default=0)
        status_line = {
            "COMPLETE": f"VISUAL PARITY GATE: PASSED at {self.contract.breakpoints} with {attempts} attempts (required {self.contract.visual_pass_ratio})",
            "BLOCKED": "VISUAL PARITY GATE: BLOCKED - see recorded failures and evidence",
            "DRY_RUN": "VISUAL PARITY GATE: NOT RUN - dry run; no live evidence collected",
        }.get(pipeline_status, f"VISUAL PARITY GATE: FAILED - {len(gaps)} unresolved components - see residual gaps and failed phases")
        sections = [
            "# Migration Completion Report", f"Run: `{self.run_id}`", f"Status: **{pipeline_status}**",
            status_line, f"Source: {self.contract.site_url}", f"AEM page: {state.get('target_url') or 'not recorded'}",
            f"Run state: {self.state.path}", f"Latest persisted parity result: {parity_slug}",
            "Only recorded evidence is shown. Missing values are not inferred. Ratios use the 0-1 scale.",
        ]

        def table(title: str, entries: list[Mapping[str, Any]], columns: list[tuple[str, str]]) -> None:
            cells = [{key: to_text(value).replace("\r", "").replace("\n", "<br>") for key, value in entry.items()} for entry in entries]
            sections.extend([f"## {title}", markdown_table(cells, columns)])

        table("Phases", [entry for entry in state["phases"] if entry["id"] != phase_id],
              [("Phase", "id"), ("Status", "status"), ("Error", "error")])
        table("Component Ledger", rows, [("Component", "id"), ("Status", "status"), ("Attempts", "attempts"), ("Changed files", "changed_files")])
        score_columns = [
            ("Component", "component_id"), ("Instance", "instance_id"), ("Viewport", "breakpoint"), ("Mode", "mode"), ("DPR", "dpr"),
            ("Content", "content_score"), ("Typography", "typography_score"), ("Color", "color_score"), ("Layout", "layout_score"),
            ("Section order", "section_order_score"), ("Media/interaction", "media_interaction_score"), ("Property", "property_score"),
            ("Screenshot ratio", "ratio"), ("Authorability", "authorability_score"), ("Final minimum (reported)", "final_minimum"),
            ("Screenshot validation", "screenshot_validation"), ("Matched pixels", "matched_pixels"),
            ("Differing pixels", "differing_pixels"), ("Total pixels", "total_pixels"),
            ("Live URL", "live_url"), ("AEM URL", "aem_url"), ("Live screenshot", "source_image"), ("AEM screenshot", "target_image"),
            ("Side-by-side", "side_by_side"), ("Diff mask", "diff_mask"),
        ]
        capture_keys = {"component_id", "instance_id", "breakpoint", "mode", "dpr", "live_url", "aem_url", "source_image", "target_image", "side_by_side", "diff_mask"}
        for title, entries in (("Instance Scores", scores), ("Page Composites", composites)):
            sanitized = [{**row, "differing_pixels": row["total_pixels"] - row["matched_pixels"]} if valid_score(row) else {
                **{key: value for key, value in row.items() if key in capture_keys},
                "screenshot_validation": "SCORE WITHHELD - INVALID OR MISSING SCREENSHOT EVIDENCE",
            } for row in entries]
            table(title, sanitized, score_columns)

        minima = []
        for group, entries, key in (("instance", scores, "instance_id"), ("component type", scores, "component_id"), ("page composite", composites, None)):
            identities = sorted({str(row.get(key, "unknown")) if key else "page" for row in entries})
            for identity in identities:
                selected = [row for row in entries if key is None or str(row.get(key, "unknown")) == identity]
                minima.append({"group": group, "id": identity, "ratio": min(row["ratio"] for row in selected) if all(valid_score(row) for row in selected) else "SCORE WITHHELD"})
        table("Cross-Breakpoint Screenshot Minima", minima, [("Group", "group"), ("Identity", "id"), ("Minimum recorded ratio", "ratio")])

        artifacts = []
        ledger = []
        failures = []
        for slug, result in results.items():
            outputs = result.get("outputs", {})
            ledger.append({"invocation": slug, "status": result.get("status"), "run_id": result.get("run_id"),
                           "result_path": result.get("result_path"), "changed_files": outputs.get("changed_files", []),
                           "deploy_commands": outputs.get("deploy_commands", [])})
            for name in ("coverage_report", "source_selector_map", "geometry_tables", "color_authorability_matrix", "authorability_matrix",
                         "asset_manifest", "media_manifest", "token_manifest", "readiness_matrix", "screenshot_index", "runtime_sweep", "verification"):
                if name in outputs:
                    artifacts.append({"invocation": slug, "kind": name, "evidence": outputs[name]})
            failures.extend({"invocation": slug, "failure": failure} for failure in result.get("failures", []))
            failures.extend({"invocation": slug, "failure": check} for check in records(result.get("checks")) if check.get("status") != "PASS")
        if self.state.get("error"):
            failures.append({"invocation": "orchestrator", "failure": self.state.get("error")})
        if receipt_error:
            failures.append({"invocation": parity_slug, "failure": receipt_error})
        table("Coverage, Geometry, Authorability and Asset Evidence", artifacts, [("Invocation", "invocation"), ("Kind", "kind"), ("Recorded evidence", "evidence")])
        asset_phase = next((entry for entry in state["phases"] if entry["id"] == "assets"), {})
        table("Asset Transfers", [{"kind": name, "records": asset_phase[name]} for name in ("uploaded", "skipped", "failed") if name in asset_phase], [("Outcome", "kind"), ("Records", "records")])
        table("Invocation and Deployment Ledger", ledger, [("Invocation", "invocation"), ("Run", "run_id"), ("Status", "status"), ("Result", "result_path"), ("Changed files", "changed_files"), ("Deploy commands", "deploy_commands")])
        table("Remediation History", state["remediation_history"], [("Attempt", "attempt"), ("Status", "status"), ("Components", "components")])
        table("Recorded Failures", failures, [("Invocation", "invocation"), ("Failure", "failure")])
        table("Residual Gaps", gaps, [("Component", "component_id"), ("Status", "status"), ("Attempts", "attempts"), ("Breakpoints", "breakpoints"),
                                      ("Recorded ratio", "worst_ratio"), ("Owning layer", "owning_layer"), ("Reason", "reason"), ("Evidence", "evidence")])
        report_path = (self.evidence_dir / str(self.settings.migration.get("run.report_file", "completion-report.md"))).resolve()
        if not report_path.is_relative_to(self.evidence_dir):
            raise PipelineError("The completion report must remain inside the run evidence directory.")
        report_path.parent.mkdir(parents=True, exist_ok=True)
        report_path.write_text("\n\n".join(sections) + "\n", encoding="utf-8")
        result = AgentResult("report", self.run_id, "PASS", outputs={
            "report_path": str(report_path), "pipeline_status": pipeline_status,
            "status_line": status_line, "residual_gaps": gaps,
        })
        result.path = str(self.evidence_dir / "report-result.json")
        dump_json(Path(result.path), result.to_dict())
        self.state.record_agent_result("report", result.to_dict())
        self.state.set_phase(phase_id, "PASS", report_path=str(report_path))
        emit(f"  report: {report_path}", "dim")
        return PhaseOutcome(phase_id, "PASS", [result])

    def _finish(
        self, phases: Mapping[str, Any], pipeline_status: str, terminal_status: str
    ) -> str:
        if pipeline_status == "COMPLETE" and not self.dry_run:
            statuses = {phase["id"]: phase["status"] for phase in self.state.get("phases", [])}
            missing = [phase_id for phase_id in phases if phase_id != "report" and statuses.get(phase_id) != "PASS"]
            rows = self.state.component_rows()
            if missing or not rows or any(row.get("status") != "PASS" for row in rows):
                pipeline_status = "FAIL"
                self.state.update(error=f"Completion prerequisites not satisfied: {missing or 'components'}")
        if self.dry_run and pipeline_status == "COMPLETE":
            pipeline_status = "DRY_RUN"
        self.state.update(status=pipeline_status)
        report_phase = phases.get("report")
        if report_phase and self._wants("report"):
            try:
                outcome = self.run_report(report_phase, pipeline_status=pipeline_status)
                if not outcome.passed:
                    pipeline_status = "FAIL"
                elif pipeline_status == "COMPLETE" and (
                    not outcome.results or outcome.results[0].output("pipeline_status") != "COMPLETE"
                    or outcome.results[0].output("residual_gaps")
                ):
                    pipeline_status = "FAIL"
            except (PipelineError, EnvelopeError, ConfigError, OSError, ValueError) as error:
                emit(f"  !! report generation failed: {error}", "red")
                if self.logger:
                    self.logger.exception("Report generation failed")
                self.state.record_agent_result("report", AgentResult("report", self.run_id, "FAIL", failures=[str(error)]).to_dict())
                self.state.set_phase("report", "FAIL", error=str(error))
                pipeline_status = "FAIL"
        elif pipeline_status == "COMPLETE" and not self.dry_run:
            pipeline_status = "FAIL"

        self.state.update(status=pipeline_status)
        color = {"COMPLETE": "green", "BLOCKED": "yellow"}.get(pipeline_status, "red")
        emit(f"\nRun {self.run_id} finished: {pipeline_status}", color)
        emit(f"Evidence: {self.evidence_dir}")
        target_url = self.state.get("target_url")
        if target_url:
            emit(f"AEM page: {target_url}")
        unresolved = [
            row["id"] for row in self.state.component_rows() if row.get("status") == terminal_status
        ]
        if unresolved:
            emit(f"Unresolved components: {', '.join(unresolved)}", "red")
        return pipeline_status
