"""Loading and lookup for the authorable YAML configuration."""

from __future__ import annotations

import copy
import os
import re
from pathlib import Path
from typing import Any, Iterable, Mapping

import yaml


class ConfigError(RuntimeError):
    """Raised when configuration is missing, malformed, or internally inconsistent."""


_MISSING = object()
_ENV_NAME = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")


def _deep_merge(base: Any, override: Any) -> Any:
    if isinstance(base, Mapping) and isinstance(override, Mapping):
        merged = dict(base)
        for key, value in override.items():
            merged[key] = _deep_merge(merged.get(key), value) if key in merged else value
        return merged
    return override


class Config:
    """Read-only view over a merged mapping with dotted-path lookup."""

    def __init__(self, data: Mapping[str, Any], source: str = "<memory>") -> None:
        self._data = copy.deepcopy(dict(data))
        self.source = source

    @classmethod
    def from_file(cls, path: Path) -> "Config":
        if not path.is_file():
            raise ConfigError(f"Configuration file not found: {path}")
        try:
            loaded = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        except yaml.YAMLError as error:
            raise ConfigError(f"Invalid YAML in {path}: {error}") from error
        if not isinstance(loaded, Mapping):
            raise ConfigError(f"{path} must contain a YAML mapping at the top level.")
        return cls(loaded, source=str(path))

    @property
    def data(self) -> dict[str, Any]:
        return copy.deepcopy(self._data)

    def get(self, dotted_path: str, default: Any = _MISSING) -> Any:
        node: Any = self._data
        for part in dotted_path.split("."):
            if not isinstance(node, Mapping) or part not in node:
                if default is _MISSING:
                    raise ConfigError(f"Missing required key '{dotted_path}' in {self.source}")
                return default
            node = node[part]
        return copy.deepcopy(node) if isinstance(node, (dict, list)) else node

    def require(self, dotted_path: str) -> Any:
        value = self.get(dotted_path)
        if value is None:
            raise ConfigError(f"Key '{dotted_path}' in {self.source} must not be null.")
        return value

    def section(self, dotted_path: str) -> "Config":
        value = self.get(dotted_path, {})
        if not isinstance(value, Mapping):
            raise ConfigError(f"Key '{dotted_path}' in {self.source} must be a mapping.")
        return Config(value, source=f"{self.source}#{dotted_path}")

    def merged(self, override: Mapping[str, Any]) -> "Config":
        return Config(_deep_merge(self._data, override), source=self.source)

    def __contains__(self, dotted_path: str) -> bool:
        return self.get(dotted_path, _MISSING) is not _MISSING


class AgentSpec:
    """One agent entry from ``agents.yaml`` with the shared defaults applied."""

    def __init__(self, agent_id: str, data: Mapping[str, Any], defaults: Mapping[str, Any]) -> None:
        self.id = agent_id
        merged = _deep_merge(dict(defaults), dict(data))
        self._config = Config(merged, source=f"agents.yaml#agents.{agent_id}")

    def get(self, dotted_path: str, default: Any = _MISSING) -> Any:
        return self._config.get(dotted_path, default)

    @property
    def title(self) -> str:
        return str(self.get("title", self.id))

    @property
    def prompt_path(self) -> Path:
        return Path(str(self.get("prompt_dir"))) / str(self.get("prompt"))

    @property
    def timeout_seconds(self) -> int:
        return int(self.get("timeout_seconds"))

    @property
    def required_result_keys(self) -> list[str]:
        return list(self.get("required_result_keys"))

    @property
    def status_values(self) -> list[str]:
        return list(self.get("result_status_values"))


class Settings:
    """Everything the pipeline needs, resolved once and passed around explicitly."""

    def __init__(self, repo_root: Path, migration: Config, agents: Config) -> None:
        self.repo_root = repo_root
        self.migration = migration
        self._agents_config = agents

        defaults = agents.get("defaults", {})
        roster = agents.get("agents", {})
        if not isinstance(roster, Mapping) or not roster:
            raise ConfigError("agents.yaml must define at least one entry under 'agents'.")
        self.agents: dict[str, AgentSpec] = {
            agent_id: AgentSpec(agent_id, spec, defaults) for agent_id, spec in roster.items()
        }

    @classmethod
    def load(
        cls,
        repo_root: Path,
        config_dir: Path,
        overrides: Mapping[str, Any] | None = None,
    ) -> "Settings":
        migration = Config.from_file(config_dir / "migration.yaml")
        agents = Config.from_file(config_dir / "agents.yaml")
        if overrides:
            migration = migration.merged(overrides)
        return cls(repo_root=repo_root, migration=migration, agents=agents)

    def agent(self, agent_id: str) -> AgentSpec:
        try:
            return self.agents[agent_id]
        except KeyError as error:
            raise ConfigError(f"Unknown agent '{agent_id}'. Declare it in agents.yaml.") from error

    def resolve(self, relative: str | os.PathLike[str]) -> Path:
        path = Path(relative)
        return path if path.is_absolute() else (self.repo_root / path)

    def relative_to_repo(self, path: Path) -> str:
        try:
            return path.resolve().relative_to(self.repo_root.resolve()).as_posix()
        except ValueError:
            return path.as_posix()

    def phases(self) -> list[Mapping[str, Any]]:
        phases = self.migration.get("pipeline.phases", [])
        if not isinstance(phases, list) or not phases:
            raise ConfigError("migration.yaml must define a non-empty 'pipeline.phases' list.")
        for phase in phases:
            if not isinstance(phase, Mapping) or "id" not in phase:
                raise ConfigError("Every pipeline phase needs an 'id'.")
            if "agent" in phase:
                self.agent(str(phase["agent"]))
            elif "handler" not in phase:
                raise ConfigError(
                    f"Pipeline phase '{phase['id']}' needs either an 'agent' or a 'handler'."
                )
        return phases

    def env_value(self, env_key_path: str, default_path: str) -> str:
        """Read a value from the environment variable named in config, else the config default."""
        env_name = self.migration.get(env_key_path, None)
        if env_name:
            if not _ENV_NAME.fullmatch(str(env_name)):
                raise ConfigError(
                    f"'{env_key_path}' must be the NAME of an environment variable "
                    f"(for example AEM_PORT), not a value. It is currently {env_name!r}. "
                    f"To change the value itself, set '{default_path}'."
                )
            from_env = os.environ.get(str(env_name))
            if from_env:
                return from_env
        return str(self.migration.require(default_path))


def find_repo_root(start: Path, markers: Iterable[str] = ("pom.xml", ".git")) -> Path:
    for candidate in (start, *start.parents):
        if any((candidate / marker).exists() for marker in markers):
            return candidate
    return start
