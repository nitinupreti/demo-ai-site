"""Coordinator-run browser comparison with deterministic acceptance and no LLM call."""

from __future__ import annotations

import json
import math
import time
import uuid
from pathlib import Path
from typing import Any, Iterable, Mapping

from PIL import Image, ImageDraw

from ..envelope import AgentResult, EnvelopeError
from ..console import emit
from ..scoring import PixelScorer
from .base import Agent, RunContext, dump_json


class CaptureGeometryError(EnvelopeError):
    """Real capture dimensions require a layout repair, not another score claim."""


class ParityAgent(Agent):
    """Retain the phase interface while replacing model judgments with measured gates."""

    agent_id = "parity"

    def __init__(self, context: RunContext) -> None:
        super().__init__(context)
        self.scorer: PixelScorer | None = None
        self.capture_dir: Path | None = None
        self.capture_started_ns: int | None = None

    def run(self, **kwargs: Any) -> AgentResult:
        started = time.monotonic()
        slug = self.slug(**kwargs)
        self.workspace(slug).mkdir(parents=True, exist_ok=True)
        self.capture_dir = self.workspace(self.slug(**kwargs)) / "captures" / uuid.uuid4().hex
        components = list(kwargs.get("components") or [])
        if self.context.dry_run:
            emit("  -- Deterministic Playwright comparison skipped (dry run; no model call).", "dim")
            return AgentResult(self.agent_id, self.context.run_id, "PASS")
        self.scorer = self.context.scorer or PixelScorer()
        self.capture_started_ns = time.time_ns()
        emit(f"  -> Playwright comparing {len(components)} components across all breakpoints (no model call).", "cyan")
        try:
            result = self._capture(components)
            self.validate_result(result, components=components)
        except (EnvelopeError, OSError, ValueError, TypeError, KeyError) as error:
            result = AgentResult(self.agent_id, self.context.run_id, "FAIL", failures=[str(error)])
        result.path = str(self.result_path(slug))
        dump_json(Path(result.path), result.to_dict())
        self.context.state.record_agent_result(slug, {**result.to_dict(), "duration_seconds": time.monotonic() - started,
                                                     "comparison_model_calls": 0})
        failed = result.output("failing_components", [])
        summary = f"{len(failed)} component(s) need attention" if not result.failures else "collector/evidence error; comparison incomplete"
        emit(f"  <- Playwright comparison: {result.status} | {summary} | comparison model calls: 0", "green" if result.passed else "red")
        for error in result.failures:
            emit(f"     {error}", "red")
        if failed:
            emit("     Failing components: " + ", ".join(row["component_id"] for row in failed), "yellow")
        return result

    def _capture(self, components: list[Mapping[str, Any]]) -> AgentResult:
        from ..style_parity import BrowserParity
        return BrowserParity(self.context).capture(components, self.capture_dir)

    def env_extra(self) -> dict[str, str]:
        environment = super().env_extra()
        if self.capture_dir is not None:
            environment["MIGRATION_CAPTURE_DIR"] = str(self.capture_dir)
        return environment

    def slug(self, attempt: int = 1, **_: Any) -> str:
        return f"parity-attempt-{attempt}"

    def prompt_values(
        self,
        components: Iterable[Mapping[str, Any]] | None = None,
        attempt: int = 1,
        **_: Any,
    ) -> dict[str, Any]:
        migration = self.context.settings.migration
        runner_dir = self.context.evidence_dir / str(migration.get("parity.runner_dir", "parity"))
        scope = [
            {
                "id": component.get("id"),
                "resource_type": component.get("resource_type"),
                "source_selectors": component.get("source_selectors"),
                "visible_breakpoints": component.get("visible_breakpoints"),
                "instances": component.get("instances", 1),
            }
            for component in (components or [])
        ]
        values = super().prompt_values()
        values.update(
            {
                "attempt": attempt,
                "components_json": json.dumps(scope, indent=2, ensure_ascii=False),
                "modes": ", ".join(str(mode) for mode in migration.get("parity.modes", ["disabled"])),
                "runner_dir": self.context.rel(runner_dir),
                "capture_dir": self.context.rel(self.capture_dir or self.workspace(self.slug(attempt=attempt)) / "captures" / "preview"),
                "comparator": migration.get("parity.diff_tooling.comparator", "pixelmatch"),
                "png_codec": migration.get("parity.diff_tooling.png_codec", "pngjs"),
                "tolerance_x": migration.get("parity.geometry_tolerance_px.x", 1),
                "tolerance_width": migration.get("parity.geometry_tolerance_px.width", 1),
                "tolerance_height": migration.get("parity.geometry_tolerance_px.height", 8),
            }
        )
        return values

    def validate_result(self, result: AgentResult, **kwargs: Any) -> None:
        super().validate_result(result, **kwargs)
        if not self.context.dry_run and not result.blocked:
            self.enforce_threshold(result, list(kwargs.get("components") or []))

    def enforce_threshold(self, result: AgentResult, components: list[Mapping[str, Any]]) -> None:
        threshold = self.context.contract.visual_pass_ratio
        scores = result.output("scores")
        if not isinstance(scores, list):
            raise EnvelopeError("Parity agent 'outputs.scores' must be a list.")
        planned = {str(component["id"]): component for component in components}
        if not planned:
            raise EnvelopeError("Parity requires the validated component plan.")
        modes = self.context.settings.migration.get("parity.modes", ["disabled", "author"])
        failing: dict[str, dict[str, Any]] = {}
        reported = result.output("failing_components")
        if not isinstance(reported, list):
            raise EnvelopeError("Parity failing_components must be a list.")
        for entry in reported:
            if not isinstance(entry, Mapping) or not isinstance(entry.get("component_id"), str) or entry["component_id"] not in planned:
                raise EnvelopeError("Parity reported an unknown failing component.")
            failing[str(entry["component_id"])] = dict(entry)

        def fail(component_id: str, reason: str, layer: str = "evidence") -> None:
            entry = failing.setdefault(component_id, {
            "component_id": component_id, "owning_layer": layer,
                "hypothesis": reason, "diagnostic": {"validation_errors": []},
            })
            entry.setdefault("validation_errors", []).append(reason)

        groups: dict[tuple[str, int, str], set[str]] = {}
        for component_id, component in planned.items():
            visible = component.get("visible_breakpoints")
            for width in self.context.contract.breakpoints:
                if visible is not None and width not in visible:
                    continue
                for mode in modes:
                    groups[(component_id, width, mode)] = set()
        if not groups:
            raise EnvelopeError("The component plan has no visible instances to score.")

        valid_instances = []
        geometry_previews = []
        for row in scores:
            if not isinstance(row, dict) or not isinstance(row.get("component_id"), str) or row["component_id"] not in planned:
                raise EnvelopeError("Parity score has no known component_id.")
            component_id = row["component_id"]
            if type(row.get("breakpoint")) is not int or not isinstance(row.get("mode"), str):
                fail(component_id, "Invalid breakpoint or mode type.")
                row["screenshot_validation"] = "FAIL"
                continue
            key = (component_id, row.get("breakpoint"), row.get("mode"))
            instance_id = row.get("instance_id")
            if key not in groups or not isinstance(instance_id, str) or not instance_id:
                fail(component_id, "Unexpected breakpoint, mode, or missing instance_id.")
                continue
            if instance_id in groups[key]:
                fail(component_id, f"Duplicate score for {key}/{instance_id}.")
            groups[key].add(instance_id)
            try:
                self._validate_score(row)
                valid_instances.append(row)
            except EnvelopeError as error:
                row["screenshot_validation"] = "FAIL"
                row["ratio"] = None
                row["status"] = "FAIL"
                fail(component_id, str(error), "css" if isinstance(error, CaptureGeometryError) else "evidence")
                if isinstance(error, CaptureGeometryError):
                    self._geometry_preview(row)
                    geometry_previews.append(row)

        for (component_id, width, mode), actual in groups.items():
            component = planned[component_id]
            expected = {
                str(selector["instance_id"])
                for selector in component.get("source_selectors", [])
                if isinstance(selector, Mapping) and selector.get("instance_id")
                and selector.get("breakpoint", width) == width
            }
            count = component.get("instances", 1)
            if (expected and actual != expected) or (not expected and len(actual) != count):
                fail(component_id, f"Incomplete instance coverage at {width}/{mode}.")

        page_rows = result.output("page_composites")
        page_keys = {(width, mode) for width in self.context.contract.breakpoints for mode in modes}
        seen_pages: set[tuple[int, str]] = set()
        valid_pages = []
        page_failures = []
        if not isinstance(page_rows, list):
            page_rows = []
        for row in page_rows:
            if not isinstance(row, dict) or type(row.get("breakpoint")) is not int or not isinstance(row.get("mode"), str):
                page_failures.append(("Invalid page composite row.", "evidence"))
                continue
            key = (row.get("breakpoint"), row.get("mode"))
            if key not in page_keys or key in seen_pages:
                page_failures.append(("Invalid or duplicate page composite.", "evidence"))
                continue
            seen_pages.add(key)
            try:
                self._validate_score(row, whole_page=True)
                valid_pages.append(row)
            except EnvelopeError as error:
                row["ratio"] = None
                row["screenshot_validation"] = "FAIL"
                row["status"] = "FAIL"
                page_failures.append((f"Invalid page composite: {error}", "foundation" if isinstance(error, CaptureGeometryError) else "evidence"))
        if seen_pages != page_keys:
            page_failures.append(("Missing page composite coverage.", "evidence"))

        valid_states = []
        state_keys = set()
        for row in result.output("interaction_scores", []):
            component_id = row.get("component_id")
            if component_id not in planned or not isinstance(row.get("state"), str):
                raise EnvelopeError("Interaction screenshot has an unknown component or state.")
            if type(row.get("breakpoint")) is not int or (component_id, row.get("breakpoint"), row.get("mode")) not in groups:
                raise EnvelopeError("Interaction screenshot has an unexpected breakpoint or mode.")
            key = (component_id, row.get("instance_id"), row.get("breakpoint"), row.get("mode"), row["state"])
            if key in state_keys:
                fail(component_id, "Duplicate interaction screenshot state.")
                continue
            state_keys.add(key)
            try:
                self._validate_score(row)
                valid_states.append(row)
            except EnvelopeError as error:
                row.update(status="FAIL", ratio=None, screenshot_validation="FAIL")
                fail(component_id, f"Invalid interaction capture {row['state']}: {error}")
                if isinstance(error, CaptureGeometryError):
                    self._geometry_preview(row)
                    geometry_previews.append(row)

        scorer = self.scorer or PixelScorer()
        verification = scorer.score(valid_instances + valid_pages + valid_states, self.context.evidence_dir / "parity" / "verified", run_id=self.context.run_id)
        for row in valid_instances + valid_states:
            row["status"] = "PASS" if threshold.passes(row["ratio"]) else "FAIL"
            if row["status"] != "PASS":
                fail(row["component_id"], f"Measured pixel ratio {row['ratio']} did not pass {threshold}.", "css")
        for row in valid_pages:
            row["status"] = "PASS" if threshold.passes(row["ratio"]) else "FAIL"
            if row["status"] != "PASS":
                page_failures.append((f"Measured page composite at {row['breakpoint']}/{row['mode']} did not pass {threshold}.", "foundation"))
        for reason, layer in page_failures:
            for component_id in (list(failing) or [next(iter(planned))]):
                fail(component_id, reason, layer)
        for component_id, entry in failing.items():
            captures = [row for row in valid_instances + valid_states + geometry_previews if row["component_id"] == component_id]
            if entry.get("owning_layer") == "foundation":
                captures += valid_pages
            entry.setdefault("diagnostic", {})["captures"] = [
                {name: row[name] for name in ("breakpoint", "mode", "state", "ratio", "source_image", "target_image", "side_by_side", "diff_mask") if name in row}
                for row in captures
            ]
            entry.setdefault("evidence", []).append(verification["path"])
        gate_name = "all_final_minima_and_composites_pass_threshold"
        result.checks = [check for check in result.checks if check.get("name") != gate_name]
        result.checks.append({"name": gate_name, "status": "FAIL" if failing else "PASS", "evidence": verification["path"]})
        result.outputs["verification"] = verification
        result.outputs["failing_components"] = list(failing.values())
        result.outputs["threshold"] = str(threshold)
        result.outputs["scores_withheld"] = sum(row.get("screenshot_validation") != "PASS" for row in scores)
        if failing:
            result.status = "FAIL"

    def _geometry_preview(self, row: dict[str, Any]) -> None:
        directory = (self.capture_dir or self.context.evidence_dir) / "geometry-previews"
        directory.mkdir(parents=True, exist_ok=True)
        with Image.open(row["source_image"]) as source, Image.open(row["target_image"]) as target:
            width, height = source.width + target.width, max(source.height, target.height) + 48
            if width * height > 100000000:
                return
            preview = Image.new("RGB", (width, height), "white")
            preview.paste(source, (0, 48))
            preview.paste(target, (source.width, 48))
            draw = ImageDraw.Draw(preview)
            draw.text((4, 2), "GEOMETRY MISMATCH - UNSCORED, NATIVE-SIZE IMAGES", fill="black")
            draw.text((4, 24), f"LIVE {source.width}x{source.height}", fill="black")
            draw.text((source.width + 4, 24), f"AEM {target.width}x{target.height}", fill="black")
            path = directory / f"{uuid.uuid4().hex}.png"
            preview.save(path)
            row["side_by_side"] = str(path)

    @staticmethod
    def _valid_ratio(value: Any) -> bool:
        return type(value) in (int, float) and math.isfinite(value) and 0 <= value <= 1

    def _validate_score(self, row: Mapping[str, Any], *, whole_page: bool = False) -> None:
        if row.get("screenshot_validation") != "PASS":
            raise EnvelopeError("Screenshot validation did not pass.")
        expected_url = self.context.author_url if row["mode"] == "author" else self.context.disabled_url
        if row.get("live_url") != self.context.contract.site_url or row.get("aem_url") != expected_url:
            raise EnvelopeError("Score URLs do not match this run.")
        dpr = row.get("dpr")
        if type(dpr) not in (int, float) or not math.isfinite(dpr) or dpr <= 0:
            raise EnvelopeError("Invalid screenshot DPR.")
        sizes = []
        paths = []
        for name in ("source_image", "target_image"):
            path = self.context.evidence_file(row.get(name))
            paths.append(path)
            if self.capture_started_ns is not None and (
                self.capture_dir is None or not path.is_relative_to(self.capture_dir.resolve())
                or path.stat().st_mtime_ns < self.capture_started_ns
            ):
                raise EnvelopeError("A new capture in this invocation's capture directory is required.")
            try:
                with Image.open(path) as image:
                    if image.format != "PNG":
                        raise EnvelopeError(f"Evidence is not a PNG image: {path}")
                    image.verify()
                with Image.open(path) as image:
                    image.load()
                    sizes.append(image.size)
                    if name in ("source_image", "target_image") and all(
                        low == high for low, high in image.convert("RGB").getextrema()
                    ):
                        raise EnvelopeError(f"Uniform screenshot crop: {path}")
            except (OSError, ValueError, SyntaxError, Image.DecompressionBombError) as error:
                raise EnvelopeError(f"Invalid PNG evidence {path}: {error}") from error
        if paths[0] == paths[1]:
            raise EnvelopeError("Source and target must be separate capture files.")
        if sizes[0] != sizes[1]:
            raise CaptureGeometryError("Source and target dimensions disagree; resizing is not permitted.")
        if whole_page and sizes[0][0] != round(row["breakpoint"] * dpr):
            raise EnvelopeError("Page composite width does not match the declared viewport and DPR.")
