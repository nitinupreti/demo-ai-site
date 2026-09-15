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
from aem_agents.browser import browser_paths, check_browser
from aem_agents.assets import AemClient, AssetError, _declared_assets, fetch_assets
from aem_agents.merge import latest_contribution_path, read_contributions, merge_contributions, MergeError
from aem_agents.state import RunLock, RunState, StateError
from aem_agents.workspaces import WorkerWorkspace, WorkspaceError, apply_changes, validate_ownership
from aem_agents.scoring import PixelScorer
from aem_agents.envelope import EnvelopeError
from aem_agents.checkpoints import capture_checkpoint, validate_checkpoint
from aem_agents.config import ConfigError
from aem_agents.contract import load_contract
from aem_agents.discovery import collect_discovery, repository_inventory, validate_collection


class DiscoveryCollectorTests(unittest.TestCase):
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
                #hover-menu{display:none}#trigger:hover + #hover-menu,#trigger:focus + #hover-menu{display:block}</style>
                <header id="header"><nav class="mega-menu"><a href="/one">One</a><a href="/two">Two</a><button id="trigger">Menu</button><div id="hover-menu">Hover content</div></nav></header>
                <main id="main"><section id="hero" class="hero"><h1>Fixture heading</h1><p>Exact source copy.</p></section>
                <div id="late" class="announcement">Scroll revealed</div></main><footer id="footer">Footer</footer>
                <script>addEventListener('scroll',()=>{if(scrollY>100)document.querySelector('#late').style.display='block'});
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
        runtime = check_browser(settings)
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
        generated = self.root / "core/target/classes/old.class"
        generated.parent.mkdir(parents=True)
        generated.write_bytes(b"old")
        worker = self.worker()
        self.assertFalse((worker.root / "core/target").exists())
        generated = worker.root / "core/target/classes/new.class"
        generated.parent.mkdir(parents=True)
        generated.write_bytes(b"new")
        self.assertEqual(worker.collect().changed, {})

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