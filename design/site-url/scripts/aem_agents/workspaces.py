"""Isolated source snapshots and coordinator-owned application of worker changes."""

from __future__ import annotations

import hashlib
import os
import shutil
import tempfile
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Any, Iterable, Mapping

from .config import Settings
from .envelope import EnvelopeError

_GENERATED = {".git", ".venv", "venv", ".tools", "node_modules", "__pycache__", "target", "dist", "node", ".pytest_cache", ".mypy_cache", ".idea", ".vscode"}
_EXCLUDED = ("design/scratch", ".copilot", ".claude/projects")


class WorkspaceError(EnvelopeError):
    """A worker's changes cannot be safely applied."""


def relative_path(value: str) -> str:
    if not isinstance(value, str) or not value or "\\" in value or ":" in value:
        raise WorkspaceError(f"Expected a repository-relative POSIX path: {value!r}")
    path = PurePosixPath(value)
    if path.is_absolute() or any(part in ("", ".", "..") for part in value.split("/")):
        raise WorkspaceError(f"Unsafe repository path: {value!r}")
    return path.as_posix()


def digest(path: Path) -> str | None:
    if path.is_symlink():
        raise WorkspaceError(f"Symbolic links are not supported in worker sources: {path}")
    if not path.exists():
        return None
    if not path.is_file():
        raise WorkspaceError(f"Expected a regular file: {path}")
    checksum = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            checksum.update(block)
    return checksum.hexdigest()


def source_manifest(root: Path, *, excluded: Iterable[Path] = ()) -> dict[str, str]:
    excluded = tuple(path.resolve() for path in excluded)
    manifest = {}
    for directory, directories, filenames in os.walk(root, followlinks=False):
        parent = Path(directory)
        directories[:] = sorted(
            name for name in directories
            if name not in _GENERATED
            and (parent / name).relative_to(root).as_posix() not in _EXCLUDED
            and not (parent / name).is_symlink()
            and not any((parent / name).resolve().is_relative_to(path) for path in excluded)
        )
        for name in sorted(filenames):
            if name.startswith(".env") or name.endswith((".pyc", ".log", ".tmp")):
                continue
            path = parent / name
            checksum = digest(path)
            if checksum is not None:
                manifest[path.relative_to(root).as_posix()] = checksum
    return manifest


def normalize_scope(value: str) -> str:
    subtree = value.endswith("/**") if isinstance(value, str) else False
    path = relative_path(value[:-3] if subtree else value)
    if any(character in path for character in "*?["):
        raise WorkspaceError("Ownership accepts exact files or directory/**, not arbitrary globs.")
    return path + "/**" if subtree else path


def owns(path: str, scope: str) -> bool:
    path = path.casefold()
    scope = scope.casefold()
    return path.startswith(scope[:-2]) if scope.endswith("/**") else path == scope


def scopes_overlap(first: str, second: str) -> bool:
    first_root = first[:-3] if first.endswith("/**") else first
    second_root = second[:-3] if second.endswith("/**") else second
    return first_root.casefold() == second_root.casefold() or owns(first_root, second) or owns(second_root, first)


def component_scopes(settings: Settings, component: Mapping[str, Any]) -> list[str]:
    project = str(settings.migration.require("project.name"))
    component_id = str(component["id"])
    default = f"ui.apps/src/main/content/jcr_root/apps/{project}/components/{component_id}/**"
    declared = component.get("owned_paths", [])
    if not isinstance(declared, list) or any(not isinstance(path, str) for path in declared):
        raise WorkspaceError(f"{component_id}: owned_paths must be a list of paths.")
    scopes = sorted({normalize_scope(path) for path in [default, *declared]})
    allowed_roots = (
        f"ui.apps/src/main/content/jcr_root/apps/{project}/components/",
        "core/src/main/java/", "core/src/test/java/",
        "ui.frontend/src/main/webpack/components/",
    )
    shared = foundation_scopes(settings)
    for scope in scopes:
        if not scope.startswith(allowed_roots) or any(scopes_overlap(scope, protected) for protected in shared):
            raise WorkspaceError(f"{component_id}: {scope} is shared or outside component source paths.")
        if scope.startswith("core/") and (scope.endswith("/**") or not scope.endswith(".java")):
            raise WorkspaceError(f"{component_id}: Java ownership must name individual .java files.")
    return scopes


def foundation_scopes(settings: Settings) -> list[str]:
    configured = settings.migration.get("isolation.foundation_paths", [
        str(settings.migration.require("css.token_layer.clientlib")) + "/**",
        str(settings.migration.require("css.token_layer.scss_source")),
    ])
    return [normalize_scope(path) for path in configured]


def validate_ownership(settings: Settings, components: Iterable[Mapping[str, Any]]) -> None:
    assigned: list[tuple[str, str]] = []
    for component in components:
        owner = str(component["id"])
        for scope in component_scopes(settings, component):
            for previous_owner, previous_scope in assigned:
                if previous_owner != owner and scopes_overlap(scope, previous_scope):
                    raise WorkspaceError(f"Conflicting ownership: {owner} and {previous_owner} both own {scope}.")
            assigned.append((owner, scope))


@dataclass
class ChangeSet:
    root: Path
    baseline: dict[str, str]
    changed: dict[str, str | None]


@dataclass
class WorkerWorkspace:
    root: Path
    baseline: dict[str, str]
    scopes: list[str]

    @classmethod
    def create(cls, source: Path, directory: Path, scopes: list[str], *, evidence_dir: Path | None = None) -> "WorkerWorkspace":
        directory.mkdir(parents=True, exist_ok=True)
        root = Path(tempfile.mkdtemp(prefix="checkout-", dir=directory))
        baseline = source_manifest(source, excluded=[evidence_dir or directory])
        for name, checksum in baseline.items():
            destination = root / name
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source / name, destination)
            if digest(destination) != checksum:
                raise WorkspaceError(f"Source changed during snapshot: {name}")
        return cls(root, baseline, [normalize_scope(scope) for scope in scopes])

    def collect(self) -> ChangeSet:
        current = source_manifest(self.root)
        changed = {
            name: current.get(name) for name in sorted(self.baseline.keys() | current.keys())
            if self.baseline.get(name) != current.get(name)
        }
        violations = [name for name in changed if not any(owns(name, scope) for scope in self.scopes)]
        if violations:
            raise WorkspaceError("Worker changed unowned files: " + ", ".join(violations))
        return ChangeSet(self.root, self.baseline, changed)


def apply_changes(destination: Path, changes: Iterable[ChangeSet]) -> list[str]:
    prepared: dict[str, tuple[ChangeSet, str | None]] = {}
    identities: set[str] = set()
    for change in changes:
        for name, checksum in change.changed.items():
            name = relative_path(name)
            if name.casefold() in identities:
                raise WorkspaceError(f"More than one worker changed {name}.")
            identities.add(name.casefold())
            target = destination / name
            if not target.resolve().is_relative_to(destination.resolve()):
                raise WorkspaceError(f"Destination escapes the checkout: {name}")
            if digest(target) != change.baseline.get(name):
                raise WorkspaceError(f"Checkout changed while worker was running: {name}")
            if digest(change.root / name) != checksum:
                raise WorkspaceError(f"Worker output changed after validation: {name}")
            prepared[name] = (change, checksum)
    for name, (change, checksum) in prepared.items():
        target = destination / name
        if checksum is None:
            target.unlink()
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            descriptor, temporary = tempfile.mkstemp(prefix=".worker-", dir=target.parent)
            os.close(descriptor)
            try:
                shutil.copy2(change.root / name, temporary)
                os.replace(temporary, target)
            finally:
                Path(temporary).unlink(missing_ok=True)
    return sorted(prepared)