"""Parity agent: scores the deployed page and enforces the contract threshold."""

from __future__ import annotations

import json
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

    def run(self, **kwargs: Any) -> AgentResult:
        result = super().run(**kwargs)
        if not self.context.dry_run:
            self.enforce_threshold(result)
        return result

    def enforce_threshold(self, result: AgentResult) -> None:
        """Recompute pass/fail from the raw ratios instead of trusting the status."""
        threshold = self.context.contract.visual_pass_ratio
        scores = result.output("scores") or []
        if not isinstance(scores, list):
            raise EnvelopeError("Parity agent 'outputs.scores' must be a list.")

        below: dict[str, dict[str, Any]] = {}
        withheld = 0
        for row in scores:
            if not isinstance(row, Mapping):
                continue
            if str(row.get("screenshot_validation", "PASS")).upper() != "PASS":
                withheld += 1
                continue
            ratio = self._ratio(row)
            if ratio is None:
                withheld += 1
                continue
            if threshold.passes(ratio):
                continue
            component_id = str(row.get("component_id", "unknown"))
            entry = below.setdefault(
                component_id,
                {"component_id": component_id, "worst_ratio": ratio, "breakpoints": [], "rows": []},
            )
            entry["worst_ratio"] = min(entry["worst_ratio"], ratio)
            breakpoint = row.get("breakpoint")
            if breakpoint is not None and breakpoint not in entry["breakpoints"]:
                entry["breakpoints"].append(breakpoint)
            entry["rows"].append(dict(row))

        if withheld:
            self.context.logger.warning("%d parity score row(s) had withheld evidence.", withheld)

        reported = {
            str(item.get("component_id"))
            for item in (result.output("failing_components") or [])
            if isinstance(item, Mapping)
        }

        if below and result.passed:
            raise EnvelopeError(
                "The parity agent reported PASS but "
                f"{len(below)} component(s) are below the contract threshold "
                f"({threshold}): {', '.join(sorted(below))}. Refusing the verdict."
            )

        # Union the agent's own failure list with anything the recheck caught.
        failing = list(result.output("failing_components") or [])
        known = {str(item.get("component_id")) for item in failing if isinstance(item, Mapping)}
        for component_id, entry in below.items():
            if component_id not in known:
                failing.append(
                    {
                        "component_id": component_id,
                        "worst_ratio": entry["worst_ratio"],
                        "breakpoints": entry["breakpoints"],
                        "owning_layer": "unknown",
                        "hypothesis": "Detected by orchestrator threshold recheck.",
                        "diagnostic": {"rows": entry["rows"][:3]},
                    }
                )
        result.outputs["failing_components"] = failing
        result.outputs["threshold"] = str(threshold)
        result.outputs["scores_withheld"] = withheld
        if failing and result.status == "PASS":
            result.status = "FAIL"
        self.context.logger.info(
            "Parity attempt evaluated: %d score row(s), %d failing component(s), %d withheld. "
            "Agent reported %d failing.",
            len(scores),
            len(failing),
            withheld,
            len(reported),
        )

    @staticmethod
    def _ratio(row: Mapping[str, Any]) -> float | None:
        ratio = row.get("ratio")
        if isinstance(ratio, (int, float)):
            value = float(ratio)
            return value / 100.0 if value > 1 else value
        matched = row.get("matched_pixels")
        total = row.get("total_pixels")
        if isinstance(matched, (int, float)) and isinstance(total, (int, float)) and total:
            return float(matched) / float(total)
        return None
