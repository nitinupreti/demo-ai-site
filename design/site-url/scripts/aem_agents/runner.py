"""Agent execution backend: the GitHub Copilot CLI as a streaming subprocess.

The CLI invocation is entirely described by ``backend.copilot`` in
``migration.yaml``; this module only resolves the executable, fills placeholders,
and pumps the JSON event stream.
"""

from __future__ import annotations

import hashlib
import json
import os
import platform
import queue
import re
import shutil
import signal
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
    completed_early: bool = False
    lingered_seconds: float = 0.0

    @property
    def ok(self) -> bool:
        return (self.exit_code == 0 or self.completed_early) and not self.timed_out


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
        self._process_lock = threading.Lock()
        self._processes: set[subprocess.Popen[str]] = set()
        self._cancelled = threading.Event()
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

    def launch_args(self, prompt: str, options: Mapping[str, Any], workspace: Path) -> list[str]:
        argv = [*self._command_prefix(), *self.build_args(prompt, options)]
        size = len(subprocess.list2cmdline(argv).encode("utf-16-le")) // 2
        if size < 30000:
            return argv
        request = (workspace / "request-prompt.md").absolute()
        payload = prompt.encode("utf-8")
        if request.is_symlink() or (request.exists() and request.read_bytes() != payload):
            raise BackendError("Refusing to replace a different saved prompt in this invocation.")
        request = request.resolve()
        if not request.exists():
            with request.open("xb") as stream:
                stream.write(payload)
        short_prompt = (
            f"Read the complete UTF-8 task instructions from this file before doing any work: {request}\n"
            "Use file reads in successive ranges if necessary; do not truncate or summarize away requirements. "
            "Execute that full task with its specified source ownership, validation rules and result path. "
            "This file is the invocation prompt, not a document to edit. Do not treat its parent folder as the source root."
        )
        argv = [*self._command_prefix(), *self.build_args(short_prompt, options)]
        reduced_size = len(subprocess.list2cmdline(argv).encode("utf-16-le")) // 2
        if reduced_size >= 30000:
            raise BackendError("Copilot launch arguments exceed the command-line limit even with file-referenced instructions.")
        receipt = {"transport": "file-reference", "path": str(request), "bytes": len(payload),
                   "sha256": hashlib.sha256(payload).hexdigest(), "original_command_utf16_units": size,
                   "command_utf16_units": reduced_size}
        (workspace / "prompt-transport.json").write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")
        return argv

    def run(
        self,
        *,
        prompt: str,
        options: Mapping[str, Any],
        workspace: Path,
        stream_name: str,
        stderr_name: str,
        timeout_seconds: int | None,
        working_directory: Path | None = None,
        env_extra: Mapping[str, str] | None = None,
        on_event: Callable[[Mapping[str, Any]], None] | None = None,
        completion_ready: Callable[[], bool] | None = None,
    ) -> AgentRun:
        if self._cancelled.is_set():
            raise BackendError("Agent execution was cancelled.")
        workspace.mkdir(parents=True, exist_ok=True)
        stream_path = workspace / stream_name
        stderr_path = workspace / stderr_name

        argv = self.launch_args(prompt, options, workspace)
        started = time.monotonic()

        process = None
        try:
            with stderr_path.open("w", encoding="utf-8") as stderr_file:
                process = subprocess.Popen(
                    argv, cwd=working_directory or self.settings.repo_root, stdin=subprocess.DEVNULL,
                    stdout=subprocess.PIPE, stderr=stderr_file,
                    env=self.environment(env_extra), text=True, encoding="utf-8",
                    errors="replace", bufsize=1, shell=False,
                    start_new_session=os.name != "nt",
                    creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0,
                )
                with self._process_lock:
                    self._processes.add(process)
                if self._cancelled.is_set():
                    raise BackendError("Agent execution was cancelled.")
                run = self._pump(process, stream_path, stderr_path, timeout_seconds, on_event, completion_ready)
        except (OSError, subprocess.SubprocessError) as error:
            raise BackendError(f"Agent process failed: {error}") from error
        finally:
            if process is not None:
                try:
                    self._stop_process(process)
                finally:
                    with self._process_lock:
                        self._processes.discard(process)
                    if process.stdout:
                        process.stdout.close()

        run.duration_seconds = time.monotonic() - started
        return run

    @staticmethod
    def _stop_process(process: subprocess.Popen[str]) -> None:
        if process.poll() is not None:
            return
        try:
            if os.name == "nt":
                subprocess.run(
                    [str(Path(os.environ.get("SystemRoot", "C:/Windows")) / "System32" / "taskkill.exe"),
                     "/PID", str(process.pid), "/T", "/F"],
                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False, timeout=10,
                )
            else:
                os.killpg(process.pid, signal.SIGTERM)
            process.wait(timeout=5)
        except ProcessLookupError:
            process.wait(timeout=5)
        except (OSError, subprocess.TimeoutExpired):
            if os.name != "nt":
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
            else:
                process.kill()
            process.wait(timeout=5)

    def cancel_all(self) -> None:
        self._cancelled.set()
        with self._process_lock:
            active = list(self._processes)
        for process in active:
            self._stop_process(process)

    def _pump(
        self,
        process: subprocess.Popen[str],
        stream_path: Path,
        stderr_path: Path,
        timeout_seconds: int | None,
        on_event: Callable[[Mapping[str, Any]], None] | None,
        completion_ready: Callable[[], bool] | None = None,
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

        deadline = time.monotonic() + timeout_seconds if timeout_seconds else None
        heartbeat_at = time.monotonic() + 1.0
        messages: list[str] = []
        usage: dict[str, Any] = {}
        session_id: str | None = None
        timed_out = False
        completion = self.config.get("completion", {})
        complete_event = str(completion.get("task_complete_event", "session.task_complete"))
        idle_event = str(completion.get("idle_event", "assistant.idle"))
        grace = completion.get("grace_seconds", 10)
        idle_grace = completion.get("idle_grace_seconds", 120)
        quiet_grace = completion.get("result_quiet_seconds", 120)
        finish_at: float | None = None
        finished_since: float | None = None
        last_event_at: float | None = None
        completed_early = False

        with stream_path.open("w", encoding="utf-8") as stream_file:
            while True:
                now = time.monotonic()
                if last_event_at is None:
                    last_event_at = now
                remaining = deadline - now if deadline is not None else None
                if remaining is not None and remaining <= 0:
                    timed_out = True
                    break
                if finish_at is not None and now >= finish_at:
                    completed_early = True
                    break
                if on_event and now >= heartbeat_at:
                    on_event({"type": "aem.heartbeat"})
                    heartbeat_at = now + 1.0
                try:
                    line = lines.get(timeout=min(remaining, 1.0) if remaining is not None else 1.0)
                except queue.Empty:
                    # A hung CLI stops emitting entirely, so completion must also be
                    # detectable from the validated result file alone.
                    if (finish_at is None and quiet_grace is not None and completion_ready is not None
                            and now - last_event_at >= float(quiet_grace) and completion_ready()):
                        finish_at = now + (float(grace) if grace is not None else 0.0)
                        finished_since = last_event_at
                    continue
                if line is None:
                    break
                last_event_at = now
                stream_file.write(line + "\n")
                stream_file.flush()
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
                # The CLI can linger for many minutes after the agent is done; its
                # result file, not process exit, is what the orchestrator validates.
                if finish_at is None:
                    if event.get("type") == complete_event and grace is not None:
                        finish_at, finished_since = now + float(grace), now
                    elif (event.get("type") == idle_event and idle_grace is not None
                          and completion_ready is not None and completion_ready()):
                        finish_at, finished_since = now + float(idle_grace), now
                if on_event:
                    on_event(event)

        if timed_out or completed_early:
            self._stop_process(process)
        try:
            exit_code = process.wait(timeout=30 if deadline is not None or completed_early else None)
        except subprocess.TimeoutExpired:
            self._stop_process(process)
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
            completed_early=completed_early,
            lingered_seconds=time.monotonic() - finished_since if finished_since is not None else 0.0,
        )


def run_command(command: Sequence[str], directory: Path, log_path: Path, environment: Mapping[str, str]) -> int:
    executable = shutil.which(command[0])
    if not executable:
        raise BackendError(f"Required build executable is unavailable: {command[0]}")
    argv = [executable, *command[1:]]
    if os.name == "nt" and Path(executable).suffix.lower() in _WINDOWS_SHIMS:
        argv = ["cmd", "/d", "/c", *argv]
    log_path.parent.mkdir(parents=True, exist_ok=True)
    with log_path.open("w", encoding="utf-8") as log:
        process = subprocess.Popen(
            argv, cwd=directory, env={**os.environ, **environment}, stdout=log, stderr=subprocess.STDOUT,
            stdin=subprocess.DEVNULL, shell=False, start_new_session=os.name != "nt",
            creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0,
        )
        try:
            return process.wait()
        finally:
            CopilotBackend._stop_process(process)


def create_backend(settings: Settings) -> CopilotBackend:
    kind = str(settings.migration.get("backend.kind", "copilot-cli"))
    if kind != "copilot-cli":
        raise ConfigError(
            f"Unsupported backend.kind {kind!r}. Only 'copilot-cli' is implemented; "
            "add a new backend class and register it here to support another."
        )
    return CopilotBackend(settings)
