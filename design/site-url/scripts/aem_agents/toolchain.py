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

    @property
    def bin(self) -> Path:
        return self.java_home / "bin"

    def environment(self) -> dict[str, str]:
        """JAVA_HOME plus its bin prepended to PATH, for the agent subprocess."""
        return {
            "JAVA_HOME": str(self.java_home),
            "PATH": os.pathsep.join([str(self.bin), os.environ.get("PATH", "")]),
        }


def _is_jdk(path: Path) -> bool:
    return (path / "bin" / "java.exe").is_file() or (path / "bin" / "java").is_file()


def _sort_key(path: Path) -> tuple[int, str]:
    """Prefer the highest version number so a stale JDK 8 never wins."""
    numbers = [int(value) for value in _VERSION.findall(path.name)]
    return (max(numbers) if numbers else 0, path.name)


def resolve_java_home(settings: Settings) -> Toolchain:
    config = settings.migration.section("toolchain")

    configured = config.get("java_home", None)
    if configured:
        path = Path(str(configured)).expanduser()
        if not _is_jdk(path):
            raise ToolchainError(
                f"toolchain.java_home is set to {path}, which is not a JDK "
                "(no bin/java). Correct it in migration.yaml."
            )
        return Toolchain(java_home=path, source="toolchain.java_home")

    env_name = str(config.get("java_home_env", "JAVA_HOME"))
    from_env = os.environ.get(env_name)
    if from_env:
        path = Path(from_env).expanduser()
        if _is_jdk(path):
            return Toolchain(java_home=path, source=f"${env_name}")

    discovered: list[Path] = []
    for pattern in config.get("java_home_candidates", []):
        for match in glob.glob(str(pattern)):
            candidate = Path(match)
            if _is_jdk(candidate):
                discovered.append(candidate)
    if discovered:
        best = sorted(discovered, key=_sort_key)[-1]
        return Toolchain(java_home=best, source="toolchain.java_home_candidates")

    broken = f"\n  {env_name} is currently {from_env!r}, which is not a JDK." if from_env else ""
    raise ToolchainError(
        "Could not resolve a usable JAVA_HOME, and the agents must not spend turns "
        f"searching for one.{broken}\n"
        "  Set an absolute JDK path in design/site-url/scripts/config/migration.yaml:\n\n"
        "    toolchain:\n"
        "      java_home: C:/Program Files/Zulu/zulu-21\n\n"
        "  (or add its parent directory to toolchain.java_home_candidates)"
    )
