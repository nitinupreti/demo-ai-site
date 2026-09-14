"""The orchestration agent.

Drives the configured pipeline: plan once, fan out one implementation agent per
planned component, hand the union of code changes to the deployer, gate on visual
parity against the threshold in the prompt contract, and remediate within the
attempt budget before reporting.
"""

from __future__ import annotations

import concurrent.futures
import urllib.error
import urllib.request
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable, Mapping

from .config import ConfigError, Settings
from .console import emit
from .contract import RunContract
from .envelope import AgentResult, EnvelopeError
from .assets import AssetError, fetch_assets
from .merge import MergeError, merge_contributions
from .runner import BackendError, create_backend
from .state import RunState
from .toolchain import ToolchainError, resolve_java_home
from .agents import AGENT_CLASSES, RunContext


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
    ) -> None:
        self.settings = settings
        self.contract = contract
        self.run_id = run_id or str(uuid.uuid4())
        self.dry_run = dry_run
        self.skip_probe = skip_probe
        self.only_phases = only_phases
        self.logger = logger

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

        self.state = RunState.create(
            self.evidence_dir / str(settings.migration.get("run.state_file", "run-state.json")),
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
        self.context: RunContext | None = None

    # -- setup -------------------------------------------------------------

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

        toolchain = resolve_java_home(self.settings)
        emit(f"  JAVA_HOME: {toolchain.java_home} (from {toolchain.source})", "green")
        self.state.update(toolchain={"java_home": str(toolchain.java_home), "source": toolchain.source})

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
        )

    # -- phase dispatch ----------------------------------------------------

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
        try:
            result = agent.run(**kwargs)
        except (EnvelopeError, BackendError, OSError, ValueError) as error:
            result = AgentResult(str(phase["agent"]), self.run_id, "FAIL", failures=[str(error)])
            self.state.record_agent_result(agent.slug(**kwargs), result.to_dict())
            emit(f"  !! {phase_id}: {error}", "red")
        self.state.set_phase(phase_id, result.status)
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
        return PhaseOutcome(phase_id=phase_id, status=status, results=[result])

    def run_fanout(
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

        with concurrent.futures.ThreadPoolExecutor(
            max_workers=self.max_parallel, thread_name_prefix="component"
        ) as pool:
            futures = {
                pool.submit(
                    self._agent(phase).run,
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
                    result = future.result()
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
                self.state.update_component(
                    component_id,
                    status=result.status,
                    attempts=attempt,
                    changed_files=result.output("changed_files", []),
                    resource_type=result.output("resource_type"),
                )

        status = "PASS" if results and not errors and all(r.passed for r in results) else "FAIL"
        if any(r.blocked for r in results):
            status = "BLOCKED"
        self.state.set_phase(phase_id, status, errors=errors)
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
            if self._wants(plan_phase["id"]):
                outcome = self.run_single(plan_phase)
                if not outcome.passed:
                    return self._finish(phases, outcome.status, terminal_status)
                components = list(outcome.results[0].output("components") or [])
                self.state.set_components(components)
                emit(f"  plan: {len(components)} component(s)", "green")
            else:
                components = [row["plan"] for row in self.state.component_rows()]

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
        assets = phases.get("assets")
        merge = phases.get("merge")
        deploy = self._phase(phases, "deploy", remediation_ids)
        parity = self._phase(phases, "parity", remediation_ids)

        by_id = {str(component["id"]): component for component in components}
        pending = list(components)
        feedback: dict[str, Mapping[str, Any]] = {}
        attempts: dict[str, int] = {str(component["id"]): 0 for component in components}
        changed_files: set[str] = set()
        needs_implementation = True

        for attempt in range(1, self.max_attempts + 1):
            if not pending:
                break
            for component in pending:
                attempts[str(component["id"])] = attempt

            if needs_implementation and self._wants(implement["id"]):
                outcome = self.run_fanout(implement, pending, feedback, attempt)
                if outcome.status == "BLOCKED":
                    return "BLOCKED"
                for result in outcome.results:
                    changed_files.update(result.output("changed_files", []) or [])
                if not outcome.passed:
                    self._record_attempt(attempt, pending, "IMPLEMENT_FAILED")
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
            pending = [by_id[component_id] for component_id in feedback]
            needs_implementation = any(item.get("owning_layer") != "evidence" for item in feedback.values())
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
        self.state.update(status=pipeline_status)
        report_phase = phases.get("report")
        if report_phase and self._wants("report") and not self.dry_run and self.context is not None:
            try:
                outcome = self.run_single(report_phase, pipeline_status=pipeline_status)
                if pipeline_status == "COMPLETE" and (
                    not outcome.passed or not outcome.results or outcome.results[0].status != "COMPLETE"
                    or outcome.results[0].output("residual_gaps", [])
                ):
                    pipeline_status = "FAIL"
            except (EnvelopeError, BackendError, ConfigError, OSError, ValueError) as error:
                emit(f"  !! reporter failed: {error}", "red")
                if self.logger:
                    self.logger.exception("Reporter failed")
                pipeline_status = "FAIL"
        elif pipeline_status == "COMPLETE" and not self.dry_run:
            pipeline_status = "FAIL"

        if self.dry_run and pipeline_status == "COMPLETE":
            pipeline_status = "DRY_RUN"

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
