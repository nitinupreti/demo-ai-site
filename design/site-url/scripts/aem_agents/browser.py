"""Prepare the pinned shared browser runtime before invoking any agents."""

from __future__ import annotations

import json
import hashlib
import os
import signal
import shutil
import subprocess
from dataclasses import dataclass, replace
from pathlib import Path

from .config import ConfigError, Settings
from .bootstrap import SKIP_ENV
from .console import emit
from .envelope import EnvelopeError
from .state import RunLock


@dataclass(frozen=True)
class BrowserToolchain:
    tools_dir: Path
    browsers_path: Path
    playwright_version: str = ""
    browser_version: str = ""
    chromium_revision: str = ""
    elapsed_ms: int = 0

    @property
    def module_path(self) -> Path:
        return self.tools_dir / "browser.mjs"

    def environment(self) -> dict[str, str]:
        return {
            "PLAYWRIGHT_BROWSERS_PATH": str(self.browsers_path),
            "MIGRATION_BROWSER_MODULE": self.module_path.as_uri(),
        }


def browser_paths(settings: Settings) -> BrowserToolchain:
    configured = os.environ.get("PLAYWRIGHT_BROWSERS_PATH") or str(settings.migration.require("parity.browsers_path"))
    if configured == "0":
        raise ConfigError("PLAYWRIGHT_BROWSERS_PATH must name a persistent shared directory, not 0.")
    return BrowserToolchain(
        settings.resolve(str(settings.migration.require("parity.tools_dir"))).resolve(),
        settings.resolve(Path(configured).expanduser()).resolve(),
    )


def _package_fingerprint(directory: Path) -> tuple[str, dict]:
    try:
        package_bytes = (directory / "package.json").read_bytes()
        lock_bytes = (directory / "package-lock.json").read_bytes()
        package = json.loads(package_bytes)
        lock = json.loads(lock_bytes)
        if package.get("dependencies") != lock["packages"][""]["dependencies"]:
            raise ValueError("package.json and package-lock.json dependencies differ")
        dependencies = lock["packages"]
        for name, entry in dependencies.items():
            if name and (not name.startswith("node_modules/") or ".." in name.split("/") or "\\" in name or ":" in name):
                raise ValueError("Unsafe package path in lockfile")
            if name and not isinstance(entry.get("version"), str):
                raise ValueError("Package lockfile entry is missing its version")
        return hashlib.sha256(package_bytes + b"\0" + lock_bytes).hexdigest(), dependencies
    except (OSError, ValueError, KeyError, TypeError, AttributeError) as error:
        raise EnvelopeError(f"Cannot prepare shared tools from {directory}: {error}") from error


def _packages_match(directory: Path, dependencies: dict) -> bool:
    for name, entry in dependencies.items():
        if not name:
            continue
        installed = directory / name / "package.json"
        if not installed.is_file() and entry.get("optional"):
            continue
        try:
            if json.loads(installed.read_text(encoding="utf-8")).get("version") != entry["version"]:
                return False
        except (OSError, ValueError, AttributeError):
            return False
    return True


def _npm_cli(node: str) -> Path:
    candidates = [Path(node).resolve().parent / "node_modules/npm/bin/npm-cli.js"]
    executable = shutil.which("npm")
    if executable:
        resolved = Path(executable).resolve()
        candidates.extend([resolved, resolved.parent / "node_modules/npm/bin/npm-cli.js"])
    for candidate in candidates:
        if candidate.name == "npm-cli.js" and candidate.is_file():
            return candidate
    raise EnvelopeError("npm's npm-cli.js was not found. Install Node.js 20+ with npm, then rerun the launcher.")


def _run_setup(arguments: list[str], runtime: BrowserToolchain, label: str, timeout: int) -> None:
    process = None
    try:
        process = subprocess.Popen(
            arguments, cwd=runtime.tools_dir, env={**os.environ, **runtime.environment()},
            shell=False, start_new_session=os.name != "nt",
            creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0,
        )
        if process.wait(timeout=timeout) != 0:
            raise EnvelopeError(f"{label} failed. Resolve the installer error above and rerun the launcher; setup was not marked complete.")
    except (OSError, subprocess.SubprocessError) as error:
        raise EnvelopeError(f"{label} failed or exceeded {timeout}s: {error}") from error
    finally:
        if process is not None and process.poll() is None:
            try:
                if os.name == "nt":
                    subprocess.run(
                        [str(Path(os.environ.get("SystemRoot", "C:/Windows")) / "System32/taskkill.exe"), "/PID", str(process.pid), "/T", "/F"],
                        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=10, check=False,
                    )
                else:
                    os.killpg(process.pid, signal.SIGKILL)
            except (OSError, subprocess.SubprocessError):
                process.kill()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)


def _ensure_packages(runtime: BrowserToolchain, node: str) -> None:
    fingerprint, dependencies = _package_fingerprint(runtime.tools_dir)
    stamp = runtime.tools_dir / "node_modules/.migration-package-stamp"
    if stamp.is_file() and stamp.read_text(encoding="utf-8").strip() == fingerprint and _packages_match(runtime.tools_dir, dependencies):
        return
    emit("  Preparing shared Node tools from package-lock.json (first run or dependencies changed).", "cyan")
    _run_setup([node, str(_npm_cli(node)), "ci", "--ignore-scripts", "--engine-strict", "--no-audit", "--no-fund"], runtime, "Shared Node dependency setup", 300)
    if not _packages_match(runtime.tools_dir, dependencies):
        raise EnvelopeError("Shared Node dependency setup did not produce the locked versions; setup was not marked complete.")
    stamp.write_text(fingerprint + "\n", encoding="utf-8")


def _incomplete_browser(runtime: BrowserToolchain) -> bool:
    try:
        metadata = json.loads((runtime.tools_dir / "node_modules/playwright-core/browsers.json").read_text(encoding="utf-8"))
        revision = next(entry["revision"] for entry in metadata["browsers"] if entry["name"] == "chromium-headless-shell")
        if not isinstance(revision, str) or not revision.isdigit():
            return False
        directory = runtime.browsers_path / f"chromium_headless_shell-{revision}"
        return directory.is_dir() and not (directory / "INSTALLATION_COMPLETE").is_file()
    except (OSError, ValueError, TypeError, KeyError, StopIteration):
        return False


def ensure_browser(settings: Settings, *, bootstrap: bool = True) -> BrowserToolchain:
    if not bootstrap or os.environ.get(SKIP_ENV):
        return check_browser(settings)
    runtime = browser_paths(settings)
    node = shutil.which("node")
    if not node:
        raise EnvelopeError("Node.js 20+ with npm is required; Python cannot provision the system Node runtime.")
    if not runtime.module_path.is_file():
        raise EnvelopeError(f"Shared browser helper is missing: {runtime.module_path}")
    with RunLock(runtime.tools_dir.parent / ".tools/browser-setup.lock"):
        _ensure_packages(runtime, node)
        try:
            return check_browser(settings)
        except EnvelopeError as error:
            incomplete = "spawn EFTYPE" in str(error) and _incomplete_browser(runtime)
            if "Executable doesn't exist" not in str(error) and not incomplete:
                raise
        emit("  Preparing matching Chromium in the shared cache (missing or interrupted installation).", "cyan")
        _run_setup([node, str(runtime.module_path), "--install", "--browsers-path", str(runtime.browsers_path)], runtime, "Chromium setup", 330)
        return check_browser(settings)


def check_browser(settings: Settings) -> BrowserToolchain:
    runtime = browser_paths(settings)
    node = shutil.which("node")
    setup = (
        f"Install dependencies once: npm ci --prefix {json.dumps(str(runtime.tools_dir))} --ignore-scripts. "
        f"Then explicitly set up the browser: node {json.dumps(str(runtime.module_path))} "
        f"--install --browsers-path {json.dumps(str(runtime.browsers_path))}"
    )
    if not node:
        raise EnvelopeError("Node.js 20+ is required for the browser preflight.")
    if not runtime.module_path.is_file():
        raise EnvelopeError(f"Shared browser helper is missing: {runtime.module_path}. {setup}")
    timeout = settings.migration.get("parity.browser_check_timeout_seconds", 15)
    if type(timeout) is not int or not 1 <= timeout <= 60:
        raise ConfigError("parity.browser_check_timeout_seconds must be between 1 and 60.")
    try:
        completed = subprocess.run(
            [node, str(runtime.module_path), "--browsers-path", str(runtime.browsers_path), "--timeout-ms", str(timeout * 1000)],
            cwd=runtime.tools_dir, env={**os.environ, **runtime.environment()},
            capture_output=True, text=True, encoding="utf-8", errors="replace",
            timeout=timeout + 10, check=False, shell=False,
        )
    except (OSError, subprocess.SubprocessError) as error:
        raise EnvelopeError(f"Shared browser preflight failed: {error}. {setup}") from error
    if completed.returncode:
        raise EnvelopeError(f"Shared browser preflight failed: {completed.stderr.strip()[:1500]}. {setup}")
    try:
        result = json.loads(completed.stdout)
        expected = json.loads((runtime.tools_dir / "package.json").read_text(encoding="utf-8"))["dependencies"]["playwright"]
        if not isinstance(result, dict) or result.get("status") != "READY" or result.get("playwright_version") != expected:
            raise ValueError("Playwright readiness/version does not match the pinned package")
        if Path(result["browsers_path"]).resolve() != runtime.browsers_path or result["module_uri"] != runtime.module_path.as_uri():
            raise ValueError("Browser preflight used a different module or cache")
        if any(not isinstance(result.get(key), str) or not result[key] for key in ("browser_version", "chromium_revision")) or type(result.get("elapsed_ms")) is not int:
            raise ValueError("Browser preflight omitted its runtime identity")
        return replace(runtime, **{key: result[key] for key in ("playwright_version", "browser_version", "chromium_revision", "elapsed_ms")})
    except (OSError, TypeError, KeyError, ValueError) as error:
        raise EnvelopeError(f"Invalid browser preflight response: {error}. {setup}") from error