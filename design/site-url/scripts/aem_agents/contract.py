"""Reads the canonical prompt contract so thresholds live in markdown, not in code.

Every fenced ``yaml`` block in the contract file is parsed and merged. The logical
names the pipeline uses are bound to real keys by ``contract.keys`` in
``migration.yaml``, so renaming a key in the prompt only requires a config edit.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Mapping
from urllib.parse import urlparse

import yaml

from .config import ConfigError, Settings

_YAML_BLOCK = re.compile(r"^[ \t]*```[ \t]*ya?ml[ \t]*\r?\n(.*?)^[ \t]*```", re.MULTILINE | re.DOTALL)
_COMPARATOR = re.compile(r"^\s*(>=|<=|>|<|==|=)?\s*([0-9]*\.?[0-9]+)\s*%?\s*$")
_PLACEHOLDER = re.compile(r"<[^>]+>")


class ContractError(RuntimeError):
    """Raised when the prompt contract is missing a value the pipeline depends on."""


@dataclass(frozen=True)
class Threshold:
    """A parsed comparison such as ``> 0.90`` from the prompt contract."""

    operator: str
    value: float
    raw: str

    def passes(self, ratio: float) -> bool:
        if self.operator == ">":
            return ratio > self.value
        if self.operator == ">=":
            return ratio >= self.value
        if self.operator == "<":
            return ratio < self.value
        if self.operator == "<=":
            return ratio <= self.value
        return ratio == self.value

    def __str__(self) -> str:
        return self.raw

    @classmethod
    def parse(cls, raw: Any) -> "Threshold":
        text = str(raw).strip()
        match = _COMPARATOR.match(text)
        if not match:
            raise ContractError(
                f"Cannot parse threshold {raw!r}. Use a form like '> 0.90', '>= 0.9', or '0.9'."
            )
        operator = match.group(1) or ">="
        if operator == "=":
            operator = "=="
        value = float(match.group(2))
        if value > 1:  # the prompt may express the gate as a percentage
            value /= 100.0
        if not 0 < value <= 1:
            raise ContractError(f"Threshold {raw!r} resolves to {value}, which is outside (0, 1].")
        return cls(operator=operator, value=value, raw=text)


@dataclass
class RunContract:
    """The run-controlling values the prompt owns."""

    site_url: str
    breakpoints: list[int]
    visual_pass_ratio: Threshold
    max_attempts_per_component: int
    target_page_path: str | None = None
    evidence_dir_template: str | None = None
    completion_requires: list[str] = field(default_factory=list)
    source_file: str = ""
    raw: dict[str, Any] = field(default_factory=dict)

    def as_dict(self) -> dict[str, Any]:
        return {
            "site_url": self.site_url,
            "target_page_path": self.target_page_path,
            "breakpoints": list(self.breakpoints),
            "visual_pass_ratio": str(self.visual_pass_ratio),
            "max_attempts_per_component": self.max_attempts_per_component,
            "completion_requires": list(self.completion_requires),
            "source_file": self.source_file,
        }


def parse_yaml_blocks(markdown: str) -> dict[str, Any]:
    """Merge every fenced ``yaml`` block in ``markdown`` into a single mapping."""
    merged: dict[str, Any] = {}
    for block in _YAML_BLOCK.findall(markdown):
        try:
            loaded = yaml.safe_load(block)
        except yaml.YAMLError:
            # Illustrative blocks in the prompt are not required to be valid YAML.
            continue
        if isinstance(loaded, Mapping):
            for key, value in loaded.items():
                merged.setdefault(str(key), value)
    return merged


def _clean(value: Any) -> Any:
    """Drop prompt placeholders such as ``<runtime-required>``."""
    if isinstance(value, str) and _PLACEHOLDER.fullmatch(value.strip()):
        return None
    return value


def _coerce_breakpoints(value: Any) -> list[int]:
    if isinstance(value, str):
        parts = [part.strip() for part in value.split(",")]
    elif isinstance(value, (list, tuple)):
        parts = list(value)
    else:
        parts = [value]
    widths: list[int] = []
    for part in parts:
        try:
            width = int(str(part).strip())
        except (TypeError, ValueError) as error:
            raise ContractError(f"Breakpoint {part!r} is not an integer width.") from error
        if width < 240:
            raise ContractError(f"Breakpoint {width} is below the minimum supported width of 240.")
        widths.append(width)
    if not widths:
        raise ContractError("The contract must declare at least one breakpoint.")
    return sorted(set(widths))


def validate_url(url: str, allowed_schemes: list[str]) -> str:
    parsed = urlparse(url)
    if parsed.scheme.lower() not in {scheme.lower() for scheme in allowed_schemes}:
        raise ContractError(
            f"SITE_URL must use one of {allowed_schemes}; got {parsed.scheme or '(none)'!r}."
        )
    if not parsed.netloc:
        raise ContractError(f"SITE_URL is not an absolute URL: {url!r}")
    return parsed._replace(fragment="").geturl()


def load_contract(settings: Settings, overrides: Mapping[str, Any] | None = None) -> RunContract:
    """Load the run contract from the prompt file named in ``migration.yaml``."""
    contract_file = settings.resolve(str(settings.migration.require("contract.file")))
    if not contract_file.is_file():
        raise ContractError(f"Contract prompt not found: {contract_file}")

    values = parse_yaml_blocks(contract_file.read_text(encoding="utf-8"))
    key_map: Mapping[str, str] = settings.migration.get("contract.keys", {})
    required: list[str] = list(settings.migration.get("contract.required", []))
    overrides = {name: value for name, value in (overrides or {}).items() if value is not None}

    bound: dict[str, Any] = {}
    for logical, prompt_key in key_map.items():
        bound[logical] = overrides.get(logical, _clean(values.get(prompt_key)))

    missing = [name for name in required if bound.get(name) in (None, "", [])]
    if missing:
        raise ContractError(
            f"{contract_file} does not define {', '.join(missing)} "
            f"(looked for {', '.join(key_map.get(name, name) for name in missing)}). "
            "Add the value to the prompt or pass it on the command line."
        )

    allowed_schemes = list(settings.migration.get("run.allowed_url_schemes", ["http", "https"]))
    completion = bound.get("completion_requires") or []

    return RunContract(
        site_url=validate_url(str(bound["site_url"]).strip(), allowed_schemes),
        breakpoints=_coerce_breakpoints(bound["breakpoints"]),
        visual_pass_ratio=Threshold.parse(bound["visual_pass_ratio"]),
        max_attempts_per_component=int(bound["max_attempts_per_component"]),
        target_page_path=(str(bound["target_page_path"]).strip() or None)
        if bound.get("target_page_path")
        else None,
        evidence_dir_template=bound.get("evidence_dir_template"),
        completion_requires=[str(item) for item in completion] if isinstance(completion, list) else [],
        source_file=settings.relative_to_repo(Path(contract_file)),
        raw=values,
    )
