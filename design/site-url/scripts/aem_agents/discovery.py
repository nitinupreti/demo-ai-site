"""Run trusted source discovery once and prepare compact planner inputs."""

from __future__ import annotations

import hashlib
import json
import math
import os
from pathlib import Path
import shutil
import signal
import subprocess
import time
import uuid
from dataclasses import dataclass
from typing import Any, TYPE_CHECKING
from xml.etree import ElementTree

from .browser import browser_paths
from .config import ConfigError, Settings
from .console import emit
from .envelope import EnvelopeError
from .workspaces import digest, relative_path

if TYPE_CHECKING:
    from .agents.base import RunContext

SIGNALS = {"landmarks", "headings", "class_family", "vertical_bands", "interaction_media", "overlays",
           "repetition", "missable", "scroll_triggered", "dynamic_injection", "third_party_embeds"}
REQUIRED_FILES = {"initial.json", "final.json", "observations.json", "media.json", "tokens.json", "bands.json",
                  "signals.json", "stability.json", "summary.json", "network.json", "interactions.json", "header-links.json", "source.png"}


@dataclass(frozen=True)
class DiscoveryEvidence:
    manifest: Path
    summary: Path
    inventory: Path
    artifacts: tuple[Path, ...]
    elapsed_seconds: float
    inventory_cached: bool


def _json_digest(value: Any) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True).encode("utf-8")).hexdigest()


def repository_inventory(settings: Settings, target: Path) -> bool:
    roots = settings.migration.get("reuse.survey_roots", {})
    files: dict[str, str] = {}
    root_rows = []
    for kind, value in roots.items():
        root = settings.resolve(str(value))
        names = []
        if root.is_dir():
            for file in sorted(root.rglob("*")):
                if file.is_file() and file.suffix in {".xml", ".html", ".js", ".css", ".scss", ".json"}:
                    name = settings.relative_to_repo(file)
                    files[name] = digest(file)
                    names.append(name)
        root_rows.append({"kind": kind, "path": str(value), "exists": root.is_dir(), "files": names})
    fingerprint = _json_digest({"version": 1, "roots": root_rows, "files": files})
    cache_root = settings.resolve(str(settings.migration.get("discovery.inventory_cache_dir", "design/site-url/scripts/.tools/inventory")))
    cache = cache_root / f"{fingerprint}.json"
    payload = None
    if cache.is_file():
        try:
            cached = json.loads(cache.read_text(encoding="utf-8"))
            if cached.get("fingerprint") == fingerprint and cached.get("payload_sha256") == _json_digest(cached.get("payload")):
                payload = cached["payload"]
        except (OSError, ValueError, AttributeError):
            pass
    reused = payload is not None
    if payload is None:
        definitions = []
        for name in files:
            if not name.endswith(".xml"):
                continue
            try:
                tree = ElementTree.parse(settings.resolve(name))
                attributes = lambda node: {key.rsplit("}", 1)[-1]: value for key, value in node.attrib.items()}
                fields = [attributes(node) for node in tree.iter() if "name" in node.attrib or any(key.endswith("}resourceType") for key in node.attrib)]
                definitions.append({"path": name, "attributes": attributes(tree.getroot()), "fields": fields})
            except (ElementTree.ParseError, OSError) as error:
                raise EnvelopeError(f"Cannot build reuse inventory from {name}: {error}") from error
        payload = {"schema_version": 1, "fingerprint": fingerprint, "roots": root_rows, "definitions": definitions}
        cache_root.mkdir(parents=True, exist_ok=True)
        temporary = cache_root / f"{fingerprint}-{uuid.uuid4().hex}.tmp"
        try:
            temporary.write_text(json.dumps({"fingerprint": fingerprint, "payload_sha256": _json_digest(payload), "payload": payload}), encoding="utf-8")
            os.replace(temporary, cache)
        finally:
            temporary.unlink(missing_ok=True)
    target.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return reused


def validate_collection(manifest_path: Path, run_id: str, site_url: str, breakpoints: list[int], collector_sha256: str) -> tuple[dict[str, Any], tuple[Path, ...]]:
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        if manifest.get("schema_version") != 1 or manifest.get("run_id") != run_id or manifest.get("site_url") != site_url or manifest.get("breakpoints") != breakpoints:
            raise ValueError("Discovery manifest identity does not match this run")
        if manifest.get("collector_sha256") != collector_sha256:
            raise ValueError("Discovery collector revision changed")
        if manifest.get("header_navigation_scope") != "visible-links-only":
            raise ValueError("Discovery header navigation scope does not match this run")
        if manifest.get("status") != "COLLECTED":
            failures = [{"breakpoint": row.get("breakpoint"), "issues": row.get("issues")} for row in manifest.get("results", []) if row.get("status") != "COLLECTED"]
            raise ValueError(f"Source discovery is incomplete: {failures}")
        results = manifest.get("results")
        if not isinstance(results, list) or len(results) != len(breakpoints) or {row["breakpoint"] for row in results} != set(breakpoints):
            raise ValueError("Discovery omitted or duplicated a breakpoint")
        for row in results:
            if row.get("status") != "COLLECTED" or any(issue.get("gate") != "source_javascript" for issue in row.get("issues", [])):
                raise ValueError("Discovery has unresolved readiness issues")
        artifacts = {}
        root = manifest_path.parent.resolve()
        for entry in manifest["artifacts"]:
            name = relative_path(entry["path"])
            artifact = (root / name).resolve()
            if name in artifacts or not artifact.is_relative_to(root) or not artifact.is_file() or digest(artifact) != entry["sha256"] or artifact.stat().st_size != entry["bytes"]:
                raise ValueError(f"Missing, changed or invalid discovery artifact: {name}")
            artifacts[name] = artifact
        for width in breakpoints:
            missing = {f"{width}/{name}" for name in REQUIRED_FILES} - artifacts.keys()
            if missing:
                raise ValueError(f"Discovery artifacts missing: {sorted(missing)}")
            header = json.loads(artifacts[f"{width}/header-links.json"].read_text(encoding="utf-8"))
            if header.get("scope") != "visible-links-only" or header.get("breakpoint") != width or not isinstance(header.get("links"), list):
                raise ValueError(f"Invalid visible-header link evidence at {width}")
            signals = json.loads(artifacts[f"{width}/signals.json"].read_text(encoding="utf-8"))
            if len(signals.get("executed", [])) != len(SIGNALS) or set(signals["executed"]) != SIGNALS or set(signals.get("signals", {})) != SIGNALS:
                raise ValueError(f"Not all discovery signals were executed at {width}")
            final = json.loads(artifacts[f"{width}/final.json"].read_text(encoding="utf-8"))
            if final.get("viewport", {}).get("width") != width or final["viewport"].get("dpr") != 1 or final["viewport"].get("scale") != 1:
                raise ValueError(f"Invalid discovery viewport at {width}")
        return manifest, tuple(artifacts.values())
    except (OSError, TypeError, KeyError, ValueError, AttributeError) as error:
        raise EnvelopeError(f"{error}. Discovery evidence: {manifest_path}") from error


def _stop_collector(process: subprocess.Popen) -> None:
    if process.poll() is not None:
        return
    if os.name == "nt":
        subprocess.run([str(Path(os.environ.get("SystemRoot", "C:/Windows")) / "System32/taskkill.exe"), "/PID", str(process.pid), "/T", "/F"],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=10, check=False)
    else:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=5)


def collect_discovery(context: "RunContext") -> DiscoveryEvidence:
    started = time.monotonic()
    settings = context.settings
    browser = context.browser or browser_paths(settings)
    collector = browser.tools_dir / "discover.mjs"
    node = shutil.which("node")
    if not node or not collector.is_file():
        raise EnvelopeError(f"The shared discovery collector is unavailable: {collector}")
    root = context.evidence_dir / "discovery" / f"collection-{uuid.uuid4().hex}"
    root.mkdir(parents=True)
    source = root / "source"
    page_timeout = settings.migration.get("discovery.page_timeout_seconds", None)
    if page_timeout is not None and (type(page_timeout) is not int or page_timeout < 0):
        raise ConfigError("discovery.page_timeout_seconds must be null, zero, or a positive integer.")
    settings_values = {
        "max_parallel": settings.migration.get("discovery.max_parallel", 2),
        "page_timeout_ms": page_timeout * 1000 if page_timeout else None,
        "navigation_timeout_ms": settings.migration.get("discovery.navigation_timeout_seconds", 30) * 1000,
        "readiness_timeout_ms": settings.migration.get("discovery.readiness_timeout_seconds", 15) * 1000,
        "stability_samples": settings.migration.get("parity.stability_samples", 3),
        "stability_interval_ms": settings.migration.get("parity.stability_interval_ms", 500),
    }
    if any(type(value) is not int or value <= 0 for key, value in settings_values.items() if key != "page_timeout_ms") or settings_values["max_parallel"] > 3:
        raise ConfigError("Discovery limits must be positive integers with max_parallel at most 3.")
    config = {"schema_version": 1, "run_id": context.run_id, "site_url": context.contract.site_url,
              "breakpoints": context.contract.breakpoints, "output_dir": str(source.resolve()), **settings_values}
    config_path = root / "input.json"
    config_path.write_text(json.dumps(config, indent=2), encoding="utf-8")
    inventory = root / "inventory.json"
    reused = repository_inventory(settings, inventory)
    revision = digest(collector)
    timeout = math.ceil(len(context.contract.breakpoints) / settings_values["max_parallel"]) * page_timeout + 30 if page_timeout else None
    emit(f"  source discovery: {len(context.contract.breakpoints)} breakpoints, {settings_values['max_parallel']} concurrent; inventory {'cached' if reused else 'refreshed'}", "cyan")
    emit(f"  discovery deadline: {str(page_timeout) + 's per breakpoint' if page_timeout else 'disabled; Ctrl+C to stop'}", "dim")
    process = None
    try:
        process = subprocess.Popen(
            [node, str(collector), str(config_path)], cwd=settings.repo_root,
            env={**os.environ, **browser.environment()}, shell=False,
            start_new_session=os.name != "nt",
            creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0,
        )
        exit_code = process.wait(timeout=timeout)
    except (OSError, subprocess.SubprocessError) as error:
        limit = f" or exceeded {timeout:.0f}s" if timeout is not None else ""
        raise EnvelopeError(f"Source collector failed{limit}: {error}. Evidence: {root}") from error
    finally:
        if process is not None:
            _stop_collector(process)
    manifest_path = source / "manifest.json"
    if not manifest_path.is_file():
        raise EnvelopeError(f"Source collector exited {exit_code} without a manifest. See {root}")
    manifest, artifacts = validate_collection(manifest_path, context.run_id, context.contract.site_url, context.contract.breakpoints, revision)
    if exit_code or digest(collector) != revision:
        raise EnvelopeError(f"Collector process or revision was invalid. See {manifest_path}")
    summary = root / "summary.json"
    pages = [json.loads((source / str(width) / "summary.json").read_text(encoding="utf-8")) for width in context.contract.breakpoints]
    summary.write_text(json.dumps({"run_id": context.run_id, "site_url": context.contract.site_url,
                                   "collection_seconds": manifest["elapsed_ms"] / 1000,
                                   "pages": pages, "inventory": str(inventory), "manifest": str(manifest_path)}, indent=2), encoding="utf-8")
    elapsed = time.monotonic() - started
    emit(f"  source collection complete in {elapsed:.1f}s; planner will use {summary}", "green")
    return DiscoveryEvidence(manifest_path, summary, inventory, (*artifacts, config_path), elapsed, reused)