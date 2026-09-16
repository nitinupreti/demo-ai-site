from __future__ import annotations

import copy
import json
import queue
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

from aem_agents.config import AgentSpec, ConfigError, Settings
from aem_agents.cli import main as cli_main
from aem_agents.browser import browser_paths
from aem_agents.contract import load_contract
from aem_agents.envelope import AgentResult, EnvelopeError, affected_components, dependency_waves, read_result
from aem_agents.agents.base import Agent, RunContext
from aem_agents.agents.parity import ParityAgent
from aem_agents.orchestrator import Orchestrator, PhaseOutcome, PipelineError
from aem_agents.merge import MergeReport
from aem_agents.runner import CopilotBackend, BackendError, run_command
from aem_agents.agents.planner import PlannerAgent
from aem_agents.agents.deployer import DeployerAgent
from aem_agents.state import RunState
from aem_agents.toolchain import Toolchain
from aem_agents.agents import AGENT_CLASSES
from aem_agents.workspaces import WorkspaceError, digest
from aem_agents.discovery import DiscoveryEvidence


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


class EvidenceTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name).resolve()
        self.evidence = self.root / "evidence"
        self.evidence.mkdir()
        settings = Settings.load(SCRIPTS.parents[2], SCRIPTS / "config")
        self.context = RunContext(settings, load_contract(settings), None, MagicMock(), "test", self.evidence, MagicMock())
        self.agent = PlannerAgent(self.context)
        self.paths = [self.evidence / f"stability-{width}.json" for width in (375, 768, 1440)]
        for path in self.paths:
            path.write_text("{}", encoding="utf-8")

    def validate(self, evidence):
        result = AgentResult("planner", "test", "PASS", checks=[{
            "name": "all_breakpoints_ready", "status": "PASS", "evidence": evidence,
            "details": "Viewport and layout stability checked at every breakpoint.",
        }])
        Agent.validate_result(self.agent, result)

    def test_single_evidence_path_remains_supported(self):
        self.validate(str(self.paths[0]))

    def test_explicit_evidence_paths_are_all_validated(self):
        self.validate([str(path) for path in self.paths])
        self.paths[-1].unlink()
        with self.assertRaisesRegex(EnvelopeError, "all_breakpoints_ready.*stability-1440"):
            self.validate([str(path) for path in self.paths])

    def test_empty_or_out_of_run_evidence_is_rejected(self):
        empty = self.evidence / "empty.json"
        empty.touch()
        outside = self.root / "outside.json"
        outside.write_text("{}", encoding="utf-8")
        for invalid in (empty, outside):
            with self.subTest(path=invalid), self.assertRaisesRegex(EnvelopeError, "all_breakpoints_ready"):
                self.validate([str(self.paths[0]), str(invalid)])

    def test_malformed_evidence_is_rejected_with_check_context(self):
        annotated = f"{self.paths[0]}, stability-768.json, stability-1440.json (all blocks stable)"
        for invalid in (None, "", [], [None], [[str(self.paths[0])]], {"path": str(self.paths[0])}, annotated):
            with self.subTest(evidence=invalid), self.assertRaisesRegex(EnvelopeError, "all_breakpoints_ready.*details"):
                self.validate(invalid)

    def test_filename_punctuation_is_not_parsed_as_prose(self):
        path = self.evidence / "stability, 375 (verified).json"
        path.write_text("{}", encoding="utf-8")
        self.validate(str(path))

    def test_rendered_prompt_explains_structured_evidence(self):
        prompt = self.agent.render_prompt("planner")
        self.assertIn("nonempty JSON array of file path strings", prompt)
        self.assertIn("details", prompt)
        self.assertIn("comma-separated", prompt)

    def test_planning_precedes_separate_foundations_and_components(self):
        phases = self.context.settings.phases()
        self.assertEqual([phase["id"] for phase in phases[:3]], ["plan", "foundations", "implement"])
        self.assertIn("foundations", AGENT_CLASSES)
        self.assertNotIn("shared_tokens_ready", self.agent.spec.get("required_checks"))
        shared = AGENT_CLASSES["foundations"](self.context)
        self.assertIn("shared_tokens_ready", shared.spec.get("required_checks"))
        self.assertIn("shared_policies_ready", shared.spec.get("required_checks"))

    def test_foundation_repairs_have_separate_attempt_identity(self):
        self.assertEqual(self.agent.slug(), "planner")
        foundations = AGENT_CLASSES["foundations"](self.context)
        self.assertEqual(foundations.slug(), "foundations")
        self.assertEqual(foundations.slug(repair=True, attempt=2), "foundations-repair-attempt-2")

    def test_planner_prompt_is_readonly_and_worker_root_is_explicit(self):
        prompt = self.agent.render_prompt("planner")
        self.assertIn("read-only for all repository sources", prompt)
        self.assertIn(f"Source root: `{self.context.repo_root.resolve()}`", prompt)
        self.assertIn("Never use the original checkout path", prompt)
        self.assertNotIn("shared_tokens_ready", prompt)
        self.assertEqual(self.agent.env_extra()["MIGRATION_SOURCE_ROOT"], str(self.context.repo_root.resolve()))

    def test_foundations_validate_tokens_without_replanning(self):
        agent = AGENT_CLASSES["foundations"](self.context)
        components = [{"id": "hero"}]
        result = AgentResult("foundations", "test", "PASS", outputs={"components": components, "token_manifest": str(self.paths[0])})
        agent.validate_result(result, components=components)
        with self.assertRaisesRegex(EnvelopeError, "preserve the validated component plan"):
            agent.validate_result(result, components=[{"id": "other"}])
        result.outputs["token_manifest"] = str(self.evidence / "missing.json")
        with self.assertRaisesRegex(EnvelopeError, "Missing, empty"):
            agent.validate_result(result, components=components)

    def test_planner_routes_xf_ownership_to_required_contributions(self):
        target = "/content/experience-fragments/demo-ai-site/us/en/site/header/master"
        content_path = f"ui.content/src/main/content/jcr_root{target}/.content.xml"
        model_path = "core/src/main/java/com/demo/core/models/SiteHeaderModel.java"
        component = {
            "id": "site-header", "name": "Site header", "tier": 2,
            "delivery": "experience-fragment", "source_order": 0,
            "resource_type": "demo-ai-site/components/site-header",
            "source_selectors": [{"instance_id": "header-1", "selector": "header"}],
            "owned_paths": [content_path, model_path], "reuse_target": target,
        }
        result = AgentResult("planner", "test", "PASS", outputs={"components": [component]})
        planned = self.agent.validate_plan(result)
        self.assertEqual(planned[0]["owned_paths"], [model_path])
        self.assertEqual(planned[0]["contribution_targets"], [target])
        self.assertEqual(planned[0]["delivery"], "experience-fragment")
        self.assertEqual(planned[0]["reuse_target"], target)
        self.assertEqual(result.output("ownership_corrections")[0]["path"], content_path)
        self.assertEqual(component["owned_paths"], [content_path, model_path])
        persisted = json.loads((self.evidence / "component-plan.json").read_text(encoding="utf-8"))
        self.assertEqual(persisted["components"], planned)

    def test_planner_routes_page_and_footer_targets_without_mutating_input(self):
        page = "/content/demo-ai-site/us/en/story"
        footer = "/content/experience-fragments/demo-ai-site/us/en/site/footer/master"
        component = {"id": "site-footer", "contribution_targets": [footer], "owned_paths": [
            f"ui.content/src/main/content/jcr_root{target}/.content.xml" for target in (page, footer, page)
        ]}
        original = copy.deepcopy(component)
        routed = copy.deepcopy(component)
        self.agent.route_content_ownership([routed])
        self.assertEqual(routed["owned_paths"], [])
        self.assertEqual(routed["contribution_targets"], [footer, page])
        self.assertEqual(component, original)
        self.assertEqual(self.agent.route_content_ownership([routed]), [])

    def test_planner_ownership_correction_rejects_unsafe_content_paths(self):
        paths = [
            "ui.content/src/main/content/jcr_root/conf/demo-ai-site/settings/wcm/templates/page/initial/.content.xml",
            "ui.content/src/main/content/jcr_root/content/dam/demo-ai-site/image/.content.xml",
            "ui.content/src/main/content/jcr_root/content/other-site/en/.content.xml",
            "ui.content/src/main/content/jcr_root/content/demo-ai-site/../other-site/.content.xml",
            "ui.content/src/main/content/jcr_root/content/demo-ai-site/**/.content.xml",
            "ui.content/src/main/content/jcr_root/content/demo-ai-site/en/jcr:content/.content.xml",
        ]
        for path in paths:
            with self.subTest(path=path), self.assertRaises(EnvelopeError):
                self.agent.route_content_ownership([{"id": "header", "owned_paths": [path]}])

    def test_planner_keeps_unknown_shared_source_ownership_rejected(self):
        for path in ("pom.xml", "ui.frontend/src/main/webpack/site/_variables.scss", "ui.content/src/main/content/META-INF/vault/filter.xml"):
            component = {"id": "hero", "name": "Hero", "tier": 4, "delivery": "component", "source_order": 0,
                         "resource_type": "demo-ai-site/components/hero", "source_selectors": [{"instance_id": "hero-1", "selector": "main"}],
                         "owned_paths": [path]}
            with self.subTest(path=path), self.assertRaises(EnvelopeError):
                self.agent.validate_plan(AgentResult("planner", "test", "PASS", outputs={"components": [component]}))

    def test_planner_routes_using_configured_content_package(self):
        self.context.settings = Settings(self.context.settings.repo_root, self.context.settings.migration.merged({
            "shared_files": {"authored_page": {"file": "content-package/src{page_path}/.content.xml"}},
            "reuse": {"experience_fragment_root": "/content/experience-fragments/custom"},
        }), self.context.settings._agents_config)
        component = {"id": "header", "owned_paths": ["content-package/src/content/experience-fragments/custom/header/master/.content.xml"]}
        self.agent.route_content_ownership([component])
        self.assertEqual(component["contribution_targets"], ["/content/experience-fragments/custom/header/master"])

    def test_progress_displays_planner_section_milestones(self):
        event = {"type": "assistant.message", "data": {"content": 'AEM_PROGRESS {"stage":"planning","subject":"Hero","action":"Checking existing component reuse","current":2,"total":8}'}}
        with patch("aem_agents.agents.base.emit") as output:
            self.agent._on_event("Planner [planner]", event)
        text = "\n".join(call.args[0] for call in output.call_args_list)
        self.assertIn("Section 2/8: Hero", text)
        self.assertIn("Planning | Checking existing component reuse", text)
        self.assertNotIn("AEM_PROGRESS", text)

    def test_progress_accepts_unknown_section_counts_from_live_planner(self):
        event = {"type": "assistant.message", "data": {"content": 'AEM_PROGRESS {"stage":"evidence","subject":"Startup","action":"Reading contract, discovery summary, manifest and repository inventory","current":null,"total":null}\n\nBeginning by reading the contract and evidence files to establish scope before any planning work.'}}
        with patch("aem_agents.agents.base.emit") as output:
            self.agent._on_event("Planner [planner]", event)
        text = "\n".join(call.args[0] for call in output.call_args_list)
        self.assertIn("Startup | Evidence | Reading contract, discovery summary, manifest and repository inventory", text)
        self.assertNotIn("Section", text)
        self.assertNotIn("null", text)
        self.assertNotIn("Beginning by", text)

    def test_progress_displays_component_identity_and_step(self):
        agent = AGENT_CLASSES["component"](self.context)
        event = {"type": "assistant.message", "data": {"content": 'AEM_PROGRESS {"stage":"dialog","subject":"Hero banner","action":"Adding authored image and title fields"}'}}
        with patch("aem_agents.agents.base.emit") as output:
            agent._on_event("Component builder [component-hero-banner-attempt-2]", event)
        text = "\n".join(call.args[0] for call in output.call_args_list)
        self.assertIn("component-hero-banner-attempt-2", text)
        self.assertIn("Hero banner | Dialog | Adding authored image and title fields", text)

    def test_progress_keeps_tool_output_verbose_only(self):
        event = {"type": "assistant.message", "data": {"toolRequests": [{"name": "read_file", "arguments": {"path": "example.html"}}]}}
        for verbose in (False, True):
            self.context.logger.isEnabledFor.return_value = verbose
            with self.subTest(verbose=verbose), patch("aem_agents.agents.base.emit") as output:
                self.agent._on_event("Planner [planner]", event)
                self.assertEqual(output.called, verbose)

    def test_progress_displays_actual_tool_activity_without_milestones(self):
        for role in ("planner", "foundations", "component"):
            agent = AGENT_CLASSES[role](self.context)
            self.context.logger.isEnabledFor.return_value = False
            start = {"type": "tool.execution_start", "data": {
                "toolCallId": "readiness-check", "toolName": "powershell",
                "arguments": {"description": "Verify all fonts ready at each breakpoint", "command": "sensitive command text"},
            }}
            end = {"type": "tool.execution_complete", "data": {"toolCallId": "readiness-check", "success": True, "result": "sensitive result text"}}
            with self.subTest(role=role), patch("aem_agents.agents.base.emit") as output:
                agent._on_event(f"Worker [{role}]", start)
                agent._on_event(f"Worker [{role}]", end)
                text = "\n".join(call.args[0] for call in output.call_args_list)
                self.assertIn("activity: Started | Verify all fonts ready at each breakpoint", text)
                self.assertIn("activity: Finished | Verify all fonts ready at each breakpoint", text)
                self.assertNotIn("sensitive", text)
                self.assertNotIn("PASS", text)
            self.context.state.record_agent_result.assert_not_called()
            self.context.state.update.assert_not_called()

    def test_progress_heartbeat_identifies_active_tool_and_model_wait(self):
        with patch("aem_agents.agents.base.time.monotonic", return_value=100):
            agent = PlannerAgent(self.context)
        start = {"type": "tool.execution_start", "data": {"toolCallId": "fonts", "toolName": "powershell", "arguments": {"description": "Checking fonts at 375px"}}}
        with patch("aem_agents.agents.base.emit") as output:
            with patch("aem_agents.agents.base.time.monotonic", return_value=110):
                agent._on_event("planner", start)
            with patch("aem_agents.agents.base.time.monotonic", return_value=150):
                agent._on_event("planner", {"type": "tool.execution_partial_result", "data": {"toolCallId": "fonts", "partialOutput": "private tool output"}})
                agent._on_event("planner", {"type": "aem.heartbeat"})
                self.assertEqual(output.call_count, 1)
            with patch("aem_agents.agents.base.time.monotonic", return_value=155):
                agent._on_event("planner", {"type": "aem.heartbeat"})
                self.assertIn("Tool active for 45s | Checking fonts at 375px", output.call_args.args[0])
            with patch("aem_agents.agents.base.time.monotonic", return_value=170):
                agent._on_event("planner", {"type": "tool.execution_complete", "data": {"toolCallId": "fonts", "success": True}})
            with patch("aem_agents.agents.base.time.monotonic", return_value=171):
                agent._on_event("planner", {"type": "model.call_start", "data": {"turnId": "next"}})
            with patch("aem_agents.agents.base.time.monotonic", return_value=215):
                agent._on_event("planner", {"type": "aem.heartbeat"})
                self.assertIn("Waiting for model response for 44s | 1 tool calls completed", output.call_args.args[0])
        text = "\n".join(call.args[0] for call in output.call_args_list)
        self.assertNotIn("No milestone reported yet", text)
        self.assertNotIn("private tool output", text)

    def test_progress_runtime_events_keep_workers_and_concurrent_tools_separate(self):
        first = AGENT_CLASSES["component"](self.context)
        second = AGENT_CLASSES["component"](self.context)
        events = [{"type": "tool.execution_start", "data": {"toolCallId": identity, "toolName": "view", "arguments": {"path": f"core/models/{identity}.java"}}} for identity in ("hero", "card")]
        with patch("aem_agents.agents.base.emit") as output:
            first._on_event("Component [component-hero-attempt-1]", events[0])
            first._on_event("Component [component-hero-attempt-1]", events[0])
            first._on_event("Component [component-hero-attempt-1]", events[1])
            second._on_event("Component [component-card-attempt-1]", events[0])
            end = {"type": "tool.execution_complete", "data": {"toolCallId": "hero", "success": False}}
            first._on_event("Component [component-hero-attempt-1]", end)
            first._on_event("Component [component-hero-attempt-1]", end)
            self.assertEqual(output.call_count, 4)
            self.assertIn("Failed | Reading file: models/hero.java", output.call_args.args[0])
            self.assertEqual(list(first._active_tools), ["card"])
            self.assertEqual(list(second._active_tools), ["hero"])
            self.assertEqual(first._completed_tools, 1)
            self.assertEqual(second._completed_tools, 0)
        first._reset_progress()
        self.assertEqual(first._active_tools, {})
        self.assertEqual(first._completed_tools, 0)

    def test_progress_runtime_fallbacks_never_display_raw_payloads(self):
        starts = [
            {"toolCallId": "one", "toolName": "powershell", "arguments": {"command": "SECRET"}},
            {"toolCallId": "two", "toolName": "view", "arguments": {"path": "https://user:SECRET@example.invalid/file"}},
            {"toolCallId": "three", "toolName": "view", "arguments": {"description": "SECRET\u001b[2J", "path": "bad\npath"}},
            {"toolCallId": "four", "toolName": [], "arguments": "SECRET"},
        ]
        with patch("aem_agents.agents.base.emit") as output:
            for data in starts:
                self.agent._on_event("planner", {"type": "tool.execution_start", "data": data})
                self.agent._on_event("planner", {"type": "tool.execution_complete", "data": {"toolCallId": data["toolCallId"], "result": "SECRET"}})
            text = "\n".join(call.args[0] for call in output.call_args_list)
            self.assertNotIn("SECRET", text)
            self.assertIn("Ended (outcome unknown)", text)
            self.assertNotIn("Finished", text)

    def test_progress_ignores_malformed_messages_without_changing_state(self):
        content = [
            "Reading source evidence", "AEM_PROGRESS not-json", "AEM_PROGRESS []",
            'AEM_PROGRESS {"stage":[],"subject":"Hero","action":"Checking reuse"}',
            'AEM_PROGRESS {"stage":"planning","subject":"Hero","action":null}',
            'AEM_PROGRESS {"stage":"planning","subject":"Hero","action":"Checking reuse","current":true,"total":8}',
            'AEM_PROGRESS {"stage":"planning","subject":"Hero","action":"Checking reuse","current":9,"total":8}',
            'AEM_PROGRESS {"stage":"planning","subject":"Hero","action":"Checking reuse","current":1}',
            'AEM_PROGRESS {"stage":"planning","subject":"Hero","action":"\\u001b[2J"}',
            'AEM_PROGRESS {"stage":"foundations","subject":"Tokens","action":"Working","current":1,"total":8}',
        ]
        with patch("aem_agents.agents.base.emit") as output:
            for message in content:
                self.agent._on_event("Planner [planner]", {"type": "assistant.message", "data": {"content": message}})
        output.assert_not_called()
        self.context.state.record_agent_result.assert_not_called()
        self.context.state.update.assert_not_called()

    def test_progress_deduplicates_with_independent_worker_state(self):
        first = AGENT_CLASSES["component"](self.context)
        second = AGENT_CLASSES["component"](self.context)
        event = {"type": "assistant.message", "data": {"content": 'AEM_PROGRESS {"stage":"tests","subject":"Shared model","action":"Running focused tests"}'}}
        with patch("aem_agents.agents.base.emit") as output:
            first._on_event("Component [component-hero-attempt-1]", event)
            first._on_event("Component [component-hero-attempt-1]", event)
            second._on_event("Component [component-card-attempt-1]", event)
        self.assertEqual(output.call_count, 2)
        self.assertIn("component-hero-attempt-1", output.call_args_list[0].args[0])
        self.assertIn("component-card-attempt-1", output.call_args_list[1].args[0])

    def test_progress_heartbeat_is_throttled_and_does_not_invent_activity(self):
        with patch("aem_agents.agents.base.time.monotonic", return_value=100):
            agent = PlannerAgent(self.context)
        with patch("aem_agents.agents.base.emit") as output:
            for now in (144, 145, 146, 190):
                with patch("aem_agents.agents.base.time.monotonic", return_value=now):
                    agent._on_event("Planner [planner]", {"type": "aem.heartbeat"})
        self.assertEqual(output.call_count, 2)
        self.assertIn("[planner 00:45] Still running | No milestone reported yet", output.call_args_list[0].args[0])
        self.assertIn("No progress update for 90s", output.call_args_list[1].args[0])
        self.context.state.update.assert_not_called()

    def test_progress_heartbeat_uses_last_milestone_not_tool_activity(self):
        self.context.logger.isEnabledFor.return_value = False
        with patch("aem_agents.agents.base.time.monotonic", return_value=100):
            agent = AGENT_CLASSES["component"](self.context)
        label = "Component [component-hero-attempt-2]"
        event = {"type": "assistant.message", "data": {"content": 'AEM_PROGRESS {"stage":"tests","subject":"Hero","action":"Running model tests"}'}}
        with patch("aem_agents.agents.base.emit") as output:
            with patch("aem_agents.agents.base.time.monotonic", return_value=110):
                agent._on_event(label, event)
            with patch("aem_agents.agents.base.time.monotonic", return_value=150):
                agent._on_event(label, {"type": "assistant.message", "data": {"toolRequests": [{"name": "shell"}]}})
                agent._on_event(label, {"type": "aem.heartbeat"})
            with patch("aem_agents.agents.base.time.monotonic", return_value=155):
                agent._on_event(label, {"type": "aem.heartbeat"})
        self.assertEqual(output.call_count, 2)
        self.assertIn("Last reported activity: Hero | Tests | Running model tests", output.call_args.args[0])
        self.assertIn("No progress update for 45s", output.call_args.args[0])

    def test_progress_prompts_cover_planning_and_component_steps(self):
        planner = self.agent.render_prompt("planner")
        component = AGENT_CLASSES["component"](self.context).render_prompt("component-hero-attempt-2", component={"id": "hero", "source_order": 0}, attempt=2)
        for prompt in (planner, component):
            self.assertIn("AEM_PROGRESS", prompt)
            self.assertIn("standalone", prompt)
            self.assertIn("heartbeat", prompt)
        self.assertIn("candidate section list", planner)
        self.assertIn('"subject":"hero"', component)
        for step in ("dialog", "model", "htl", "styles", "tests", "content"):
            self.assertIn(f"`{step}`", component)


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
        self.engine.state.update(foundations={"attempt": 0, "changed_files": []})
        self.phases = {phase["id"]: phase for phase in settings.phases()}
        self.engine.prepare_frontend = MagicMock(return_value=AgentResult("frontend-build", "test", "PASS", outputs={"changed_files": []}))
        self.engine.run_planner = MagicMock(return_value=PhaseOutcome("plan", "PASS", [
            AgentResult("planner", "test", "PASS", outputs={"components": self.components, "changed_files": []}),
        ]))
        self.engine.run_foundations = MagicMock(return_value=PhaseOutcome("foundations", "PASS", [
            AgentResult("foundations", "test", "PASS", outputs={"components": self.components, "changed_files": []}),
        ]))
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

    def test_failed_planner_never_starts_components(self):
        self.engine.preflight = MagicMock()
        self.engine.run_planner.return_value.status = "FAIL"
        self.assertEqual(self.engine.run(), "FAIL")
        self.engine.run_foundations.assert_not_called()
        self.engine.run_fanout.assert_not_called()
        self.engine.run_single.assert_not_called()

    def test_validated_foundations_are_not_repeated_in_component_gate(self):
        self.assertEqual(self.run_gate(), "COMPLETE")
        self.engine.run_planner.assert_not_called()
        self.engine.run_foundations.assert_not_called()

    def test_initial_pipeline_orders_plan_foundations_then_components(self):
        self.engine.preflight = MagicMock()
        events = []
        self.engine.run_planner.side_effect = lambda *args, **kwargs: events.append("plan") or self.engine.run_planner.return_value
        self.engine.run_foundations.side_effect = lambda *args, **kwargs: events.append("foundations") or self.engine.run_foundations.return_value
        self.engine.run_fanout.side_effect = lambda *args, **kwargs: events.append("implement") or self.engine.run_fanout.return_value
        self.engine.run()
        self.assertEqual(events, ["plan", "foundations", "implement"])
        self.engine.run_foundations.assert_called_once_with(self.phases["foundations"], components=self.components)

    def test_failed_initial_foundations_never_start_components(self):
        self.engine.preflight = MagicMock()
        self.engine.state.update(foundations={})
        self.engine.run_foundations.return_value.status = "FAIL"
        self.assertEqual(self.engine.run(), "FAIL")
        self.assertFalse(self.engine.state.get("foundations"))
        self.engine.run_fanout.assert_not_called()
        self.engine.run_single.assert_not_called()

    def test_components_cannot_skip_missing_foundations(self):
        self.engine.state.update(foundations={})
        with self.assertRaisesRegex(PipelineError, "No validated shared foundations"):
            self.run_gate()
        self.engine.run_fanout.assert_not_called()

    def test_planner_rejection_persists_failure_and_reports_no_accepted_plan(self):
        self.engine.context = RunContext(self.engine.settings, self.engine.contract, None, self.engine.state,
                                         "test", self.engine.evidence_dir, MagicMock())
        self.engine.state.set_components([])
        agent = PlannerAgent(self.engine.context)
        path = agent.result_path("planner")
        path.parent.mkdir(parents=True)
        path.write_text(json.dumps({"agent": "planner", "run_id": "test", "status": "PASS"}), encoding="utf-8")
        with patch.object(self.engine, "_run_worker", side_effect=WorkspaceError("header: templates are not component-owned")):
            outcome = Orchestrator.run_planner(self.engine, self.phases["plan"])
        self.assertFalse(outcome.passed)
        self.assertEqual(json.loads(path.read_text(encoding="utf-8")), self.engine.state.get("agent_results")["planner"])
        self.assertEqual(self.engine.state.get("agent_results")["planner"]["status"], "FAIL")
        self.engine._finish(self.phases, "FAIL", "FAILED-FINAL")
        text = (self.engine.evidence_dir / "completion-report.md").read_text(encoding="utf-8")
        self.assertIn("failed before a component plan was accepted", text)
        self.assertNotIn("0 unresolved components", text)
        self.assertIn("templates are not component-owned", text)

    def test_planner_source_writes_are_rejected(self):
        self.engine.context = RunContext(self.engine.settings, self.engine.contract, None, self.engine.state,
                                         "test", self.engine.evidence_dir, MagicMock())
        source_path = "ui.frontend/src/main/webpack/site/_tokens.scss"
        def run(agent, **kwargs):
            target = agent.context.repo_root / source_path
            target.parent.mkdir(parents=True)
            target.write_text("worker tokens", encoding="utf-8")
            return AgentResult("planner", "test", "PASS")
        with patch.object(PlannerAgent, "run", run):
            outcome = Orchestrator.run_planner(self.engine, self.phases["plan"])
        self.assertFalse(outcome.passed)
        self.assertIn("Worker changed unowned files", outcome.results[0].failures[0])
        self.assertFalse((self.engine.settings.repo_root / source_path).exists())

    def test_foundations_apply_before_component_snapshot(self):
        self.engine.context = RunContext(self.engine.settings, self.engine.contract, None, self.engine.state,
                                         "test", self.engine.evidence_dir, MagicMock())
        source_path = "ui.frontend/src/main/webpack/site/_tokens.scss"
        def foundations(agent, **kwargs):
            self.assertNotEqual(agent.context.repo_root, self.engine.settings.repo_root)
            target = agent.context.repo_root / source_path
            target.parent.mkdir(parents=True)
            target.write_text("validated tokens", encoding="utf-8")
            return AgentResult("foundations", "test", "PASS", outputs={"components": self.components})
        with patch.object(AGENT_CLASSES["foundations"], "run", foundations):
            outcome = Orchestrator.run_foundations(self.engine, self.phases["foundations"], components=self.components)
        self.assertTrue(outcome.passed)
        self.assertEqual(outcome.results[0].output("changed_files"), [source_path])
        def component(agent, **kwargs):
            self.assertEqual((agent.context.repo_root / source_path).read_text(encoding="utf-8"), "validated tokens")
            return AgentResult("component", "test", "PASS")
        with patch.object(AGENT_CLASSES["component"], "run", component):
            result, _ = self.engine._run_worker(self.phases["implement"], component=self.components[0])
        self.assertTrue(result.passed)

    def test_shared_checkout_escape_reports_exact_file_and_does_not_revert(self):
        self.engine.context = RunContext(self.engine.settings, self.engine.contract, None, self.engine.state,
                                         "test", self.engine.evidence_dir, MagicMock())
        target = self.engine.settings.repo_root / "unexpected.txt"
        def run(agent, **kwargs):
            target.write_text("external edit", encoding="utf-8")
            return AgentResult("foundations", "test", "PASS")
        with patch.object(AGENT_CLASSES["foundations"], "run", run):
            outcome = Orchestrator.run_foundations(self.engine, self.phases["foundations"], components=self.components)
        self.assertFalse(outcome.passed)
        self.assertIn("unexpected.txt", outcome.results[0].failures[0])
        self.assertIn("No worker changes were merged", outcome.results[0].failures[0])
        self.assertEqual(target.read_text(encoding="utf-8"), "external edit")

    def test_apply_conflict_never_advances_checkpoint(self):
        result = AgentResult("component", "test", "PASS", outputs={"component_id": "hero", "changed_files": []})
        self.engine._run_worker = MagicMock(return_value=(result, None))
        with patch("aem_agents.orchestrator.apply_changes", side_effect=WorkspaceError("Intervening edit")), patch.object(self.engine, "_save_checkpoint") as save:
            outcome = self.engine._run_component_batch(self.phases["implement"], self.components)
        self.assertFalse(outcome.passed)
        save.assert_not_called()

    def test_foundation_changes_reach_deployment(self):
        self.engine.state.update(foundations={"attempt": 0, "changed_files": ["ui.frontend/src/main/webpack/site/_variables.scss"]})
        output = "ui.apps/src/main/content/jcr_root/apps/demo-ai-site/clientlibs/clientlib-site/css/site.css"
        self.engine.prepare_frontend.return_value.outputs["changed_files"] = [output]
        self.assertEqual(self.run_gate(), "COMPLETE")
        self.assertIn("ui.frontend/src/main/webpack/site/_variables.scss", self.engine.prepare_frontend.call_args.args[0])
        self.assertIn(output, self.engine.run_single.call_args_list[0].kwargs["changed_files"])
        self.assertNotIn("ui.frontend/src/main/webpack/site/_variables.scss", self.engine.run_single.call_args_list[0].kwargs["changed_files"])

    def test_shared_frontend_failure_never_deploys_or_scores(self):
        self.engine.prepare_frontend.return_value = AgentResult("frontend-build", "test", "FAIL", failures=["Build failed"])
        self.assertEqual(self.run_gate(), "FAIL")
        self.engine.run_single.assert_not_called()
        self.engine.prepare_frontend.assert_called_once()

    def test_shared_frontend_is_after_merge_and_before_deployment(self):
        events = []
        self.engine.run_merge.side_effect = lambda *args, **kwargs: events.append("merge") or PhaseOutcome("merge", "PASS")
        self.engine.prepare_frontend.side_effect = lambda *args, **kwargs: events.append("frontend") or AgentResult("frontend-build", "test", "PASS")
        self.engine.run_single.side_effect = lambda phase, **kwargs: events.append(phase["id"]) or PhaseOutcome(phase["id"], "PASS", [
            AgentResult(phase["agent"], "test", "PASS", outputs={"target_url": "http://test.invalid", "failing_components": []}),
        ])
        self.assertEqual(self.run_gate(), "COMPLETE")
        self.assertEqual(events, ["merge", "frontend", "deploy", "parity"])

    def prepare_frontend_fixture(self):
        self.engine.context = RunContext(self.engine.settings, self.engine.contract, None, self.engine.state,
                                         "test", self.engine.evidence_dir, MagicMock())
        self.frontend_source = "ui.frontend/src/main/webpack/site/main.scss"
        self.frontend_output = "ui.apps/src/main/content/jcr_root/apps/demo-ai-site/clientlibs/clientlib-site/css/site.css"
        source = self.engine.settings.repo_root / self.frontend_source
        source.parent.mkdir(parents=True, exist_ok=True)
        source.write_text("source style", encoding="utf-8")

    def build_frontend_fixture(self, command, directory, log, environment):
        log.write_text("Build log", encoding="utf-8")
        self.assertTrue(directory.is_relative_to(self.engine.evidence_dir))
        self.assertTrue(Path(environment["TMPDIR"]).is_dir())
        if command[-1] == "prod":
            output = directory.parent / self.frontend_output
            output.parent.mkdir(parents=True, exist_ok=True)
            output.write_text((directory.parent / self.frontend_source).read_text(encoding="utf-8"), encoding="utf-8")
        return 0

    def test_shared_frontend_build_is_reused_until_inputs_or_outputs_change(self):
        self.prepare_frontend_fixture()
        with patch("aem_agents.orchestrator.run_command", side_effect=self.build_frontend_fixture) as command:
            for attempt in (1, 2):
                result = Orchestrator.prepare_frontend(self.engine, [self.frontend_source], attempt)
                self.assertTrue(result.passed)
                self.assertIn(self.frontend_output, result.output("changed_files"))
            self.assertEqual(command.call_count, 2)
            (self.engine.settings.repo_root / self.frontend_source).write_text("repaired source", encoding="utf-8")
            self.assertTrue(Orchestrator.prepare_frontend(self.engine, [self.frontend_source], 3).passed)
            self.assertEqual(command.call_count, 4)
            (self.engine.settings.repo_root / self.frontend_output).write_text("other output", encoding="utf-8")
            self.assertTrue(Orchestrator.prepare_frontend(self.engine, [self.frontend_source], 4).passed)
            self.assertEqual(command.call_count, 6)
        self.assertEqual((self.engine.settings.repo_root / self.frontend_output).read_text(encoding="utf-8"), "repaired source")

    def test_shared_frontend_rejects_build_failure_and_unowned_mutations(self):
        self.prepare_frontend_fixture()
        def execute(command, directory, log, environment):
            self.build_frontend_fixture(command, directory, log, environment)
            (directory / "package-lock.json").write_text("unowned lockfile rewrite", encoding="utf-8")
            return 0
        for effect in (lambda *args: 1, execute):
            with self.subTest(effect=effect), patch("aem_agents.orchestrator.run_command", side_effect=effect):
                result = Orchestrator.prepare_frontend(self.engine, [self.frontend_source], 1)
                self.assertFalse(result.passed)
                self.assertFalse((self.engine.settings.repo_root / self.frontend_output).exists())
                self.assertFalse((self.engine.settings.repo_root / "ui.frontend/package-lock.json").exists())

    def test_shared_frontend_skips_unneeded_and_dry_run_work(self):
        with patch("aem_agents.orchestrator.run_command") as command:
            self.assertTrue(Orchestrator.prepare_frontend(self.engine, ["core/Model.java"], 1).passed)
            self.engine.dry_run = True
            self.assertTrue(Orchestrator.prepare_frontend(self.engine, ["ui.frontend/site.scss"], 1).passed)
            command.assert_not_called()

    def test_shared_frontend_receipt_is_protected(self):
        self.prepare_frontend_fixture()
        with patch("aem_agents.orchestrator.run_command", side_effect=self.build_frontend_fixture):
            Orchestrator.prepare_frontend(self.engine, [self.frontend_source], 1)
        receipt = Path(self.engine.state.get("frontend_build")["receipt"])
        receipt.write_text("tampered", encoding="utf-8")
        with self.assertRaisesRegex(PipelineError, "receipt changed"), patch("aem_agents.orchestrator.run_command") as command:
            Orchestrator.prepare_frontend(self.engine, [self.frontend_source], 2)
        command.assert_not_called()

    def test_shared_frontend_rejects_intervening_source_edits(self):
        self.prepare_frontend_fixture()
        source = self.engine.settings.repo_root / self.frontend_source
        def execute(command, directory, log, environment):
            status = self.build_frontend_fixture(command, directory, log, environment)
            source.write_text("user edit during build", encoding="utf-8")
            return status
        with patch("aem_agents.orchestrator.run_command", side_effect=execute):
            result = Orchestrator.prepare_frontend(self.engine, [self.frontend_source], 1)
        self.assertFalse(result.passed)
        self.assertIn("Shared source changed", result.failures[0])
        self.assertEqual(source.read_text(encoding="utf-8"), "user edit during build")
        self.assertFalse((self.engine.settings.repo_root / self.frontend_output).exists())

    def test_component_shared_requests_are_repaired_before_rebuild(self):
        self.engine.max_attempts = 2
        request = {"path": "ui.frontend/src/main/webpack/site/_variables.scss", "name": "--site-spacing", "value": "24px", "evidence": "measurement.json"}
        self.engine.run_fanout.side_effect = [
            PhaseOutcome("implement", "FAIL", [AgentResult("component", "test", "FAIL", outputs={"component_id": "hero", "foundation_requests": [request]})]),
            PhaseOutcome("implement", "PASS", [AgentResult("component", "test", "PASS", outputs={"component_id": "hero"})]),
        ]
        self.engine.run_foundations.return_value.results[0].outputs["changed_files"] = [request["path"]]
        self.assertEqual(self.run_gate(), "COMPLETE")
        self.engine.run_foundations.assert_called_once()
        self.engine.run_planner.assert_not_called()
        self.assertTrue(self.engine.run_foundations.call_args.kwargs["repair"])
        self.assertEqual(self.engine.run_foundations.call_args.kwargs["feedback"]["hero"]["requests"], [request])
        self.assertEqual(self.engine.run_fanout.call_count, 2)
        self.engine.prepare_frontend.assert_called_once()

    def test_shared_repairs_use_foundations_and_keep_prior_changes(self):
        self.engine.max_attempts = 2
        original = "ui.frontend/src/main/webpack/site/_variables.scss"
        repaired = "ui.frontend/src/main/webpack/site/main.scss"
        self.engine.state.update(foundations={"attempt": 0, "changed_files": [original]})
        self.engine.run_foundations.return_value.results[0].outputs["changed_files"] = [repaired]

        def run_single(phase, **kwargs):
            failing = phase["id"] == "parity" and kwargs["attempt"] == 1
            status = "FAIL" if failing else "PASS"
            return PhaseOutcome(phase["id"], status, [AgentResult(phase["agent"], "test", status, outputs={
                "target_url": "http://test.invalid",
                "failing_components": [{"component_id": "hero", "owning_layer": "foundation"}] if failing else [],
            })])

        self.engine.run_single.side_effect = run_single
        self.assertEqual(self.run_gate(), "COMPLETE")
        self.engine.run_foundations.assert_called_once()
        self.engine.run_planner.assert_not_called()
        self.assertEqual(self.engine.run_foundations.call_args.args[0]["id"], "foundations")
        self.assertTrue(self.engine.run_foundations.call_args.kwargs["repair"])
        self.assertEqual(self.engine.run_foundations.call_args.kwargs["attempt"], 2)
        self.assertEqual(self.engine.run_fanout.call_count, 2)
        self.assertEqual(set(self.engine.state.get("foundations")["changed_files"]), {original, repaired})

    def test_failed_shared_repairs_never_restart_components(self):
        self.engine.resume = True
        self.engine.max_attempts = 2
        self.engine.state.append_remediation({"attempt": 1, "status": "FAIL", "failing": [
            {"component_id": "hero", "owning_layer": "foundation"},
        ]})
        self.engine.run_foundations.return_value.status = "FAIL"
        self.assertEqual(self.run_gate(), "FAIL")
        self.engine.run_fanout.assert_not_called()
        self.engine.run_single.assert_not_called()

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
        with patch("aem_agents.orchestrator.create_backend") as backend, patch("aem_agents.orchestrator.resolve_java_home") as java, patch("aem_agents.orchestrator.check_maven") as maven, patch("aem_agents.orchestrator.check_node") as node, patch("aem_agents.orchestrator.PixelScorer") as scorer, patch("aem_agents.orchestrator.probe") as probe, patch("aem_agents.orchestrator.ensure_browser") as browser:
            self.engine.preflight()
            for operation in (backend, java, maven, node, scorer, probe, browser):
                operation.assert_not_called()
        self.assertIsNone(self.engine.context.backend)

    def test_missing_browser_fails_before_starting_copilot(self):
        with patch("aem_agents.orchestrator.check_node", return_value="v22.14.0"), patch("aem_agents.orchestrator.resolve_java_home"), patch("aem_agents.orchestrator.check_maven", return_value=Toolchain(self.engine.evidence_dir / "jdk", "fixture")), patch("aem_agents.orchestrator.ensure_browser", side_effect=EnvelopeError("Browser missing")), patch("aem_agents.orchestrator.create_backend") as backend, self.assertRaises(EnvelopeError):
            self.engine.preflight()
        backend.assert_not_called()

    def test_preflight_passes_bootstrap_policy_to_browser_setup(self):
        for enabled in (True, False):
            self.engine.bootstrap = enabled
            with self.subTest(enabled=enabled), patch("aem_agents.orchestrator.check_node", return_value="v22.14.0"), patch("aem_agents.orchestrator.resolve_java_home"), patch("aem_agents.orchestrator.check_maven", return_value=Toolchain(self.engine.evidence_dir / "jdk", "fixture")), patch("aem_agents.orchestrator.ensure_browser", side_effect=EnvelopeError("fixture stop")) as prepare:
                with self.assertRaises(EnvelopeError):
                    self.engine.preflight()
                prepare.assert_called_once_with(self.engine.settings, bootstrap=enabled)

    def test_missing_system_prerequisite_stops_before_downloads(self):
        with patch("aem_agents.orchestrator.check_node", side_effect=ConfigError("Node.js missing")), patch("aem_agents.orchestrator.ensure_browser") as prepare, patch("aem_agents.orchestrator.create_backend") as backend:
            with self.assertRaisesRegex(ConfigError, "Node.js missing"):
                self.engine.preflight()
        prepare.assert_not_called()
        backend.assert_not_called()

    def test_report_is_owned_by_orchestrator(self):
        self.assertNotIn("reporter", AGENT_CLASSES)
        self.assertNotIn("reporter", self.engine.settings.agents)
        self.assertEqual(self.phases["report"]["handler"], "write_report")
        self.assertNotIn("agent", self.phases["report"])

    def test_orchestrator_reports_without_agent_backend(self):
        self.engine.context = None
        self.assertEqual(self.engine._finish(self.phases, "FAIL", "FAILED-FINAL"), "FAIL")
        report = self.engine.evidence_dir / "completion-report.md"
        self.assertTrue(report.is_file())
        self.assertIn("hero", report.read_text(encoding="utf-8"))
        self.assertEqual(self.engine.state.get("agent_results")["report"]["outputs"]["residual_gaps"][0]["component_id"], "hero")
        self.engine.run_single.assert_not_called()

    def test_report_withholds_invalid_screenshot_scores(self):
        for validation, with_receipt in (("FAIL", False), ("PASS", False), ("PASS", True)):
            with self.subTest(validation=validation, with_receipt=with_receipt):
                outputs = {
                    "scores": [{"component_id": "hero", "instance_id": "hero-1", "breakpoint": 375,
                                "mode": "disabled", "screenshot_validation": validation, "ratio": .987654321}],
                }
                if with_receipt:
                    receipt = self.engine.evidence_dir / "incomplete-receipt.json"
                    receipt.write_text(json.dumps({"run_id": "test", "measurements": outputs["scores"]}), encoding="utf-8")
                    outputs["verification"] = {"path": str(receipt), "sha256": digest(receipt)}
                self.engine.state.record_agent_result("parity-attempt-1", AgentResult("parity", "test", "FAIL", outputs=outputs).to_dict())
                self.engine._finish(self.phases, "FAIL", "FAILED-FINAL")
                text = (self.engine.evidence_dir / "completion-report.md").read_text(encoding="utf-8")
                self.assertIn("SCORE WITHHELD", text)
                self.assertNotIn("987654321", text)

    def test_report_uses_verified_measurements_and_rejects_changed_receipt(self):
        score = {"component_id": "hero", "instance_id": "hero-1", "breakpoint": 375,
                 "mode": "disabled", "screenshot_validation": "PASS", "ratio": .8,
                 "matched_pixels": 80, "total_pixels": 100}
        receipt = self.engine.evidence_dir / "receipt.json"
        receipt.write_text(json.dumps({"run_id": "test", "measurements": [score]}), encoding="utf-8")
        self.engine.state.record_agent_result("parity-attempt-1", AgentResult("parity", "test", "FAIL", outputs={
            "scores": [score], "verification": {"path": str(receipt), "sha256": digest(receipt)},
        }).to_dict())
        self.engine._finish(self.phases, "FAIL", "FAILED-FINAL")
        text = (self.engine.evidence_dir / "completion-report.md").read_text(encoding="utf-8")
        self.assertIn("| 80 | 20 | 100 |", text)
        receipt.write_text("{}", encoding="utf-8")
        self.engine._finish(self.phases, "FAIL", "FAILED-FINAL")
        text = (self.engine.evidence_dir / "completion-report.md").read_text(encoding="utf-8")
        self.assertIn("SCORE WITHHELD", text)
        self.assertNotIn("| 80 | 20 | 100 |", text)

    def test_report_does_not_reuse_scores_from_an_older_parity_attempt(self):
        self.engine.state.record_agent_result("parity-attempt-1", AgentResult("parity", "test", "PASS", outputs={
            "scores": [{"component_id": "hero", "instance_id": "old-capture", "ratio": 1, "screenshot_validation": "PASS"}],
        }).to_dict())
        self.engine.state.record_agent_result("parity-attempt-2", AgentResult("parity", "test", "FAIL", failures=["Capture failed"]).to_dict())
        self.engine._finish(self.phases, "FAIL", "FAILED-FINAL")
        text = (self.engine.evidence_dir / "completion-report.md").read_text(encoding="utf-8")
        self.assertIn("Latest persisted parity result: parity-attempt-2", text)
        self.assertNotIn("old-capture", text)

    def test_report_cannot_complete_without_passing_upstream_envelopes(self):
        for phase in self.phases:
            self.engine.state.set_phase(phase, "PASS")
        self.engine.state.update_component("hero", status="PASS")
        self.assertEqual(self.engine._finish(self.phases, "COMPLETE", "FAILED-FINAL"), "FAIL")
        report = self.engine.state.get("agent_results")["report"]["outputs"]
        self.assertEqual(report["pipeline_status"], "FAIL")
        self.assertNotIn("PASSED", report["status_line"])

    def test_report_preserves_blocked_status(self):
        self.engine.state.update(error="AEM author unavailable")
        self.assertEqual(self.engine._finish(self.phases, "BLOCKED", "FAILED-FINAL"), "BLOCKED")
        text = (self.engine.evidence_dir / "completion-report.md").read_text(encoding="utf-8")
        self.assertIn("VISUAL PARITY GATE: BLOCKED", text)
        self.assertIn("AEM author unavailable", text)

    def test_dry_run_writes_report_without_claiming_completion(self):
        self.engine.dry_run = True
        self.assertEqual(self.engine._finish(self.phases, "DRY_RUN", "FAILED-FINAL"), "DRY_RUN")
        report = self.engine.state.get("agent_results")["report"]
        self.assertEqual(report["outputs"]["pipeline_status"], "DRY_RUN")
        self.assertIn("NOT RUN", report["outputs"]["status_line"])
        self.engine.run_single.assert_not_called()

    def test_merged_paths_reach_deployer(self):
        self.assertEqual(self.run_gate(), "COMPLETE")
        deployment = self.engine.run_single.call_args_list[0]
        self.assertIn("ui.content/page/.content.xml", deployment.kwargs["changed_files"])

    def test_real_merge_handler_returns_its_changes(self):
        report = MergeReport(merged_files=["ui.content/page/.content.xml"])
        with patch("aem_agents.orchestrator.merge_contributions", return_value=report):
            outcome = Orchestrator.run_merge(self.engine, self.phases["merge"], self.components)
        self.assertEqual(outcome.results[0].output("changed_files"), report.merged_files)

    def test_report_write_failure_downgrades_complete(self):
        for phase in self.phases:
            self.engine.state.set_phase(phase, "PASS")
        self.engine.state.update_component("hero", status="PASS")
        with patch.object(self.engine, "run_report", side_effect=OSError("Disk full")):
            self.assertEqual(self.engine._finish(self.phases, "COMPLETE", "FAILED-FINAL"), "FAIL")
        self.assertEqual(next(phase for phase in self.engine.state.get("phases") if phase["id"] == "report")["status"], "FAIL")

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

    def test_resume_revalidates_latest_foundations_repair(self):
        self.engine.resume = True
        self.engine.state.update(foundations={"attempt": 1, "changed_files": []})
        self.engine._cached_result = MagicMock(return_value=AgentResult("foundations", "test", "PASS", outputs={"changed_files": []}))
        self.assertEqual(self.run_gate(), "COMPLETE")
        self.engine._cached_result.assert_called_once_with(self.phases["foundations"], components=self.components, repair=True, attempt=1)
        self.engine.run_planner.assert_not_called()

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

    def test_shared_build_command_logs_and_cleans_up_on_cancellation(self):
        process = MagicMock()
        process.wait.side_effect = KeyboardInterrupt()
        log = self.workspace / "build.log"
        with patch("aem_agents.runner.shutil.which", return_value="npm.cmd"), patch("aem_agents.runner.subprocess.Popen", return_value=process) as start, patch.object(CopilotBackend, "_stop_process") as stop:
            with self.assertRaises(KeyboardInterrupt):
                run_command(["npm", "run", "prod"], self.workspace, log, {"TMPDIR": str(self.workspace / "temp")})
        stop.assert_called_once_with(process)
        self.assertFalse(start.call_args.kwargs["shell"])
        self.assertEqual(start.call_args.kwargs["env"]["TMPDIR"], str(self.workspace / "temp"))
        self.assertTrue(start.call_args.kwargs["stdout"].closed)

    def test_shared_build_command_preserves_nonzero_exit_code(self):
        process = MagicMock()
        process.wait.return_value = 7
        with patch("aem_agents.runner.shutil.which", return_value="npm"), patch("aem_agents.runner.subprocess.Popen", return_value=process), patch.object(CopilotBackend, "_stop_process"):
            self.assertEqual(run_command(["npm", "ci"], self.workspace, self.workspace / "install.log", {}), 7)
        process.wait.assert_called_once_with()

    def test_disabled_timeout_does_not_stop_agent_after_elapsed_time(self):
        for timeout in (None, 0):
            incoming = MagicMock()
            incoming.get.side_effect = [queue.Empty(), None]
            process = MagicMock()
            process.wait.return_value = 0
            on_event = MagicMock()
            with self.subTest(timeout=timeout), patch("aem_agents.runner.queue.Queue", return_value=incoming), patch("aem_agents.runner.threading.Thread"), patch("aem_agents.runner.time.monotonic", side_effect=[0, 100000, 200000]), patch.object(self.backend, "_stop_process") as stop:
                result = self.backend._pump(process, self.workspace / "unlimited.jsonl", self.workspace / "stderr.log", timeout, on_event)
                self.assertTrue(result.ok)
                self.assertFalse(result.timed_out)
                process.wait.assert_called_once_with(timeout=None)
                stop.assert_not_called()
                self.assertTrue(on_event.called)

    def test_explicit_agent_timeout_still_stops_expired_process(self):
        process = MagicMock()
        process.wait.return_value = 1
        with patch("aem_agents.runner.queue.Queue"), patch("aem_agents.runner.threading.Thread"), patch("aem_agents.runner.time.monotonic", side_effect=[0, 0, 2]), patch.object(self.backend, "_stop_process") as stop:
            result = self.backend._pump(process, self.workspace / "expired.jsonl", self.workspace / "stderr.log", 1, None)
        self.assertTrue(result.timed_out)
        self.assertFalse(result.ok)
        stop.assert_called_once_with(process)

    def test_progress_pump_delivers_heartbeats_during_idle_and_tool_output(self):
        event = {"type": "assistant.message", "data": {"toolRequests": [{"name": "read_file"}]}}
        incoming = MagicMock()
        incoming.get.side_effect = [queue.Empty(), json.dumps(event), None]
        process = MagicMock()
        process.wait.return_value = 0
        on_event = MagicMock()
        with patch("aem_agents.runner.queue.Queue", return_value=incoming), patch("aem_agents.runner.threading.Thread"), patch("aem_agents.runner.time.monotonic", side_effect=[0, 0, 1, 2, 3]):
            result = self.backend._pump(process, self.workspace / "stream.jsonl", self.workspace / "stderr.log", 60, on_event)
        self.assertTrue(result.ok)
        self.assertEqual([call.args[0]["type"] for call in on_event.call_args_list], ["aem.heartbeat", "aem.heartbeat", "assistant.message", "aem.heartbeat"])
        self.assertEqual((self.workspace / "stream.jsonl").read_text(encoding="utf-8"), json.dumps(event) + "\n")

    def test_progress_stream_is_readable_before_event_callback(self):
        event = {"type": "tool.execution_start", "data": {"toolCallId": "one", "toolName": "view", "arguments": {"path": "summary.json"}}}
        incoming = MagicMock()
        incoming.get.side_effect = [json.dumps(event), None]
        process = MagicMock()
        process.wait.return_value = 0
        stream = self.workspace / "stream.jsonl"

        def on_event(received):
            if received["type"] == event["type"]:
                self.assertEqual(stream.read_text(encoding="utf-8"), json.dumps(event) + "\n")

        with patch("aem_agents.runner.queue.Queue", return_value=incoming), patch("aem_agents.runner.threading.Thread"), patch("aem_agents.runner.time.monotonic", return_value=0):
            result = self.backend._pump(process, stream, self.workspace / "stderr.log", None, on_event)
        self.assertTrue(result.ok)

    def test_interrupted_or_failed_pump_always_stops_process(self):
        for error in (KeyboardInterrupt(), RuntimeError("callback failed")):
            process = MagicMock()
            process.poll.return_value = None
            process.pid = 123
            with self.subTest(error=type(error).__name__), patch("aem_agents.runner.subprocess.Popen", return_value=process), patch("aem_agents.runner.subprocess.run"), patch("aem_agents.runner.os.killpg", create=True), patch.object(self.backend, "_pump", side_effect=error):
                with self.assertRaises(type(error)):
                    self.backend.run(prompt="test", options={}, workspace=self.workspace, stream_name="stream.jsonl", stderr_name="stderr.log", timeout_seconds=None)
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

    def test_shared_validation_policy_is_rendered_once_for_every_role(self):
        rule = "Shared validation policy fixture: keep outputs separate from source."
        settings = Settings(self.settings.repo_root, self.settings.migration.merged({"validation": {"rules": [rule]}}), self.settings._agents_config)
        self.context.settings = settings
        for role in AGENT_CLASSES:
            agent = AGENT_CLASSES[role](self.context)
            component = {"id": "hero", "source_order": 0}
            with self.subTest(role=role):
                prompt = agent.render_prompt(agent.slug(component=component), component=component)
                self.assertEqual(prompt.count("## Shared Validation Policy"), 1)
                self.assertEqual(prompt.count(rule), 1)
                self.assertIn(str((agent.workspace(agent.slug(component=component)) / "validation").resolve()), prompt)

    def test_validation_outputs_are_isolated_per_agent_and_attempt(self):
        component = {"id": "hero", "source_order": 0}
        cases = [
            ("planner", {}), ("foundations", {}), ("foundations", {"repair": True, "attempt": 2}),
            ("component", {"component": component, "attempt": 1}),
            ("component", {"component": component, "attempt": 2}),
            ("component", {"component": {"id": "card", "source_order": 1}, "attempt": 1}),
            ("deployer", {"attempt": 1}), ("parity", {"attempt": 1}),
        ]
        directories = set()
        for role, kwargs in cases:
            agent = AGENT_CLASSES[role](self.context)
            self.context.backend.run.reset_mock()
            self.context.backend.run.return_value = SimpleNamespace(timed_out=False, ok=True, exit_code=0, duration_seconds=0)
            result = AgentResult(role, "test", "PASS")
            with self.subTest(role=role, kwargs=kwargs), patch("aem_agents.agents.base.read_result", return_value=result), patch.object(agent, "validate_result"), patch("aem_agents.agents.base.emit"):
                Agent.run(agent, **kwargs)
            environment = self.context.backend.run.call_args.kwargs["env_extra"]
            validation = Path(environment["MIGRATION_VALIDATION_DIR"])
            reports = Path(environment["REPORTS_PATH"])
            self.assertEqual(validation, (agent.workspace(agent.slug(**kwargs)) / "validation").resolve())
            self.assertTrue(validation.is_absolute())
            self.assertTrue(validation.is_relative_to(self.evidence.resolve()))
            self.assertTrue(reports.is_dir())
            self.assertEqual(reports, validation / "reports")
            for variable in ("TMP", "TEMP", "TMPDIR"):
                self.assertEqual(Path(environment[variable]), validation / "tmp")
                self.assertTrue(Path(environment[variable]).is_dir())
            self.assertEqual(environment["MIGRATION_BROWSER_MODULE"], agent.env_extra()["MIGRATION_BROWSER_MODULE"])
            self.assertNotIn(validation, directories)
            directories.add(validation)

    def test_validation_workspace_rejects_escape_and_dry_render_writes_nothing(self):
        agent = PlannerAgent(self.context)
        environment = agent.validation_environment("planner")
        self.assertFalse(Path(environment["MIGRATION_VALIDATION_DIR"]).exists())
        with self.assertRaises(ConfigError):
            agent.validation_environment("../../../outside", prepare=True)
        self.assertFalse((self.evidence.parent / "outside/validation").exists())

    def test_shared_validation_policy_rejects_malformed_rules(self):
        for rules in ("do checks", [None], [""]):
            self.context.settings = Settings(self.settings.repo_root, self.settings.migration.merged({"validation": {"rules": rules}}), self.settings._agents_config)
            with self.subTest(rules=rules), self.assertRaises(ConfigError):
                PlannerAgent(self.context).render_prompt("planner")

    def test_worker_prompts_keep_validation_from_changing_dependency_sources(self):
        for role in ("planner", "foundations", "component", "deployer"):
            agent = AGENT_CLASSES[role](self.context)
            prompt = agent.render_prompt(agent.slug(component={"id": "hero"}), component={"id": "hero"})
            with self.subTest(role=role):
                self.assertIn("MIGRATION_VALIDATION_DIR", prompt)
                self.assertIn("REPORTS_PATH", prompt)
                self.assertIn("--noEmit", prompt)
                self.assertIn("npm ci", prompt)
                self.assertIn("lockfile", prompt)
                self.assertIn("clientlib", prompt)

    def test_all_agent_timeouts_are_disabled_by_default(self):
        for role in AGENT_CLASSES:
            with self.subTest(role=role):
                self.assertIsNone(self.settings.agent(role).timeout_seconds)

    def test_agent_timeout_accepts_disabled_or_positive_limits(self):
        for value, expected in ((None, None), (0, None), (90, 90)):
            with self.subTest(value=value):
                self.assertEqual(AgentSpec("planner", {"timeout_seconds": value}, {}).timeout_seconds, expected)
        for value in (-1, True, "unlimited", 1.5):
            with self.subTest(value=value), self.assertRaises(ConfigError):
                AgentSpec("planner", {"timeout_seconds": value}, {}).timeout_seconds

    def test_global_budget_and_session_names_reach_cli(self):
        agent = PlannerAgent(self.context)
        options = agent.backend_options("planner")
        self.assertEqual(options["max_continues"], self.settings.migration.get("model.max_continues"))
        backend = object.__new__(CopilotBackend)
        backend.config = self.settings.migration.section("backend.copilot")
        args = backend.build_args("test", options)
        self.assertEqual(args[args.index("--name") + 1], "test-planner")
        self.assertNotIn("{session_name}", args)

    def test_launcher_enables_setup_unless_explicitly_disabled(self):
        for arguments, enabled in (([], True), (["--no-bootstrap"], False)):
            with self.subTest(arguments=arguments), patch("aem_agents.cli.Orchestrator") as factory, patch("aem_agents.cli.RunLock"), patch("aem_agents.cli.get_logger"), patch("aem_agents.cli.emit"):
                factory.return_value.run.return_value = "COMPLETE"
                factory.return_value.evidence_dir = self.evidence
                self.assertEqual(cli_main(arguments), 0)
                self.assertEqual(factory.call_args.kwargs["bootstrap"], enabled)

    def test_show_plan_does_not_construct_runtime_or_install_dependencies(self):
        with patch("aem_agents.cli.Orchestrator") as factory, patch("aem_agents.cli.emit"):
            self.assertEqual(cli_main(["--show-plan"]), 0)
        factory.assert_not_called()

    def test_browser_roles_use_verified_shared_module(self):
        self.context.browser = browser_paths(self.settings)
        for role in ("planner", "parity"):
            agent = AGENT_CLASSES[role](self.context)
            with self.subTest(role=role):
                prompt = agent.render_prompt(agent.slug())
                if role == "planner":
                    self.assertIn("Do not generate or run discovery scripts", prompt)
                else:
                    self.assertIn("await import(process.env.MIGRATION_BROWSER_MODULE)", prompt)
                self.assertIn(self.context.browser.module_path.as_uri(), prompt)
                self.assertNotIn("Install its dependencies", prompt)
                self.assertNotIn("Install any Node.js browser tooling", prompt)
                self.assertEqual(agent.env_extra()["MIGRATION_BROWSER_MODULE"], self.context.browser.module_path.as_uri())

    def test_planner_failure_during_collection_never_starts_llm(self):
        with patch("aem_agents.agents.planner.collect_discovery", side_effect=EnvelopeError("Incomplete source readiness")):
            with self.assertRaisesRegex(EnvelopeError, "Incomplete source"):
                PlannerAgent(self.context).run()
        self.context.backend.run.assert_not_called()

    def test_planner_dry_run_never_collects_source(self):
        self.context.dry_run = True
        with patch("aem_agents.agents.planner.collect_discovery") as collector, patch("aem_agents.agents.base.emit"):
            self.assertTrue(PlannerAgent(self.context).run().passed)
        collector.assert_not_called()
        self.context.backend.run.assert_not_called()

    def test_foundations_never_recollect_source(self):
        result = AgentResult("foundations", "test", "FAIL")
        with patch("aem_agents.agents.planner.collect_discovery") as collector, patch.object(Agent, "run", return_value=result):
            for repair in (False, True):
                self.assertIs(AGENT_CLASSES["foundations"](self.context).run(repair=repair, attempt=2), result)
        collector.assert_not_called()

    def test_foundation_repairs_preserve_plan_and_require_token_evidence(self):
        artifact = self.evidence / "frozen.json"
        artifact.write_text("{}", encoding="utf-8")
        components = [{"id": "hero"}]
        discovery = {name: str(artifact) for name in ("discovery_manifest", "discovery_summary", "discovery_inventory")}
        self.state.record_agent_result("planner", {"outputs": {**discovery, "components": components}})
        agent = AGENT_CLASSES["foundations"](self.context)
        self.assertEqual(agent.prompt_values(repair=True)["plan_result_path"], str(agent.result_path("planner")))
        for changed_plan, missing_token in ((False, False), (True, False), (False, True)):
            result = AgentResult("foundations", "test", "PASS", outputs={
                "components": [{"id": "other"}] if changed_plan else components,
                "token_manifest": str(self.evidence / "missing.json") if missing_token else str(artifact),
            })
            with self.subTest(changed_plan=changed_plan, missing_token=missing_token), patch.object(PlannerAgent, "validate_plan") as replan:
                if changed_plan or missing_token:
                    with self.assertRaises(EnvelopeError):
                        agent.validate_result(result, repair=True, components=components)
                else:
                    agent.validate_result(result, repair=True, components=components)
                replan.assert_not_called()

    def test_isolated_planner_uses_shared_inventory_cache(self):
        engine = Orchestrator(self.settings, self.context.contract, run_id="test", dry_run=True,
                              evidence_dir=self.evidence / "run", logger=MagicMock())
        engine.dry_run = False
        engine.context = self.context
        worker = MagicMock()
        worker.root = self.evidence / "checkout"
        agent = PlannerAgent(self.context)
        with patch.object(engine, "_agent", return_value=agent), patch("aem_agents.orchestrator.WorkerWorkspace.create", return_value=worker), patch.object(agent, "run", return_value=AgentResult("planner", "test", "PASS")):
            engine._run_worker({"id": "plan", "agent": "planner"})
        expected = self.settings.resolve(self.settings.migration.get("discovery.inventory_cache_dir"))
        self.assertEqual(agent.context.settings.repo_root, worker.root)
        self.assertEqual(agent.context.settings.migration.get("discovery.inventory_cache_dir"), str(expected))

    def test_isolated_worker_keeps_original_browser_paths(self):
        self.context.browser = browser_paths(self.settings)
        original_environment = self.context.browser.environment()
        isolated = Settings(self.evidence / "checkout", self.settings.migration, self.settings._agents_config)
        self.context.settings = isolated
        environment = PlannerAgent(self.context).env_extra()
        for key, value in original_environment.items():
            self.assertEqual(environment[key], value)

    def test_resolved_target_reaches_parity_and_state(self):
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
        command = self.settings.migration.get("deploy.frontend.build")
        self.assertIn(command[-1], package["scripts"])
        self.assertEqual(self.settings.migration.get("deploy.frontend.install"), ["npm", "ci"])
        self.assertFalse(any(row["id"] == "ui-frontend" for row in self.settings.migration.get("deploy.scoped")))

    def test_deployer_rejects_source_changes_after_shared_frontend_build(self):
        self.context.settings = Settings(self.evidence, self.settings.migration, self.settings._agents_config)
        self.context.state.update(frontend_build={"status": "PASS", "inputs": {}, "outputs": {}})
        changed = self.evidence / "ui.frontend/main.scss"
        changed.parent.mkdir()
        changed.write_text("modified during deployment", encoding="utf-8")
        current = {"ui.frontend/main.scss": digest(changed)}
        with patch("aem_agents.agents.deployer.source_manifest", return_value=current), self.assertRaisesRegex(EnvelopeError, "changed after the serialized build"):
            DeployerAgent(self.context).validate_result(AgentResult("deployer", "test", "PASS"))

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
            xf_target = "/content/experience-fragments/demo-ai-site/us/en/site/header/master"
            xf_file = settings.migration.get("shared_files.authored_page.file").format(page_path=xf_target)
            components[0].update(delivery="experience-fragment", reuse_target=xf_target, owned_paths=[xf_file])
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
                        test_case.assertNotEqual(kwargs["working_directory"], root)
                        outputs = {"components": components, "coverage_report": str(check_log),
                                   "source_selector_map": str(check_log), "design_tokens": str(check_log)}
                    elif role == "foundations":
                        changed = settings.migration.get("css.token_layer.scss_source")
                        code = kwargs["working_directory"] / changed
                        test_case.assertNotEqual(kwargs["working_directory"], root)
                        test_case.assertFalse((root / changed).exists())
                        code.parent.mkdir(parents=True, exist_ok=True)
                        code.write_text(":root { --site-color-text: #111; }", encoding="utf-8")
                        outputs = {"components": [row["plan"] for row in engine.state.component_rows()],
                                   "changed_files": [changed], "token_manifest": str(check_log)}
                    elif role == "component":
                        test_case.assertTrue((kwargs["working_directory"] / settings.migration.get("css.token_layer.scss_source")).is_file())
                        test_case.assertIn(str((evidence / "agents/foundations/checks.log").resolve()), kwargs["prompt"])
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
                        if component_id == "hero":
                            test_case.assertIn('"contribution_targets"', kwargs["prompt"])
                            test_case.assertIn(xf_target, kwargs["prompt"])
                            page = {name: contribution.pop(name) for name in ("page_path", "parent_path", "template_path", "page_properties", "nodes")}
                            contribution["pages"] = [page, {**page, "page_path": xf_target}]
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
                    payload = {
                        "agent": role, "run_id": "integration", "status": status, "outputs": outputs,
                        "checks": [{"name": name, "status": "PASS", "evidence": str(check_log)} for name in settings.agent(role).get("required_checks")],
                        "failures": [],
                    }
                    (workspace / "result.json").write_text(json.dumps(payload), encoding="utf-8")
                    return SimpleNamespace(timed_out=False, ok=True, exit_code=0, duration_seconds=.01)

            backend = FixtureBackend()
            def frontend_command(command, directory, log, environment):
                log.write_text("Offline frontend build", encoding="utf-8")
                if command[-1] == "prod":
                    output = directory.parent / "ui.apps/src/main/content/jcr_root/apps/demo-ai-site/clientlibs/clientlib-site/css/site.css"
                    output.parent.mkdir(parents=True, exist_ok=True)
                    output.write_text(":root { --site-color-text: #111; }", encoding="utf-8")
                return 0

            build_patch = patch("aem_agents.orchestrator.run_command", side_effect=frontend_command)
            build_mock = build_patch.start()
            self.addCleanup(build_patch.stop)
            engine = Orchestrator(settings, contract, run_id="integration", skip_probe=True, evidence_dir=evidence, logger=MagicMock())
            fixture_manifest = evidence / "collector.json"
            fixture_manifest.write_text("Offline collector fixture", encoding="utf-8")
            prepared = DiscoveryEvidence(fixture_manifest, fixture_manifest, fixture_manifest, (fixture_manifest,), .1, False)
            with patch("aem_agents.orchestrator.create_backend", return_value=backend), patch("aem_agents.orchestrator.check_node", return_value="v22.14.0"), patch("aem_agents.orchestrator.resolve_java_home", return_value=Toolchain(root / "jdk", "fixture")), patch("aem_agents.orchestrator.check_maven", side_effect=lambda tools: tools), patch("aem_agents.orchestrator.ensure_browser", return_value=browser_paths(original)), patch("aem_agents.agents.planner.collect_discovery", return_value=prepared) as collect, patch("aem_agents.agents.planner.validate_collection", return_value=({}, (fixture_manifest,))), patch("aem_agents.orchestrator.emit"), patch("aem_agents.agents.base.emit"):
                with self.assertRaises(KeyboardInterrupt):
                    engine.run()
                self.assertEqual(engine.state.get("status"), "INTERRUPTED")
                self.assertEqual(sum(row["status"] == "PASS" for row in engine.state.component_rows()), 2)
                self.assertEqual(calls, ["planner", "foundations", "component", "component", "deployer", "parity"])
                calls.clear()
                engine = Orchestrator(settings, contract, resume=True, skip_probe=True, evidence_dir=evidence, logger=MagicMock())
                self.assertEqual(engine.run(), "COMPLETE")
                collect.assert_called_once()
                self.assertEqual(build_mock.call_count, 2)
            self.assertEqual(calls, ["deployer", "parity"])
            self.assertEqual(engine.state.get("status"), "COMPLETE")
            accepted = next(row["plan"] for row in engine.state.component_rows() if row["id"] == "hero")
            self.assertEqual(accepted["owned_paths"], [])
            self.assertEqual(accepted["contribution_targets"], [xf_target])
            self.assertTrue(settings.resolve(xf_file).is_file())
            self.assertTrue((evidence / "completion-report.md").is_file())
            report = engine.state.get("agent_results")["report"]["outputs"]
            self.assertEqual(report["pipeline_status"], "COMPLETE")
            self.assertEqual(report["residual_gaps"], [])
            self.assertIn("VISUAL PARITY GATE: PASSED", (evidence / "completion-report.md").read_text(encoding="utf-8"))
            self.assertTrue((evidence / "report-result.json").is_file())


if __name__ == "__main__":
    unittest.main()