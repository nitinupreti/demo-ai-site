"""Thread-safe, atomically persisted run state."""

from __future__ import annotations

import copy
import json
import os
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Mapping

SCHEMA_VERSION = 2


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


class RunState:
    """``run-state.json`` — the single source of truth for the orchestrator."""

    def __init__(self, path: Path, initial: Mapping[str, Any]) -> None:
        self.path = path
        self._lock = threading.RLock()
        self._data: dict[str, Any] = dict(initial)
        self.flush()

    @classmethod
    def create(
        cls,
        path: Path,
        *,
        run_id: str,
        contract: Mapping[str, Any],
        inputs: Mapping[str, Any],
        phases: list[Mapping[str, Any]],
        orchestrator: Mapping[str, Any],
    ) -> "RunState":
        path.parent.mkdir(parents=True, exist_ok=True)
        return cls(
            path,
            {
                "schema_version": SCHEMA_VERSION,
                "run_id": run_id,
                "status": "INITIALIZED",
                "created_at": utc_now(),
                "updated_at": utc_now(),
                "current_phase": None,
                "orchestrator": dict(orchestrator),
                "contract": dict(contract),
                "inputs": dict(inputs),
                "phases": [
                    {
                        "id": phase["id"],
                        "agent": phase.get("agent") or phase.get("handler"),
                        "status": "PENDING",
                    }
                    for phase in phases
                ],
                "components": [],
                "agent_results": {},
                "remediation_history": [],
                "target_url": None,
            },
        )

    @classmethod
    def load(cls, path: Path) -> "RunState":
        data = json.loads(path.read_text(encoding="utf-8"))
        return cls(path, data)

    @property
    def data(self) -> dict[str, Any]:
        with self._lock:
            return copy.deepcopy(self._data)

    def get(self, key: str, default: Any = None) -> Any:
        with self._lock:
            return copy.deepcopy(self._data.get(key, default))

    def update(self, **fields: Any) -> None:
        with self._lock:
            self._data.update(fields)
            self._data["updated_at"] = utc_now()
            self._write_locked()

    def set_phase(self, phase_id: str, status: str, **extra: Any) -> None:
        with self._lock:
            for phase in self._data.get("phases", []):
                if phase.get("id") == phase_id:
                    phase["status"] = status
                    phase["updated_at"] = utc_now()
                    phase.update(extra)
                    break
            else:
                self._data.setdefault("phases", []).append(
                    {"id": phase_id, "status": status, "updated_at": utc_now(), **extra}
                )
            self._data["current_phase"] = phase_id
            self._data["updated_at"] = utc_now()
            self._write_locked()

    def record_agent_result(self, key: str, result: Mapping[str, Any]) -> None:
        with self._lock:
            self._data.setdefault("agent_results", {})[key] = dict(result)
            self._data["updated_at"] = utc_now()
            self._write_locked()

    def set_components(self, components: list[Mapping[str, Any]]) -> None:
        with self._lock:
            self._data["components"] = [
                {
                    "id": component.get("id"),
                    "name": component.get("name"),
                    "tier": component.get("tier"),
                    "resource_type": component.get("resource_type"),
                    "status": "PLANNED",
                    "attempts": 0,
                    "plan": dict(component),
                }
                for component in components
            ]
            self._data["updated_at"] = utc_now()
            self._write_locked()

    def component_rows(self) -> list[dict[str, Any]]:
        with self._lock:
            return copy.deepcopy(self._data.get("components", []))

    def update_component(self, component_id: str, **fields: Any) -> None:
        with self._lock:
            for row in self._data.get("components", []):
                if row.get("id") == component_id:
                    row.update(fields)
                    row["updated_at"] = utc_now()
                    break
            self._data["updated_at"] = utc_now()
            self._write_locked()

    def append_remediation(self, entry: Mapping[str, Any]) -> None:
        with self._lock:
            self._data.setdefault("remediation_history", []).append(
                {"at": utc_now(), **dict(entry)}
            )
            self._data["updated_at"] = utc_now()
            self._write_locked()

    def flush(self) -> None:
        with self._lock:
            self._write_locked()

    def _write_locked(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.path.with_suffix(self.path.suffix + ".tmp")
        temporary.write_text(
            json.dumps(self._data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
        )
        os.replace(temporary, self.path)
