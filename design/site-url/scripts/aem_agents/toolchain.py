"""Toolchain resolution.

Every agent that runs Maven needs a working ``JAVA_HOME``. When the machine's
value is wrong, each agent rediscovers that independently — probing ``mvn -v``,
hunting for installed JDKs, then prefixing every later command with its own fix.
That is pure waste repeated once per agent, per run.

So the orchestrator resolves the toolchain once at preflight, fails fast with an
actionable message if it cannot, and exports the result to every agent.
"""

from __future__ import annotations

import glob
import os
import re
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path

from .config import ConfigError, Settings

_VERSION = re.compile(r"(\d+)")


class ToolchainError(ConfigError):
    """Raised when a required tool cannot be resolved."""


@dataclass(frozen=True)
class Toolchain:
    java_home: Path
    source: str
    maven_executable: Path | None = None
    maven_version: str = ""

    @property
    def bin(self) -> Path:
        return self.java_home / "bin"

    def environment(self) -> dict[str, str]:
        """JAVA_HOME plus its bin prepended to PATH, for the agent subprocess."""
        paths = [str(self.bin)]
        if self.maven_executable is not None:
            paths.append(str(self.maven_executable.parent))
        return {
            "JAVA_HOME": str(self.java_home),
            "PATH": os.pathsep.join([*paths, os.environ.get("PATH", "")]),
        }


def _is_jdk(path: Path) -> bool:
    suffix = ".exe" if os.name == "nt" else ""
    return all((path / "bin" / (name + suffix)).is_file() for name in ("java", "javac"))


def _sort_key(path: Path) -> tuple[int, str]:
    """Rank installed fallbacks only when configuration and environment have no JDK."""
    numbers = [int(value) for value in _VERSION.findall(path.name)]
    return (max(numbers) if numbers else 0, path.name)


def resolve_java_home(settings: Settings) -> Toolchain:
    config = settings.migration.section("toolchain")

    configured = config.get("java_home", None)
    if configured:
        path = settings.resolve(Path(str(configured)).expanduser()).resolve()
        if not _is_jdk(path):
            raise ToolchainError(
                f"toolchain.java_home is set to {path}, which does not contain both java and javac. "
                "Correct it in migration.yaml or leave it null to use JAVA_HOME or PATH."
            )
        return Toolchain(java_home=path, source="toolchain.java_home")

    env_name = str(config.get("java_home_env", "JAVA_HOME"))
    from_env = os.environ.get(env_name)
    if from_env:
        path = Path(from_env).expanduser().resolve()
        if _is_jdk(path):
            return Toolchain(java_home=path, source=f"${env_name}")

    java = shutil.which("javac")
    if java:
        candidate = Path(java).resolve().parent.parent
        if _is_jdk(candidate):
            return Toolchain(java_home=candidate, source="PATH")

    discovered: list[Path] = []
    for pattern in config.get("java_home_candidates", []):
        for match in glob.glob(str(pattern)):
            candidate = Path(match)
            if _is_jdk(candidate):
                discovered.append(candidate)
    if discovered:
        best = sorted(discovered, key=_sort_key)[-1]
        return Toolchain(java_home=best.resolve(), source="toolchain.java_home_candidates")

    broken = f"\n  {env_name} is currently {from_env!r}, which does not contain both java and javac." if from_env else ""
    raise ToolchainError(
        "Could not resolve an installed JDK, and the agents must not spend turns "
        f"searching for one.{broken}\n"
        "  Set JAVA_HOME to an existing JDK, put its bin directory on PATH, "
        "or set toolchain.java_home in migration.yaml. No particular JDK version is enforced by the launcher."
    )


def check_maven(toolchain: Toolchain) -> Toolchain:
    from dataclasses import replace

    executable = shutil.which("mvn")
    if not executable:
        raise ToolchainError("Apache Maven is required. Install Maven and add its bin directory to PATH before running a migration.")
    path = Path(executable).resolve()
    home = path.parent.parent
    launchers = sorted((home / "boot").glob("plexus-classworlds-*.jar"))
    config = home / "bin/m2.conf"
    if not launchers or not config.is_file():
        raise ToolchainError(f"Cannot find Maven's runtime beside {path}. Put the actual Maven bin directory on PATH, not an unresolved shim.")
    java = toolchain.bin / ("java.exe" if os.name == "nt" else "java")
    try:
        result = subprocess.run(
            [str(java), "-classpath", str(launchers[-1]), f"-Dclassworlds.conf={config}",
             f"-Dmaven.home={home}", f"-Dmaven.conf={home / 'conf'}", f"-Dmaven.multiModuleProjectDirectory={home}",
             "org.codehaus.plexus.classworlds.launcher.Launcher", "--version"],
            cwd=home,
            env={**os.environ, **toolchain.environment()}, capture_output=True, text=True,
            encoding="utf-8", errors="replace", timeout=20, shell=False, check=False,
        )
    except (OSError, subprocess.SubprocessError) as error:
        raise ToolchainError(f"Maven cannot run with the selected JDK: {error}") from error
    version = re.search(r"Apache Maven (\d+\.\d+\.\d+)", result.stdout or "")
    if result.returncode or version is None:
        raise ToolchainError("Maven failed its startup check with the selected JDK: " + (result.stderr or result.stdout).strip()[:1000])
    return replace(toolchain, maven_executable=path, maven_version=version.group(1))


def check_node() -> str:
    node = shutil.which("node")
    if not node:
        raise ToolchainError("Node.js 20+ with npm is required. Install a supported Node.js runtime and rerun the launcher.")
    try:
        result = subprocess.run([node, "--version"], capture_output=True, text=True, encoding="utf-8",
                                errors="replace", timeout=10, shell=False, check=False)
    except (OSError, subprocess.SubprocessError) as error:
        raise ToolchainError(f"Node.js cannot start: {error}") from error
    version = re.fullmatch(r"v?(\d+)\.(\d+)\.(\d+)", result.stdout.strip())
    if result.returncode or version is None or int(version.group(1)) < 20:
        raise ToolchainError(f"The pinned Playwright runtime requires Node.js 20+; found {result.stdout.strip() or 'an unusable runtime'}.")
    return result.stdout.strip()
