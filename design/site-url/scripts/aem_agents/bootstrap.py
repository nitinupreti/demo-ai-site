"""Self-bootstrapping Python environment.

Imported by ``run_migration.py`` before any third-party import so the launcher is
the only entry point a user needs. If the dependencies are missing it creates the
virtual environment, installs the pinned requirements, and re-launches the same
command inside that environment.

Deliberately standard-library only, and deliberately shell-free: every subprocess
is an explicit argument list with ``shell=False``, so nothing here resembles the
inline-command patterns endpoint security tooling flags.
"""

from __future__ import annotations

import hashlib
import importlib.util
import os
import subprocess
import sys
import venv
from pathlib import Path

MINIMUM_PYTHON = (3, 10)

#: Imported by the pipeline itself; keep in sync with requirements.txt.
REQUIRED_MODULES = ("yaml", "PIL")

MARKER_ENV = "AEM_AGENTS_BOOTSTRAPPED"
SKIP_ENV = "AEM_AGENTS_SKIP_BOOTSTRAP"
VENV_ENV = "AEM_AGENTS_VENV"
SKIP_FLAG = "--no-bootstrap"

_STAMP_NAME = ".requirements-stamp"


class BootstrapError(RuntimeError):
    """Raised when the environment cannot be prepared."""


def _note(message: str) -> None:
    # stderr keeps --show-plan's JSON on stdout clean.
    print(message, file=sys.stderr, flush=True)


def _missing_modules() -> list[str]:
    return [name for name in REQUIRED_MODULES if importlib.util.find_spec(name) is None]


def venv_dir(scripts_dir: Path) -> Path:
    override = os.environ.get(VENV_ENV)
    return Path(override).expanduser().resolve() if override else scripts_dir / ".venv"


def venv_python(venv_path: Path) -> Path:
    if os.name == "nt":
        return venv_path / "Scripts" / "python.exe"
    return venv_path / "bin" / "python"


def _requirements(scripts_dir: Path) -> Path:
    path = scripts_dir / "requirements.txt"
    if not path.is_file():
        raise BootstrapError(f"Requirements file not found: {path}")
    return path


def _digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _create_venv(venv_path: Path) -> None:
    _note(f"  creating virtual environment at {venv_path}")
    try:
        venv.EnvBuilder(with_pip=True, clear=False, upgrade=False).create(str(venv_path))
    except Exception as error:  # noqa: BLE001 - surfaced with actionable guidance
        hint = ""
        if sys.platform.startswith("linux"):
            hint = "\n  On Debian/Ubuntu install the venv package first: sudo apt-get install python3-venv"
        raise BootstrapError(f"Could not create a virtual environment at {venv_path}: {error}{hint}")


def _install(python: Path, requirements: Path) -> None:
    _note(f"  installing dependencies from {requirements.name}")
    completed = subprocess.run(  # noqa: S603 - explicit argv, shell=False
        [
            str(python),
            "-m",
            "pip",
            "install",
            "--requirement",
            str(requirements),
            "--disable-pip-version-check",
            "--quiet",
        ],
        shell=False,
        check=False,
    )
    if completed.returncode != 0:
        raise BootstrapError(
            f"pip install failed with exit code {completed.returncode}. "
            f"Run it manually to see the full output:\n"
            f"    {python} -m pip install -r {requirements}"
        )


def _manual_hint(scripts_dir: Path, missing: list[str]) -> str:
    target = venv_python(venv_dir(scripts_dir))
    return (
        f"Missing Python dependency: {', '.join(missing)}.\n"
        f"  Automatic setup is disabled ({SKIP_FLAG} or {SKIP_ENV}). Install manually with:\n"
        f"    {sys.executable} -m pip install -r {_requirements(scripts_dir)}\n"
        f"  or let the launcher build its own environment at:\n"
        f"    {target}"
    )


def ensure_environment(script: Path, argv: list[str]) -> None:
    """Guarantee the dependencies are importable, re-launching in a venv if needed.

    Returns normally when the current interpreter is already usable. Otherwise it
    prepares the environment, runs the same command inside it, and exits with that
    command's status.
    """
    if sys.version_info < MINIMUM_PYTHON:
        running = ".".join(str(part) for part in sys.version_info[:3])
        required = ".".join(str(part) for part in MINIMUM_PYTHON)
        raise BootstrapError(
            f"This pipeline needs Python {required} or newer; you are running {running}.\n"
            f"  Install a newer Python, then re-run this command.\n"
            f"    Windows        winget install Python.Python.3.12\n"
            f"    macOS          brew install python@3.12\n"
            f"    Debian/Ubuntu  sudo apt-get install python3 python3-venv python3-pip"
        )

    missing = _missing_modules()
    if not missing:
        return

    scripts_dir = script.parent
    if os.environ.get(MARKER_ENV):
        raise BootstrapError(
            f"Dependencies are still missing after setup: {', '.join(missing)}.\n"
            f"  The environment at {venv_dir(scripts_dir)} did not install correctly.\n"
            f"  Delete it and re-run, or install manually:\n"
            f"    {sys.executable} -m pip install -r {_requirements(scripts_dir)}"
        )
    if os.environ.get(SKIP_ENV) or SKIP_FLAG in argv:
        raise BootstrapError(_manual_hint(scripts_dir, missing))

    target = venv_dir(scripts_dir)
    python = venv_python(target)
    if not python.is_file():
        _note(f"First run: preparing the Python environment for {script.name}.")
        _create_venv(target)
        if not python.is_file():
            raise BootstrapError(
                f"Expected a Python interpreter at {python} after creating the venv."
            )

    requirements = _requirements(scripts_dir)
    stamp = target / _STAMP_NAME
    digest = _digest(requirements)
    if not stamp.is_file() or stamp.read_text(encoding="utf-8").strip() != digest:
        _install(python, requirements)
        stamp.write_text(digest + "\n", encoding="utf-8")

    _note(f"  running in {target}\n")
    command = [str(python), str(script), *argv]
    environment = {**os.environ, MARKER_ENV: "1"}
    try:
        completed = subprocess.run(command, shell=False, check=False, env=environment)  # noqa: S603
    except KeyboardInterrupt:
        sys.exit(130)
    sys.exit(completed.returncode)
