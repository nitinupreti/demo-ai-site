from __future__ import annotations

import copy
import json
import re
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import MagicMock, patch

from PIL import Image

SCRIPTS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS))

from aem_agents.config import AgentSpec, Settings
from aem_agents.contract import load_contract
from aem_agents.envelope import AgentResult, EnvelopeError, affected_components, dependency_waves, read_result
from aem_agents.agents.base import RunContext
from aem_agents.agents.parity import ParityAgent
from aem_agents.orchestrator import Orchestrator, PhaseOutcome, PipelineError
from aem_agents.merge import MergeReport
from aem_agents.runner import CopilotBackend, BackendError
from aem_agents.agents.planner import PlannerAgent
from aem_agents.agents.deployer import DeployerAgent
from aem_agents.state import RunState
from aem_agents.toolchain import Toolchain
from aem_agents.agents import AGENT_CLASSES
from aem_agents.workspaces import WorkspaceError


class EnvelopeTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / "result.json"
        self.spec = AgentSpec("component", {}, {
            "required_result_keys": ["agent", "run_id", "status", "component_id", "changed_files"],
            "result_status_values": ["PASS", "FAIL", "BLOCKED"],
        })
        self.payload = {
            "agent": "component", "run_id": "test", "status": "PASS",
            "outputs": {"component_id": "hero", "changed_files": []},
            "checks": [{"name": "focused_test", "status": "PASS"}], "failures": [],
        }

    def read(self, payload):
        self.path.write_text(json.dumps(payload), encoding="utf-8")
        return read_result(self.path, self.spec, "test")

    def test_valid_result_passes(self):
        self.assertTrue(self.read(self.payload).passed)

    def test_success_with_failed_check_is_rejected(self):
        self.payload["checks"][0]["status"] = "FAIL"
        with self.assertRaises(EnvelopeError):
            self.read(self.payload)

    def test_success_with_failures_or_no_checks_is_rejected(self):
        for fields in ({"failures": ["test failed"]}, {"checks": []}):
            with self.subTest(fields=fields), self.assertRaises(EnvelopeError):
                self.read({**self.payload, **fields})

    def test_wrong_identity_is_rejected(self):
        for fields in ({"agent": "planner"}, {"run_id": "another-run"}):
            with self.subTest(fields=fields), self.assertRaises(EnvelopeError):
                self.read({**self.payload, **fields})

    def test_malformed_checks_are_rejected(self):
        for checks in ("PASS", ["PASS"], [{}]):
            with self.subTest(checks=checks), self.assertRaises(EnvelopeError):
                self.read({**self.payload, "checks": checks})

    def test_failed_result_does_not_need_success_evidence(self):
        result = self.read({**self.payload, "status": "FAIL", "checks": [], "failures": ["offline"]})
        self.assertFalse(result.passed)

    def test_in_memory_result_checks_affect_success(self):
        result = AgentResult("component", "test", "PASS", checks=[{"name": "test", "status": "FAIL"}])
        self.assertFalse(result.passed)


class DependencyTests(unittest.TestCase):
    def test_dependencies_finish_in_separate_waves(self):
        components = [{"id": "card", "depends_on": ["layout"]}, {"id": "layout"}, {"id": "footer"}]
        self.assertEqual([[row["id"] for row in wave] for wave in dependency_waves(components)], [["layout", "footer"], ["card"]])
        self.assertEqual([[row["id"] for row in wave] for wave in dependency_waves(components, {"layout", "footer"})], [["card"]])

    def test_unknown_dependencies_and_cycles_fail_before_execution(self):
        plans = [
            [{"id": "hero", "depends_on": ["missing"]}],
            [{"id": "hero", "depends_on": ["hero"]}],
            [{"id": "hero", "depends_on": ["body"]}, {"id": "body", "depends_on": ["hero"]}],
            [{"id": "hero", "depends_on": "body"}],
        ]
        for plan in plans:
            with self.subTest(plan=plan), self.assertRaises(EnvelopeError):
                dependency_waves(plan)

    def test_repairs_include_transitive_dependents(self):
        components = [{"id": "layout"}, {"id": "card", "depends_on": ["layout"]}, {"id": "list", "depends_on": ["card"]}, {"id": "footer"}]
        self.assertEqual([row["id"] for row in affected_components(components, {"layout"})], ["layout", "card", "list"])


class ParityTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.evidence = Path(self.directory.name)
        settings = Settings.load(SCRIPTS.parents[2], SCRIPTS / "config")
        contract = load_contract(settings, {"target_page_path": "/content/test"})
        self.context = RunContext(settings, contract, MagicMock(), MagicMock(), "test", self.evidence, MagicMock())
        self.agent = ParityAgent(self.context)
        self.components = [{"id": "hero", "instances": 1, "source_selectors": [{"instance_id": "hero-1"}]}]
        image = self.evidence / "image.png"
        Image.frombytes("RGB", (10, 10), bytes(index % 256 for index in range(300))).save(image)
        target = self.evidence / "target.png"
        target.write_bytes(image.read_bytes())
        rows = []
        composites = []
        for width in contract.breakpoints:
            page_source = self.evidence / f"page-{width}-source.png"
            page_target = self.evidence / f"page-{width}-target.png"
            Image.frombytes("RGB", (width, 10), bytes(index % 256 for index in range(width * 30))).save(page_source)
            page_target.write_bytes(page_source.read_bytes())
            for mode in settings.migration.get("parity.modes"):
                rows.append({
                    "component_id": "hero", "instance_id": "hero-1", "breakpoint": width, "mode": mode,
                    "matched_pixels": 99, "total_pixels": 100, "ratio": .99, "status": "PASS",
                    "live_url": contract.site_url,
                    "aem_url": self.context.author_url if mode == "author" else self.context.disabled_url,
                    "dpr": 1, "screenshot_validation": "PASS",
                    **{name: str(image) for name in ("source_image", "target_image", "side_by_side", "diff_mask")},
                })
                rows[-1]["target_image"] = str(target)
                composites.append({**rows[-1], "source_image": str(page_source), "target_image": str(page_target)})
        self.result = AgentResult("parity", "test", "PASS", outputs={
            "scores": rows, "page_composites": composites, "failing_components": [],
        })

    def evaluate(self, result):
        self.agent.enforce_threshold(result, self.components)
        return result

    def test_complete_matrix_passes(self):
        self.assertTrue(self.evaluate(self.result).passed)

    def test_empty_or_incomplete_scores_fail(self):
        for rows in ([], self.result.outputs["scores"][:1]):
            result = copy.deepcopy(self.result)
            result.outputs["scores"] = rows
            with self.subTest(rows=len(rows)):
                self.assertFalse(self.evaluate(result).passed)

    def test_invalid_capture_evidence_fails(self):
        for fields in ({"screenshot_validation": "FAIL"}, {"dpr": float("inf")},
                       {"source_image": str(self.evidence / "missing.png")},
                       {"target_image": str(self.evidence / "image.png")}, {"live_url": "http://wrong.invalid"}):
            result = copy.deepcopy(self.result)
            result.outputs["scores"][0].update(fields)
            with self.subTest(fields=fields):
                self.assertFalse(self.evaluate(result).passed)

    def test_claimed_counts_are_replaced_by_actual_pixelmatch(self):
        self.result.outputs["scores"][0].update(matched_pixels=0, total_pixels=0, ratio=float("inf"))
        self.assertTrue(self.evaluate(self.result).passed)
        self.assertEqual(self.result.outputs["scores"][0]["ratio"], 1)
        self.assertTrue(self.result.outputs["verification"]["sha256"])

    def test_optimistic_claim_cannot_pass_mismatching_images(self):
        target = self.evidence / "different.png"
        Image.frombytes("RGB", (10, 10), bytes(255 - index % 256 for index in range(300))).save(target)
        self.result.outputs["scores"][0].update(target_image=str(target), matched_pixels=100, total_pixels=100, ratio=1.0)
        self.assertFalse(self.evaluate(self.result).passed)
        self.assertLess(self.result.outputs["scores"][0]["ratio"], .9)

    def test_composite_requires_full_capture_evidence(self):
        self.result.outputs["page_composites"][0] = {"breakpoint": 375, "mode": "disabled", "ratio": 1}
        self.assertFalse(self.evaluate(self.result).passed)

    def test_fresh_invocation_rejects_old_capture_paths(self):
        self.agent.capture_dir = self.evidence / "fresh"
        self.agent.capture_started_ns = 1
        self.assertFalse(self.evaluate(self.result).passed)

    def test_exactly_ninety_percent_still_fails(self):
        target = self.evidence / "ninety-percent.png"
        with Image.open(self.evidence / "image.png") as image:
            for column in range(10):
                image.putpixel((column, 0), (255, 0, 0))
            image.save(target)
        self.result.outputs["scores"][0]["target_image"] = str(target)
        self.assertFalse(self.evaluate(self.result).passed)
        self.assertEqual(self.result.outputs["scores"][0]["ratio"], .9)

    def test_unequal_crops_request_layout_repair(self):
        target = self.evidence / "different-size.png"
        Image.frombytes("RGB", (9, 10), bytes(index % 256 for index in range(270))).save(target)
        self.result.outputs["scores"][0]["target_image"] = str(target)
        self.assertFalse(self.evaluate(self.result).passed)
        self.assertEqual(self.result.outputs["failing_components"][0]["owning_layer"], "css")

    def test_duplicate_instance_or_missing_composite_fails(self):
        result = copy.deepcopy(self.result)
        result.outputs["scores"].append(copy.deepcopy(result.outputs["scores"][0]))
        self.assertFalse(self.evaluate(result).passed)
        self.result.outputs["page_composites"] = []
        self.assertFalse(self.evaluate(self.result).passed)

    def test_truncated_and_uniform_pngs_fail(self):
        image = self.evidence / "bad.png"
        image.write_bytes((self.evidence / "image.png").read_bytes()[:24])
        result = copy.deepcopy(self.result)
        result.outputs["scores"][0]["source_image"] = str(image)
        self.assertFalse(self.evaluate(result).passed)
        Image.new("RGB", (10, 10), "white").save(image)
        result = copy.deepcopy(self.result)
        result.outputs["scores"][0]["target_image"] = str(image)
        self.assertFalse(self.evaluate(result).passed)

    def test_malformed_score_keys_fail_closed(self):
        result = copy.deepcopy(self.result)
        result.outputs["scores"][0]["breakpoint"] = []
        self.assertFalse(self.evaluate(result).passed)
        result = copy.deepcopy(self.result)
        result.outputs["scores"][0]["component_id"] = []
        with self.assertRaises(EnvelopeError):
            self.evaluate(result)

    def test_post_validation_is_persisted(self):
        self.result.outputs["scores"] = []
        result_path = self.evidence / "result.json"
        backend = self.context.backend
        backend.run.return_value = SimpleNamespace(timed_out=False, ok=True, exit_code=0, duration_seconds=1)
        with patch.object(self.agent, "render_prompt", return_value="test"), patch.object(self.agent, "result_path", return_value=result_path), patch("aem_agents.agents.base.read_result", return_value=self.result):
            result = self.agent.run(components=self.components)
        self.assertEqual(result.status, "FAIL")
        self.assertEqual(self.context.state.record_agent_result.call_args.args[1]["status"], "FAIL")


class OrchestratorTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        settings = Settings.load(SCRIPTS.parents[2], SCRIPTS / "config")
        contract = load_contract(settings)
        settings.repo_root = Path(self.directory.name) / "repo"
        settings.repo_root.mkdir()
        self.engine = Orchestrator(settings, contract, run_id="test",
                                   evidence_dir=Path(self.directory.name) / "evidence", logger=MagicMock())
        self.engine.context = MagicMock()
        self.engine.max_attempts = 1
        self.components = [{"id": "hero"}]
        self.engine.state.set_components(self.components)
        self.phases = {phase["id"]: phase for phase in settings.phases()}
        self.engine.run_foundations = MagicMock(return_value=PhaseOutcome("foundations", "PASS"))
        self.engine.run_assets = MagicMock(return_value=PhaseOutcome("assets", "PASS"))
        self.engine.run_fanout = MagicMock(return_value=PhaseOutcome("implement", "PASS", [
            AgentResult("component", "test", "PASS", outputs={"changed_files": ["ui.apps/hero.html"]}),
        ]))
        self.engine.run_merge = MagicMock(return_value=PhaseOutcome("merge", "PASS", [
            AgentResult("merge", "test", "PASS", outputs={"changed_files": ["ui.content/page/.content.xml"]}),
        ]))
        self.engine.run_single = MagicMock(side_effect=lambda phase, **kwargs: PhaseOutcome(phase["id"], "PASS", [
            AgentResult(phase["agent"], "test", "PASS", outputs={"failing_components": [], "target_url": "http://test.invalid"}),
        ]))
        quiet = patch("aem_agents.orchestrator.emit")
        quiet.start()
        self.addCleanup(quiet.stop)

    def run_gate(self):
        return self.engine._implement_and_gate(self.phases, self.components, [], "FAILED-FINAL")

    def test_failed_implementation_never_deploys(self):
        self.engine.run_fanout.return_value.status = "FAIL"
        self.assertEqual(self.run_gate(), "FAIL")
        self.engine.run_single.assert_not_called()

    def test_failed_foundations_never_start_components(self):
        self.engine.run_foundations.return_value.status = "FAIL"
        self.assertEqual(self.run_gate(), "FAIL")
        self.engine.run_fanout.assert_not_called()
        self.engine.run_single.assert_not_called()

    def test_apply_conflict_never_advances_checkpoint(self):
        result = AgentResult("component", "test", "PASS", outputs={"component_id": "hero", "changed_files": []})
        self.engine._run_worker = MagicMock(return_value=(result, None))
        with patch("aem_agents.orchestrator.apply_changes", side_effect=WorkspaceError("Intervening edit")), patch.object(self.engine, "_save_checkpoint") as save:
            outcome = self.engine._run_component_batch(self.phases["implement"], self.components)
        self.assertFalse(outcome.passed)
        save.assert_not_called()

    def test_foundation_changes_reach_deployment(self):
        self.engine.run_foundations.return_value.results = [AgentResult("foundations", "test", "PASS", outputs={"changed_files": ["ui.frontend/src/main/webpack/site/_variables.scss"]})]
        self.assertEqual(self.run_gate(), "COMPLETE")
        self.assertIn("ui.frontend/src/main/webpack/site/_variables.scss", self.engine.run_single.call_args_list[0].kwargs["changed_files"])

    def test_failed_parity_without_component_ids_is_not_complete(self):
        self.engine.run_single.side_effect = lambda phase, **kwargs: PhaseOutcome(phase["id"], "FAIL" if phase["id"] == "parity" else "PASS", [
            AgentResult(phase["agent"], "test", "FAIL" if phase["id"] == "parity" else "PASS", outputs={"failing_components": []}),
        ])
        self.assertEqual(self.run_gate(), "FAIL")

    def test_dry_run_does_not_claim_visual_success(self):
        self.engine.dry_run = True
        self.assertEqual(self.run_gate(), "DRY_RUN")

    def test_dry_run_preflight_never_probes_external_tools(self):
        self.engine.dry_run = True
        with patch("aem_agents.orchestrator.create_backend") as backend, patch("aem_agents.orchestrator.resolve_java_home") as java, patch("aem_agents.orchestrator.PixelScorer") as scorer, patch("aem_agents.orchestrator.probe") as probe:
            self.engine.preflight()
            for operation in (backend, java, scorer, probe):
                operation.assert_not_called()
        self.assertIsNone(self.engine.context.backend)

    def test_dry_run_validates_reporter_without_claiming_completion(self):
        self.engine.dry_run = True
        self.assertEqual(self.engine._finish(self.phases, "DRY_RUN", "FAILED-FINAL"), "DRY_RUN")
        self.assertEqual(self.engine.run_single.call_args.args[0]["id"], "report")
        self.engine.run_single.side_effect = EnvelopeError("invalid reporter prompt")
        self.assertEqual(self.engine._finish(self.phases, "DRY_RUN", "FAILED-FINAL"), "FAIL")

    def test_merged_paths_reach_deployer(self):
        self.assertEqual(self.run_gate(), "COMPLETE")
        deployment = self.engine.run_single.call_args_list[0]
        self.assertIn("ui.content/page/.content.xml", deployment.kwargs["changed_files"])

    def test_real_merge_handler_returns_its_changes(self):
        report = MergeReport(merged_files=["ui.content/page/.content.xml"])
        with patch("aem_agents.orchestrator.merge_contributions", return_value=report):
            outcome = Orchestrator.run_merge(self.engine, self.phases["merge"], self.components)
        self.assertEqual(outcome.results[0].output("changed_files"), report.merged_files)

    def test_reporter_failure_downgrades_complete(self):
        for phase in self.phases:
            self.engine.state.set_phase(phase, "PASS")
        self.engine.state.update_component("hero", status="PASS")
        self.engine.run_single.side_effect = EnvelopeError("missing report")
        self.assertEqual(self.engine._finish(self.phases, "COMPLETE", "FAILED-FINAL"), "FAIL")

    def test_incomplete_prerequisites_cannot_complete(self):
        self.assertEqual(self.engine._finish(self.phases, "COMPLETE", "FAILED-FINAL"), "FAIL")

    def test_preflight_failure_is_finalized(self):
        self.engine.preflight = MagicMock(side_effect=PipelineError("offline"))
        self.assertEqual(self.engine.run(), "FAIL")
        self.assertEqual(self.engine.state.get("status"), "FAIL")

    def test_resume_preserves_identity_and_components(self):
        resumed = Orchestrator(self.engine.settings, self.engine.contract, resume=True,
                               evidence_dir=self.engine.evidence_dir, logger=MagicMock())
        self.assertEqual(resumed.run_id, "test")
        self.assertEqual(resumed.state.component_rows(), self.engine.state.component_rows())

    def test_resume_reuses_successful_components_but_redeploys(self):
        self.engine.resume = True
        self.engine.state.update_component("hero", status="PASS", attempts=1, changed_files=["ui.apps/cached.html"])
        self.engine._cached_result = MagicMock(return_value=AgentResult("component", "test", "PASS", outputs={"changed_files": ["ui.apps/cached.html"]}))
        self.assertEqual(self.run_gate(), "COMPLETE")
        self.engine.run_fanout.assert_not_called()
        self.assertIn("ui.apps/cached.html", self.engine.run_single.call_args_list[0].kwargs["changed_files"])

    def test_resume_does_not_reset_attempt_budget(self):
        self.engine.resume = True
        self.engine.state.append_remediation({"attempt": 1, "status": "FAIL", "failing": []})
        self.assertEqual(self.run_gate(), "FAIL")
        self.engine.run_fanout.assert_not_called()

    def test_resume_after_final_pass_still_runs_runtime_gates(self):
        self.engine.resume = True
        self.engine.state.update_component("hero", status="PASS", attempts=1, changed_files=[])
        self.engine.state.append_remediation({"attempt": 1, "status": "PASS", "failing": []})
        self.engine._cached_result = MagicMock(return_value=AgentResult("component", "test", "PASS", outputs={"changed_files": []}))
        self.assertEqual(self.run_gate(), "COMPLETE")
        self.engine.run_fanout.assert_not_called()
        self.assertEqual([call.args[0]["id"] for call in self.engine.run_single.call_args_list], ["deploy", "parity"])

    def test_resume_does_not_repeat_interrupted_component_attempt(self):
        self.engine.resume = True
        self.engine.state.update_component("hero", status="RUNNING", attempts=1)
        self.assertEqual(self.run_gate(), "FAIL")
        self.engine.run_fanout.assert_not_called()

    def test_resume_rejects_changed_contract_without_overwriting(self):
        before = self.engine.state.path.read_bytes()
        changed = copy.deepcopy(self.engine.contract)
        changed.site_url = "https://different.invalid"
        with self.assertRaises(Exception):
            Orchestrator(self.engine.settings, changed, resume=True, evidence_dir=self.engine.evidence_dir)
        self.assertEqual(self.engine.state.path.read_bytes(), before)


class RunnerTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.workspace = Path(self.directory.name)
        settings = Settings.load(SCRIPTS.parents[2], SCRIPTS / "config")
        with patch.object(CopilotBackend, "_resolve_executable", return_value="test"), patch.object(CopilotBackend, "_probe_version", return_value="test"):
            self.backend = CopilotBackend(settings)

    def test_interrupted_or_failed_pump_always_stops_process(self):
        for error in (KeyboardInterrupt(), RuntimeError("callback failed")):
            process = MagicMock()
            process.poll.return_value = None
            process.pid = 123
            with self.subTest(error=type(error).__name__), patch("aem_agents.runner.subprocess.Popen", return_value=process), patch("aem_agents.runner.subprocess.run"), patch("aem_agents.runner.os.killpg", create=True), patch.object(self.backend, "_pump", side_effect=error):
                with self.assertRaises(type(error)):
                    self.backend.run(prompt="test", options={}, workspace=self.workspace, stream_name="stream.jsonl", stderr_name="stderr.log", timeout_seconds=1)
            process.wait.assert_called()
            process.stdout.close.assert_called()
            self.assertFalse(self.backend._processes)

    def test_cancelled_backend_does_not_start_more_agents(self):
        self.backend.cancel_all()
        with patch("aem_agents.runner.subprocess.Popen") as start, self.assertRaises(BackendError):
            self.backend.run(prompt="test", options={}, workspace=self.workspace, stream_name="stream.jsonl", stderr_name="stderr.log", timeout_seconds=1)
        start.assert_not_called()

    def test_worker_directory_is_independent_of_logs(self):
        checkout = self.workspace / "checkout"
        checkout.mkdir()
        for directory in (None, checkout):
            with self.subTest(directory=directory), patch("aem_agents.runner.subprocess.Popen") as start, patch.object(self.backend, "_pump", return_value=SimpleNamespace(duration_seconds=0)):
                start.return_value.poll.return_value = 0
                self.backend.run(
                    prompt="test", options={}, workspace=self.workspace / "logs",
                    stream_name="stream.jsonl", stderr_name="stderr.log", timeout_seconds=1,
                    working_directory=directory,
                )
                self.assertEqual(start.call_args.kwargs["cwd"], directory or self.backend.settings.repo_root)


class ConfigurationTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.evidence = Path(self.directory.name)
        self.settings = Settings.load(SCRIPTS.parents[2], SCRIPTS / "config")
        self.state = RunState.create(self.evidence / "state.json", run_id="test", contract={}, inputs={}, phases=[], orchestrator={})
        self.context = RunContext(self.settings, load_contract(self.settings), MagicMock(), self.state, "test", self.evidence, MagicMock())

    def test_global_budget_and_session_names_reach_cli(self):
        agent = PlannerAgent(self.context)
        options = agent.backend_options("planner")
        self.assertEqual(options["max_continues"], self.settings.migration.get("model.max_continues"))
        backend = object.__new__(CopilotBackend)
        backend.config = self.settings.migration.section("backend.copilot")
        args = backend.build_args("test", options)
        self.assertEqual(args[args.index("--name") + 1], "test-planner")
        self.assertNotIn("{session_name}", args)

    def test_resolved_target_reaches_parity_and_reporter(self):
        base = f"http://{self.context.aem_host}:{self.context.aem_port}"
        self.context.record_target_url(base + "/content/discovered.html")
        self.assertEqual(self.context.disabled_url, base + "/content/discovered.html?wcmmode=disabled")
        self.assertEqual(self.context.author_url, base + "/editor.html/content/discovered.html")
        self.assertEqual(self.context.target_page_path, "/content/discovered")

    def test_wrong_target_is_rejected(self):
        with self.assertRaises(EnvelopeError):
            self.context.record_target_url("http://wrong.invalid:1234/content/discovered.html")

    def test_malformed_contribution_is_an_envelope_failure(self):
        component = {"id": "hero", "source_order": 0}
        agent = AGENT_CLASSES["component"](self.context)
        workspace = agent.workspace(agent.slug(component=component))
        workspace.mkdir(parents=True)
        (workspace / "contributions.json").write_text(json.dumps({"component_id": "hero", "nodes": []}), encoding="utf-8")
        result = AgentResult("component", "test", "PASS", outputs={"component_id": "hero", "changed_files": []})
        with self.assertRaises(EnvelopeError):
            agent.validate_result(result, component=component)

    def test_all_deploy_commands_bind_host_and_port(self):
        table = DeployerAgent(self.context).deploy_table()
        for line in table.splitlines():
            if "mvn " in line and " install " in line:
                self.assertIn(f"-Daem.host={self.context.aem_host}", line)
                self.assertIn(f"-Daem.port={self.context.aem_port}", line)
        self.assertNotIn("{host}", table)
        self.assertNotIn("{port}", table)

    def test_frontend_command_uses_an_existing_script(self):
        package = json.loads((SCRIPTS.parents[2] / "ui.frontend" / "package.json").read_text(encoding="utf-8"))
        command = next(row["command"] for row in self.settings.migration.get("deploy.scoped") if row["id"] == "ui-frontend")
        self.assertIn(command.split()[-1], package["scripts"])

    def test_configured_check_names_match_rendered_prompts(self):
        component = {"id": "hero", "source_order": 0}
        for role, factory in AGENT_CLASSES.items():
            agent = factory(self.context)
            prompt = agent.render_prompt(agent.slug(component=component), component=component)
            envelopes = []
            for block in re.findall(r"```json\s*\n(.*?)```", prompt, re.DOTALL):
                try:
                    payload = json.loads(block)
                except ValueError:
                    continue
                if isinstance(payload, dict) and "checks" in payload:
                    envelopes.append(payload)
            with self.subTest(role=role):
                self.assertEqual(len(envelopes), 1)
                self.assertEqual(set(agent.spec.get("required_checks")), {row["name"] for row in envelopes[0]["checks"]})


class EndToEndTests(unittest.TestCase):
    def test_interrupted_pipeline_resumes_without_replanning_or_rebuilding_components(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            original = Settings.load(SCRIPTS.parents[2], SCRIPTS / "config")
            settings = Settings(root, original.migration.merged({
                "contract": {"file": str(SCRIPTS.parent / "prompt_new.md")},
            }), original._agents_config.merged({"defaults": {"prompt_dir": str(SCRIPTS / "prompts")}}))
            contract = load_contract(settings, {"site_url": "https://example.invalid/page"})
            evidence = root / "evidence"
            template = "/conf/demo-ai-site/settings/wcm/templates/page-content"
            initial = settings.resolve(settings.migration.get("shared_files.authored_page.file").format(page_path=template + "/initial"))
            initial.parent.mkdir(parents=True, exist_ok=True)
            initial.write_text('<jcr:root xmlns:jcr="http://www.jcp.org/jcr/1.0" jcr:primaryType="cq:Page"><jcr:content jcr:primaryType="cq:PageContent"><root><container /></root></jcr:content></jcr:root>', encoding="utf-8")
            components = [{
                "id": name, "name": name.title(), "tier": 4, "delivery": "component",
                "resource_type": f"demo-ai-site/components/{name}", "source_order": order,
                "instances": 1, "source_selectors": [{"instance_id": f"{name}-1", "selector": f".{name}"}],
            } for order, name in enumerate(("hero", "body"))]
            components[1]["depends_on"] = ["hero"]
            calls = []
            interrupt = [True]
            test_case = self

            class FixtureBackend:
                version = "offline fixture"

                def run(self, **kwargs):
                    workspace = kwargs["workspace"]
                    role = workspace.name.split("-")[0]
                    calls.append(role)
                    if role == "parity" and interrupt[0]:
                        interrupt[0] = False
                        raise KeyboardInterrupt()
                    check_log = workspace / "checks.log"
                    check_log.write_text("Offline unit-test fixture", encoding="utf-8")
                    outputs = {}
                    status = "PASS"
                    if role == "planner":
                        outputs = {"components": components, "coverage_report": str(check_log), "source_selector_map": str(check_log)}
                    elif role == "foundations":
                        outputs = {"changed_files": [], "token_manifest": str(check_log)}
                    elif role == "component":
                        component_id = workspace.name[len("component-"):].rsplit("-attempt-", 1)[0]
                        component = next(row for row in components if row["id"] == component_id)
                        if component_id == "body":
                            test_case.assertTrue((kwargs["working_directory"] / "ui.apps/src/main/content/jcr_root/apps/demo-ai-site/components/hero/component.html").is_file())
                        changed = f"ui.apps/src/main/content/jcr_root/apps/demo-ai-site/components/{component_id}/component.html"
                        code = kwargs["working_directory"] / changed
                        code.parent.mkdir(parents=True, exist_ok=True)
                        code.write_text("<p>Unit test</p>", encoding="utf-8")
                        outputs = {"component_id": component_id, "changed_files": [changed], "resource_type": component["resource_type"]}
                        contribution = {
                            "component_id": component_id, "source_order": component["source_order"],
                            "page_path": "/content/test", "parent_path": "jcr:content/root/container",
                            "template_path": template, "page_properties": {"jcr:title": "Unit test"},
                            "nodes": [{"name": component_id, "xml": f"<{component_id} />"}], "assets": [],
                        }
                        (workspace / "contributions.json").write_text(json.dumps(contribution), encoding="utf-8")
                    elif role == "deployer":
                        outputs = {"deploy_commands": [], "target_url": f"http://{engine.context.aem_host}:{engine.context.aem_port}/content/test.html"}
                    elif role == "parity":
                        captures = Path(kwargs["env_extra"]["MIGRATION_CAPTURE_DIR"])
                        captures.mkdir(parents=True)
                        image = captures / "image.png"
                        target = captures / "target.png"
                        Image.frombytes("RGB", (10, 10), bytes(index % 256 for index in range(300))).save(image)
                        target.write_bytes(image.read_bytes())
                        rows = [{
                            "component_id": component["id"], "instance_id": f"{component['id']}-1",
                            "breakpoint": width, "mode": mode, "matched_pixels": 100, "total_pixels": 100,
                            "ratio": 1.0, "status": "PASS", "screenshot_validation": "PASS", "dpr": 1,
                            "live_url": contract.site_url,
                            "aem_url": engine.context.author_url if mode == "author" else engine.context.disabled_url,
                            "source_image": str(image), "target_image": str(target),
                        } for component in components for width in contract.breakpoints for mode in settings.migration.get("parity.modes")]
                        composites = []
                        for width in contract.breakpoints:
                            page_source = captures / f"page-{width}-source.png"
                            page_target = captures / f"page-{width}-target.png"
                            Image.frombytes("RGB", (width, 10), bytes(index % 256 for index in range(width * 30))).save(page_source)
                            page_target.write_bytes(page_source.read_bytes())
                            for mode in settings.migration.get("parity.modes"):
                                composite = next(row for row in rows if row["breakpoint"] == width and row["mode"] == mode)
                                composites.append({**composite, "source_image": str(page_source), "target_image": str(page_target)})
                        outputs = {"scores": rows, "failing_components": [], "page_composites": composites}
                    elif role == "reporter":
                        report = evidence / settings.migration.get("run.report_file")
                        report.write_text("Offline unit-test report", encoding="utf-8")
                        status = "COMPLETE"
                        outputs = {"report_path": str(report), "residual_gaps": []}
                    payload = {
                        "agent": role, "run_id": "integration", "status": status, "outputs": outputs,
                        "checks": [{"name": name, "status": "PASS", "evidence": str(check_log)} for name in settings.agent(role).get("required_checks")],
                        "failures": [],
                    }
                    (workspace / "result.json").write_text(json.dumps(payload), encoding="utf-8")
                    return SimpleNamespace(timed_out=False, ok=True, exit_code=0, duration_seconds=.01)

            backend = FixtureBackend()
            engine = Orchestrator(settings, contract, run_id="integration", skip_probe=True, evidence_dir=evidence, logger=MagicMock())
            with patch("aem_agents.orchestrator.create_backend", return_value=backend), patch("aem_agents.orchestrator.resolve_java_home", return_value=Toolchain(root / "jdk", "fixture")), patch("aem_agents.orchestrator.emit"), patch("aem_agents.agents.base.emit"):
                with self.assertRaises(KeyboardInterrupt):
                    engine.run()
                self.assertEqual(engine.state.get("status"), "INTERRUPTED")
                self.assertEqual(sum(row["status"] == "PASS" for row in engine.state.component_rows()), 2)
                calls.clear()
                engine = Orchestrator(settings, contract, resume=True, skip_probe=True, evidence_dir=evidence, logger=MagicMock())
                self.assertEqual(engine.run(), "COMPLETE")
            self.assertEqual(calls, ["deployer", "parity", "reporter"])
            self.assertEqual(engine.state.get("status"), "COMPLETE")
            self.assertTrue((evidence / "completion-report.md").is_file())


if __name__ == "__main__":
    unittest.main()