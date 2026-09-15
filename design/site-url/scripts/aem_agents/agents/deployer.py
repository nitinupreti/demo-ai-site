"""Deployer agent: receives the union of component changes and deploys them."""

from __future__ import annotations

import json
from typing import Any, Iterable

from ..envelope import AgentResult
from ..render import bullet_list, markdown_table
from .base import Agent


class DeployerAgent(Agent):
    """Builds, deploys, and proves the change is live on the target instance."""

    agent_id = "deployer"

    def validate_result(self, result: AgentResult, **kwargs: Any) -> None:
        super().validate_result(result, **kwargs)
        if result.passed and not self.context.dry_run:
            self.context.record_target_url(result.output("target_url"))
            result.outputs["target_url"] = self.context.disabled_url
            result.outputs["author_url"] = self.context.author_url

    def slug(self, attempt: int = 1, **_: Any) -> str:
        return f"deployer-attempt-{attempt}"

    def prompt_values(
        self,
        changed_files: Iterable[str] | None = None,
        attempt: int = 1,
        **_: Any,
    ) -> dict[str, Any]:
        values = super().prompt_values()
        values.update(
            {
                "attempt": attempt,
                "changed_files_json": json.dumps(sorted(set(changed_files or [])), indent=2),
                "deploy_table": self.deploy_table(),
                "deploy_hygiene": self.deploy_hygiene(),
                "deploy_rules": bullet_list(
                    list(self.context.settings.migration.get("deploy.rules", []))
                ),
            }
        )
        return values

    def deploy_hygiene(self) -> str:
        """Render the one-time pre-deploy cleanup and validation build from config."""
        hygiene = self.context.settings.migration.get("deploy.hygiene", {})
        if not hygiene:
            return "_No pre-deploy hygiene configured._"
        lines: list[str] = []
        stale = list(hygiene.get("stale_paths", []))
        if stale:
            lines.append(
                "Delete these stale build artifacts **before the first build of this run**. "
                "They are the one case where clearing `target/` is justified:\n"
            )
            lines.extend(f"- `{path}`" for path in stale)
        validation = hygiene.get("validation", {})
        if validation.get("command"):
            lines.append(
                f"\nThen run one validation build — {validation.get('description', '')}:\n\n"
                f"```\n{validation['command']}\n```"
            )
        batch_rules = list(hygiene.get("batch_rules", []))
        if batch_rules:
            cycles = validation.get("max_cycles")
            budget = f" You have at most {cycles} validation cycles." if cycles else ""
            lines.append(
                f"\n**Fix every reported failure together, then rebuild once.**{budget}\n"
            )
            lines.extend(f"- {rule}" for rule in batch_rules)
        return "\n".join(lines)

    def deploy_table(self) -> str:
        """Render the scoped-deploy table from config so commands are never hardcoded."""
        port = self.context.aem_port
        host = self.context.aem_host
        migration = self.context.settings.migration
        rows: list[dict[str, Any]] = []
        for entry in migration.get("deploy.scoped", []):
            description = str(entry.get("description", ""))
            if entry.get("then"):
                description += f" — then also run the `{entry['then']}` row"
            rows.append(
                {
                    "scope": ", ".join(f"`{pattern}`" for pattern in entry.get("match", [])),
                    "description": description,
                    "command": f"`{str(entry.get('command', '')).format(port=port, host=host)}`",
                }
            )
        full = migration.get("deploy.full", {})
        table = markdown_table(
            rows,
            [("Changed paths", "scope"), ("Scope", "description"), ("Command", "command")],
        )
        tests = migration.get("deploy.focused_tests.command", None)
        extra = [table]
        if tests:
            extra.append(f"\nFocused tests: `{tests}`")
        if full:
            extra.append(
                f"\nFull reactor build ({full.get('description', '')}):\n\n"
                f"```\n{str(full.get('command', '')).format(port=port, host=host)}\n```"
            )
        return "\n".join(extra)
