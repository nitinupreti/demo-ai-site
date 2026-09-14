"""Parity agent: scores the deployed page and enforces the contract threshold."""

from __future__ import annotations

import json
import math
import struct
from typing import Any, Iterable, Mapping

from ..envelope import AgentResult, EnvelopeError
from .base import Agent


class ParityAgent(Agent):
    """Runs the visual comparison, then has its verdict re-checked in Python.

    The threshold comes from the prompt contract, so the agent cannot relax it by
    reporting an optimistic status: every reported ratio is re-evaluated here.
    """

    agent_id = "parity"

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
            if not isinstance(entry, Mapping) or entry.get("component_id") not in planned:
                raise EnvelopeError("Parity reported an unknown failing component.")
            failing[str(entry["component_id"])] = dict(entry)

        def fail(component_id: str, reason: str) -> None:
            entry = failing.setdefault(component_id, {
                "component_id": component_id, "owning_layer": "evidence",
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

        for row in scores:
            if not isinstance(row, dict) or row.get("component_id") not in planned:
                raise EnvelopeError("Parity score has no known component_id.")
            component_id = row["component_id"]
            key = (component_id, row.get("breakpoint"), row.get("mode"))
            instance_id = row.get("instance_id")
            if key not in groups or not isinstance(instance_id, str) or not instance_id:
                fail(component_id, "Unexpected breakpoint, mode, or missing instance_id.")
                continue
            if instance_id in groups[key]:
                fail(component_id, f"Duplicate score for {key}/{instance_id}.")
            groups[key].add(instance_id)
            try:
                ratio = self._validate_score(row)
                row["ratio"] = ratio
                if not threshold.passes(ratio) or row.get("status") != "PASS":
                    fail(component_id, f"Instance {instance_id} at {key[1:]} did not pass {threshold}.")
            except EnvelopeError as error:
                row["screenshot_validation"] = "FAIL"
                row["ratio"] = None
                fail(component_id, str(error))

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
        if not isinstance(page_rows, list):
            page_rows = []
        for row in page_rows:
            if not isinstance(row, Mapping):
                continue
            key = (row.get("breakpoint"), row.get("mode"))
            ratio = row.get("ratio")
            if key not in page_keys or key in seen_pages or not self._valid_ratio(ratio) or not threshold.passes(ratio):
                for component_id in planned:
                    fail(component_id, "Invalid or failing page composite.")
            seen_pages.add(key)
        if seen_pages != page_keys:
            for component_id in planned:
                fail(component_id, "Missing page composite coverage.")

        result.outputs["failing_components"] = list(failing.values())
        result.outputs["threshold"] = str(threshold)
        result.outputs["scores_withheld"] = sum(row.get("screenshot_validation") != "PASS" for row in scores)
        if failing:
            result.status = "FAIL"

    @staticmethod
    def _valid_ratio(value: Any) -> bool:
        return type(value) in (int, float) and math.isfinite(value) and 0 <= value <= 1

    def _validate_score(self, row: Mapping[str, Any]) -> float:
        if row.get("screenshot_validation") != "PASS":
            raise EnvelopeError("Screenshot validation did not pass.")
        matched = row.get("matched_pixels")
        total = row.get("total_pixels")
        if type(matched) is not int or type(total) is not int or not 0 <= matched <= total or total <= 0:
            raise EnvelopeError("Invalid matched_pixels or total_pixels.")
        ratio = matched / total
        if not self._valid_ratio(row.get("ratio")) or not math.isclose(row["ratio"], ratio, abs_tol=1e-12):
            raise EnvelopeError("Reported ratio disagrees with pixel counts.")
        expected_url = self.context.author_url if row["mode"] == "author" else self.context.disabled_url
        if row.get("live_url") != self.context.contract.site_url or row.get("aem_url") != expected_url:
            raise EnvelopeError("Score URLs do not match this run.")
        dpr = row.get("dpr")
        if type(dpr) not in (int, float) or not math.isfinite(dpr) or dpr <= 0:
            raise EnvelopeError("Invalid screenshot DPR.")
        sizes = []
        for name in ("source_image", "target_image", "side_by_side", "diff_mask"):
            path = self.context.evidence_file(row.get(name))
            with path.open("rb") as image:
                header = image.read(24)
            if len(header) < 24 or header[:8] != b"\x89PNG\r\n\x1a\n" or header[12:16] != b"IHDR":
                raise EnvelopeError(f"Evidence is not a PNG image: {path}")
            size = struct.unpack(">II", header[16:24])
            if not all(size):
                raise EnvelopeError(f"Empty image dimensions: {path}")
            sizes.append(size)
        if sizes[0] != sizes[1] or sizes[0] != sizes[3] or sizes[0][0] * sizes[0][1] != total:
            raise EnvelopeError("Crop/diff dimensions or pixel totals disagree.")
        return ratio
