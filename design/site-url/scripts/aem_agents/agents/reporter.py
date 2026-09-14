"""Reporter agent: writes the truthful completion report from persisted state."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .base import Agent


class ReporterAgent(Agent):
    """Reads only persisted artifacts; it never re-runs the migration."""

    agent_id = "reporter"

    def slug(self, **_: Any) -> str:
        return "reporter"

    @property
    def report_path(self) -> Path:
        name = str(self.context.settings.migration.get("run.report_file", "completion-report.md"))
        return self.context.evidence_dir / name

    def prompt_values(self, pipeline_status: str = "UNKNOWN", **_: Any) -> dict[str, Any]:
        state = self.context.state.data
        envelopes = {
            key: {
                "agent": value.get("agent"),
                "status": value.get("status"),
                "result_path": value.get("result_path"),
                "outputs": value.get("outputs", {}),
                "failures": value.get("failures", []),
            }
            for key, value in (state.get("agent_results") or {}).items()
        }
        values = super().prompt_values()
        values.update(
            {
                "pipeline_status": pipeline_status,
                "state_path": self.context.rel(self.context.state.path),
                "report_path": self.context.rel(self.report_path),
                "envelopes_json": json.dumps(envelopes, indent=2, ensure_ascii=False, default=str),
            }
        )
        return values
