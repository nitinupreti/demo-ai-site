"""Deterministic deployment worker with the pipeline's existing result interface."""

from __future__ import annotations

import json
import fnmatch
import os
from pathlib import Path
import re
import shlex
import shutil
import time
import xml.etree.ElementTree as ET
from typing import Any, Iterable

from ..config import ConfigError
from ..console import emit
from ..deployment import DeploymentError, DeploymentVerifier
from ..envelope import AgentResult, EnvelopeError
from ..render import bullet_list, markdown_table
from ..runner import BackendError, run_command
from ..workspaces import component_scopes, digest, foundation_scopes, owns, relative_path, source_manifest
from .base import Agent, dump_json


class DeployerAgent(Agent):
    """Execute deployment without a model session or application source edits."""

    agent_id = "deployer"

    def run(self, *, changed_files: Iterable[str] | None = None, attempt: int = 1, **_: Any) -> AgentResult:
        started = time.monotonic()
        slug = self.slug(attempt=attempt)
        directory = self.workspace(slug)
        directory.mkdir(parents=True, exist_ok=True)
        outputs: dict[str, Any] = {"deploy_commands": [], "deployment_model_calls": 0, "failing_components": []}
        checks = []
        result = AgentResult(self.agent_id, self.context.run_id, "PASS", outputs=outputs, checks=checks)
        baseline = {}
        try:
            files = sorted({relative_path(path) for path in changed_files or []})
            plan = self.deployment_plan(files)
            if self.context.dry_run:
                outputs.update(planned_commands=plan, skipped=True)
            else:
                baseline = source_manifest(self.context.repo_root, excluded=[self.context.evidence_dir])
                environment = {**self.env_extra(), **self.validation_environment(slug, prepare=True)}
                validation = Path(environment["MIGRATION_VALIDATION_DIR"])
                self._prepare_target()
                self._hygiene()
                validation_command = self.context.settings.migration.require("deploy.hygiene.validation.command")
                self._execute("compile", self._command(validation_command), validation, environment, outputs)
                outputs["focused_tests"] = []
                for index, test in enumerate(self.focused_test_plan(), 1):
                    try:
                        self._execute(f"focused-tests-{index}", test["command"], validation, environment, outputs,
                                      working_directory=Path(test["working_directory"]))
                    except DeploymentError as error:
                        if not error.blocked:
                            error.feedback = [{"component_id": identity, "owning_layer": "component", "hypothesis": str(error), "evidence": [str(validation / f"focused-tests-{index}.log")]} for identity in test["components"]]
                        raise
                    outputs["focused_tests"].append({**test, "status": "PASS", "evidence": str(validation / f"focused-tests-{index}.log")})
                self._assess(files, validation, environment, outputs)
                checked = directory / "validation-result.json"
                dump_json(checked, {"run_id": self.context.run_id, "commands": outputs.get("validation_commands"), "code_assessment": outputs["code_assessment"]})
                checks.append({"name": "focused_tests_pass", "status": "PASS", "evidence": str(checked)})
                outputs["stage"] = "predeploy-assets"
                outputs["predeploy_assets"] = DeploymentVerifier(self.context).predeploy_assets(validation)
                self._assert_unchanged(baseline)
                outputs["deployment_started_at"] = time.time()
                for entry in plan:
                    self._execute(entry["id"], entry["command"], validation, environment, outputs, deploy=True)
                receipt = directory / "deploy-commands.json"
                dump_json(receipt, {"run_id": self.context.run_id, "commands": outputs["deploy_commands"], "no_changed_modules": not plan})
                checks.append({"name": "scoped_deploy_succeeded", "status": "PASS", "evidence": str(receipt)})
                try:
                    runtime = self.verify_runtime(files, plan, validation, environment, outputs["deployment_started_at"])
                except DeploymentError as error:
                    mismatch = getattr(error, "reactor_evidence", None)
                    if not mismatch or any(entry["id"] == self.context.settings.migration.get("deploy.full.id", "reactor") for entry in plan):
                        raise
                    proof = self.context.evidence_file(mismatch)
                    observed = json.loads(proof.read_text(encoding="utf-8"))
                    if observed.get("run_id") != self.context.run_id or not any(row.get("differences") for row in observed.get("nodes", [])):
                        raise EnvelopeError("Reactor fallback requires current-run measured repository differences.")
                    fallback = self._reactor_plan({"reason": "scoped-runtime-mismatch", "evidence": str(proof), "sha256": digest(proof)})
                    repair_directory = validation / "reactor-fallback"
                    repair_directory.mkdir(parents=True, exist_ok=True)
                    dump_json(repair_directory / "justification.json", fallback[0]["justification"])
                    self._assert_unchanged(baseline)
                    restarted_at = time.time()
                    self._execute(fallback[0]["id"], fallback[0]["command"], repair_directory, environment, outputs, deploy=True)
                    outputs["reactor_fallback"] = fallback[0]["justification"]
                    runtime = self.verify_runtime(files, fallback, repair_directory, environment, restarted_at)
                    dump_json(receipt, {"run_id": self.context.run_id, "commands": outputs["deploy_commands"], "reactor_fallback": outputs["reactor_fallback"]})
                checks.extend(runtime["checks"])
                outputs.update(runtime["outputs"])
                self._assert_unchanged(baseline)
                required = set(self.spec.get("required_checks", []))
                if {check["name"] for check in checks} != required or any(check["status"] != "PASS" for check in checks):
                    raise EnvelopeError("Deployment runtime checks are incomplete or failed.")
                outputs["target_url"] = self.context.disabled_url
                self.validate_result(result)
        except (EnvelopeError, BackendError, ConfigError, OSError, ValueError) as error:
            result.status = "BLOCKED" if isinstance(error, BackendError) or getattr(error, "blocked", False) else "FAIL"
            result.failures.append(str(error))
            diagnostic = directory / "failure.json"
            dump_json(diagnostic, {"run_id": self.context.run_id, "error": str(error), "stage": outputs.get("stage"), "commands": outputs.get("validation_commands", []) + outputs["deploy_commands"]})
            outputs["failure_evidence"] = str(diagnostic)
            if result.status != "BLOCKED":
                feedback = self.repair_feedback(error, diagnostic, outputs)
                combined = {}
                for entry in feedback:
                    identity = entry["component_id"]
                    if identity not in combined:
                        combined[identity] = {**entry, "diagnostic": {"failures": [entry]}}
                    else:
                        previous = combined[identity]
                        shared = previous.get("owning_layer") == "foundation" or entry.get("owning_layer") == "foundation"
                        if entry.get("owning_layer") not in ("foundation", "assets", "evidence"):
                            previous["owning_layer"] = entry["owning_layer"]
                        previous["requires_foundations"] = shared or previous.get("requires_foundations", False)
                        previous["diagnostic"]["failures"].append(entry)
                outputs["failing_components"] = list(combined.values())
        result.path = str(self.result_path(slug))
        dump_json(Path(result.path), result.to_dict())
        self.context.state.record_agent_result(slug, {**result.to_dict(), "duration_seconds": time.monotonic() - started})
        emit(f"  <- Deployment worker: {result.status} | model calls: 0", "green" if result.passed else "red")
        for failure in result.failures:
            emit(f"     {failure}", "red")
        return result

    def _command(self, value: Any, **values: Any) -> list[str]:
        argv = shlex.split(value) if isinstance(value, str) else list(value or [])
        if not argv or any(not isinstance(argument, str) or not argument for argument in argv):
            raise EnvelopeError("Configured deployment commands must be nonempty argument lists or strings.")
        return [argument.format(host=self.context.aem_host, port=self.context.aem_port, **values) for argument in argv]

    def focused_test_plan(self) -> list[dict[str, Any]]:
        results = self.context.state.get("agent_results", {})
        commands: dict[tuple[str, ...], dict[str, Any]] = {}
        root = self.context.repo_root.resolve()
        for row in self.context.state.component_rows():
            identity = row["id"]
            result = results.get(f"component-{identity}-attempt-{row.get('attempts', 1)}", {})
            if result.get("status") != "PASS" or result.get("run_id") != self.context.run_id:
                raise EnvelopeError(f"No accepted current-run focused-test result for {identity}.")
            output = result.get("outputs", {})
            tests = output.get("focused_tests") or output.get("focused_test")
            tests = tests if isinstance(tests, list) else [tests]
            if not tests or any(not isinstance(test, (dict, str)) for test in tests):
                raise DeploymentError(f"Component {identity} did not report its focused test command.", feedback=[{"component_id": identity, "owning_layer": "component", "hypothesis": "Report the exact focused test command and working directory so deployment can rerun it."}])
            for test in tests:
                test = {"command": test} if isinstance(test, str) else test
                value = test.get("command")
                command = shlex.split(value) if isinstance(value, str) else list(value or [])
                if not command or any(not isinstance(argument, str) or not argument for argument in command):
                    raise EnvelopeError(f"Component {identity} has an invalid focused test command.")
                if any(argument in {";", "&&", "||", "|", ">", ">>", "&"} or "\n" in argument or "\r" in argument for argument in command):
                    raise EnvelopeError(f"Component {identity} must report shell-free focused test commands separately.")
                if Path(command[0]).stem.lower() in {"cmd", "powershell", "pwsh", "bash", "sh"} or any(argument.lower() in {"install", "deploy", "clean", "publish"} or "autoinstall" in argument.lower() for argument in command[1:]):
                    raise EnvelopeError(f"Component {identity} reported a deployment or shell command instead of a focused test.")
                worker = output.get("worker_directory")
                working_directory = str(test.get("working_directory") or test.get("cwd") or root)
                if isinstance(worker, str):
                    def relocate(value: str) -> str:
                        return value.replace(worker, str(root)).replace(worker.replace("\\", "/"), root.as_posix())
                    command = [relocate(argument) for argument in command]
                    working_directory = relocate(working_directory)
                cwd = (root / working_directory).resolve()
                if not cwd.is_relative_to(root) or not cwd.is_dir():
                    raise EnvelopeError(f"Focused test for {identity} has a working directory outside the source checkout or missing.")
                key = (str(cwd), *command)
                record = commands.setdefault(key, {"command": command, "working_directory": str(cwd), "components": []})
                record["components"].append(identity)
        return list(commands.values())

    def _execute(self, name: str, command: list[str], directory: Path, environment: dict[str, str], outputs: dict[str, Any], *, deploy: bool = False, working_directory: Path | None = None) -> None:
        outputs["stage"] = name
        log = directory / f"{name}.log"
        emit(f"  deployment {name}: {' '.join(command)}", "dim")
        exit_code = run_command(command, working_directory or self.context.repo_root, log, environment)
        record = {"id": name, "command": command, "exit_code": exit_code, "evidence": str(log)}
        outputs.setdefault("deploy_commands" if deploy else "validation_commands", []).append(record)
        if exit_code:
            text = log.read_text(encoding="utf-8", errors="replace") if log.is_file() else ""
            prerequisite = re.search(r"(?:connection refused|connect timed out|unknown host|unknownhostexception|unauthorized|authentication failed|status code:?\s*(?:401|403)|could not transfer artifact)", text, re.IGNORECASE)
            raise DeploymentError(f"Deployment {name} failed with exit code {exit_code}. See {log}", blocked=bool(prerequisite))
        if log.is_file() and not log.stat().st_size:
            log.write_text(f"Command {name} completed with exit code 0 and no output.\n", encoding="utf-8")
        self.context.evidence_file(str(log))

    def _assert_unchanged(self, baseline: dict[str, str]) -> None:
        if source_manifest(self.context.repo_root, excluded=[self.context.evidence_dir]) != baseline:
            raise EnvelopeError("Repository source changed during deployment; no source repair is authorized in this worker.")

    def _prepare_target(self) -> None:
        if self.context.target_page_path:
            return
        planner = self.context.state.get("agent_results", {}).get("planner", {}).get("outputs", {})
        target = planner.get("target_page_path")
        if not target:
            from ..merge import read_contributions
            contributions, missing = read_contributions(self.context.settings, self.context.evidence_dir, [row["plan"] for row in self.context.state.component_rows()])
            targets = {row.page_path for row in contributions if isinstance(row.page_path, str) and not row.page_path.startswith("/content/experience-fragments/")}
            if missing or len(targets) != 1:
                raise EnvelopeError("Deployment needs exactly one validated target page; set TARGET_PAGE_PATH or provide unambiguous contributions.")
            target = targets.pop()
        self.context.record_target_url(f"http://{self.context.aem_host}:{self.context.aem_port}{target}.html")

    def _hygiene(self) -> None:
        if self.context.state.get("deploy_hygiene_complete"):
            return
        root = self.context.repo_root.resolve()
        for value in self.context.settings.migration.get("deploy.hygiene.stale_paths", []):
            name = relative_path(value)
            path = root / name
            if "target" not in Path(name).parts or not path.resolve().is_relative_to(root) or path.is_symlink():
                raise EnvelopeError(f"Deployment hygiene can only remove configured build artifacts under target/: {name}")
            if path.is_dir():
                shutil.rmtree(path)
            elif path.exists():
                path.unlink()
        self.context.state.update(deploy_hygiene_complete=True)

    def _assess(self, files: list[str], directory: Path, environment: dict[str, str], outputs: dict[str, Any]) -> None:
        selected = [name for name in files if name.endswith((".java", ".cfg.json", ".config", ".cfg")) or Path(name).name == "pom.xml"]
        selected = [name for name in selected if (self.context.repo_root / name).is_file()]
        report = directory / "code-assessment.json"
        if not selected:
            dump_json(report, {"findings": [], "warnings": [], "files": [], "reason": "No changed Java, OSGi or Maven sources."})
        else:
            if self.context.toolchain is None:
                raise BackendError("The deployment worker requires the preflight JDK.")
            source = self.context.settings.resolve(str(self.context.settings.migration.require("deploy.assessment.source")))
            sources = sorted(str(path) for path in source.rglob("*.java"))
            if not sources:
                raise BackendError("The configured OOTB code-assessment analyzer is unavailable.")
            analyzer_hashes = {name: digest(Path(name)) for name in sources}
            classes = directory / "analyzer-classes"
            classes.mkdir(parents=True, exist_ok=True)
            suffix = ".exe" if os.name == "nt" else ""
            java = self.context.toolchain.java_home / "bin"
            self._execute("assessment-compile", [str(java / f"javac{suffix}"), "-d", str(classes), *sources], directory, environment, outputs)
            self._execute("assessment", [str(java / f"java{suffix}"), "-cp", str(classes), "analyzer.Analyze", str(self.context.repo_root), "--files", ",".join(selected)], directory, environment, outputs)
            if any(digest(Path(name)) != checksum for name, checksum in analyzer_hashes.items()):
                raise EnvelopeError("OOTB analyzer source changed during code assessment.")
            data = json.loads((directory / "assessment.log").read_text(encoding="utf-8"))
            if not isinstance(data, dict) or not isinstance(data.get("findings"), list) or not isinstance(data.get("warnings"), list):
                raise EnvelopeError("Code assessment returned malformed findings.")
            dump_json(report, data)
            outputs["assessment_findings"] = data["findings"]
            if data["findings"] or data["warnings"]:
                raise EnvelopeError(f"Code assessment found blocking findings or incomplete analysis. See {report}")
        outputs["code_assessment"] = str(report)

    def verify_runtime(self, files: list[str], plan: list[dict[str, Any]], directory: Path, environment: dict[str, str], started_at: float) -> dict[str, Any]:
        return DeploymentVerifier(self.context).verify(files, plan, directory, environment, started_at)

    def repair_feedback(self, error: Exception, evidence: Path, outputs: dict[str, Any]) -> list[dict[str, Any]]:
        direct = getattr(error, "feedback", None)
        if direct:
            return [{**entry, "evidence": [str(evidence), *entry.get("evidence", [])]} for entry in direct]
        diagnostics = str(error).replace("\\", "/")
        for record in outputs.get("validation_commands", []) + outputs["deploy_commands"]:
            if record["exit_code"] and Path(record["evidence"]).is_file():
                diagnostics += "\n" + Path(record["evidence"]).read_text(encoding="utf-8", errors="replace").replace("\\", "/")
        paths = {entry.get("file", "").replace("\\", "/") for entry in outputs.get("assessment_findings", [])}
        manifest = source_manifest(self.context.repo_root, excluded=[self.context.evidence_dir])
        paths.update(name for name in manifest if name in diagnostics)
        feedback = []
        for row in self.context.state.component_rows():
            component = row["plan"]
            owned = [name for name in paths if any(owns(name, scope) for scope in component_scopes(self.context.settings, component))]
            if owned:
                feedback.append({"component_id": row["id"], "owning_layer": "component", "hypothesis": str(error), "paths": owned, "evidence": [str(evidence)], "diagnostic": {"logs": [record["evidence"] for record in outputs.get("validation_commands", []) + outputs["deploy_commands"] if record["exit_code"]]}})
        shared = [name for name in paths if any(owns(name, scope) for scope in foundation_scopes(self.context.settings))]
        rows = self.context.state.component_rows()
        if shared and rows:
            feedback.append({"component_id": rows[0]["id"], "owning_layer": "foundation", "hypothesis": str(error), "paths": shared, "evidence": [str(evidence)]})
        return feedback

    def deployment_plan(self, changed_files: Iterable[str]) -> list[dict[str, Any]]:
        changed_files = [relative_path(value) for value in changed_files]
        requirement = self._reactor_requirement(changed_files)
        if requirement:
            return self._reactor_plan(requirement)
        entries = self.context.settings.migration.get("deploy.scoped", [])
        by_id = {entry["id"]: entry for entry in entries}
        if len(by_id) != len(entries):
            raise EnvelopeError("Deployment scope ids must be unique.")
        selected = set()
        for value in changed_files:
            path = relative_path(value)
            matches = {entry["id"] for entry in entries if any(fnmatch.fnmatchcase(path, pattern) for pattern in entry.get("match", []))}
            if not matches:
                raise EnvelopeError(f"No configured deployment scope covers {path}.")
            if len(matches) != 1:
                raise EnvelopeError(f"Ambiguous deployment scopes for {path}: {', '.join(sorted(matches))}")
            selected.update(matches)
        ordered = []
        visiting = set()
        visited = set()

        def visit(scope_id: str) -> None:
            if scope_id in visiting:
                raise EnvelopeError("Deployment dependencies contain a cycle.")
            if scope_id in visited:
                return
            visiting.add(scope_id)
            for dependency in by_id[scope_id].get("depends_on", []):
                if dependency not in by_id:
                    raise EnvelopeError(f"Unknown deployment dependency: {dependency}")
                if dependency in selected:
                    visit(dependency)
            visiting.remove(scope_id)
            visited.add(scope_id)
            ordered.append({"id": scope_id, "command": self._command(by_id[scope_id].get("command"))})

        for scope_id in by_id:
            if scope_id in selected:
                visit(scope_id)
        return ordered

    def _reactor_plan(self, justification: dict[str, Any]) -> list[dict[str, Any]]:
        configured = self.context.settings.migration.require("deploy.full")
        command = self._command(configured.get("command"))
        if "-pl" not in command:
            raise EnvelopeError("The configured reactor command must declare its selected modules.")
        return [{"id": configured.get("id", "reactor"), "command": command,
                 "verify_modules": configured.get("verify_modules", command[command.index("-pl") + 1].split(",")),
                 "justification": justification}]

    def _reactor_requirement(self, files: list[str]) -> dict[str, Any] | None:
        if not any(Path(name).name == "pom.xml" for name in files):
            return None
        planner = self.context.state.get("agent_results", {}).get("planner", {})
        original = planner.get("outputs", {}).get("worker_directory")
        if planner.get("status") != "PASS" or planner.get("run_id") != self.context.run_id or not isinstance(original, str):
            return None
        before = Path(original).resolve()
        if not before.is_relative_to(self.context.evidence_dir.resolve()) or not (before / "pom.xml").is_file():
            raise EnvelopeError("The accepted planner source snapshot is unavailable for reactor justification.")
        root = self.context.repo_root
        namespace = {"m": "http://maven.apache.org/POM/4.0.0"}
        def graph(directory: Path) -> dict[str, Any]:
            found = {}
            def visit(module: str) -> None:
                path = directory / module / "pom.xml"
                if not path.is_file():
                    raise EnvelopeError(f"Reactor module has no pom.xml: {module}")
                document = ET.parse(path).getroot()
                group = document.findtext("m:groupId", namespaces=namespace) or document.findtext("m:parent/m:groupId", namespaces=namespace)
                artifact = document.findtext("m:artifactId", namespaces=namespace)
                dependencies = {(entry.findtext("m:groupId", namespaces=namespace), entry.findtext("m:artifactId", namespaces=namespace)) for entry in document.findall("m:dependencies/m:dependency", namespace)}
                found[module] = {"coordinate": (group, artifact), "dependencies": dependencies, "sha256": digest(path)}
                for child in document.findall("m:modules/m:module", namespace):
                    child_module = relative_path((Path(module) / str(child.text)).as_posix())
                    if child_module in found:
                        raise EnvelopeError("Reactor modules contain repeated or cyclic paths.")
                    visit(child_module)
            visit("")
            return found
        old, current = graph(before), graph(root)
        coordinates = {row["coordinate"] for row in current.values()}
        reasons = []
        for module, row in current.items():
            previous = old.get(module)
            if previous is None:
                reasons.append({"module": module, "new_artifact": list(row["coordinate"]), "sha256": row["sha256"]})
            else:
                added = sorted((row["dependencies"] - previous["dependencies"]) & coordinates)
                if added:
                    reasons.append({"module": module, "new_internal_dependencies": [list(value) for value in added], "before_sha256": previous["sha256"], "sha256": row["sha256"]})
        if not reasons:
            return None
        full = self._reactor_plan({})[0]["command"]
        selected = full[full.index("-pl") + 1].split(",")
        if any(module not in current for module in selected):
            raise EnvelopeError("Configured reactor command contains modules absent from the Maven project.")
        unsupported = [name for name in files if name != "pom.xml" and not any(name.startswith(module + "/") for module in current if module)]
        if unsupported:
            raise EnvelopeError("Reactor justification does not cover paths outside Maven modules: " + ", ".join(unsupported))
        return {"reason": "new-cross-module-artifact-or-dependency", "baseline": str(before), "changes": reasons}

    def validate_result(self, result: AgentResult, **kwargs: Any) -> None:
        super().validate_result(result, **kwargs)
        if result.passed and not self.context.dry_run:
            frontend = self.context.state.get("frontend_build", {})
            if frontend.get("status") == "PASS":
                current = source_manifest(self.context.repo_root, excluded=[self.context.evidence_dir])
                module = str(self.context.settings.migration.get("deploy.frontend.root", "ui.frontend"))
                inputs = {path: value for path, value in current.items() if owns(path, module + "/**")}
                outputs = {path: value for path, value in current.items() if any(owns(path, scope) for scope in self.context.settings.migration.get("deploy.frontend.outputs", []))}
                if inputs != frontend.get("inputs") or outputs != frontend.get("outputs"):
                    raise EnvelopeError("Frontend source or generated clientlibs changed after the serialized build; deployment cannot be accepted.")
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
                "frontend_build_json": json.dumps(self.context.state.get("frontend_build", {}), indent=2),
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
