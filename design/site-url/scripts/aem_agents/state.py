"""Thread-safe, atomically persisted run state."""

from __future__ import annotations

import copy
import json
import os
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Mapping

SCHEMA_VERSION = 3


class StateError(OSError):
    """Run state cannot be safely created, loaded, or persisted."""


class RunLock:
    def __init__(self, path: Path) -> None:
        self.path = path
        self.handle = None

    def __enter__(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.handle = self.path.open("a+b")
        if not self.path.stat().st_size:
            self.handle.write(b"0")
            self.handle.flush()
        self.handle.seek(0)
        try:
            if os.name == "nt":
                import msvcrt
                msvcrt.locking(self.handle.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(self.handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as error:
            self.handle.close()
            raise StateError("Another migration is already running in this workspace.") from error
        return self

    def __exit__(self, *args):
        self.handle.close()


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


class RunState:
    """``run-state.json`` — the single source of truth for the orchestrator."""

    def __init__(self, path: Path, initial: Mapping[str, Any]) -> None:
        self.path = path
        self._lock = threading.RLock()
        self._data: dict[str, Any] = dict(initial)

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
        state = cls(
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
        try:
            with path.open("x", encoding="utf-8") as stream:
                json.dump(state._data, stream, indent=2, ensure_ascii=False)
        except FileExistsError as error:
            raise StateError(f"Run state already exists: {path}. Use --resume or a new run id.") from error
        return state

    @classmethod
    def load(cls, path: Path) -> "RunState":
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError) as error:
            raise StateError(f"Could not load run state: {path}") from error
        if not isinstance(data, dict) or data.get("schema_version") != SCHEMA_VERSION or not data.get("run_id"):
            raise StateError(f"Invalid or unsupported run state: {path}. Start a new run with the current pipeline.")
        for key, expected in (("contract", dict), ("inputs", dict), ("orchestrator", dict),
                              ("agent_results", dict), ("components", list), ("phases", list),
                              ("remediation_history", list)):
            if not isinstance(data.get(key), expected):
                raise StateError(f"Invalid {key} in run state: {path}")
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
        # os.replace can hit WinError 5 when an indexer or scanner briefly holds the
        # destination; losing run state to a transient lock is not acceptable.
        last_error: OSError | None = None
        for delay in (0, 0.05, 0.15, 0.4, 1.0):
            if delay:
                time.sleep(delay)
            try:
                os.replace(temporary, self.path)
                return
            except PermissionError as error:
                last_error = error
        raise StateError(f"Could not atomically update {self.path}; the previous checkpoint is preserved.") from last_error
