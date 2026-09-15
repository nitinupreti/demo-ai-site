"""Resolve and check the shared browser runtime without installing during a run."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
from dataclasses import dataclass, replace
from pathlib import Path

from .config import ConfigError, Settings
from .envelope import EnvelopeError


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


def check_browser(settings: Settings) -> BrowserToolchain:
    runtime = browser_paths(settings)
    node = shutil.which("node")
    setup = (
        f"Install dependencies once: npm ci --prefix {json.dumps(str(runtime.tools_dir))} --ignore-scripts. "
        f"Then explicitly set up the browser: node {json.dumps(str(runtime.module_path))} "
        f"--install --browsers-path {json.dumps(str(runtime.browsers_path))}"
    )
    if not node:
        raise EnvelopeError("Node.js 18+ is required for the browser preflight.")
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