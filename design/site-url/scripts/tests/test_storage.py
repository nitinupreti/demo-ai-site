from __future__ import annotations

import json
from pathlib import Path
import sys
import tempfile
import unittest
from PIL import Image
from unittest.mock import patch
from urllib.error import URLError
from xml.etree import ElementTree

SCRIPTS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS))

from aem_agents.config import Settings
from aem_agents.assets import AemClient, AssetError, _declared_assets, fetch_assets
from aem_agents.merge import latest_contribution_path, read_contributions, merge_contributions, MergeError
from aem_agents.state import RunLock, RunState, StateError
from aem_agents.workspaces import WorkerWorkspace, WorkspaceError, apply_changes, validate_ownership
from aem_agents.scoring import PixelScorer
from aem_agents.envelope import EnvelopeError
from aem_agents.checkpoints import capture_checkpoint, validate_checkpoint
from aem_agents.config import ConfigError
from aem_agents.contract import load_contract


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