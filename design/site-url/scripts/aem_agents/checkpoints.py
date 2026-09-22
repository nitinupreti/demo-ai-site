"""Fingerprint reusable inputs without treating historical runtime success as current."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any, Iterable, Mapping

from .config import ConfigError, Settings
from .contract import RunContract
from .workspaces import digest, relative_path, source_manifest


def configuration_fingerprint(settings: Settings, contract: RunContract | Mapping[str, Any]) -> str:
    saved = contract.as_dict() if isinstance(contract, RunContract) else dict(contract)
    value = {"migration": settings.migration.data, "agents": settings._agents_config.data, "contract": saved}
    return hashlib.sha256(json.dumps(value, sort_keys=True, default=str).encode("utf-8")).hexdigest()


def evidence_paths(value: Any, settings: Settings, evidence_dir: Path) -> set[Path]:
    paths: set[Path] = set()
    if isinstance(value, Mapping):
        for child in value.values():
            paths.update(evidence_paths(child, settings, evidence_dir))
    elif isinstance(value, list):
        for child in value:
            paths.update(evidence_paths(child, settings, evidence_dir))
    elif isinstance(value, str) and len(value) < 4096 and "\n" not in value and not value.startswith(("http://", "https://")):
        try:
            path = settings.resolve(value).resolve()
            if path.is_relative_to(evidence_dir.resolve()) and path.is_file():
                paths.add(path)
        except (OSError, ValueError):
            pass
    return paths


def validate_artifacts(checkpoint: Mapping[str, Any], evidence_dir: Path) -> None:
    for name, expected in checkpoint.get("artifacts", {}).items():
        path = evidence_dir / relative_path(name)
        if not path.resolve().is_relative_to(evidence_dir.resolve()) or digest(path) != expected:
            raise ConfigError(f"Reusable evidence changed or disappeared: {name}. Start a new run.")


def capture_checkpoint(settings: Settings, contract: RunContract, evidence_dir: Path, artifacts: Iterable[Path]) -> dict[str, Any]:
    artifact_hashes = {}
    for path in sorted({path.resolve() for path in artifacts}):
        checksum = digest(path)
        if checksum is None:
            raise ConfigError(f"Reusable evidence disappeared before checkpointing: {path}")
        artifact_hashes[path.relative_to(evidence_dir.resolve()).as_posix()] = checksum
    return {
        "schema_version": 1,
        "configuration": configuration_fingerprint(settings, contract),
        "source_files": source_manifest(settings.repo_root, excluded=[evidence_dir]),
        "artifacts": artifact_hashes,
    }


def validate_checkpoint(checkpoint: Any, settings: Settings, contract: RunContract | Mapping[str, Any], evidence_dir: Path) -> None:
    if not isinstance(checkpoint, Mapping) or checkpoint.get("schema_version") != 1 or not isinstance(checkpoint.get("source_files"), dict) or not isinstance(checkpoint.get("artifacts"), dict):
        raise ConfigError("This run has no compatible fingerprinted checkpoint. Start a new run.")
    if checkpoint.get("configuration") != configuration_fingerprint(settings, contract):
        raise ConfigError("Pipeline configuration changed since the checkpoint. Start a new run.")
    current = source_manifest(settings.repo_root, excluded=[evidence_dir])
    saved = checkpoint["source_files"]
    changed = sorted(name for name in current.keys() | saved.keys() if current.get(name) != saved.get(name))
    if changed:
        raise ConfigError("Source changed since the checkpoint: " + ", ".join(changed[:8]) + ". Start a new run; existing changes are preserved.")
    validate_artifacts(checkpoint, evidence_dir)