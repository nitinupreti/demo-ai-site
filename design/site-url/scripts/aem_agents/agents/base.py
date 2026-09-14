"""Shared agent machinery: run context and the base agent."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping

from ..config import AgentSpec, Settings
from ..console import emit
from ..contract import RunContract
from ..envelope import AgentResult, EnvelopeError, read_result
from ..render import render_file
from ..runner import CopilotBackend
from ..state import RunState
from ..toolchain import Toolchain


@dataclass
class RunContext:
    """Everything an agent needs, resolved once by the orchestrator."""

    settings: Settings
    contract: RunContract
    backend: CopilotBackend
    state: RunState
    run_id: str
    evidence_dir: Path
    logger: Any
    dry_run: bool = False
    toolchain: Toolchain | None = None

    @property
    def repo_root(self) -> Path:
        return self.settings.repo_root

    def rel(self, path: Path) -> str:
        return self.settings.relative_to_repo(path)

    @property
    def aem_host(self) -> str:
        return self.settings.env_value("aem.host_env", "aem.default_host")

    @property
    def aem_port(self) -> str:
        return self.settings.env_value("aem.port_env", "aem.default_port")

    @property
    def credentials_env(self) -> str:
        return str(self.settings.migration.get("aem.credentials_env", "AEM_CREDENTIALS"))

    def _page_url(self, pattern_key: str) -> str:
        path = self.contract.target_page_path or ""
        if not path:
            return (
                "(unresolved — TARGET_PAGE_PATH is not set; create or resolve the page, "
                "then report it as outputs.target_url)"
            )
        if not path.startswith("/"):
            path = "/" + path
        pattern = str(self.settings.migration.require(pattern_key))
        return pattern.format(host=self.aem_host, port=self.aem_port, path=path)

    @property
    def disabled_url(self) -> str:
        return self._page_url("aem.disabled_url_pattern")

    @property
    def author_url(self) -> str:
        return self._page_url("aem.author_url_pattern")

    def base_values(self) -> dict[str, Any]:
        """Prompt placeholders every agent template may reference."""
        migration = self.settings.migration
        return {
            "run_id": self.run_id,
            "site_url": self.contract.site_url,
            "target_page_path": self.contract.target_page_path or "(not set — create or reuse a page)",
            "breakpoints": ", ".join(str(width) for width in self.contract.breakpoints),
            "visual_pass_ratio": str(self.contract.visual_pass_ratio),
            "max_attempts": self.contract.max_attempts_per_component,
            "contract_file": self.contract.source_file,
            "evidence_dir": self.rel(self.evidence_dir),
            "companion_docs": ", ".join(
                f"`{doc}`" for doc in migration.get("contract.companion_docs", [])
            ),
            "aem_host": self.aem_host,
            "aem_port": self.aem_port,
            "aem_base_url": f"http://{self.aem_host}:{self.aem_port}",
            "disabled_url": self.disabled_url,
            "author_url": self.author_url,
            "credentials_env": self.credentials_env,
            "project_name": str(migration.get("project.name", "demo-ai-site")),
            "java_package": str(migration.get("project.java_package", "com.demo.core")),
            "stability_samples": migration.get("parity.stability_samples", 3),
            "stability_interval_ms": migration.get("parity.stability_interval_ms", 500),
            "min_components": migration.get("fanout.min_components", 1),
            "max_components": migration.get("fanout.max_components", 40),
            "reuse_survey": "\n".join(
                f"- **{name.replace('_', ' ')}**: `{path}`"
                for name, path in migration.get("reuse.survey_roots", {}).items()
            ),
            "xf_first_roles": ", ".join(
                f"`{role}`" for role in migration.get("reuse.experience_fragment_first", [])
            ),
            "xf_root": str(migration.get("reuse.experience_fragment_root", "")),
            "xf_variation": str(migration.get("reuse.experience_fragment_variation", "master")),
            "xf_component": str(migration.get("reuse.experience_fragment_component", "")),
            "java_home": str(self.toolchain.java_home) if self.toolchain else "",
            "browser_tools_dir": str(migration.get("parity.tools_dir", "")),
        }


class Agent:
    """Base class: render a prompt, run the backend, validate the envelope."""

    #: Overridden by each subclass to pick its entry in ``agents.yaml``.
    agent_id: str = ""

    def __init__(self, context: RunContext) -> None:
        self.context = context
        self.spec: AgentSpec = context.settings.agent(self.agent_id)

    # -- overridable -------------------------------------------------------

    def prompt_values(self, **kwargs: Any) -> dict[str, Any]:
        """Template placeholders for this agent. Subclasses add their own."""
        return self.context.base_values()

    def slug(self, **kwargs: Any) -> str:
        """Workspace sub-directory name; fan-out agents make this unique."""
        return self.agent_id

    # -- execution ---------------------------------------------------------

    def workspace(self, slug: str) -> Path:
        root = self.context.evidence_dir / str(
            self.context.settings.migration.get("run.agent_workspace_dir", "agents")
        )
        return root / slug

    def result_path(self, slug: str) -> Path:
        return self.workspace(slug) / str(
            self.context.settings.migration.get("run.result_file", "result.json")
        )

    def backend_options(self) -> dict[str, Any]:
        migration = self.context.settings.migration
        return {
            "model": self.spec.get("model", None) or migration.get("model.default", None) or "",
            "effort": self.spec.get("effort", None) or migration.get("model.effort", None) or "",
            "max_continues": self.spec.get("max_continues", None)
            or migration.get("model.max_continues", 20),
            "max_ai_credits": migration.get("model.max_ai_credits", None) or "",
        }

    def render_prompt(self, slug: str, **kwargs: Any) -> str:
        values = self.prompt_values(**kwargs)
        values.setdefault("result_path", self.context.rel(self.result_path(slug)))
        template = self.context.settings.resolve(str(self.spec.prompt_path))
        return render_file(template, values)

    def run(self, **kwargs: Any) -> AgentResult:
        context = self.context
        slug = self.slug(**kwargs)
        workspace = self.workspace(slug)
        workspace.mkdir(parents=True, exist_ok=True)

        prompt = self.render_prompt(slug, **kwargs)
        prompt_file = workspace / str(context.settings.migration.get("run.prompt_file", "prompt.md"))
        prompt_file.write_text(prompt, encoding="utf-8")

        result_path = self.result_path(slug)
        result_path.unlink(missing_ok=True)

        label = f"{self.spec.title} [{slug}]"
        emit(f"  -> {label} starting", "cyan")
        context.logger.info("Starting agent %s (prompt: %s)", slug, prompt_file)

        if context.dry_run:
            emit(f"  -- {label} skipped (dry run)", "dim")
            return AgentResult(agent=self.agent_id, run_id=context.run_id, status="PASS")

        run = context.backend.run(
            prompt=prompt,
            options=self.backend_options(),
            workspace=workspace,
            stream_name=str(context.settings.migration.get("run.stream_file", "stream.jsonl")),
            stderr_name=str(context.settings.migration.get("run.stderr_file", "stderr.log")),
            timeout_seconds=self.spec.timeout_seconds,
            env_extra=self.env_extra(),
            on_event=lambda event: self._on_event(label, event),
        )
        context.logger.info(
            "Agent %s exited with %s in %.1fs", slug, run.exit_code, run.duration_seconds
        )

        if run.timed_out:
            raise EnvelopeError(
                f"{label} exceeded its {self.spec.timeout_seconds}s budget and was stopped. "
                f"Raise timeout_seconds in agents.yaml or narrow the work. Stream: {run.stream_path}"
            )
        if not run.ok:
            raise EnvelopeError(
                f"{label} exited with code {run.exit_code}. See {run.stderr_path}"
            )

        result = read_result(result_path, self.spec, context.run_id)
        color = "green" if result.passed else ("yellow" if result.blocked else "red")
        emit(f"  <- {label} {result.summary()}", color)
        context.state.record_agent_result(slug, {**result.to_dict(), "duration_seconds": run.duration_seconds})
        return result

    def env_extra(self) -> dict[str, str]:
        migration = self.context.settings.migration
        environment = {
            "MIGRATION_RUN_ID": self.context.run_id,
            "MIGRATION_SITE_URL": self.context.contract.site_url,
            "MIGRATION_EVIDENCE_DIR": self.context.rel(self.context.evidence_dir),
            "AEM_HOST": self.context.aem_host,
            "AEM_PORT": str(self.context.aem_port),
        }
        if self.context.toolchain:
            environment.update(self.context.toolchain.environment())
        browsers = migration.get("parity.browsers_path", None)
        if browsers:
            environment["PLAYWRIGHT_BROWSERS_PATH"] = str(
                self.context.settings.resolve(str(browsers))
            )
        return environment

    def _on_event(self, label: str, event: Mapping[str, Any]) -> None:
        events = self.context.settings.migration.section("backend.copilot.events")
        event_type = event.get("type")
        data = event.get("data") or {}

        if event_type == events.get("error", "session.error"):
            message = data.get("message") or data.get("error") or "unknown error"
            emit(f"  !! {label} {message}", "red")
            self.context.logger.error("%s backend error: %s", label, message)
            return

        if event_type == events.get("message", "assistant.message"):
            for request in data.get("toolRequests") or []:
                name = request.get("name") or request.get("toolName") or "tool"
                arguments = request.get("arguments") or request.get("input") or {}
                detail = ""
                if isinstance(arguments, Mapping):
                    for key in ("file_path", "path", "url", "command", "query", "description"):
                        if arguments.get(key):
                            detail = str(arguments[key])
                            break
                detail = " ".join(detail.split())[:120]
                self.context.logger.debug("%s tool %s %s", label, name, detail)
                emit(f"     [{slug_of(label)}] {name}: {detail}", "dim")
            content = data.get("content")
            if isinstance(content, str) and content.strip():
                self.context.logger.debug("%s says: %s", label, content.strip()[:2000])


def slug_of(label: str) -> str:
    return label.split("[", 1)[-1].rstrip("]") if "[" in label else label


def dump_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
