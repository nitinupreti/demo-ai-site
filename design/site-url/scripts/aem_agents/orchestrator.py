"""The orchestration agent.

Drives the configured pipeline: plan once, fan out one implementation agent per
planned component, hand the union of code changes to the deployer, gate on visual
parity against the threshold in the prompt contract, and remediate within the
attempt budget before reporting.
"""

from __future__ import annotations

import concurrent.futures
import hashlib
import json
import logging
import re
import shutil
import stat
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
from .assets import AssetDeclarationError, AssetError, fetch_assets
from .merge import MergeError, latest_contribution_path, merge_contributions
from .render import markdown_table, to_text
from .runner import BackendError, create_backend, run_command
from .scoring import PixelScorer
from .state import RunState, ensure_resumable_run, utc_now
from .toolchain import check_maven, check_node, resolve_java_home
from .agents import AGENT_CLASSES, RunContext
from .agents.base import dump_json
from .workspaces import ChangeSet, WorkerWorkspace, WorkspaceError, apply_changes, component_scopes, digest, foundation_scopes, normalize_scope, owns, relative_path, source_manifest, validate_ownership


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
        retry_recovery: bool = False,
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
        if retry_recovery and not resume:
            raise ConfigError("Recovery grants require --resume.")
        known_phases = {str(phase["id"]) for phase in settings.phases()}
        if only_phases and (set(only_phases) - known_phases or (not resume and "plan" not in only_phases)):
            raise ConfigError("--only must name valid phases; skipping plan requires --resume.")

        self.evidence_dir = evidence_dir.resolve() if evidence_dir else self._evidence_dir()
        self.evidence_dir.mkdir(parents=True, exist_ok=True)
        evidence_stat = self.evidence_dir.stat()
        self._evidence_identity = (evidence_stat.st_dev, evidence_stat.st_ino)

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
            ensure_resumable_run(self.evidence_dir)
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
        if retry_recovery:
            self.grant_recovery_attempt()

    # -- setup -------------------------------------------------------------

    def _save_checkpoint(self) -> None:
        if self.dry_run:
            return
        previous = self.state.get("checkpoint", {})
        validate_artifacts(previous, self.evidence_dir)
        active = {"planner", "planner-shared"}
        artifacts = set()
        discovery = self.state.get("discovery_cache", {})
        if discovery:
            artifacts.update(Path(path).resolve() for path in [discovery["manifest"], discovery["summary"], discovery["inventory"], *discovery["artifacts"]])
        foundation = self.state.get("foundations", {})
        if foundation.get("attempt"):
            active.add(f"planner-shared-repair-attempt-{foundation['attempt']}")
        for component in self.state.component_rows():
            accepted_attempt = component.get("accepted_attempt", component.get("attempts", 0))
            accepted = self.state.get("agent_results", {}).get(f"component-{component['id']}-attempt-{accepted_attempt}", {})
            if component.get("status") == "PASS" or accepted.get("status") == "PASS":
                active.add(f"component-{component['id']}-attempt-{accepted_attempt}")
                contribution = self.evidence_dir / str(self.settings.migration.get("run.agent_workspace_dir", "agents")) / f"component-{component['id']}-attempt-{accepted_attempt}" / str(self.settings.migration.get("shared_files.contribution_file", "contributions.json"))
                if contribution and contribution.is_file():
                    artifacts.add(contribution.resolve())
        for slug, result in self.state.get("agent_results", {}).items():
            if slug in active and result.get("status") in {"PASS", "COMPLETE"}:
                artifacts.update(evidence_paths(result, self.settings, self.evidence_dir))
            candidate = result.get("outputs", {}).get("contribution_candidate")
            if candidate:
                receipt = self.settings.resolve(candidate["path"]).resolve()
                if not receipt.is_relative_to(self.evidence_dir.resolve()) or digest(receipt) != candidate["sha256"]:
                    raise WorkspaceError("Retained contribution candidate changed before checkpointing.")
                artifacts.add(receipt)
        if self.state.get("frontend_build", {}).get("status") == "PASS":
            artifacts.update(evidence_paths(self.state.get("frontend_build"), self.settings, self.evidence_dir))
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
        backend = create_backend(self.settings)
        self.context = RunContext(self.settings, self.contract, backend, self.state, self.run_id,
                                  self.evidence_dir, self.logger)
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
        if agent_id == "planner":
            return factory(self.context, shared=phase.get("mode") == "shared", diagnostic=phase.get("mode") == "diagnostic")
        return factory(self.context)

    def diagnose_failure(self, phase_id: str, outcome: PhaseOutcome, components: list[Mapping[str, Any]]) -> dict[str, Any]:
        sequence = int(self.state.get("diagnosis_sequence", 0)) + 1
        self.state.update(diagnosis_sequence=sequence)
        directory = self.evidence_dir / "agents" / f"planner-diagnosis-attempt-{sequence}"
        packet = directory / "failure-packet.json"
        dump_json(packet, {"run_id": self.run_id, "phase": phase_id, "status": outcome.status,
                           "results": [result.to_dict() for result in outcome.results],
                           "components": components, "frontend_build": self.state.get("frontend_build", {}),
                           "history": self.state.get("recovery_history", [])})
        baseline, packet_hash = source_manifest(self.settings.repo_root, excluded=[self.evidence_dir]), digest(packet)
        self._save_checkpoint()
        emit(f"  asking planner for read-only recovery diagnosis: {phase_id}", "cyan")
        if self.context is None or self.context.backend is None:
            return {"action": "pause", "component_ids": [], "repair_shared": False,
                "reason": "Agent backend unavailable; restore tooling/authentication and resume.", "evidence": [str(packet)]}
        try:
            result, _ = self._run_worker({"id": phase_id, "agent": "planner", "mode": "diagnostic"},
                                         attempt=sequence, components=components, failure_packet=str(packet))
            if source_manifest(self.settings.repo_root, excluded=[self.evidence_dir]) != baseline:
                raise WorkspaceError("Recovery diagnosis changed the shared checkout.")
            if digest(packet) != packet_hash:
                raise WorkspaceError("Recovery diagnosis changed its failure evidence.")
            validate_artifacts(self.state.get("checkpoint"), self.evidence_dir)
            if not result.passed:
                raise PipelineError("Recovery diagnosis did not produce a valid decision.")
            return dict(result.output("decision"))
        except WorkspaceError:
            raise
        except (EnvelopeError, BackendError, ConfigError, OSError, ValueError, PipelineError) as error:
            return {"action": "pause", "component_ids": [], "repair_shared": False,
                    "reason": f"Recovery diagnosis unavailable: {error}", "evidence": [str(packet)]}

    def _wants(self, phase_id: str) -> bool:
        return self.only_phases is None or phase_id in self.only_phases

    def recover_failure(self, phase_id: str, outcome: PhaseOutcome, components: list[Mapping[str, Any]],
                        failing: list[Mapping[str, Any]] | None = None) -> dict[str, Any]:
        known = {str(component["id"]) for component in components}
        failing = list(failing or [])
        if any(not isinstance(entry, Mapping) or entry.get("component_id") not in known for entry in failing):
            raise PipelineError("Recovery feedback contains an unknown component owner.")
        if any(result.output("critical") or result.output("critical_asset_failure") for result in outcome.results):
            return {"action": "stop", "reason": "Critical failure; automatic recovery is prohibited."}
        owners = sorted({str(entry["component_id"]) for entry in failing})
        keys = [f"{phase_id}:{owner}" for owner in owners] or [phase_id]
        failures = [message for result in outcome.results for message in result.failures]
        reasons = failures + [str(entry.get("hypothesis", "")) for entry in failing]
        signature = hashlib.sha256(json.dumps({"phase": phase_id, "owners": owners, "reasons": [re.sub(r"attempt-\d+", "attempt-N", reason) for reason in reasons]}, sort_keys=True).encode()).hexdigest()
        counters = self.state.get("recovery_counts", {})
        repeated = self.state.get("recovery_repeats", {})
        for key in keys:
            counters[key] = int(counters.get(key, 0)) + 1
        repeated[signature] = int(repeated.get(signature, 0)) + 1
        self.state.update(recovery_counts=counters, recovery_repeats=repeated)
        limit = int(self.settings.migration.get("pipeline.recovery.repeated_failure_limit", 2))
        grants = self.state.get("recovery_grants", {})
        repeat_grants = self.state.get("recovery_repeat_grants", {})
        repeated_limit = limit + int(repeat_grants.get(signature, 0))
        exhausted = any(counters[key] >= self.max_attempts + int(grants.get(key, 0)) for key in keys) or repeated[signature] > repeated_limit
        component_ids = sorted({str(entry["component_id"]) for entry in failing if entry.get("owning_layer") not in ("foundation", "assets", "evidence")})
        shared = any(entry.get("owning_layer") == "foundation" or entry.get("requires_foundations") for entry in failing)
        if (component_ids or shared) and not exhausted and outcome.status != "BLOCKED":
            decision = {"action": "repair", "component_ids": component_ids, "repair_shared": shared,
                        "reason": "; ".join(reasons) or f"Repair the recorded {phase_id} defect", "evidence": []}
        elif repeated[signature] > repeated_limit:
            decision = {"action": "pause", "component_ids": [], "repair_shared": False,
                        "reason": "Identical failure repeated; preserving work rather than repeating model calls.", "evidence": []}
        else:
            decision = self.diagnose_failure(phase_id, outcome, components)
        if exhausted:
            decision = {**decision, "action": "pause", "component_ids": [], "repair_shared": False,
                        "reason": f"Recovery budget reached for {', '.join(keys)}. {decision['reason']}"}
        history = self.state.get("recovery_history", [])
        history.append({"phase": phase_id, "status": outcome.status, "keys": keys, "signature": signature,
                        "counts": {key: counters[key] for key in keys}, "decision": decision,
                        "failing": failing, "results": [result.to_dict() for result in outcome.results]})
        self.state.update(recovery_history=history)
        emit(f"  recovery {phase_id}: {decision['action']} - {decision['reason']}", "yellow")
        return decision

    def grant_recovery_attempt(self) -> None:
        history = self.state.get("recovery_history", [])
        if self.state.get("status") != "BLOCKED" or not history or history[-1]["decision"]["action"] != "pause":
            raise ConfigError("There is no paused recovery operation to authorize.")
        last = history[-1]
        grants = self.state.get("recovery_grants", {})
        for key in last["keys"]:
            grants[key] = int(grants.get(key, 0)) + 1
        signatures = self.state.get("recovery_repeat_grants", {})
        signatures[last["signature"]] = int(signatures.get(last["signature"], 0)) + 1
        approvals = self.state.get("recovery_approvals", [])
        approvals.append({"at": utc_now(), "keys": last["keys"], "signature": last["signature"], "additional_attempts": 1})
        self.state.update(recovery_grants=grants, recovery_repeat_grants=signatures, recovery_approvals=approvals)

    def pause_recovery(self, cursor: dict[str, Any], reason: str) -> str:
        retained = self.state.get("recovery_checkpoint") if cursor["stage"] == "preflight" else None
        self.state.update(recovery_checkpoint=retained or {**cursor, "running": False, "reason": reason}, status="BLOCKED")
        phase = "deploy" if cursor["stage"] == "frontend" else cursor["stage"]
        self.state.set_phase(phase, "BLOCKED", error=reason)
        self._save_checkpoint()
        emit(f"  progress preserved; resume with --resume --run-id {self.run_id}", "cyan")
        return "BLOCKED"

    def prepare_with_recovery(self, phase: Mapping[str, Any], components: list[Mapping[str, Any]]) -> PhaseOutcome:
        phase_id = str(phase["id"])
        counts = self.state.get("recovery_counts", {})
        if counts.get(phase_id, 0) >= self.max_attempts + self.state.get("recovery_grants", {}).get(phase_id, 0):
            return PhaseOutcome(phase_id, "BLOCKED")
        feedback = self.state.get("preparation_feedback", {}).get(phase_id, {})
        while True:
            sequences = self.state.get("preparation_sequences", {})
            sequence = int(sequences.get(phase_id, 0)) + 1
            sequences[phase_id] = sequence
            self.state.update(preparation_sequences=sequences)
            if phase_id == "plan":
                outcome = self.run_planner(phase, **({"attempt": sequence, "feedback": feedback} if sequence > 1 else {}))
            else:
                outcome = self.run_foundations(phase, components=components,
                                               **({"repair": True, "attempt": sequence, "feedback": feedback} if sequence > 1 else {}))
            if outcome.passed:
                result = outcome.results[0]
                canonical = "planner" if phase_id == "plan" else "planner-shared"
                if sequence > 1:
                    result.path = str(self.evidence_dir / "agents" / canonical / "result.json")
                    dump_json(Path(result.path), result.to_dict())
                    self.state.record_agent_result(canonical, result.to_dict())
                return outcome
            decision = self.recover_failure(phase_id, outcome, components)
            if decision["action"] == "stop":
                return PhaseOutcome(phase_id, "FAIL", outcome.results)
            feedback = {"failure": [result.to_dict() for result in outcome.results], "diagnosis": decision}
            saved = self.state.get("preparation_feedback", {})
            saved[phase_id] = feedback
            self.state.update(preparation_feedback=saved)
            if decision["action"] == "pause" or (phase_id == "plan" and decision["action"] == "repair"):
                self.pause_recovery({"stage": phase_id, "pending": [], "feedback": feedback, "attempt": sequence, "changed_files": []}, decision["reason"])
                return PhaseOutcome(phase_id, "BLOCKED", outcome.results)

    def run_single(self, phase: Mapping[str, Any], **kwargs: Any) -> PhaseOutcome:
        phase_id = str(phase["id"])
        self.state.set_phase(phase_id, "RUNNING")
        agent = self._agent(phase)
        emit(f"\n[{phase_id}] {agent.spec.title}", "cyan")
        readonly = not self.dry_run
        baseline = source_manifest(self.settings.repo_root, excluded=[self.evidence_dir]) if readonly else {}
        try:
            result = agent.run(**kwargs)
        except (EnvelopeError, BackendError, OSError, ValueError) as error:
            result = AgentResult(str(phase["agent"]), self.run_id, "FAIL", failures=[str(error)])
            self.state.record_agent_result(agent.slug(**kwargs), result.to_dict())
            emit(f"  !! {phase_id}: {error}", "red")
        changed_readonly = readonly and source_manifest(self.settings.repo_root, excluded=[self.evidence_dir]) != baseline
        if changed_readonly:
            result = AgentResult(str(phase["agent"]), self.run_id, "FAIL", outputs={"critical": True}, failures=["Read-only agent changed repository sources; changes were not accepted."])
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
        except AssetDeclarationError as error:
            failing = [{"component_id": owner, "owning_layer": "component", "phase": "assets", "hypothesis": str(error)}
                       for owner in error.owners]
            self.state.set_phase(phase_id, "FAIL", error=str(error), failing_components=failing)
            result = AgentResult("assets", self.run_id, "FAIL", outputs={"failing_components": failing, "critical": error.critical}, failures=[str(error)])
            emit(f"  asset declaration needs repair: {error}", "yellow")
            return PhaseOutcome(phase_id, "FAIL", [result])
        except AssetError as error:
            status = "FAIL" if error.critical else "BLOCKED"
            emit(f"  asset phase {status.lower()}: {error}", "yellow")
            self.state.set_phase(phase_id, status, error=str(error))
            return PhaseOutcome(phase_id, status, [AgentResult("assets", self.run_id, status, outputs={"critical": error.critical}, failures=[str(error)])])

        emit(
            f"  {len(report.uploaded)} uploaded, {len(report.skipped)} already present, "
            f"{len(report.failed)} failed",
            "green" if report.ok else "yellow",
        )
        for record in report.failed:
            emit(f"  !! {record.source_url or record.source_file} -> {record.detail}", "yellow")
        if report.failed:
            emit(f"\n  {len(report.failed)} asset(s) need your input; nothing else in the run is affected:", "yellow")
            for record in report.failed:
                emit(f"    - {record.dam_path}  ({', '.join(record.owners) or 'no owner'})", "yellow")
                emit(f"      from {record.source_url or record.source_file}", "dim")
                emit(f"      {record.detail}", "dim")
            if report.unresolved_path:
                emit(f"  Set 'local_file' to a file you downloaded yourself in {report.unresolved_path},", "cyan")
                emit("  or fix 'source_url'; leave it as-is to retry the same request.", "cyan")
                emit(f"  Then: python design/site-url/scripts/run_migration.py --resume --run-id {self.run_id}", "cyan")
        critical = any(record.critical for record in report.failed)
        status = "PASS" if report.ok else "FAIL" if critical else "BLOCKED"
        failing = [{"component_id": owner, "owning_layer": "assets", "phase": "assets", "hypothesis": record.detail,
                    "source_url": record.source_url, "source_file": record.source_file, "dam_path": record.dam_path,
                    "evidence": [report.manifest_path] if report.manifest_path else []}
                   for record in report.failed for owner in record.owners]
        self.state.set_phase(phase_id, status, error="; ".join(record.detail for record in report.failed), failing_components=failing, **report.to_dict())
        result = AgentResult("assets", self.run_id, status, outputs={"failing_components": failing, "critical": critical, **report.to_dict()})
        return PhaseOutcome(phase_id, status, [result])

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
        scopes = (foundation_scopes(self.settings) if agent.shared else []) if agent.agent_id == "planner" else component_scopes(self.settings, kwargs["component"])
        worker = WorkerWorkspace.create(
            self.settings.repo_root, self.evidence_dir / "workspaces" / slug,
            scopes,
            evidence_dir=self.evidence_dir,
        )
        repair = None
        feedback = kwargs.get("feedback") or {}
        if agent.agent_id == "component" and feedback.get("repair_scope") == "contributions":
            repair = self._prepare_contribution_repair(
                agent, worker, kwargs["component"], int(kwargs.get("attempt", 1)), feedback.get("contribution_candidate"),
            )
        migration = self.settings.migration
        if agent.agent_id == "planner":
            cache = self.settings.resolve(str(migration.get("discovery.inventory_cache_dir", "design/site-url/scripts/.tools/inventory")))
            migration = migration.merged({"discovery": {"inventory_cache_dir": str(cache)}})
        isolated_settings = Settings(worker.root, migration, self.settings._agents_config)
        agent.context = replace(agent.context, settings=isolated_settings)
        try:
            result = agent.run(**kwargs)
        finally:
            if repair is not None:
                WorkerWorkspace(worker.root, repair["source_files"], []).collect()
                try:
                    validate_artifacts(repair, self.evidence_dir)
                except ConfigError as error:
                    raise WorkspaceError(str(error)) from error
        if agent.agent_id == "component" or (agent.agent_id == "planner" and agent.shared):
            validation = agent.validation_environment(slug)
            diagnostic_dir = Path(validation["MIGRATION_VALIDATION_DIR"]) / "worker-diagnostics"
            if not diagnostic_dir.resolve().is_relative_to(self.evidence_dir.resolve()):
                raise WorkspaceError("Diagnostic storage escaped this run's evidence.")
            changes = worker.collect(diagnostic_dir=diagnostic_dir)
        else:
            changes = worker.collect()
        if changes.quarantined:
            result.outputs["quarantined_diagnostics"] = changes.quarantined
            emit(f"  {slug}: retained {len(changes.quarantined)} new root text dump(s) under validation/worker-diagnostics; not source changes.", "yellow")
        result.outputs["changed_files"] = sorted(changes.changed)
        result.outputs["worker_directory"] = str(worker.root)
        result.outputs.pop("contribution_candidate", None)
        if agent.agent_id == "component" and getattr(agent, "contribution_failure", None):
            result.outputs["contribution_candidate"] = self._retain_contribution_candidate(
                agent, worker, changes, result, kwargs["component"], int(kwargs.get("attempt", 1)),
            )
        return result, changes if result.passed else None

    def _retain_contribution_candidate(self, agent: Any, worker: WorkerWorkspace, changes: ChangeSet,
                                       result: AgentResult, component: Mapping[str, Any], attempt: int) -> dict[str, str]:
        directory = agent.workspace(agent.slug(component=component, attempt=attempt))
        contribution = directory / str(self.settings.migration.get("shared_files.contribution_file", "contributions.json"))
        artifacts = evidence_paths(result.to_dict(), agent.context.settings, self.evidence_dir)
        if contribution.is_file():
            artifacts.add(contribution.resolve())
            try:
                payload = json.loads(contribution.read_text(encoding="utf-8"))
                artifacts.update(evidence_paths(payload, agent.context.settings, self.evidence_dir))
                evidence_settings = Settings(self.evidence_dir, self.settings.migration, self.settings._agents_config)
                artifacts.update(evidence_paths(payload, evidence_settings, self.evidence_dir))
            except (UnicodeError, ValueError):
                pass
        if result.path:
            artifacts.discard(Path(result.path).resolve())
        sources = dict(worker.baseline)
        for name, checksum in changes.changed.items():
            if checksum is None:
                sources.pop(name, None)
            else:
                sources[name] = checksum
        receipt = directory / "contribution-candidate.json"
        dump_json(receipt, {
            "schema_version": 1, "run_id": self.run_id, "component": dict(component), "attempt": attempt,
            "root": str(worker.root.resolve()), "scopes": worker.scopes,
            "baseline": worker.baseline, "changed": changes.changed, "source_files": sources,
            "artifacts": {path.relative_to(self.evidence_dir.resolve()).as_posix(): digest(path) for path in sorted(artifacts)},
            "result": result.to_dict(), "contribution": str(contribution.resolve()),
            "failure": agent.contribution_failure,
        })
        return {"path": str(receipt.resolve()), "sha256": str(digest(receipt))}

    def _prepare_contribution_repair(self, agent: Any, worker: WorkerWorkspace, component: Mapping[str, Any],
                                     attempt: int, reference: Any) -> dict[str, Any]:
        try:
            if not isinstance(reference, Mapping):
                raise WorkspaceError("Contribution repair requires a retained candidate receipt.")
            receipt = agent.context.evidence_file(reference["path"])
            if digest(receipt) != reference["sha256"]:
                raise WorkspaceError("Retained contribution candidate receipt changed.")
            candidate = json.loads(receipt.read_text(encoding="utf-8"))
            previous_attempt = candidate["attempt"]
            if (candidate["schema_version"] != 1 or candidate["run_id"] != self.run_id
                    or candidate["component"] != dict(component) or type(previous_attempt) is not int
                    or not 0 < previous_attempt < attempt or candidate["scopes"] != worker.scopes):
                raise WorkspaceError("Retained contribution candidate does not match this component and attempt.")
            previous_slug = agent.slug(component=component, attempt=previous_attempt)
            previous_directory = agent.workspace(previous_slug).resolve()
            registered = self.state.get("agent_results", {}).get(previous_slug, {}).get("outputs", {}).get("contribution_candidate")
            if registered != dict(reference) or receipt != previous_directory / "contribution-candidate.json":
                raise WorkspaceError("Contribution repair candidate is not registered by this coordinator.")
            source = Path(candidate["root"])
            expected_parent = (self.evidence_dir / "workspaces" / previous_slug).resolve()
            if source.is_symlink() or source.resolve().parent != expected_parent or not source.is_dir():
                raise WorkspaceError("Retained contribution source escaped its worker workspace.")
            retained = WorkerWorkspace(source, candidate["baseline"], worker.scopes)
            changes = retained.collect()
            if changes.changed != candidate["changed"] or source_manifest(source) != candidate["source_files"]:
                raise WorkspaceError("Retained contribution candidate source changed.")
            validate_artifacts(candidate, self.evidence_dir)
            apply_changes(worker.root, [changes])
            directory = agent.workspace(agent.slug(component=component, attempt=attempt)).resolve()
            directory.mkdir(parents=True, exist_ok=True)
            contribution = directory / str(self.settings.migration.get("shared_files.contribution_file", "contributions.json"))
            protected = dict(candidate["artifacts"])
            for name in candidate["artifacts"]:
                original = self.evidence_dir / relative_path(name)
                if not original.resolve().is_relative_to(previous_directory):
                    continue
                target = directory / original.resolve().relative_to(previous_directory)
                if target.exists():
                    raise WorkspaceError("Refusing to overwrite evidence while preparing contribution repair.")
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(original, target)
                if digest(target) != candidate["artifacts"][name]:
                    raise WorkspaceError("Contribution evidence changed while copying the candidate.")
                if target != contribution:
                    protected[target.relative_to(self.evidence_dir.resolve()).as_posix()] = candidate["artifacts"][name]

            def relocate(value: Any) -> Any:
                if isinstance(value, dict):
                    return {key: relocate(child) for key, child in value.items()}
                if isinstance(value, list):
                    return [relocate(child) for child in value]
                if isinstance(value, str):
                    locations = ((source, worker.root), (previous_directory, directory),
                                 (previous_directory.relative_to(self.evidence_dir.resolve()), directory.relative_to(self.evidence_dir.resolve())))
                    for before, after in locations:
                        if value in (str(before), before.as_posix()):
                            value = str(after)
                        value = value.replace(str(before) + "\\", str(after) + "\\")
                        value = value.replace(before.as_posix() + "/", after.as_posix() + "/")
                return value

            if contribution.is_file():
                try:
                    payload = json.loads(contribution.read_text(encoding="utf-8"))
                except (UnicodeError, ValueError):
                    pass
                else:
                    dump_json(contribution, relocate(payload))
            result = relocate(candidate["result"])
            result.update(status="PASS", failures=[], result_path=str(agent.result_path(agent.slug(component=component, attempt=attempt))))
            result["outputs"].update(contributions=str(contribution), worker_directory=str(worker.root), changed_files=sorted(changes.changed))
            result["outputs"].pop("rejected_envelope", None)
            seed = directory / "candidate-result.json"
            dump_json(seed, result)
            agent.contribution_repair = {"candidate_result": str(seed), "contribution": str(contribution),
                                         "previous_contribution": candidate["contribution"], "failure": candidate["failure"]}
            protected[receipt.relative_to(self.evidence_dir.resolve()).as_posix()] = reference["sha256"]
            protected[seed.relative_to(self.evidence_dir.resolve()).as_posix()] = str(digest(seed))
            return {"source_files": source_manifest(worker.root), "artifacts": protected}
        except (EnvelopeError, ConfigError, OSError, ValueError, TypeError, KeyError) as error:
            if isinstance(error, WorkspaceError):
                raise
            raise WorkspaceError(f"Cannot reuse retained contribution candidate: {error}") from error

    def run_planner(self, phase: Mapping[str, Any], **kwargs: Any) -> PhaseOutcome:
        return self._run_preparation(phase, **kwargs)

    def run_foundations(self, phase: Mapping[str, Any], **kwargs: Any) -> PhaseOutcome:
        return self._run_preparation(phase, **kwargs)

    def _run_preparation(self, phase: Mapping[str, Any], **kwargs: Any) -> PhaseOutcome:
        phase_id = str(phase["id"])
        agent = self._agent(phase)
        slug = agent.slug(**kwargs)
        self.state.set_phase(phase_id, "RUNNING")
        operation = "planning (read-only)" if not agent.shared else (
            "repairing shared foundations" if kwargs.get("repair") else "establishing shared foundations"
        )
        emit(f"\n[{phase_id}] {operation}", "cyan")
        applying = False
        try:
            baseline = source_manifest(self.settings.repo_root, excluded=[self.evidence_dir]) if not self.dry_run else {}
            result, changes = self._run_worker(phase, **kwargs)
            if not self.dry_run:
                current = source_manifest(self.settings.repo_root, excluded=[self.evidence_dir])
                changed = [name for name in sorted(current.keys() | baseline.keys()) if current.get(name) != baseline.get(name)]
                if changed:
                    raise WorkspaceError(f"The shared checkout changed during {phase_id}: {', '.join(changed)}. No worker changes were merged; existing edits were not reverted.")
                if result.passed and changes is not None:
                    applying = True
                    apply_changes(self.settings.repo_root, [changes])
        except (EnvelopeError, BackendError, ConfigError, OSError, ValueError) as error:
            result = AgentResult(agent.agent_id, self.run_id, "FAIL", outputs={"critical": applying or isinstance(error, WorkspaceError)}, failures=[str(error)], path=str(agent.result_path(slug)))
            emit(f"  !! {phase_id}: {error}", "red")
        if result.path:
            dump_json(Path(result.path), result.to_dict())
        saved = self.state.get("agent_results", {}).get(slug, {})
        self.state.record_agent_result(slug, {**saved, **result.to_dict()})
        self.state.set_phase(phase_id, result.status, error="; ".join(result.failures) if result.failures else None)
        return PhaseOutcome(phase_id, result.status, [result])

    def prepare_frontend(self, changed_files: Iterable[str], attempt: int) -> AgentResult:
        config = self.settings.migration.get("deploy.frontend", {})
        module = relative_path(config.get("root", "ui.frontend"))
        needed = any(owns(path, module + "/**") for path in changed_files)
        if not needed or self.dry_run:
            return AgentResult("frontend-build", self.run_id, "PASS", outputs={"changed_files": [], "skipped": True})
        outputs = config.get("outputs", [])
        if not isinstance(outputs, list) or not outputs:
            raise ConfigError("deploy.frontend.outputs must declare generated clientlib ownership.")
        scopes = [normalize_scope(path) for path in outputs]
        clientlibs = f"ui.apps/src/main/content/jcr_root/apps/{self.settings.migration.require('project.name')}/clientlibs/"
        if any(not scope.startswith(clientlibs) for scope in scopes):
            raise ConfigError("Frontend output ownership must be restricted to deployable clientlibs.")
        commands = [config.get(name) for name in ("install", "build")]
        if any(not isinstance(command, list) or not command or any(not isinstance(arg, str) or not arg for arg in command) for command in commands):
            raise ConfigError("Frontend install/build must be nonempty argv lists.")
        baseline = source_manifest(self.settings.repo_root, excluded=[self.evidence_dir])
        inputs = {path: value for path, value in baseline.items() if owns(path, module + "/**")}
        output_hashes = {path: value for path, value in baseline.items() if any(owns(path, scope) for scope in scopes)}
        saved = self.state.get("frontend_build", {})
        if saved.get("status") == "PASS" and saved.get("run_id") == self.run_id and saved.get("inputs") == inputs and saved.get("outputs") == output_hashes and saved.get("commands") == commands:
            receipt = self.context.evidence_file(saved.get("receipt"))
            if digest(receipt) != saved.get("receipt_sha256"):
                raise PipelineError("The shared frontend build receipt changed; cannot reuse it.")
            emit("  shared frontend: reusing unchanged generated clientlibs", "dim")
            return AgentResult("frontend-build", self.run_id, "PASS", outputs={"changed_files": saved["changed_files"]})

        agent = self._agent({"agent": "deployer"})
        slug = f"frontend-build-attempt-{attempt}"
        environment = {**agent.env_extra(), **agent.validation_environment(slug, prepare=True)}
        workspace = WorkerWorkspace.create(self.settings.repo_root, self.evidence_dir / "workspaces" / slug, scopes, evidence_dir=self.evidence_dir)
        logs = []
        self.state.update(frontend_build={"status": "RUNNING", "changed_files": saved.get("changed_files", [])})
        emit(f"\n[deploy] building shared frontend from merged source (attempt {attempt})", "cyan")
        applying = False
        try:
            for name, command in zip(("install", "build"), commands):
                log = Path(environment["MIGRATION_VALIDATION_DIR"]) / f"{name}.log"
                emit(f"  frontend {name}: {' '.join(command)}; log: {log}", "dim")
                exit_code = run_command(command, workspace.root / module, log, environment)
                logs.append({"command": command, "exit_code": exit_code, "log": str(log)})
                if exit_code:
                    raise PipelineError(f"Shared frontend {name} failed with exit code {exit_code}. See {log}")
            changes = workspace.collect()
            current = source_manifest(workspace.root)
            generated = {path: value for path, value in current.items() if any(owns(path, scope) for scope in scopes)}
            if not generated:
                raise PipelineError("Frontend build produced no deployable clientlibs.")
            if source_manifest(self.settings.repo_root, excluded=[self.evidence_dir]) != baseline:
                raise WorkspaceError("Shared source changed during the frontend build; no generated files were applied.")
            applying = True
            applied = apply_changes(self.settings.repo_root, [changes])
        except (PipelineError, EnvelopeError, BackendError, ConfigError, OSError, ValueError) as error:
            self.state.update(frontend_build={"status": "FAIL", "failures": [str(error)], "logs": logs, "changed_files": saved.get("changed_files", [])})
            emit(f"  !! shared frontend: {error}", "red")
            return AgentResult("frontend-build", self.run_id, "FAIL", outputs={"critical": applying or isinstance(error, WorkspaceError)}, failures=[str(error)])
        changed = sorted(set(applied) | set(generated) | set(saved.get("changed_files", [])))
        receipt = agent.workspace(slug) / "build-result.json"
        record = {"status": "PASS", "run_id": self.run_id, "inputs": inputs, "outputs": generated,
                  "commands": commands, "logs": logs, "changed_files": changed, "receipt": str(receipt)}
        dump_json(receipt, record)
        self.state.update(frontend_build={**record, "receipt_sha256": digest(receipt)})
        self._save_checkpoint()
        return AgentResult("frontend-build", self.run_id, "PASS", outputs={"changed_files": changed})

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
        feedback = feedback or {}
        for wave in waves:
            reusable = [component for component in wave if not self.dry_run
                        and self.settings.migration.get("fanout.batch_reuse", True)
                        and (feedback.get(component["id"], {}).get("reuse_only")
                             or (not feedback.get(component["id"])
                                 and component.get("execution_mode", "authoring" if component.get("tier") == 1 else "implementation") == "authoring"))]
            builders = [component for component in wave if component not in reusable]
            outcomes = []
            if reusable:
                outcomes.append(self._run_reuse_batch(phase, reusable, feedback, attempt))
            critical = any(result.output("critical") for outcome in outcomes for result in outcome.results)
            if builders and not critical:
                outcomes.append(self._run_component_batch(phase, builders, feedback, attempt))
            results.extend(result for outcome in outcomes for result in outcome.results)
            if any(not outcome.passed for outcome in outcomes):
                status = "FAIL" if critical else "BLOCKED" if any(outcome.status == "BLOCKED" for outcome in outcomes) else "FAIL"
                self.state.set_phase(str(phase["id"]), status)
                return PhaseOutcome(str(phase["id"]), status, results)
        return PhaseOutcome(str(phase["id"]), "PASS", results)

    def _run_reuse_batch(self, phase: Mapping[str, Any], components: list[Mapping[str, Any]],
                         feedback: Mapping[str, Mapping[str, Any]], attempt: int) -> PhaseOutcome:
        agent = self._agent(phase)
        agent.reuse_components = components
        slug = agent.slug(attempt=attempt)
        self.state.set_phase(str(phase["id"]), "RUNNING", fanout=len(components), attempt=attempt, mode="reuse")
        for component in components:
            self.state.update_component(component["id"], status="RUNNING", attempts=attempt, error=None)
        emit(f"\n[implement] authoring {len(components)} source-ready components in one source-read-only session", "cyan")
        worker = WorkerWorkspace.create(self.settings.repo_root, self.evidence_dir / "workspaces" / slug, [], evidence_dir=self.evidence_dir)
        agent.context = replace(agent.context, settings=Settings(worker.root, self.settings.migration, self.settings._agents_config))
        results = []
        batch = None
        batch_error = None
        interrupted = False
        try:
            try:
                batch = agent.run(attempt=attempt, feedback=feedback)
            except KeyboardInterrupt:
                interrupted = True
            except (EnvelopeError, BackendError, ConfigError, OSError, ValueError) as error:
                batch_error = str(error)
            finally:
                worker.collect()
                if source_manifest(self.settings.repo_root, excluded=[self.evidence_dir]) != worker.baseline:
                    raise WorkspaceError("The shared checkout changed during reuse authoring; no component work was accepted.")
                if any(digest(Path(path)) != checksum for path, checksum in getattr(agent, "reuse_input_hashes", {}).items()):
                    raise WorkspaceError("Reuse authoring inputs changed during execution.")
            entries = batch.output("results", {}) if batch is not None else {}
            for component in components:
                member = AGENT_CLASSES["component"](agent.context)
                member.handoff = getattr(agent, "reuse_handoffs", {}).get(component["id"], {})
                member_slug = member.slug(component=component, attempt=attempt)
                target = member.result_path(member_slug)
                try:
                    entry = entries.get(component["id"]) if isinstance(entries, Mapping) else None
                    if entry is not None and (not isinstance(entry, str) or Path(entry).resolve() != target.resolve()):
                        raise EnvelopeError(f"Reuse result path does not belong to {component['id']}.")
                    if not target.is_file():
                        raise EnvelopeError(f"No authoring result for {component['id']}: {batch_error or 'session incomplete'}")
                    result = read_result(target, member.spec, self.run_id)
                    if result.output("changed_files"):
                        raise EnvelopeError("Authoring-only work cannot report source changes; request an implementation repair.")
                    implementation = result.output("implementation_required")
                    if implementation:
                        if result.passed or not isinstance(implementation, Mapping) or not implementation.get("reason") or not implementation.get("evidence"):
                            raise EnvelopeError("Implementation repair requires a failed result with a reason and evidence.")
                        for evidence in implementation["evidence"]:
                            member.context.evidence_file(evidence)
                    member.validate_result(result, component=component, attempt=attempt)
                except (EnvelopeError, OSError, ValueError) as error:
                    result = AgentResult("component", self.run_id, "FAIL", failures=[str(error)])
                result.path = str(target)
                result.outputs.pop("contribution_candidate", None)
                result.outputs.update(component_id=component["id"], changed_files=[], worker_directory=str(worker.root), reuse_session=slug)
                result.outputs["reuse_only"] = not bool(result.output("implementation_required"))
                results.append(result)
        except (EnvelopeError, BackendError, ConfigError, OSError, ValueError) as error:
            results = [AgentResult("component", self.run_id, "FAIL", outputs={"component_id": component["id"],
                         "critical": isinstance(error, WorkspaceError), "reuse_only": True}, failures=[str(error)]) for component in components]
        for component, result in zip(components, results):
            if not result.path:
                result.path = str(AGENT_CLASSES["component"](self.context).result_path(f"component-{component['id']}-attempt-{attempt}"))
            if not result.passed and Path(result.path).is_file():
                rejected = Path(result.path).with_name("result.rejected.json")
                rejected.write_bytes(Path(result.path).read_bytes())
                result.outputs["rejected_envelope"] = str(rejected)
            self.state.update_component(component["id"], status=result.status, changed_files=[],
                                        **({"accepted_attempt": attempt} if result.passed else {}))
            self._persist_worker(result, component, attempt)
        status = "PASS" if all(result.passed for result in results) else "BLOCKED" if any(result.blocked for result in results) else "FAIL"
        saved = self.state.get("agent_results", {}).get(slug, {})
        proposal_status = batch.status if batch is not None else saved.get("status")
        batch = batch or AgentResult("component", self.run_id, status)
        batch.path = str(agent.result_path(slug))
        if proposal_status == "PASS" and status != "PASS" and Path(batch.path).is_file():
            rejected = Path(batch.path).with_name("result.rejected.json")
            rejected.write_bytes(Path(batch.path).read_bytes())
            batch.outputs["rejected_envelope"] = str(rejected)
        batch.status = status
        batch.outputs.update(proposal_status=proposal_status,
                             member_statuses={result.output("component_id"): result.status for result in results},
                             results={result.output("component_id"): result.path for result in results})
        batch.failures = [f"{result.output('component_id')}: {failure}" for result in results for failure in result.failures]
        dump_json(Path(batch.path), batch.to_dict())
        self.state.record_agent_result(slug, {**saved, **batch.to_dict()})
        emit(f"  <- Component authoring validated: {status} | {sum(result.passed for result in results)}/{len(results)} accepted",
             "green" if status == "PASS" else "yellow" if status == "BLOCKED" else "red")
        if not interrupted:
            self.state.set_phase(str(phase["id"]), status)
        if not any(result.output("critical") for result in results):
            self._save_checkpoint()
        if interrupted:
            raise KeyboardInterrupt()
        return PhaseOutcome(str(phase["id"]), status, results)

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
            f"{self.max_parallel} at a time (invocation {attempt}; recovery limit {self.max_attempts} per operation)",
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
                    results.append(AgentResult("component", self.run_id, "FAIL", outputs={"component_id": component_id, "critical": isinstance(error, WorkspaceError)}, failures=[str(error)]))
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
        except (WorkspaceError, OSError) as error:
            changes_applied = False
            errors.append(str(error))
            for _, result, _ in validated:
                if result.passed:
                    result.status = "FAIL"
                    result.outputs["critical"] = True
                    result.failures.append(str(error))
        for component, result, _ in validated:
            self.state.update_component(str(component["id"]), status=result.status, changed_files=result.output("changed_files", []))
            if result.passed and changes_applied:
                self.state.update_component(str(component["id"]), accepted_attempt=attempt)
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
            while True:
                try:
                    self.preflight()
                    break
                except (PipelineError, ConfigError, BackendError, EnvelopeError, OSError, ValueError) as error:
                    outcome = PhaseOutcome("preflight", "BLOCKED", [AgentResult("preflight", self.run_id, "BLOCKED", failures=[str(error)])])
                    decision = self.recover_failure("preflight", outcome, [])
                    if decision["action"] != "retry":
                        self.pause_recovery({"stage": "preflight", "pending": [], "feedback": {}, "attempt": 1, "changed_files": []}, decision["reason"])
                        return self._finish(phases, "BLOCKED", terminal_status)
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
                outcome = self.prepare_with_recovery(plan_phase, [])
                if not outcome.passed:
                    return self._finish(phases, outcome.status, terminal_status)
                result = outcome.results[0]
                components = list(result.output("components") or [])
                self.state.set_components(components)
                self._save_checkpoint()
            else:
                raise PipelineError("There is no validated plan to resume.")

            target = result.output("target_page_path") or self.contract.target_page_path or self.contract.site_url
            counts = {tier: sum(component.get("tier") == tier for component in components) for tier in (1, 2, 3, 4)}
            label = "Planner dry-run placeholder" if self.dry_run else "Planner accepted"
            messages = [f"{label}: {len(components)} component definitions for {target}.",
                        "Components scheduled after shared-file validation; source-ready authoring may share a session. "
                        f"Reuse unchanged: {counts[1]}; extend existing/Core: {counts[2] + counts[3]}; new: {counts[4]}."]
            for component in sorted(components, key=lambda row: row.get("source_order", 0)):
                messages.append(f"  {component['id']} | {component.get('delivery', 'component')} | tier {component.get('tier', 'unspecified')}")
            for message in messages:
                emit(message, "green")
                if self.logger:
                    self.logger.info("%s", message)

            foundations_phase = self._phase(phases, "foundations", remediation_ids)
            saved_foundations = self.state.get("foundations", {})
            if self.resume and saved_foundations:
                self._cached_result(foundations_phase, components=components,
                                    repair=bool(saved_foundations["attempt"]), attempt=saved_foundations["attempt"])
                self.state.set_phase("foundations", "PASS")
            elif self._wants(foundations_phase["id"]):
                outcome = self.prepare_with_recovery(foundations_phase, components)
                if not outcome.passed:
                    return self._finish(phases, outcome.status, terminal_status)
                result = outcome.results[0]
                self.state.update(foundations={"attempt": 0, "changed_files": result.output("changed_files", []),
                                              "token_manifest": result.output("token_manifest")})
                self._save_checkpoint()
            else:
                raise PipelineError("There are no validated shared foundations to resume; run the foundations phase before components.")

            # 2 — implement, deploy, score, remediate
            if self.resume and (self.state.get("report_pause") or {}).get("pipeline_status") == "COMPLETE":
                pipeline_status = "COMPLETE"
            else:
                if self.state.get("report_pause"):
                    self.state.update(report_pause=None)
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
        by_id = {str(component["id"]): component for component in components}
        saved_foundations = self.state.get("foundations", {})
        if not saved_foundations:
            raise PipelineError("No validated shared foundations are available.")
        changed_files = {path for row in self.state.component_rows() for path in row.get("changed_files", [])}
        changed_files.update(saved_foundations.get("changed_files", []))
        prepared_attempt = max(self.state.get("preparation_sequences", {}).values(), default=0)
        initial_attempt = prepared_attempt + 1 if prepared_attempt > 1 else 1
        cursor = {"stage": "implement", "pending": list(by_id), "feedback": {}, "attempt": initial_attempt, "changed_files": sorted(changed_files)}
        if self.resume:
            if saved_foundations["attempt"]:
                self._cached_result(phases["foundations"], components=components, repair=True, attempt=saved_foundations["attempt"])
            reusable = set()
            for row in self.state.component_rows():
                accepted_attempt = row.get("accepted_attempt", row.get("attempts", 0))
                accepted = self.state.get("agent_results", {}).get(f"component-{row['id']}-attempt-{accepted_attempt}", {})
                if row.get("status") == "PASS" or accepted.get("status") == "PASS":
                    result = self._cached_result(phases["implement"], component=by_id[row["id"]], attempt=int(accepted_attempt))
                    changed_files.update(result.output("changed_files", []))
                    reusable.add(row["id"])
            saved = self.state.get("recovery_checkpoint")
            if saved and saved.get("stage") in ("foundations", "implement", "assets", "merge", "frontend", "deploy", "parity"):
                cursor = dict(saved)
                cursor["attempt"] += int(bool(saved.get("running")) or bool(saved.get("reason") and saved["stage"] != "assets"))
                cursor.pop("reason", None)
                if cursor["stage"] == "parity":
                    cursor["stage"] = "deploy"
                if saved.get("running") and cursor["stage"] == "implement":
                    finished = {row["id"] for row in self.state.component_rows() if row.get("status") == "PASS"
                                and row.get("accepted_attempt", row.get("attempts")) == saved["attempt"]}
                    cursor["pending"] = [identity for identity in cursor["pending"] if identity not in finished]
                    if not cursor["pending"]:
                        cursor["stage"] = "assets"
            elif self.state.get("asset_pause"):
                pause = self.state.get("asset_pause")
                cursor.update(stage="assets", pending=[], attempt=pause["attempt"], changed_files=pause["changed_files"])
            else:
                pending_ids = [identity for identity in by_id if identity not in reusable]
                cursor.update(stage="implement" if pending_ids else "assets", pending=pending_ids,
                              attempt=max((int(row.get("attempts", 0)) for row in self.state.component_rows()), default=0) + 1)
                history = self.state.get("remediation_history", [])
                if history and history[-1].get("status") != "PASS":
                    return self.pause_recovery(cursor, "No compatible phase recovery checkpoint; saved work was not discarded.")
            if saved and saved.get("running") and saved.get("stage") in ("implement", "foundations"):
                counts = self.state.get("recovery_counts", {})
                keys = [f"implement:{identity}" for identity in saved["pending"]] if saved["stage"] == "implement" else ["foundations"]
                for key in keys:
                    counts[key] = int(counts.get(key, 0)) + 1
                self.state.update(recovery_counts=counts)
            elif not saved and any(row.get("status") == "RUNNING" and row.get("attempts", 0) >= self.max_attempts for row in self.state.component_rows()):
                return self.pause_recovery(cursor, "Interrupted component attempt consumed its budget; retained evidence requires review.")
            missing = set(by_id) - reusable - set(cursor["pending"])
            if missing:
                raise PipelineError("Recovery cursor would skip unvalidated components: " + ", ".join(sorted(missing)))
            changed_files.update(cursor.get("changed_files", []))

        order = ["implement", "assets", "merge", "frontend", "deploy", "parity"]
        while True:
            stage = cursor["stage"]
            attempt = cursor["attempt"]
            if stage not in (*order, "foundations") or type(attempt) is not int or attempt < 1 or any(identity not in by_id for identity in cursor["pending"]):
                raise PipelineError("Invalid recovery cursor.")
            phase_id = "deploy" if stage == "frontend" else stage
            if not self._wants(phase_id):
                return self.pause_recovery(cursor, f"Required phase {phase_id} was excluded.")
            counts = self.state.get("recovery_counts", {})
            grants = self.state.get("recovery_grants", {})
            if stage in ("implement", "foundations") and (counts.get(stage, 0) >= self.max_attempts + grants.get(stage, 0) or any(counts.get(f"{stage}:{identity}", 0) >= self.max_attempts + grants.get(f"{stage}:{identity}", 0) for identity in cursor["pending"])):
                return self.pause_recovery(cursor, f"{stage} recovery budget remains exhausted; resume does not reset it.")
            cursor.update(changed_files=sorted(changed_files), running=True)
            self.state.update(recovery_checkpoint=cursor)
            pending = [by_id[identity] for identity in cursor["pending"]]
            try:
                if stage == "foundations":
                    outcome = self.run_foundations(phases[stage], components=components, feedback=cursor["feedback"], repair=True, attempt=attempt)
                elif stage == "implement":
                    outcome = self.run_fanout(phases[stage], pending, cursor["feedback"], attempt)
                elif stage == "assets":
                    outcome = self.run_assets(phases[stage], components)
                elif stage == "merge":
                    outcome = self.run_merge(phases[stage], components)
                elif stage == "frontend":
                    frontend = self.prepare_frontend(changed_files, attempt)
                    outcome = PhaseOutcome("frontend", frontend.status, [frontend])
                elif stage == "deploy":
                    module = str(self.settings.migration.get("deploy.frontend.root", "ui.frontend"))
                    deploy_files = [path for path in sorted(changed_files) if not owns(path, module + "/**")]
                    outcome = self.run_single(phases[stage], changed_files=deploy_files, attempt=attempt)
                else:
                    outcome = self.run_single(phases[stage], components=components, attempt=attempt)
            except WorkspaceError:
                raise
            except (BackendError, EnvelopeError, OSError, ValueError) as error:
                outcome = PhaseOutcome(stage, "FAIL", [AgentResult(stage, self.run_id, "FAIL", failures=[str(error)])])
            cursor["running"] = False
            for result in outcome.results:
                if result.passed:
                    changed_files.update(result.output("changed_files", []) or [])
            failing = [entry for result in outcome.results for entry in result.output("failing_components", [])]
            if outcome.passed and not failing:
                if stage == "foundations":
                    shared = set(saved_foundations.get("changed_files", [])) | {path for result in outcome.results for path in result.output("changed_files", [])}
                    saved_foundations = {"attempt": attempt, "changed_files": sorted(shared), "token_manifest": outcome.results[0].output("token_manifest")}
                    self.state.update(foundations=saved_foundations)
                    cursor["stage"] = "implement" if pending else "assets"
                elif stage == "parity":
                    self._record_attempt(attempt, components, "PASS")
                    self.state.update(recovery_checkpoint=None, asset_pause=None)
                    if self.dry_run:
                        return "DRY_RUN"
                    for identity in by_id:
                        self.state.update_component(identity, status="PASS")
                    return "COMPLETE"
                else:
                    if stage == "implement":
                        cursor["pending"] = []
                    if stage == "assets":
                        self.state.update(asset_pause=None)
                    if stage == "deploy" and outcome.results:
                        self.state.update(target_url=outcome.results[0].output("target_url"))
                    cursor["stage"] = order[order.index(stage) + 1]
                cursor["changed_files"] = sorted(changed_files)
                self.state.update(recovery_checkpoint=cursor)
                self._save_checkpoint()
                continue

            if stage == "implement":
                rows = {row["id"]: row for row in self.state.component_rows()}
                for result in outcome.results:
                    identity = result.output("component_id")
                    failing.extend({**entry, **({"reuse_only": True} if result.output("reuse_only") else {})}
                                   for entry in result.output("asset_failures", []))
                    if result.output("foundation_requests") and identity in by_id:
                        failing.append({"component_id": identity, "owning_layer": "foundation", "requests": result.output("foundation_requests"),
                                        "hypothesis": "Component requires shared tokens or policy changes."})
                failures_by_id = {entry["component_id"] for entry in failing}
                for component in pending:
                    identity = component["id"]
                    if rows[identity].get("status") != "PASS" and identity not in failures_by_id:
                        component_results = [result for result in outcome.results if result.output("component_id") == identity]
                        messages = [message for result in component_results for message in result.failures]
                        candidate = next((result.output("contribution_candidate") for result in component_results
                                          if result.output("contribution_candidate")), None)
                        failing.append({"component_id": identity, "owning_layer": "component", "phase": stage,
                                        "hypothesis": "; ".join(messages) or rows[identity].get("error") or "Implementation validation failed; inspect this invocation's result and logs.",
                                        **({"repair_scope": "contributions", "contribution_candidate": candidate} if candidate else {}),
                                        **({"reuse_only": True} if any(result.output("reuse_only") for result in component_results) else {}),
                                        "evidence": [str(self.evidence_dir / "agents" / f"component-{identity}-attempt-{attempt}")]})
                cursor["pending"] = [entry["component_id"] for entry in failing]
            failing = [{**entry, "phase": entry.get("phase", stage)} for entry in failing]
            self._record_attempt(attempt, [by_id[entry["component_id"]] for entry in failing if entry.get("component_id") in by_id], stage.upper() + "_FAILED", failing)
            decision = self.recover_failure(stage, outcome, components, failing)
            cursor["changed_files"] = sorted(changed_files)
            cursor["feedback"] = {str(entry["component_id"]): dict(entry) for entry in failing}
            if stage == "foundations":
                cursor["feedback"]["recovery"] = {"phase": stage, "diagnosis": decision, "results": [result.to_dict() for result in outcome.results]}
            if decision["action"] == "stop":
                return "FAIL"
            if decision["action"] == "pause":
                if stage == "assets":
                    self.state.update(asset_pause={"attempt": attempt, "changed_files": sorted(changed_files), "failing": failing})
                return self.pause_recovery(cursor, decision["reason"])
            if decision["action"] == "repair":
                repaired = set(decision["component_ids"])
                if stage == "implement":
                    repaired.update(cursor["pending"])
                cursor["pending"] = [component["id"] for component in affected_components(components, repaired)]
                for identity in cursor["pending"]:
                    cursor["feedback"].setdefault(identity, {"component_id": identity, "owning_layer": "component", "phase": stage,
                                                           "hypothesis": decision["reason"], "evidence": decision.get("evidence", [])})
                    self.state.update_component(identity, status="REPAIR_PENDING")
                if decision["repair_shared"]:
                    cursor["feedback"]["shared"] = {"owning_layer": "foundation", "phase": stage, "hypothesis": decision["reason"], "evidence": decision.get("evidence", [])}
                cursor["stage"] = "foundations" if decision["repair_shared"] else "implement"
            elif stage == "deploy" and any(entry.get("owning_layer") == "assets" for entry in failing):
                cursor["stage"] = "assets"
            cursor["attempt"] = attempt + 1
            self.state.update(recovery_checkpoint=cursor)

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
        interactions = records(parity.get("interaction_scores"))
        rows = state["components"]
        expected = [results.get("planner", {}), latest("deployer")[1], parity_result]
        expected.extend(results.get(f"component-{row['id']}-attempt-{row.get('accepted_attempt', row['attempts'])}", {}) for row in rows)
        if pipeline_status == "COMPLETE" and (
            any(result.get("run_id") != self.run_id or result.get("status") != "PASS" for result in expected)
            or not scores or not composites or not parity.get("verification") or parity.get("failing_components")
            or any(not valid_score(row) or not self.contract.visual_pass_ratio.passes(row["ratio"]) for row in scores + composites + interactions)
        ):
            pipeline_status = "FAIL"
            self.state.update(error="Completion report is missing current-run passing results or verified visual scores.")

        diagnostics = {}
        for entry in state["remediation_history"]:
            diagnostics.update({row.get("component_id"): row for row in records(entry.get("failing"))})
        diagnostics.update({row.get("component_id"): row for row in records(parity.get("failing_components"))})
        diagnostics.update({row.get("component_id"): row for row in records((state.get("asset_pause") or {}).get("failing"))})
        for recovery in state.get("recovery_history", []):
            diagnostics.update({row.get("component_id"): row for row in records(recovery.get("failing"))})
        gaps = []
        if pipeline_status not in {"COMPLETE", "DRY_RUN"}:
            for component in rows:
                component_id = component["id"]
                detail = diagnostics.get(component_id, {})
                current = results.get(f"component-{component_id}-attempt-{component.get('attempts', 0)}", {})
                if component.get("status") in {"FAIL", "ERROR", "BLOCKED"} and current.get("run_id") == self.run_id and current.get("failures"):
                    detail = {**detail, "owning_layer": detail.get("owning_layer", "component"),
                              "hypothesis": "; ".join(to_text(failure) for failure in current["failures"]),
                              "evidence": [current["result_path"]] if current.get("result_path") else detail.get("evidence", [])}
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
        if pipeline_status == "FAIL" and not rows:
            status_line = "VISUAL PARITY GATE: NOT RUN - migration failed before a component plan was accepted; see recorded failures"
        elif pipeline_status == "FAIL" and not parity_result and any(entry.get("id") == "parity" and entry.get("status") == "PENDING" for entry in state["phases"]):
            status_line = "VISUAL PARITY GATE: NOT RUN - migration failed before visual comparison; see recorded failures"
        sections = [
            "# Migration Completion Report", f"Run: `{self.run_id}`", f"Status: **{pipeline_status}**",
            status_line, f"Source: {self.contract.site_url}", f"AEM page: {state.get('target_url') or 'not recorded'}",
            f"Run state: {self.state.path}", f"Latest persisted parity result: {parity_slug}",
            f"Comparison model calls: {parity.get('comparison_model_calls', 'not recorded')}",
            "Only recorded evidence is shown. Missing values are not inferred. Ratios use the 0-1 scale.",
        ]

        def table(title: str, entries: list[Mapping[str, Any]], columns: list[tuple[str, str]]) -> None:
            cells = [{key: to_text(value).replace("\r", "").replace("\n", "<br>") for key, value in entry.items()} for entry in entries]
            sections.extend([f"## {title}", markdown_table(cells, columns)])

        table("Phases", [entry for entry in state["phases"] if entry["id"] != phase_id],
              [("Phase", "id"), ("Status", "status"), ("Error", "error")])
        table("Component Ledger", rows, [("Component", "id"), ("Status", "status"), ("Attempts", "attempts"), ("Changed files", "changed_files")])
        score_columns = [
            ("Component", "component_id"), ("Instance", "instance_id"), ("State", "state"), ("Viewport", "breakpoint"), ("Mode", "mode"), ("DPR", "dpr"),
            ("Content", "content_score"), ("Typography", "typography_score"), ("Color", "color_score"), ("Layout", "layout_score"),
            ("Section order", "section_order_score"), ("Media/interaction", "media_interaction_score"), ("Property", "property_score"),
            ("Screenshot ratio", "ratio"), ("Authorability", "authorability_score"), ("Final minimum (reported)", "final_minimum"),
            ("Screenshot validation", "screenshot_validation"), ("Matched pixels", "matched_pixels"),
            ("Differing pixels", "differing_pixels"), ("Total pixels", "total_pixels"),
            ("Live URL", "live_url"), ("AEM URL", "aem_url"), ("Live screenshot", "source_image"), ("AEM screenshot", "target_image"),
            ("Side-by-side", "side_by_side"), ("Diff mask", "diff_mask"),
        ]
        capture_keys = {"component_id", "instance_id", "state", "breakpoint", "mode", "dpr", "live_url", "aem_url", "source_image", "target_image", "side_by_side", "diff_mask"}
        for title, entries in (("Instance Scores", scores), ("Interaction Scores", interactions), ("Page Composites", composites)):
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
                         "asset_manifest", "media_manifest", "token_manifest", "readiness_matrix", "screenshot_index", "runtime_sweep", "strict_verification", "verification"):
                if name in outputs:
                    artifacts.append({"invocation": slug, "kind": name, "evidence": outputs[name]})
            failures.extend({"invocation": slug, "failure": failure} for failure in result.get("failures", []))
            failures.extend({"invocation": slug, "failure": check} for check in records(result.get("checks")) if check.get("status") != "PASS")
        if self.state.get("error"):
            failures.append({"invocation": "orchestrator", "failure": self.state.get("error")})
        if receipt_error:
            failures.append({"invocation": parity_slug, "failure": receipt_error})
        frontend = state.get("frontend_build", {})
        failures.extend({"invocation": "frontend-build", "failure": failure} for failure in frontend.get("failures", []))
        table("Shared Frontend Build", [frontend] if frontend else [],
              [("Status", "status"), ("Receipt", "receipt"), ("Commands and logs", "logs"), ("Deployable changes", "changed_files")])
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

    def cleanup_completed_run(self) -> Path | None:
        enabled = self.settings.migration.get("run.cleanup_on_success", True)
        if type(enabled) is not bool:
            raise PipelineError("run.cleanup_on_success must be true or false.")
        if self.dry_run or self.state.get("status") != "COMPLETE" or not enabled:
            return None
        root = self.evidence_dir
        root_stat = root.lstat()
        if root.resolve() != root or (root_stat.st_dev, root_stat.st_ino) != self._evidence_identity:
            raise PipelineError("Cleanup refused: the run directory was replaced or redirected.")
        if self.settings.repo_root.resolve().is_relative_to(root) or root == self.settings.resolve(str(self.settings.migration.require("run.evidence_root"))):
            raise PipelineError("Cleanup refused: the run directory is a source or shared scratch root.")
        summary_path = root / "completion-summary.json"
        report_result = self.state.get("agent_results", {}).get("report", {})
        output = report_result.get("outputs", {})
        if (report_result.get("run_id") != self.run_id or report_result.get("status") != "PASS"
                or output.get("pipeline_status") != "COMPLETE" or output.get("residual_gaps")):
            raise PipelineError("Cleanup requires the current run's accepted completion report.")
        report_path = self.settings.resolve(str(output.get("report_path", "")))
        if not report_path.is_relative_to(root) or report_path in {summary_path, self.state.path} or not report_path.is_file() or not report_path.stat().st_size:
            raise PipelineError("Cleanup requires a nonempty report inside this run, separate from its summary.")
        files, directories = [], []
        def visit(directory: Path) -> None:
            info = directory.lstat()
            if stat.S_ISLNK(info.st_mode) or getattr(info, "st_file_attributes", 0) & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0):
                raise PipelineError("Cleanup refused: filesystem links or junctions exist in the run directory.")
            for child in directory.iterdir():
                details = child.lstat()
                if stat.S_ISLNK(details.st_mode) or getattr(details, "st_file_attributes", 0) & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0):
                    raise PipelineError("Cleanup refused: filesystem links or junctions exist in the run directory.")
                if stat.S_ISDIR(details.st_mode):
                    visit(child)
                    directories.append(child)
                elif stat.S_ISREG(details.st_mode):
                    files.append((child, details.st_size))
                else:
                    raise PipelineError("Cleanup refused: an unsupported filesystem entry exists in the run directory.")
        visit(root)
        if summary_path.exists():
            raise PipelineError("Cleanup refused: the completion summary already exists.")
        if not self.state.path.resolve().is_relative_to(root):
            raise PipelineError("Cleanup refused: run state is outside this run.")
        persisted = json.loads(self.state.path.read_text(encoding="utf-8"))
        if persisted.get("run_id") != self.run_id or persisted.get("status") != "COMPLETE":
            raise PipelineError("Cleanup refused: persisted state does not identify this completed run.")
        summary = {
            "schema_version": 1, "artifact_type": "migration-completion-summary", "run_id": self.run_id,
            "status": "COMPLETE", "created_at": self.state.get("created_at"), "completed_at": utc_now(),
            "site_url": self.contract.site_url, "target_url": self.state.get("target_url"),
            "breakpoints": self.contract.breakpoints, "visual_pass_ratio": str(self.contract.visual_pass_ratio),
            "report_file": report_path.relative_to(root).as_posix(), "resume_available": False,
            "components": [{key: row.get(key) for key in ("id", "status", "attempts")} for row in self.state.component_rows()],
            "phases": [{key: row.get(key) for key in ("id", "status")} for row in self.state.get("phases", [])],
            "cleanup": {"status": "RUNNING", "removed_files": 0, "removed_bytes": 0, "errors": []},
        }
        with summary_path.open("x", encoding="utf-8") as stream:
            json.dump(summary, stream, indent=2)
        note = ("\n\n## Evidence Retention\n\n"
                "This successful run is retained as a report and completion-summary.json only. "
                "Detailed evidence, logs, screenshots, temporary scripts, worker checkouts and resume checkpoints "
                "are intentionally removed after verification. Evidence paths above are historical references, "
                "not retained files. Scores were verified before cleanup; they cannot be reverified from this "
                "summary alone. This run cannot be resumed. See completion-summary.json for cleanup status.\n")
        with report_path.open("a", encoding="utf-8") as stream:
            stream.write(note)
        summary["report_sha256"] = digest(report_path)
        for handler in list(getattr(self.logger, "handlers", [])):
            if isinstance(handler, logging.FileHandler) and Path(handler.baseFilename).resolve().is_relative_to(root):
                handler.flush()
                handler.close()
                self.logger.removeHandler(handler)
        retained = {report_path, summary_path}
        files.sort(key=lambda row: row[0] == self.state.path)
        for path, size in files:
            if path in retained:
                continue
            try:
                if not path.resolve().is_relative_to(root):
                    raise OSError("Path escaped the run directory during cleanup.")
                path.unlink()
                summary["cleanup"]["removed_files"] += 1
                summary["cleanup"]["removed_bytes"] += size
            except OSError as error:
                summary["cleanup"]["errors"].append({"path": path.relative_to(root).as_posix(), "error": str(error)})
        for directory in directories:
            if report_path.is_relative_to(directory):
                continue
            try:
                directory.rmdir()
            except OSError as error:
                summary["cleanup"]["errors"].append({"path": directory.relative_to(root).as_posix(), "error": str(error)})
        summary["cleanup"]["status"] = "FAILED" if summary["cleanup"]["errors"] else "COMPLETE"
        dump_json(summary_path, summary)
        if summary["cleanup"]["errors"]:
            emit(f"  cleanup incomplete: see {summary_path}", "yellow")
        else:
            emit(f"  cleanup: removed {summary['cleanup']['removed_files']} temporary files; retained report and summary.", "green")
        return summary_path

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
                while True:
                    try:
                        outcome = self.run_report(report_phase, pipeline_status=pipeline_status)
                        self.state.update(report_pause=None)
                        break
                    except OSError as error:
                        failed = PhaseOutcome("report", "FAIL", [AgentResult("report", self.run_id, "FAIL", failures=[str(error)])])
                        decision = self.recover_failure("report", failed, [row["plan"] for row in self.state.component_rows()])
                        self._save_checkpoint()
                        if decision["action"] != "retry":
                            self.state.update(report_pause={"pipeline_status": pipeline_status, "reason": decision["reason"]}, status="BLOCKED")
                            self.state.set_phase("report", "BLOCKED", error=decision["reason"])
                            emit(f"  report paused; accepted work retained. Resume with --resume --run-id {self.run_id}", "yellow")
                            return "BLOCKED"
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
        if pipeline_status == "COMPLETE" and not self.dry_run:
            try:
                self.cleanup_completed_run()
            except (PipelineError, OSError, ValueError) as error:
                emit(f"  cleanup could not finish; migration succeeded, but temporary files may remain: {error}", "yellow")
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
