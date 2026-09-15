from __future__ import annotations

import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
from types import SimpleNamespace
import unittest
from PIL import Image
from unittest.mock import patch
from urllib.error import URLError
from xml.etree import ElementTree

SCRIPTS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS))

from aem_agents.config import Settings
from aem_agents.browser import browser_paths, check_browser, ensure_browser
from aem_agents.assets import AemClient, AssetError, _declared_assets, fetch_assets
from aem_agents.merge import latest_contribution_path, read_contributions, merge_contributions, MergeError
from aem_agents.state import RunLock, RunState, StateError
from aem_agents.workspaces import WorkerWorkspace, WorkspaceError, apply_changes, validate_ownership
from aem_agents.scoring import PixelScorer
from aem_agents.envelope import EnvelopeError
from aem_agents.checkpoints import capture_checkpoint, validate_checkpoint
from aem_agents.config import ConfigError
from aem_agents.contract import load_contract
from aem_agents import bootstrap
from aem_agents.toolchain import Toolchain, ToolchainError, check_maven, check_node, resolve_java_home
from aem_agents.discovery import collect_discovery, repository_inventory, validate_collection


class PythonBootstrapTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name).resolve()
        self.script = self.root / "run_migration.py"
        self.script.write_text("", encoding="utf-8")
        self.requirements = self.root / "requirements.txt"
        self.requirements.write_text("PyYAML==6.0.3\nPillow==12.3.0\n", encoding="utf-8")
        self.target = self.root / ".venv"
        self.python = bootstrap.venv_python(self.target)
        self.python.parent.mkdir(parents=True)
        self.python.write_text("fixture", encoding="utf-8")
        environment = patch.dict(os.environ, {bootstrap.SKIP_ENV: "", bootstrap.MARKER_ENV: "", bootstrap.VENV_ENV: str(self.target)})
        environment.start()
        self.addCleanup(environment.stop)

    def test_global_dependencies_do_not_bypass_managed_environment(self):
        with patch.object(bootstrap, "_dependency_issues", return_value=[]), patch.object(bootstrap, "_install") as install, patch("aem_agents.bootstrap.subprocess.run", return_value=subprocess.CompletedProcess([], 0)) as execute:
            with self.assertRaises(SystemExit) as exited:
                bootstrap.ensure_environment(self.script, ["--show-plan"])
        self.assertEqual(exited.exception.code, 0)
        self.assertEqual(execute.call_args.args[0], [str(self.python), "-I", str(self.script), "--show-plan"])
        install.assert_not_called()

    def test_warm_managed_environment_never_installs(self):
        (self.target / bootstrap._STAMP_NAME).write_text(bootstrap._stamp_value(self.requirements), encoding="utf-8")
        with patch("aem_agents.bootstrap.sys.prefix", str(self.target)), patch("aem_agents.bootstrap.sys.flags", SimpleNamespace(isolated=1)), patch.object(bootstrap, "_dependency_issues", return_value=[]), patch.object(bootstrap, "_install") as install, patch("aem_agents.bootstrap.subprocess.run") as execute:
            bootstrap.ensure_environment(self.script, [])
        install.assert_not_called()
        execute.assert_not_called()

    def test_wrong_version_repairs_then_restarts_before_stamping(self):
        with patch("aem_agents.bootstrap.sys.prefix", str(self.target)), patch.object(bootstrap, "_dependency_issues", return_value=["Pillow mismatch"]), patch.object(bootstrap, "_install") as install, patch("aem_agents.bootstrap.subprocess.run", return_value=subprocess.CompletedProcess([], 0)) as execute:
            with self.assertRaises(SystemExit):
                bootstrap.ensure_environment(self.script, [])
        install.assert_called_once_with(self.python, self.requirements)
        self.assertEqual(execute.call_args.kwargs["env"][bootstrap.MARKER_ENV], "1")
        self.assertFalse((self.target / bootstrap._STAMP_NAME).exists())

    def test_restarted_environment_is_validated_before_stamp(self):
        with patch("aem_agents.bootstrap.sys.prefix", str(self.target)), patch("aem_agents.bootstrap.sys.flags", SimpleNamespace(isolated=1)), patch.dict(os.environ, {bootstrap.MARKER_ENV: "1"}), patch.object(bootstrap, "_dependency_issues", return_value=[]):
            bootstrap.ensure_environment(self.script, [])
        self.assertEqual((self.target / bootstrap._STAMP_NAME).read_text().strip(), bootstrap._stamp_value(self.requirements))

    def test_activated_venv_restarts_isolated_without_reinstalling(self):
        (self.target / bootstrap._STAMP_NAME).write_text(bootstrap._stamp_value(self.requirements), encoding="utf-8")
        with patch("aem_agents.bootstrap.sys.prefix", str(self.target)), patch.object(bootstrap, "_dependency_issues", return_value=[]), patch.object(bootstrap, "_install") as install, patch("aem_agents.bootstrap.subprocess.run", return_value=subprocess.CompletedProcess([], 0)) as execute:
            with self.assertRaises(SystemExit):
                bootstrap.ensure_environment(self.script, [])
        install.assert_not_called()
        self.assertIn("-I", execute.call_args.args[0])

    def test_opt_out_validates_pins_without_installing(self):
        with patch.object(bootstrap, "_dependency_issues", return_value=["Pillow==12.3.0 (found 11.3.0)"]), patch.object(bootstrap, "_install") as install:
            with self.assertRaisesRegex(bootstrap.BootstrapError, "dependency mismatch"):
                bootstrap.ensure_environment(self.script, ["--no-bootstrap"])
        install.assert_not_called()

    def test_python_environment_does_not_leak_into_child(self):
        with patch.dict(os.environ, {"PYTHONPATH": "wrong", "PYTHONHOME": "wrong", "PYTHONUSERBASE": "wrong"}):
            environment = bootstrap._isolated_environment()
        self.assertEqual(environment["PYTHONNOUSERSITE"], "1")
        for variable in ("PYTHONPATH", "PYTHONHOME", "PYTHONUSERBASE"):
            self.assertNotIn(variable, environment)

    def test_runtime_requirements_use_exact_pins(self):
        with patch.object(bootstrap, "_missing_modules", return_value=[]), patch("aem_agents.bootstrap.importlib.metadata.version", side_effect=["6.0.3", "12.3.0"]):
            self.assertEqual(bootstrap._dependency_issues(self.requirements), [])
        self.requirements.write_text("Pillow>=11\n", encoding="utf-8")
        with patch.object(bootstrap, "_missing_modules", return_value=[]), self.assertRaisesRegex(bootstrap.BootstrapError, "exact"):
            bootstrap._dependency_issues(self.requirements)


class PortableToolchainTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name).resolve()
        self.settings = Settings.load(SCRIPTS.parents[2], SCRIPTS / "config")
        self.settings.repo_root = self.root
        self.settings.migration = self.settings.migration.merged({"toolchain": {"java_home_candidates": [str(self.root / "jdks/*")]}})
        version = self.root / ".cloudmanager/java-version"
        version.parent.mkdir()
        version.write_text("21", encoding="utf-8")

    def jdk(self, name, version):
        home = self.root / "jdks" / name
        (home / "bin").mkdir(parents=True)
        suffix = ".exe" if os.name == "nt" else ""
        for executable in ("java", "javac"):
            (home / "bin" / (executable + suffix)).write_text("fixture", encoding="utf-8")
        (home / "release").write_text(f'JAVA_VERSION="{version}.0.1"', encoding="utf-8")
        return home

    def test_uses_java_home_regardless_of_cloud_manager_version(self):
        for version in (11, 21, 26):
            expected = self.jdk(f"jdk-{version}", version)
            with self.subTest(version=version), patch.dict(os.environ, {"JAVA_HOME": str(expected)}), patch("aem_agents.toolchain.shutil.which") as search:
                resolved = resolve_java_home(self.settings)
                self.assertEqual(resolved.java_home, expected)
                self.assertEqual(resolved.source, "$JAVA_HOME")
                search.assert_not_called()

    def test_invalid_java_home_uses_path_before_other_installed_jdks(self):
        expected = self.jdk("jdk-11", 11)
        self.jdk("jdk-26", 26)
        compiler = expected / "bin" / ("javac.exe" if os.name == "nt" else "javac")
        for home in ("", str(self.root / "missing-jdk-21")):
            with self.subTest(home=home), patch.dict(os.environ, {"JAVA_HOME": home}), patch("aem_agents.toolchain.shutil.which", return_value=str(compiler)):
                resolved = resolve_java_home(self.settings)
                self.assertEqual(resolved.java_home, expected)
                self.assertEqual(resolved.source, "PATH")

    def test_installed_jdk_fallback_is_used_only_without_environment_jdk(self):
        expected = self.jdk("jdk-26", 26)
        with patch.dict(os.environ, {"JAVA_HOME": ""}), patch("aem_agents.toolchain.shutil.which", return_value=None):
            self.assertEqual(resolve_java_home(self.settings).java_home, expected)

    def test_selection_does_not_require_release_or_cloud_manager_metadata(self):
        expected = self.jdk("jdk-11", 11)
        (expected / "release").unlink()
        (self.root / ".cloudmanager/java-version").unlink()
        with patch.dict(os.environ, {"JAVA_HOME": str(expected)}):
            self.assertEqual(resolve_java_home(self.settings).java_home, expected)

    def test_relative_configured_java_home_is_workspace_relative(self):
        expected = self.jdk("jdk-26", 26)
        self.settings.migration = self.settings.migration.merged({"toolchain": {"java_home": "jdks/jdk-26"}})
        self.assertEqual(resolve_java_home(self.settings).java_home, expected)

    def test_jre_only_install_is_rejected(self):
        home = self.jdk("jdk-11", 11)
        (home / "bin" / ("javac.exe" if os.name == "nt" else "javac")).unlink()
        self.settings.migration = self.settings.migration.merged({"toolchain": {"java_home": str(home)}})
        with self.assertRaisesRegex(ToolchainError, "both java and javac"):
            resolve_java_home(self.settings)

    def test_missing_jdk_reports_environment_configuration_not_version(self):
        with patch.dict(os.environ, {"JAVA_HOME": str(self.root / "missing")}), patch("aem_agents.toolchain.shutil.which", return_value=None):
            with self.assertRaisesRegex(ToolchainError, "Set JAVA_HOME to an existing JDK"):
                resolve_java_home(self.settings)

    def test_maven_is_checked_via_java_without_shell_shims(self):
        jdk = Toolchain(self.jdk("jdk-21", 21), "fixture")
        maven = self.root / "maven"
        (maven / "bin").mkdir(parents=True)
        (maven / "boot").mkdir()
        (maven / "bin/m2.conf").write_text("fixture", encoding="utf-8")
        (maven / "boot/plexus-classworlds-2.8.0.jar").write_text("fixture", encoding="utf-8")
        executable = maven / "bin" / ("mvn.cmd" if os.name == "nt" else "mvn")
        executable.write_text("fixture", encoding="utf-8")
        with patch("aem_agents.toolchain.shutil.which", return_value=str(executable)), patch("aem_agents.toolchain.subprocess.run", return_value=subprocess.CompletedProcess([], 0, "Apache Maven 3.9.9", "")) as execute:
            tools = check_maven(jdk)
        self.assertEqual(tools.maven_version, "3.9.9")
        self.assertFalse(execute.call_args.kwargs["shell"])
        self.assertEqual(execute.call_args.kwargs["env"]["JAVA_HOME"], str(jdk.java_home))

    def test_missing_maven_fails_with_actionable_message(self):
        with patch("aem_agents.toolchain.shutil.which", return_value=None), self.assertRaisesRegex(ToolchainError, "Apache Maven is required"):
            check_maven(Toolchain(self.root, "fixture"))

    def test_unsupported_node_fails_before_package_installation(self):
        for version, accepted in (("v18.20.0", False), ("v22.14.0", True), ("unknown", False)):
            with self.subTest(version=version), patch("aem_agents.toolchain.shutil.which", return_value="node"), patch("aem_agents.toolchain.subprocess.run", return_value=subprocess.CompletedProcess([], 0, version, "")):
                if accepted:
                    self.assertEqual(check_node(), version)
                else:
                    with self.assertRaisesRegex(ToolchainError, "Node.js 20"):
                        check_node()


class DiscoveryCollectorTests(unittest.TestCase):
    def test_optional_discovery_timeout_reaches_collector_and_cancellation(self):
        for limit, expected in ((None, None), (0, None), (3, 36)):
            with self.subTest(limit=limit), tempfile.TemporaryDirectory() as directory:
                settings = Settings.load(SCRIPTS.parents[2], SCRIPTS / "config")
                browser = browser_paths(settings)
                settings.repo_root = Path(directory)
                settings.migration = settings.migration.merged({"discovery": {"page_timeout_seconds": limit}})
                context = SimpleNamespace(settings=settings, contract=SimpleNamespace(site_url="https://example.invalid/", breakpoints=[375, 768, 1440]),
                                          browser=browser, evidence_dir=Path(directory) / "evidence", run_id="fixture")
                with patch("aem_agents.discovery.repository_inventory", return_value=True), patch("aem_agents.discovery.subprocess.Popen") as start, patch("aem_agents.discovery._stop_collector") as stop:
                    start.return_value.wait.side_effect = KeyboardInterrupt()
                    with self.assertRaises(KeyboardInterrupt):
                        collect_discovery(context)
                    start.return_value.wait.assert_called_once_with(timeout=expected)
                    stop.assert_called_once_with(start.return_value)
                config_path = next(context.evidence_dir.glob("discovery/*/input.json"))
                config = json.loads(config_path.read_text(encoding="utf-8"))
                self.assertEqual(config["page_timeout_ms"], limit * 1000 if limit else None)
                self.assertEqual(config["readiness_timeout_ms"], 15000)

    def test_disabled_discovery_timeout_preserves_process_errors(self):
        with tempfile.TemporaryDirectory() as directory:
            settings = Settings.load(SCRIPTS.parents[2], SCRIPTS / "config")
            browser = browser_paths(settings)
            self.assertIsNone(settings.migration.get("discovery.page_timeout_seconds"))
            settings.repo_root = Path(directory)
            context = SimpleNamespace(settings=settings, contract=SimpleNamespace(site_url="https://example.invalid/", breakpoints=[375]),
                                      browser=browser, evidence_dir=Path(directory) / "evidence", run_id="fixture")
            with patch("aem_agents.discovery.repository_inventory", return_value=True), patch("aem_agents.discovery.subprocess.Popen", side_effect=OSError("fixture process failed")):
                with self.assertRaisesRegex(EnvelopeError, "Source collector failed: fixture process failed"):
                    collect_discovery(context)

    def test_node_discovery_optional_timeout(self):
        with tempfile.TemporaryDirectory() as directory:
            script = Path(directory) / "deadline-test.mjs"
            module_uri = (SCRIPTS / "tools/discover.mjs").as_uri()
            script.write_text(
                "import assert from 'node:assert/strict';\n"
                "import { mock } from 'node:test';\n"
                "import { setImmediate } from 'node:timers/promises';\n"
                f"const {{ withDeadline, collectSource }} = await import({json.dumps(module_uri)});\n"
                "const timer = mock.method(globalThis, 'setTimeout', () => { throw new Error('Unexpected deadline timer'); });\n"
                "for (const limit of [null, 0]) {\n"
                "  assert.equal(await withDeadline(async () => { await setImmediate(); return 'complete'; }, limit, 'discovery'), 'complete');\n"
                "  await assert.rejects(withDeadline(() => { throw new Error('source failure'); }, limit, 'discovery'), /source failure/);\n"
                "}\n"
                "assert.equal(timer.mock.callCount(), 0);\n"
                "timer.mock.restore();\n"
                "await assert.rejects(withDeadline(() => new Promise(() => {}), 10, 'discovery'), /discovery exceeded 10 ms/);\n"
                f"const config = {{ schema_version: 1, run_id: 'fixture', site_url: 'https://example.invalid', breakpoints: [375], output_dir: {json.dumps(str(Path(directory).resolve()))} }};\n"
                "for (const page_timeout_ms of [-1, false, 'none', 1.5]) await assert.rejects(collectSource({ ...config, page_timeout_ms }), /Invalid discovery setting: page_timeout_ms/);\n",
                encoding="utf-8",
            )
            result = subprocess.run(["node", str(script)], capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=15)
            self.assertEqual(result.returncode, 0, result.stderr)

    def test_progress_formatter_names_work_and_elapsed_time(self):
        with tempfile.TemporaryDirectory() as directory:
            script = Path(directory) / "logging-test.mjs"
            module_uri = (SCRIPTS / "tools/discover.mjs").as_uri()
            script.write_text(
                "import assert from 'node:assert/strict';\n"
                f"const {{ formatDiscoveryProgress }} = await import({json.dumps(module_uri)});\n"
                "const output = formatDiscoveryProgress({ breakpoint: 375, stage: 'interaction_discovery', status: 'WAIT', elapsed_ms: 12500, stage_elapsed_ms: 6200, remaining_ms: 107500, current: 2, total: 9, unit: 'known controls', selector: '#menu\\nbutton', message: 'Waiting for hover' });\n"
                "assert(output.startsWith('[discovery 375px +12.5s] WAIT: Check hover and focus states'));\n"
                "assert(output.includes('2/9 known controls'));\n"
                "assert(output.includes('selector=#menu button'));\n"
                "assert(output.includes('stage 6.2s'));\n"
                "assert(output.includes('107.5s remaining'));\n"
                "assert(!output.includes('\\n'));\n",
                encoding="utf-8",
            )
            result = subprocess.run(["node", str(script)], capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=15)
            self.assertEqual(result.returncode, 0, result.stderr)

    def test_inventory_is_reused_until_its_sources_change(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            settings = Settings.load(SCRIPTS.parents[2], SCRIPTS / "config")
            settings.repo_root = root
            settings.migration = settings.migration.merged({"reuse": {"survey_roots": {"components": "components"}}, "discovery": {"inventory_cache_dir": "cache"}})
            component = root / "components/hero/.content.xml"
            component.parent.mkdir(parents=True)
            component.write_text('<root title="Hero"/>', encoding="utf-8")
            target = root / "inventory.json"
            self.assertFalse(repository_inventory(settings, target))
            initial = target.read_bytes()
            self.assertTrue(repository_inventory(settings, target))
            self.assertEqual(target.read_bytes(), initial)
            component.write_text('<root title="Changed Hero"/>', encoding="utf-8")
            self.assertFalse(repository_inventory(settings, target))
            self.assertNotEqual(target.read_bytes(), initial)

    def test_offline_collection_covers_every_breakpoint_and_signal(self):
        class FixtureHandler(BaseHTTPRequestHandler):
            def do_GET(self):
                document = b'''<!doctype html><title>Discovery fixture</title>
                <style>body{margin:0}main{min-height:1100px}section{height:220px;background:#ace}#late{display:none}a{display:block}
                #hover-menu,#header-menu{display:none}#trigger:hover + #hover-menu,#trigger:focus + #hover-menu{display:block}
                #header-trigger:hover + #header-menu,#header-trigger:focus + #header-menu{display:block}</style>
                <header id="header"><nav class="mega-menu"><a id="header-one" href="/one">One</a><a id="header-two" href="/two">Two</a>
                <button id="header-trigger">Header menu</button><div id="header-menu"><a id="submenu-link" href="/hidden">Hidden submenu link</a></div></nav></header>
                <nav id="top-nav"><a id="top-link" href="/top">Top navigation</a></nav>
                <main id="main"><section id="hero" class="hero"><h1>Fixture heading</h1><p>Exact source copy.</p></section>
                <header><button id="article-control">Article control</button></header><nav><a id="body-link" href="/body">Body link</a></nav>
                <button id="trigger">Content control</button><div id="hover-menu">Hover content</div>
                <div id="late" class="announcement">Scroll revealed</div></main><footer id="footer"><nav><a id="footer-link" href="/footer">Footer</a></nav></footer>
                <script>addEventListener('scroll',()=>{if(scrollY>100)document.querySelector('#late').style.display='block'});
                document.querySelector('#header').addEventListener('pointerover',()=>{document.querySelector('#header').dataset.probed='yes'});
                document.querySelector('#header').addEventListener('focusin',()=>{document.querySelector('#header').dataset.probed='yes'});
                setTimeout(()=>{const node=document.createElement('aside');node.id='injected';node.textContent='Late content';document.body.append(node)},1200);</script>'''
                self.send_response(200)
                self.send_header("Content-Type", "text/html")
                self.end_headers()
                self.wfile.write(document)

            def log_message(self, *args):
                pass

        server = ThreadingHTTPServer(("127.0.0.1", 0), FixtureHandler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                settings = Settings.load(SCRIPTS.parents[2], SCRIPTS / "config")
                contract = load_contract(settings, {"site_url": f"http://127.0.0.1:{server.server_port}/"})
                browser = browser_paths(settings)
                settings.repo_root = root
                context = SimpleNamespace(settings=settings, contract=contract, browser=browser, evidence_dir=root / "evidence", run_id="fixture")
                prepared = collect_discovery(context)
                output = prepared.manifest.parent
                manifest = json.loads((output / "manifest.json").read_text(encoding="utf-8"))
                self.assertEqual(manifest["status"], "COLLECTED")
                self.assertEqual(manifest["header_navigation_scope"], "visible-links-only")
                self.assertEqual(len(manifest["results"]), 3)
                for width in (375, 768, 1440):
                    signals = json.loads((output / str(width) / "signals.json").read_text(encoding="utf-8"))
                    self.assertEqual(len(signals["executed"]), 11)
                    self.assertIn("#late", signals["signals"]["scroll_triggered"])
                    self.assertIn("#injected", signals["signals"]["dynamic_injection"])
                    self.assertTrue(signals["signals"]["vertical_bands"])
                    summary = json.loads((output / str(width) / "summary.json").read_text(encoding="utf-8"))
                    self.assertEqual(summary["viewport"]["width"], width)
                    self.assertTrue((output / str(width) / "source.png").is_file())
                    interactions = json.loads((output / str(width) / "interactions.json").read_text(encoding="utf-8"))
                    trigger = next(row for row in interactions if row["selector"] == "#trigger")
                    self.assertIn("#hover-menu", [row["selector"] for row in trigger["hover"]])
                    interacted = {row["selector"] for row in interactions}
                    self.assertTrue({"#article-control", "#body-link", "#footer-link"} <= interacted)
                    self.assertFalse({"#header-one", "#header-two", "#header-trigger", "#submenu-link", "#top-link"} & interacted)
                    header = json.loads((output / str(width) / "header-links.json").read_text(encoding="utf-8"))
                    self.assertEqual(header["scope"], "visible-links-only")
                    self.assertEqual({row["href"] for row in header["links"]}, {"/one", "/two", "/top"})
                    self.assertEqual(next(row["text"] for row in header["links"] if row["href"] == "/one"), "One")
                    observed = json.loads((output / str(width) / "observations.json").read_text(encoding="utf-8"))
                    self.assertNotIn("#submenu-link", {row["selector"] for row in observed})
                    self.assertNotIn("data-probed", next(row["attributes"] for row in observed if row["selector"] == "#header"))
                self.assertIn('"stage":"COLLECTED"', (output / "progress.jsonl").read_text(encoding="utf-8"))
                self.assertTrue(prepared.summary.is_file())
                self.assertTrue(prepared.inventory.is_file())
                checked, artifacts = validate_collection(output / "manifest.json", "fixture", f"http://127.0.0.1:{server.server_port}/", [375, 768, 1440], manifest["collector_sha256"])
                self.assertEqual(checked["status"], "COLLECTED")
                self.assertGreater(len(artifacts), 3)
                (output / "375/signals.json").write_text('{}', encoding="utf-8")
                with self.assertRaisesRegex(EnvelopeError, "changed or invalid"):
                    validate_collection(output / "manifest.json", "fixture", f"http://127.0.0.1:{server.server_port}/", [375, 768, 1440], manifest["collector_sha256"])
                print(f"\nOffline three-breakpoint collector: {manifest['elapsed_ms']} ms")
                settings.migration = settings.migration.merged({"discovery": {"page_timeout_seconds": 1}})
                with self.assertRaisesRegex(EnvelopeError, "Source discovery is incomplete"):
                    collect_discovery(context)
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=5)

    def test_collector_regexes_and_browser_cleanup(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            script = root / "collector-test.mjs"
            module_uri = (SCRIPTS / "tools/discover.mjs").as_uri()
            script.write_text(
                "import assert from 'node:assert/strict';\n"
                f"const {{ snapshotDOM, usingBrowser, withDeadline }} = await import({json.dumps(module_uri)});\n"
                "let captured;\n"
                "await assert.rejects(usingBrowser(async browser => {\n"
                "  captured = browser;\n"
                "  const page = await browser.newPage();\n"
                "  await page.setContent('<main id=main><section class=hero><h1>Heading</h1><p>Copy</p></section><nav class=mega-menu><a href=/one>One</a><a href=/two>Two</a></nav></main>');\n"
                "  const snapshot = await page.evaluate(snapshotDOM);\n"
                "  assert(snapshot.elements.some(row => row.signals.includes('class_family')));\n"
                "  assert(snapshot.elements.some(row => row.signals.includes('missable')));\n"
                "  assert(snapshot.elements.some(row => row.signals.includes('repetition')));\n"
                "  for (const row of snapshot.elements) assert.equal(await page.locator(row.selector).count(), 1);\n"
                "  assert(snapshot.tokens.length > 0);\n"
                "  throw new Error('injected collection failure');\n"
                "}), /injected collection failure/);\n"
                "assert.equal(captured.isConnected(), false);\n"
                "await assert.rejects(withDeadline(() => new Promise(() => {}), 10, 'fonts'), /fonts exceeded/);\n",
                encoding="utf-8",
            )
            result = subprocess.run(["node", str(script)], capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=30)
            self.assertEqual(result.returncode, 0, result.stderr)


class BrowserTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name).resolve()
        self.settings = Settings.load(SCRIPTS.parents[2], SCRIPTS / "config")
        self.settings.repo_root = self.root
        self.settings.migration = self.settings.migration.merged({"parity": {"tools_dir": "tools", "browsers_path": "browser-cache"}})
        environment = patch.dict(os.environ, {"PLAYWRIGHT_BROWSERS_PATH": ""})
        environment.start()
        self.addCleanup(environment.stop)
        runtime = browser_paths(self.settings)
        runtime.tools_dir.mkdir(parents=True)
        runtime.module_path.write_text("fixture", encoding="utf-8")
        (runtime.tools_dir / "package.json").write_text(json.dumps({"dependencies": {"playwright": "1.63.0"}}), encoding="utf-8")
        self.payload = {"status": "READY", "playwright_version": "1.63.0", "browser_version": "153.0.0.0", "chromium_revision": "1243", "elapsed_ms": 100,
                        "browsers_path": str(runtime.browsers_path), "module_uri": runtime.module_path.as_uri()}

    def test_preflight_checks_cache_without_installing(self):
        response = subprocess.CompletedProcess([], 0, json.dumps(self.payload), "")
        with patch("aem_agents.browser.shutil.which", return_value="node"), patch("aem_agents.browser.subprocess.run", return_value=response) as execute:
            runtime = check_browser(self.settings)
        self.assertEqual(runtime.playwright_version, "1.63.0")
        self.assertNotIn("--install", execute.call_args.args[0])
        self.assertFalse(execute.call_args.kwargs["shell"])
        self.assertEqual(execute.call_args.kwargs["timeout"], 25)
        self.assertEqual(execute.call_args.kwargs["env"]["MIGRATION_BROWSER_MODULE"], runtime.module_path.as_uri())
        execute.assert_called_once()

    def test_timeout_reports_setup_hint_without_retrying(self):
        with patch("aem_agents.browser.shutil.which", return_value="node"), patch("aem_agents.browser.subprocess.run", side_effect=subprocess.TimeoutExpired("node", 25)) as execute:
            with self.assertRaisesRegex(EnvelopeError, "Install dependencies once"):
                check_browser(self.settings)
        execute.assert_called_once()

    def test_wrong_version_or_cache_fails_closed(self):
        for fields in ({"playwright_version": "1.48.0"}, {"browsers_path": str(self.root / "wrong-cache")}, {"module_uri": "file:///wrong/browser.mjs"}):
            response = subprocess.CompletedProcess([], 0, json.dumps({**self.payload, **fields}), "")
            with self.subTest(fields=fields), patch("aem_agents.browser.shutil.which", return_value="node"), patch("aem_agents.browser.subprocess.run", return_value=response), self.assertRaises(EnvelopeError):
                check_browser(self.settings)

    def test_explicit_user_cache_is_respected(self):
        cache = self.root / "shared user cache"
        with patch.dict(os.environ, {"PLAYWRIGHT_BROWSERS_PATH": str(cache)}):
            self.assertEqual(browser_paths(self.settings).browsers_path, cache)
        with patch.dict(os.environ, {"PLAYWRIGHT_BROWSERS_PATH": "0"}), self.assertRaises(ConfigError):
            browser_paths(self.settings)

    def test_real_shared_import_works_outside_tool_directory(self):
        settings = Settings.load(SCRIPTS.parents[2], SCRIPTS / "config")
        runtime = ensure_browser(settings)
        probe = self.root / "probe.mjs"
        probe.write_text("const { checkBrowser } = await import(process.env.MIGRATION_BROWSER_MODULE);\nconsole.log(JSON.stringify(await checkBrowser()));\n", encoding="utf-8")
        response = subprocess.run(["node", str(probe)], cwd=self.root, env={**os.environ, **runtime.environment()}, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=30)
        self.assertEqual(response.returncode, 0, response.stderr)
        payload = json.loads(response.stdout)
        self.assertEqual(payload["status"], "READY")
        self.assertEqual(Path(payload["browsers_path"]), runtime.browsers_path)

    def test_missing_cache_does_not_trigger_an_install(self):
        runtime = browser_paths(Settings.load(SCRIPTS.parents[2], SCRIPTS / "config"))
        empty_cache = self.root / "empty-cache"
        response = subprocess.run(
            ["node", str(runtime.module_path), "--browsers-path", str(empty_cache), "--timeout-ms", "1000"],
            capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=15,
        )
        self.assertNotEqual(response.returncode, 0)
        self.assertIn("Explicit setup", response.stderr)
        self.assertNotIn("Installing pinned Chromium", response.stderr)
        self.assertFalse(empty_cache.exists())

    def test_explicit_install_preserves_existing_installer_lock(self):
        runtime = browser_paths(Settings.load(SCRIPTS.parents[2], SCRIPTS / "config"))
        cache = self.root / "locked-cache"
        lock = cache / "__dirlock"
        lock.mkdir(parents=True)
        response = subprocess.run(
            ["node", str(runtime.module_path), "--install", "--browsers-path", str(cache)],
            capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=15,
        )
        self.assertNotEqual(response.returncode, 0)
        self.assertIn("Browser installer lock exists", response.stderr)
        self.assertTrue(lock.is_dir())
        self.assertEqual(list(cache.iterdir()), [lock])


class AutomaticBrowserSetupTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name).resolve()
        self.settings = Settings.load(SCRIPTS.parents[2], SCRIPTS / "config")
        self.settings.repo_root = self.root
        self.settings.migration = self.settings.migration.merged({"parity": {"tools_dir": "tools", "browsers_path": "cache"}})
        environment = patch.dict(os.environ, {"PLAYWRIGHT_BROWSERS_PATH": "", "AEM_AGENTS_SKIP_BOOTSTRAP": ""})
        environment.start()
        self.addCleanup(environment.stop)
        self.runtime = browser_paths(self.settings)
        self.runtime.tools_dir.mkdir()
        self.runtime.module_path.write_text("fixture", encoding="utf-8")
        self.package = {"dependencies": {"playwright": "1.63.0"}}
        self.lock = {"packages": {"": self.package, "node_modules/playwright": {"version": "1.63.0"}}}
        (self.runtime.tools_dir / "package.json").write_text(json.dumps(self.package), encoding="utf-8")
        self.lock_path = self.runtime.tools_dir / "package-lock.json"
        self.lock_path.write_text(json.dumps(self.lock), encoding="utf-8")

    def install(self, arguments, runtime, label, timeout):
        package = runtime.tools_dir / "node_modules/playwright/package.json"
        package.parent.mkdir(parents=True, exist_ok=True)
        package.write_text(json.dumps({"version": "1.63.0"}), encoding="utf-8")

    def test_first_run_installs_then_warm_run_reuses_packages(self):
        with patch("aem_agents.browser.shutil.which", return_value="node"), patch("aem_agents.browser._npm_cli", return_value=Path("npm-cli.js")), patch("aem_agents.browser._run_setup", side_effect=self.install) as setup, patch("aem_agents.browser.check_browser", return_value=self.runtime) as check:
            self.assertEqual(ensure_browser(self.settings), self.runtime)
            self.assertEqual(ensure_browser(self.settings), self.runtime)
        setup.assert_called_once()
        self.assertEqual(setup.call_args.args[0][2:], ["ci", "--ignore-scripts", "--engine-strict", "--no-audit", "--no-fund"])
        self.assertEqual(check.call_count, 2)

    def test_missing_package_or_changed_lock_triggers_repair(self):
        with patch("aem_agents.browser.shutil.which", return_value="node"), patch("aem_agents.browser._npm_cli", return_value=Path("npm-cli.js")), patch("aem_agents.browser._run_setup", side_effect=self.install) as setup, patch("aem_agents.browser.check_browser", return_value=self.runtime):
            ensure_browser(self.settings)
            (self.runtime.tools_dir / "node_modules/playwright/package.json").unlink()
            ensure_browser(self.settings)
            self.lock["packages"]["node_modules/playwright"]["integrity"] = "changed"
            self.lock_path.write_text(json.dumps(self.lock), encoding="utf-8")
            ensure_browser(self.settings)
        self.assertEqual(setup.call_count, 3)

    def test_missing_browser_is_installed_once_before_rechecking(self):
        with patch("aem_agents.browser.shutil.which", return_value="node"), patch("aem_agents.browser._ensure_packages"), patch("aem_agents.browser._run_setup") as setup, patch("aem_agents.browser.check_browser", side_effect=[EnvelopeError("Executable doesn't exist"), self.runtime]) as check:
            self.assertEqual(ensure_browser(self.settings), self.runtime)
        setup.assert_called_once()
        self.assertIn("--install", setup.call_args.args[0])
        self.assertEqual(check.call_count, 2)

    def test_interrupted_browser_download_uses_official_repair(self):
        metadata = self.runtime.tools_dir / "node_modules/playwright-core/browsers.json"
        metadata.parent.mkdir(parents=True)
        metadata.write_text(json.dumps({"browsers": [{"name": "chromium-headless-shell", "revision": "1243"}]}), encoding="utf-8")
        browser_directory = self.runtime.browsers_path / "chromium_headless_shell-1243"
        browser_directory.mkdir(parents=True)
        with patch("aem_agents.browser.shutil.which", return_value="node"), patch("aem_agents.browser._ensure_packages"), patch("aem_agents.browser._run_setup") as setup, patch("aem_agents.browser.check_browser", side_effect=[EnvelopeError("spawn EFTYPE"), self.runtime]):
            self.assertEqual(ensure_browser(self.settings), self.runtime)
        setup.assert_called_once()
        (browser_directory / "INSTALLATION_COMPLETE").write_text("", encoding="utf-8")
        with patch("aem_agents.browser.shutil.which", return_value="node"), patch("aem_agents.browser._ensure_packages"), patch("aem_agents.browser._run_setup") as setup, patch("aem_agents.browser.check_browser", side_effect=EnvelopeError("spawn EFTYPE")):
            with self.assertRaisesRegex(EnvelopeError, "EFTYPE"):
                ensure_browser(self.settings)
        setup.assert_not_called()

    def test_failed_install_never_marks_packages_ready(self):
        with patch("aem_agents.browser.shutil.which", return_value="node"), patch("aem_agents.browser._npm_cli", return_value=Path("npm-cli.js")), patch("aem_agents.browser._run_setup", side_effect=EnvelopeError("network unavailable")) as setup, patch("aem_agents.browser.check_browser") as check:
            with self.assertRaisesRegex(EnvelopeError, "network unavailable"):
                ensure_browser(self.settings)
        setup.assert_called_once()
        check.assert_not_called()
        self.assertFalse((self.runtime.tools_dir / "node_modules/.migration-package-stamp").exists())

    def test_opt_out_never_installs(self):
        with patch("aem_agents.browser._ensure_packages") as packages, patch("aem_agents.browser._run_setup") as setup, patch("aem_agents.browser.check_browser", return_value=self.runtime):
            ensure_browser(self.settings, bootstrap=False)
            with patch.dict(os.environ, {"AEM_AGENTS_SKIP_BOOTSTRAP": "1"}):
                ensure_browser(self.settings)
        packages.assert_not_called()
        setup.assert_not_called()

    def test_non_installation_errors_are_not_retried(self):
        with patch("aem_agents.browser.shutil.which", return_value="node"), patch("aem_agents.browser._ensure_packages"), patch("aem_agents.browser._run_setup") as setup, patch("aem_agents.browser.check_browser", side_effect=EnvelopeError("Browser launch timeout")) as check:
            with self.assertRaisesRegex(EnvelopeError, "launch timeout"):
                ensure_browser(self.settings)
        setup.assert_not_called()
        check.assert_called_once()

    def test_installers_use_argument_arrays_without_a_shell(self):
        from aem_agents.browser import _run_setup
        command = ["node", "path with spaces/npm-cli.js", "ci", "--ignore-scripts"]
        with patch("aem_agents.browser.subprocess.Popen") as start:
            start.return_value.wait.return_value = 0
            start.return_value.poll.return_value = 0
            _run_setup(command, self.runtime, "fixture", 300)
        self.assertEqual(start.call_args.args[0], command)
        self.assertFalse(start.call_args.kwargs["shell"])
        self.assertEqual(start.call_args.kwargs["cwd"], self.runtime.tools_dir)

    def test_timeout_stops_setup_process_tree(self):
        from aem_agents.browser import _run_setup
        with patch("aem_agents.browser.subprocess.Popen") as start, patch("aem_agents.browser.subprocess.run") as terminate, patch("aem_agents.browser.os.killpg", create=True) as kill_group:
            process = start.return_value
            process.pid = 4321
            process.poll.return_value = None
            process.wait.side_effect = [subprocess.TimeoutExpired("setup", 1), 0]
            with self.assertRaisesRegex(EnvelopeError, "exceeded 1s"):
                _run_setup(["node", "fixture.js"], self.runtime, "fixture", 1)
            if os.name == "nt":
                self.assertIn("/T", terminate.call_args.args[0])
                self.assertIn("4321", terminate.call_args.args[0])
            else:
                kill_group.assert_called_once()
            self.assertEqual(process.wait.call_count, 2)


class CheckpointTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.evidence = self.root / "evidence"
        self.evidence.mkdir()
        self.artifact = self.evidence / "proof.json"
        self.artifact.write_text("{}", encoding="utf-8")
        self.source = self.root / "component.txt"
        self.source.write_text("original", encoding="utf-8")
        self.settings = Settings.load(SCRIPTS.parents[2], SCRIPTS / "config")
        self.contract = load_contract(self.settings)
        self.settings.repo_root = self.root
        self.checkpoint = capture_checkpoint(self.settings, self.contract, self.evidence, [self.artifact])

    def test_unchanged_checkpoint_validates(self):
        validate_checkpoint(self.checkpoint, self.settings, self.contract, self.evidence)

    def test_source_changes_and_new_files_invalidate_reuse(self):
        self.source.write_text("user edit", encoding="utf-8")
        with self.assertRaisesRegex(ConfigError, "Source changed"):
            validate_checkpoint(self.checkpoint, self.settings, self.contract, self.evidence)
        self.assertEqual(self.source.read_text(), "user edit")

    def test_frozen_evidence_changes_are_rejected(self):
        self.artifact.write_text("changed", encoding="utf-8")
        with self.assertRaisesRegex(ConfigError, "evidence changed"):
            validate_checkpoint(self.checkpoint, self.settings, self.contract, self.evidence)

    def test_configuration_changes_and_legacy_checkpoints_are_rejected(self):
        self.settings.migration = self.settings.migration.merged({"model": {"effort": "low"}})
        with self.assertRaisesRegex(ConfigError, "configuration changed"):
            validate_checkpoint(self.checkpoint, self.settings, self.contract, self.evidence)
        with self.assertRaisesRegex(ConfigError, "compatible fingerprinted"):
            validate_checkpoint({}, self.settings, self.contract, self.evidence)


class ScoringTests(unittest.TestCase):
    def test_real_pixelmatch_overrides_fabricated_counts(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "source.png"
            target = root / "target.png"
            Image.new("RGB", (20, 20), "red").save(source)
            Image.new("RGB", (20, 20), "blue").save(target)
            rows = [{"source_image": str(source), "target_image": str(target), "matched_pixels": 400, "total_pixels": 400, "ratio": 1.0}]
            scorer = PixelScorer()
            receipt = scorer.score(rows, root / "verified", run_id="test")
            self.assertEqual(rows[0]["ratio"], 0)
            self.assertEqual(rows[0]["matched_pixels"], 0)
            self.assertEqual(rows[0]["total_pixels"], 400)
            self.assertTrue(Path(receipt["path"]).is_file())
            self.assertEqual(set(rows[0]["image_hashes"]), {"source_image", "target_image", "side_by_side", "diff_mask"})
            source_rows = [{"source_image": str(source), "target_image": str(source)}]
            scorer.score(source_rows, root / "verified", run_id="test")
            self.assertEqual(source_rows[0]["ratio"], 1)

    def test_scorer_tampering_is_rejected_before_execution(self):
        scorer = PixelScorer()
        with patch.object(scorer, "tooling_revision", return_value="changed"), patch("aem_agents.scoring.subprocess.run") as execute:
            with self.assertRaisesRegex(EnvelopeError, "changed during agent"):
                scorer.score([], Path("unused"), run_id="test")
            execute.assert_not_called()


class WorkspaceTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name) / "repo"
        self.root.mkdir()
        self.workers = Path(self.directory.name) / "workers"
        self.source = self.root / "core/src/main/java/Hero.java"
        self.source.parent.mkdir(parents=True)
        self.source.write_text("user's uncommitted source", encoding="utf-8")
        self.scope = "core/src/main/java/Hero.java"

    def worker(self):
        return WorkerWorkspace.create(self.root, self.workers, [self.scope])

    def test_snapshot_preserves_uncommitted_source_and_isolates_edits(self):
        worker = self.worker()
        edited = worker.root / self.scope
        self.assertEqual(edited.read_text(), self.source.read_text())
        edited.write_text("worker change", encoding="utf-8")
        self.assertEqual(self.source.read_text(), "user's uncommitted source")
        self.assertEqual(apply_changes(self.root, [worker.collect()]), [self.scope])
        self.assertEqual(self.source.read_text(), "worker change")

    def test_unowned_changes_are_rejected(self):
        worker = self.worker()
        (worker.root / "pom.xml").write_text("not owned", encoding="utf-8")
        with self.assertRaisesRegex(WorkspaceError, "unowned"):
            worker.collect()

    def test_build_outputs_are_not_copied_or_applied(self):
        for output in (
            "core/target/classes/output.class",
            "ui.frontend/dist_validate/main.css", "ui.frontend/dist_validate/nested/main.css.map",
            "ui.frontend/build/check.css", "ui.frontend/coverage/coverage-final.json", "ui.frontend/reports/lint.json",
            "ui.tests/test-module/cypress/results/screenshots/example.png", "ui.tests/test-module/cypress/results/videos/example.mp4",
        ):
            with self.subTest(output=output):
                generated = self.root / output
                generated.parent.mkdir(parents=True, exist_ok=True)
                generated.write_bytes(b"old")
                worker = self.worker()
                self.assertFalse((worker.root / output).exists())
                artifact = worker.root / output
                artifact.parent.mkdir(parents=True, exist_ok=True)
                artifact.write_bytes(b"new")
                (worker.root / self.scope).write_text("accepted source change", encoding="utf-8")
                changes = worker.collect()
                self.assertEqual(set(changes.changed), {self.scope})
                self.assertEqual(apply_changes(self.root, [changes]), [self.scope])
                self.assertEqual(generated.read_bytes(), b"old")
                self.source.write_text("user's uncommitted source", encoding="utf-8")

    def test_validation_output_exclusion_does_not_hide_source_edits(self):
        paths = (
            "ui.frontend/src/main/webpack/site/main.scss",
            "ui.frontend/src/main/webpack/dist_validate/main.scss",
            "core/src/main/java/dist_validate/Other.java",
            "ui.frontend/dist_validate_extra/main.css",
            "ui.frontend/src/main/webpack/build/main.ts",
            "ui.frontend/src/main/webpack/coverage/index.ts",
            "ui.frontend/src/main/webpack/reports/index.ts",
            "ui.frontend/reports_extra/lint.json",
            "ui.tests/test-module/cypress/fixtures/results/example.json",
            "ui.tests/test-module/cypress/results_extra/test.json",
            "ui.frontend/package-lock.json",
            "ui.frontend/package.json",
            "ui.frontend/src/main/webpack/components/example.js",
            "ui.frontend/src/main/webpack/components/example.js.map",
        )
        for source in paths:
            with self.subTest(source=source):
                worker = self.worker()
                generated = worker.root / "ui.frontend/dist_validate/main.css"
                generated.parent.mkdir(parents=True)
                generated.write_text("compiled output", encoding="utf-8")
                unowned = worker.root / source
                unowned.parent.mkdir(parents=True, exist_ok=True)
                unowned.write_text("unowned edit", encoding="utf-8")
                with self.assertRaisesRegex(WorkspaceError, "unowned"):
                    worker.collect()

    def test_dependency_clientlib_is_deployable_foundation_not_ignored_output(self):
        settings = Settings.load(SCRIPTS.parents[2], SCRIPTS / "config")
        output = "ui.apps/src/main/content/jcr_root/apps/demo-ai-site/clientlibs/clientlib-dependencies/js/dependencies.js"
        source = self.root / output
        source.parent.mkdir(parents=True)
        source.write_text("original library", encoding="utf-8")
        scopes = settings.migration.get("isolation.foundation_paths")
        worker = WorkerWorkspace.create(self.root, self.workers, scopes)
        self.assertEqual((worker.root / output).read_text(encoding="utf-8"), "original library")
        (worker.root / output).write_text("rebuilt library", encoding="utf-8")
        changes = worker.collect()
        self.assertEqual(set(changes.changed), {output})
        self.assertEqual(apply_changes(self.root, [changes]), [output])
        self.assertEqual(source.read_text(encoding="utf-8"), "rebuilt library")
        component_worker = self.worker()
        (component_worker.root / output).write_text("component tried to rebuild library", encoding="utf-8")
        with self.assertRaisesRegex(WorkspaceError, "unowned"):
            component_worker.collect()
        with self.assertRaisesRegex(WorkspaceError, "shared or outside"):
            validate_ownership(settings, [{"id": "hero", "owned_paths": [output]}])

    def test_intervening_user_edit_is_never_overwritten(self):
        worker = self.worker()
        (worker.root / self.scope).write_text("worker change", encoding="utf-8")
        change = worker.collect()
        self.source.write_text("new user edit", encoding="utf-8")
        with self.assertRaisesRegex(WorkspaceError, "Checkout changed"):
            apply_changes(self.root, [change])
        self.assertEqual(self.source.read_text(), "new user edit")

    def test_conflicts_fail_before_any_worker_is_applied(self):
        workers = [self.worker(), self.worker()]
        for worker in workers:
            (worker.root / self.scope).write_text("conflicting change", encoding="utf-8")
        with self.assertRaisesRegex(WorkspaceError, "More than one worker"):
            apply_changes(self.root, [worker.collect() for worker in workers])
        self.assertEqual(self.source.read_text(), "user's uncommitted source")

    def test_modified_worker_output_is_rejected(self):
        worker = self.worker()
        (worker.root / self.scope).write_text("first", encoding="utf-8")
        change = worker.collect()
        (worker.root / self.scope).write_text("later", encoding="utf-8")
        with self.assertRaisesRegex(WorkspaceError, "after validation"):
            apply_changes(self.root, [change])

    def test_planner_cannot_assign_shared_or_overlapping_files(self):
        settings = Settings.load(SCRIPTS.parents[2], SCRIPTS / "config")
        with self.assertRaisesRegex(WorkspaceError, "shared or outside"):
            validate_ownership(settings, [{"id": "hero", "owned_paths": ["ui.frontend/src/main/webpack/site/_variables.scss"]}])
        with self.assertRaisesRegex(WorkspaceError, "Conflicting ownership"):
            validate_ownership(settings, [{"id": name, "owned_paths": [self.scope]} for name in ("hero", "footer")])


class StorageTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.evidence = Path(self.directory.name)
        self.settings = Settings.load(SCRIPTS.parents[2], SCRIPTS / "config")

    def contribution(self, component_id, attempt, **fields):
        path = self.evidence / "agents" / f"component-{component_id}-attempt-{attempt}" / "contributions.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps({"component_id": component_id, **fields}), encoding="utf-8")
        return path

    def test_attempts_are_numeric_and_latest_missing_file_is_not_ignored(self):
        self.contribution("hero", 9)
        latest = self.contribution("hero", 10)
        self.assertEqual(latest_contribution_path(self.settings, self.evidence, "hero"), latest)
        latest.unlink()
        contributions, missing = read_contributions(self.settings, self.evidence, [{"id": "hero"}])
        self.assertEqual(missing, ["hero"])
        self.assertEqual(contributions, [])

    def test_empty_nodes_cannot_pass_merge(self):
        self.contribution("hero", 1, nodes=[])
        with self.assertRaises(MergeError):
            read_contributions(self.settings, self.evidence, [{"id": "hero"}])

    def test_required_contribution_target_cannot_be_omitted(self):
        target = "/content/experience-fragments/demo-ai-site/us/en/site/header/master"
        self.contribution("header", 1, page_path="/content/demo-ai-site/us/en/story", nodes=[{"name": "header", "xml": "<header />"}])
        with self.assertRaisesRegex(MergeError, "omits required page/XF targets"):
            read_contributions(self.settings, self.evidence, [{"id": "header", "contribution_targets": [target]}])

    def test_required_contribution_targets_merge_all_authored_pages(self):
        template = self.prepare_template()
        targets = ["/content/demo-ai-site/us/en/story", "/content/experience-fragments/demo-ai-site/us/en/site/header/master"]
        pages = [{"page_path": target, "template_path": template, "page_properties": {"jcr:title": "Header"},
                  "parent_path": "jcr:content/root/container/container", "nodes": [{"name": "header", "xml": "<header />"}]} for target in targets]
        self.contribution("header", 1, pages=pages)
        report = merge_contributions(self.settings, self.evidence, [{"id": "header", "contribution_targets": targets}])
        self.assertTrue(report.ok)
        self.assertEqual(len(report.nodes_written), 2)
        for target in targets:
            path = self.settings.resolve(self.settings.migration.get("shared_files.authored_page.file").format(page_path=target))
            self.assertIsNotNone(ElementTree.parse(path).find(".//header"))

    def test_required_contribution_targets_reject_invalid_shapes_and_scopes(self):
        self.contribution("header", 1, page_path="/content/demo-ai-site/us/en/story", nodes=[{"name": "header", "xml": "<header />"}])
        for targets in ("/content/demo-ai-site/us/en/story", [None], ["/content/other-site/en"],
                        ["/content/demo-ai-site/en/**"], ["/content/demo-ai-site/en/../other"], ["/content/demo-ai-site/en.html"]):
            with self.subTest(targets=targets), self.assertRaises(MergeError):
                read_contributions(self.settings, self.evidence, [{"id": "header", "contribution_targets": targets}])

    def test_latest_author_destination_overrides_incomplete_planner_entry(self):
        url = "https://example.invalid/hero.png"
        self.contribution("hero", 1, assets=[{"source_url": url, "dam_path": "/content/dam/old.png"}])
        self.contribution("hero", 2, assets=[{"source_url": url, "dam_path": "/content/dam/new.png"}])
        entries = _declared_assets(self.settings, self.evidence, [{"id": "hero", "assets": [{"source_url": url}]}])
        self.assertEqual([entry["dam_path"] for entry in entries], ["/content/dam/new.png"])

    def test_shared_source_keeps_both_destinations_and_downloads_once(self):
        url = "https://example.invalid/logo.png"
        components = [{"id": owner, "assets": [{"source_url": url, "dam_path": f"/content/dam/{owner}/logo.png"}]} for owner in ("header", "footer")]
        with patch("aem_agents.assets._download", return_value=(b"image", "image/png")) as download, patch("aem_agents.assets.AemClient") as client:
            client.return_value.exists.side_effect = [False, True, False, True]
            report = fetch_assets(self.settings, self.evidence, components, "http://test.invalid")
        self.assertTrue(report.ok)
        self.assertEqual(len(report.uploaded), 2)
        self.assertEqual(download.call_count, 1)
        self.assertEqual(len({record.local_path for record in report.uploaded}), 1)

    def test_conflicting_destination_is_rejected(self):
        components = [{"id": "hero", "assets": [{"source_url": f"https://example.invalid/{name}.png", "dam_path": "/content/dam/logo.png"} for name in ("old", "new")]}]
        with self.assertRaises(AssetError):
            _declared_assets(self.settings, self.evidence, components)

    def test_same_basename_does_not_collide(self):
        components = [{"id": "hero", "assets": [{"source_url": f"https://example.invalid/{name}/logo.png"} for name in ("first", "second")]}]
        entries = _declared_assets(self.settings, self.evidence, components)
        self.assertEqual(len({entry["dam_path"] for entry in entries}), 2)

    def test_aem_network_errors_are_wrapped(self):
        client = AemClient("http://test.invalid", "test:test", {})
        with patch("urllib.request.urlopen", side_effect=URLError("offline")), self.assertRaises(AssetError):
            client.exists("/content/dam/logo.png")

    def test_failed_upload_is_recorded_and_manifest_is_written(self):
        components = [{"id": "hero", "assets": [{"source_url": "https://example.invalid/logo.png", "dam_path": "/content/dam/logo.png"}]}]
        with patch("aem_agents.assets._download", return_value=(b"image", "image/png")), patch.object(AemClient, "exists", side_effect=AssetError("offline")):
            report = fetch_assets(self.settings, self.evidence, components, "http://test.invalid")
        self.assertFalse(report.ok)
        self.assertEqual(len(report.failed), 1)
        manifest = json.loads(Path(report.manifest_path).read_text(encoding="utf-8"))
        self.assertEqual(manifest["manifest"], report.manifest_path)

    def prepare_template(self):
        self.settings.repo_root = self.evidence / "repo"
        template = "/conf/demo-ai-site/settings/wcm/templates/page-content"
        pattern = self.settings.migration.get("shared_files.authored_page.file")
        initial = self.settings.resolve(pattern.format(page_path=template + "/initial"))
        initial.parent.mkdir(parents=True, exist_ok=True)
        initial.write_text('<jcr:root xmlns:jcr="http://www.jcp.org/jcr/1.0" jcr:primaryType="cq:Page"><jcr:content jcr:primaryType="cq:PageContent"><root><container><container /></container></root></jcr:content></jcr:root>', encoding="utf-8")
        return template

    def test_new_page_uses_template_and_source_order(self):
        template = self.prepare_template()
        for component_id, order in (("second", 1), ("first", 0)):
            self.contribution(component_id, 1, source_order=order, template_path=template,
                              page_properties={"jcr:title": "Authored title"}, page_path="/content/new-page",
                              parent_path="jcr:content/root/container/container",
                              nodes=[{"name": component_id, "xml": f"<{component_id} />"}])
        components = [{"id": "second", "source_order": 1}, {"id": "first", "source_order": 0}]
        report = merge_contributions(self.settings, self.evidence, components)
        self.assertTrue(report.ok)
        page = self.settings.resolve(self.settings.migration.get("shared_files.authored_page.file").format(page_path="/content/new-page"))
        parent = ElementTree.parse(page).find("{http://www.jcp.org/jcr/1.0}content/root/container/container")
        self.assertEqual([child.tag for child in parent], ["first", "second"])
        self.assertIn("/content/new-page", report.filter_roots_added)
        merge_contributions(self.settings, self.evidence, components)
        parent = ElementTree.parse(page).find("{http://www.jcp.org/jcr/1.0}content/root/container/container")
        self.assertEqual(len(parent), 2)

    def test_multiple_page_targets_are_preserved(self):
        template = self.prepare_template()
        pages = [{"page_path": path, "template_path": template, "page_properties": {"jcr:title": "Title"},
                  "parent_path": "jcr:content/root/container/container", "nodes": [{"name": "header", "xml": "<header />"}]}
                 for path in ("/content/new-page", "/content/experience-fragments/example/master")]
        self.contribution("header", 1, pages=pages)
        report = merge_contributions(self.settings, self.evidence, [{"id": "header"}])
        self.assertTrue(report.ok)
        self.assertEqual(len(report.nodes_written), 2)

    def test_missing_contribution_does_not_partially_write_pages(self):
        template = self.prepare_template()
        self.contribution("hero", 1, template_path=template, page_path="/content/new-page", page_properties={"jcr:title": "Title"},
                          parent_path="jcr:content/root/container/container", nodes=[{"name": "hero", "xml": "<hero />"}])
        report = merge_contributions(self.settings, self.evidence, [{"id": "hero"}, {"id": "missing"}])
        self.assertFalse(report.ok)
        self.assertEqual(report.merged_files, [])


class StateTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / "state.json"
        self.arguments = dict(run_id="test", contract={}, inputs={}, phases=[], orchestrator={})

    def test_create_never_overwrites_existing_checkpoint(self):
        state = RunState.create(self.path, **self.arguments)
        state.update(status="FAIL")
        before = self.path.read_bytes()
        with self.assertRaises(StateError):
            RunState.create(self.path, **self.arguments)
        self.assertEqual(self.path.read_bytes(), before)

    def test_load_is_read_only(self):
        state = RunState.create(self.path, **self.arguments)
        state.set_components([{"id": "hero"}])
        before = self.path.stat().st_mtime_ns
        loaded = RunState.load(self.path)
        self.assertEqual(loaded.component_rows()[0]["id"], "hero")
        self.assertEqual(self.path.stat().st_mtime_ns, before)

    def test_atomic_failure_preserves_previous_json(self):
        state = RunState.create(self.path, **self.arguments)
        before = self.path.read_bytes()
        with patch("aem_agents.state.os.replace", side_effect=PermissionError("locked")), patch("aem_agents.state.time.sleep"), self.assertRaises(StateError):
            state.update(status="FAIL")
        self.assertEqual(self.path.read_bytes(), before)

    def test_workspace_lock_excludes_another_run_and_releases(self):
        with RunLock(self.path):
            with self.assertRaises(StateError):
                with RunLock(self.path):
                    self.fail("Second lock was acquired")
        with RunLock(self.path):
            pass


if __name__ == "__main__":
    unittest.main()