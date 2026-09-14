"""Agent execution backend: the GitHub Copilot CLI as a streaming subprocess.

The CLI invocation is entirely described by ``backend.copilot`` in
``migration.yaml``; this module only resolves the executable, fills placeholders,
and pumps the JSON event stream.
"""

from __future__ import annotations

import json
import os
import platform
import queue
import re
import shutil
import subprocess
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Iterable, Mapping, Sequence

from .config import ConfigError, Settings

_SINGLE_TOKEN = re.compile(r"\{([a-zA-Z0-9_]+)\}")
_WINDOWS_SHIMS = {".cmd", ".bat"}


class BackendError(RuntimeError):
    """Raised when the agent backend is unavailable or exits abnormally."""


@dataclass
class AgentRun:
    exit_code: int
    duration_seconds: float
    stream_path: Path
    stderr_path: Path
    messages: list[str] = field(default_factory=list)
    usage: dict[str, Any] = field(default_factory=dict)
    timed_out: bool = False
    session_id: str | None = None

    @property
    def ok(self) -> bool:
        return self.exit_code == 0 and not self.timed_out


def _fill(template: str, values: Mapping[str, Any]) -> tuple[str, set[str]]:
    used: set[str] = set()

    def substitute(match: re.Match[str]) -> str:
        name = match.group(1)
        if name not in values:
            return match.group(0)
        used.add(name)
        value = values[name]
        return "" if value is None else str(value)

    return _SINGLE_TOKEN.sub(substitute, template), used


def _expand_group(group: Sequence[str], values: Mapping[str, Any]) -> list[str]:
    """Expand one argument group, dropping it when any placeholder is empty."""
    expanded: list[str] = []
    for item in group:
        text, used = _fill(str(item), values)
        if used and not text:
            return []
        expanded.append(text)
    return expanded


class CopilotBackend:
    """Spawns the Copilot CLI once per agent invocation."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.config = settings.migration.section("backend.copilot")
        self.executable = self._resolve_executable()
        self.version = self._probe_version()

    # -- discovery ---------------------------------------------------------

    def _candidate_paths(self) -> Iterable[str]:
        env_name = self.config.get("executable_env", None)
        if env_name:
            from_env = os.environ.get(str(env_name))
            if from_env:
                yield from_env
        machine = platform.machine().lower()
        arch = "arm64" if machine in {"arm64", "aarch64"} else "x64"
        context = {
            "APPDATA": os.environ.get("APPDATA", ""),
            "HOME": os.environ.get("HOME", os.path.expanduser("~")),
            "arch": arch,
        }
        for candidate in self.config.get("executable_candidates", []):
            text, _ = _fill(str(candidate), context)
            if text:
                yield text

    def _resolve_executable(self) -> str:
        checked: list[str] = []
        for candidate in self._candidate_paths():
            checked.append(candidate)
            path = Path(candidate)
            if path.is_absolute():
                if path.is_file():
                    return str(path)
                continue
            located = shutil.which(candidate)
            if located:
                return located
        raise BackendError(
            "The GitHub Copilot CLI was not found. Install it with "
            "`npm install -g @github/copilot`, run `copilot login`, or set the "
            f"{self.config.get('executable_env', 'COPILOT_BIN')} environment variable. "
            f"Checked: {', '.join(checked)}"
        )

    def _command_prefix(self) -> list[str]:
        suffix = Path(self.executable).suffix.lower()
        if os.name == "nt" and suffix in _WINDOWS_SHIMS:
            return ["cmd", "/c", self.executable]
        return [self.executable]

    def _probe_version(self) -> str:
        args = [str(arg) for arg in self.config.get("version_args", ["--version"])]
        try:
            completed = subprocess.run(  # noqa: S603 - fixed argv, shell=False
                [*self._command_prefix(), *args],
                cwd=self.settings.repo_root,
                capture_output=True,
                text=True,
                timeout=60,
                shell=False,
                check=False,
            )
        except (OSError, subprocess.SubprocessError) as error:
            raise BackendError(f"Could not run the Copilot CLI at {self.executable}: {error}") from error
        if completed.returncode != 0:
            raise BackendError(
                f"`{self.executable} {' '.join(args)}` exited with {completed.returncode}. "
                "Run `copilot login` and retry."
            )
        output = (completed.stdout or completed.stderr or "").strip().splitlines()
        return output[0].strip() if output else "GitHub Copilot CLI"

    # -- invocation --------------------------------------------------------

    def build_args(self, prompt: str, options: Mapping[str, Any]) -> list[str]:
        values = {"prompt": prompt, **options}
        args = _expand_group(self.config.get("base_args", []), values)
        if not args:
            raise ConfigError("backend.copilot.base_args must expand to a non-empty argument list.")
        for group_key in (
            "model_args",
            "session_args",
            "effort_args",
            "autopilot_args",
            "credit_args",
        ):
            group = self.config.get(group_key, [])
            if group:
                args.extend(_expand_group(group, values))
        for tool in self.config.get("denied_tools", []):
            args.extend(["--deny-tool", str(tool)])
        return args

    def environment(self, extra: Mapping[str, str] | None = None) -> dict[str, str]:
        env = dict(os.environ)
        env.update({str(k): str(v) for k, v in self.config.get("environment", {}).items()})
        if extra:
            env.update({str(k): str(v) for k, v in extra.items()})
        return env

    def run(
        self,
        *,
        prompt: str,
        options: Mapping[str, Any],
        workspace: Path,
        stream_name: str,
        stderr_name: str,
        timeout_seconds: int,
        env_extra: Mapping[str, str] | None = None,
        on_event: Callable[[Mapping[str, Any]], None] | None = None,
    ) -> AgentRun:
        workspace.mkdir(parents=True, exist_ok=True)
        stream_path = workspace / stream_name
        stderr_path = workspace / stderr_name

        argv = [*self._command_prefix(), *self.build_args(prompt, options)]
        started = time.monotonic()

        with stderr_path.open("w", encoding="utf-8") as stderr_file:
            process = subprocess.Popen(  # noqa: S603 - fixed argv, shell=False
                argv,
                cwd=self.settings.repo_root,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE,
                stderr=stderr_file,
                env=self.environment(env_extra),
                text=True,
                encoding="utf-8",
                errors="replace",
                bufsize=1,
                shell=False,
            )
            run = self._pump(process, stream_path, stderr_path, timeout_seconds, on_event)

        run.duration_seconds = time.monotonic() - started
        return run

    def _pump(
        self,
        process: subprocess.Popen[str],
        stream_path: Path,
        stderr_path: Path,
        timeout_seconds: int,
        on_event: Callable[[Mapping[str, Any]], None] | None,
    ) -> AgentRun:
        lines: queue.Queue[str | None] = queue.Queue()

        def reader() -> None:
            try:
                assert process.stdout is not None
                for line in process.stdout:
                    lines.put(line.rstrip("\r\n"))
            finally:
                lines.put(None)

        thread = threading.Thread(target=reader, name="copilot-stdout", daemon=True)
        thread.start()

        deadline = time.monotonic() + timeout_seconds
        messages: list[str] = []
        usage: dict[str, Any] = {}
        session_id: str | None = None
        timed_out = False

        with stream_path.open("w", encoding="utf-8") as stream_file:
            while True:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    timed_out = True
                    break
                try:
                    line = lines.get(timeout=min(remaining, 1.0))
                except queue.Empty:
                    continue
                if line is None:
                    break
                stream_file.write(line + "\n")
                if not line.strip():
                    continue
                try:
                    event = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if not isinstance(event, Mapping):
                    continue
                if event.get("type") == self.config.get("events.message", "assistant.message"):
                    content = (event.get("data") or {}).get("content")
                    if isinstance(content, str) and content.strip():
                        messages.append(content.strip())
                if event.get("type") == self.config.get("events.result", "result"):
                    usage = dict(event.get("usage") or {})
                    session_id = event.get("sessionId")
                if on_event:
                    on_event(event)

        if timed_out:
            process.kill()
        try:
            exit_code = process.wait(timeout=30)
        except subprocess.TimeoutExpired:
            process.kill()
            exit_code = process.wait()
        thread.join(timeout=5)

        return AgentRun(
            exit_code=exit_code,
            duration_seconds=0.0,
            stream_path=stream_path,
            stderr_path=stderr_path,
            messages=messages,
            usage=usage,
            timed_out=timed_out,
            session_id=session_id,
        )


def create_backend(settings: Settings) -> CopilotBackend:
    kind = str(settings.migration.get("backend.kind", "copilot-cli"))
    if kind != "copilot-cli":
        raise ConfigError(
            f"Unsupported backend.kind {kind!r}. Only 'copilot-cli' is implemented; "
            "add a new backend class and register it here to support another."
        )
    return CopilotBackend(settings)
