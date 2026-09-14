"""Minimal ``{{name}}`` template rendering for prompt files.

Double braces are used so JSON and YAML examples inside the prompts stay literal.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Mapping

_TOKEN = re.compile(r"\{\{\s*([a-zA-Z0-9_]+)\s*\}\}")


class RenderError(RuntimeError):
    """Raised when a prompt references a value the pipeline did not supply."""


def to_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (list, tuple, dict)):
        return json.dumps(value, indent=2, ensure_ascii=False)
    return str(value)


def render(template: str, values: Mapping[str, Any], *, strict: bool = True) -> str:
    unresolved: list[str] = []

    def substitute(match: re.Match[str]) -> str:
        name = match.group(1)
        if name in values:
            return to_text(values[name])
        unresolved.append(name)
        return match.group(0)

    rendered = _TOKEN.sub(substitute, template)
    if strict and unresolved:
        raise RenderError(
            "Prompt template references undefined values: " + ", ".join(sorted(set(unresolved)))
        )
    return rendered


def render_file(path: Path, values: Mapping[str, Any], *, strict: bool = True) -> str:
    if not path.is_file():
        raise RenderError(f"Prompt template not found: {path}")
    return render(path.read_text(encoding="utf-8"), values, strict=strict)


def markdown_table(rows: list[Mapping[str, Any]], columns: list[tuple[str, str]]) -> str:
    """Render ``rows`` as a GitHub-flavoured markdown table.

    ``columns`` is a list of ``(header, key)`` pairs.
    """
    if not rows:
        return "_none_"
    header = "| " + " | ".join(header for header, _ in columns) + " |"
    divider = "|" + "|".join("---" for _ in columns) + "|"
    body = [
        "| " + " | ".join(to_text(row.get(key, "")).replace("|", r"\|") for _, key in columns) + " |"
        for row in rows
    ]
    return "\n".join([header, divider, *body])


def bullet_list(items: list[Any]) -> str:
    return "\n".join(f"- {to_text(item)}" for item in items) if items else "_none_"
