"""Read-only AEM deployment verification; no model decisions or repository writes."""

from __future__ import annotations

import base64
import csv
from datetime import datetime
import hashlib
from html.parser import HTMLParser
import json
import os
from pathlib import Path
import re
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
from typing import Any, Mapping

from .assets import _declared_assets
from .envelope import EnvelopeError
from .runner import run_command
from .style_parity import validate_targets
from .workspaces import component_scopes, digest, foundation_scopes, owns, relative_path


class DeploymentError(EnvelopeError):
    def __init__(self, message: str, *, blocked: bool = False, feedback: list[dict[str, Any]] | None = None, reactor_evidence: str | None = None) -> None:
        super().__init__(message)
        self.blocked = blocked
        self.feedback = feedback or []
        self.reactor_evidence = reactor_evidence


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, newurl):
        return None

class HtlBindings(HTMLParser):
    def __init__(self, text: str) -> None:
        super().__init__()
        self.models: dict[str, str] = {}
        self.feed(text)

    def handle_starttag(self, tag, attrs):
        for name, value in attrs:
            if name.startswith("data-sly-use.") and value and re.fullmatch(r"(?:[A-Za-z_$][\w$]*\.)+[A-Z][\w$]*", value):
                self.models[value] = name.removeprefix("data-sly-use.")


def jcr_value(raw: str) -> Any:
    kind = "String"
    if raw.startswith("{") and "}" in raw:
        kind, raw = raw[1:].split("}", 1)
    if raw.startswith("[") and raw.endswith("]"):
        values = next(csv.reader([raw[1:-1]], escapechar="\\")) if raw[1:-1] else []
        return [jcr_value(f"{{{kind}}}{value}") for value in values]
    if kind == "Boolean":
        if raw.lower() not in ("true", "false"):
            raise EnvelopeError("Invalid FileVault Boolean value.")
        return raw.lower() == "true"
    if kind in ("Long", "Double", "Decimal"):
        return int(raw) if kind == "Long" else float(raw)
    if kind in ("String", "Name", "Path", "URI", "Date", "Reference", "WeakReference"):
        return raw.removeprefix("\\") if raw.startswith(("\\[", "\\{")) else raw
    raise EnvelopeError(f"Unsupported FileVault property type: {kind}")


def repository_differences(element: ET.Element, live: Mapping[str, Any], namespaces: Mapping[str, str], path: str, filesystem_children: set[str] | None = None) -> list[dict[str, Any]]:
    def name(value: str) -> str:
        for prefix, uri in namespaces.items():
            value = value.replace("{" + uri + "}", prefix + ":")
        return value

    managed = {"jcr:created", "jcr:createdBy", "jcr:lastModified", "jcr:lastModifiedBy", "jcr:uuid", "jcr:versionHistory", "jcr:baseVersion", "jcr:predecessors", "jcr:isCheckedOut", "cq:lastModified", "cq:lastModifiedBy", "cq:lastReplicated", "cq:lastReplicatedBy", "cq:lastReplicationAction"}
    properties = {name(key): jcr_value(value) for key, value in element.attrib.items()}
    differences = []
    for key, expected in properties.items():
        if key in managed:
            continue
        actual = live.get(key)
        if actual != expected or type(actual) is not type(expected):
            differences.append({"path": path, "property": key, "expected": expected, "actual": actual, "error": "Authored property differs from package intent."})
    for key, value in live.items():
        if not isinstance(value, dict) and key not in properties and key not in managed:
            differences.append({"path": path, "property": key, "expected": None, "actual": value, "error": "Unexpected stale authored property."})
    children = {name(child.tag): child for child in element}
    actual_children = [key for key, value in live.items() if isinstance(value, dict) and key != "rep:policy" and (key in children or key not in (filesystem_children or set()))]
    if actual_children != list(children):
        differences.append({"path": path, "expected": list(children), "actual": actual_children, "error": "Child cardinality or order differs from package intent."})
    for key, child in children.items():
        if isinstance(live.get(key), dict):
            differences.extend(repository_differences(child, live[key], namespaces, path + "/" + key))
    return differences


class DeploymentVerifier:
    def __init__(self, context: Any) -> None:
        self.context = context
        self.origin = f"http://{context.aem_host}:{context.aem_port}"
        self.opener = urllib.request.build_opener(NoRedirect())

    def request(self, path: str) -> bytes:
        if not path.startswith("/") or path.startswith("//") or any(part in (".", "..") for part in path.split("/")):
            raise EnvelopeError("Deployment verification requires a path on the configured AEM origin.")
        credentials = os.environ.get(self.context.credentials_env) or str(self.context.settings.migration.get("aem.default_credentials", ""))
        authorization = base64.b64encode(credentials.encode("utf-8")).decode("ascii")
        request = urllib.request.Request(self.origin + urllib.parse.quote(path, safe="/:.?=&"), headers={"Authorization": "Basic " + authorization, "Referer": self.origin + "/"})
        try:
            with self.opener.open(request, timeout=60) as response:
                if response.status != 200:
                    raise DeploymentError(f"AEM verification failed for {path}: HTTP {response.status}")
                return response.read()
        except urllib.error.HTTPError as error:
            raise DeploymentError(f"AEM verification failed for {path}: HTTP {error.code}", blocked=error.code in (301, 302, 303, 307, 308, 401, 403)) from error
        except (urllib.error.URLError, OSError) as error:
            raise DeploymentError("AEM is unavailable during deployment verification.", blocked=True) from error

    def json(self, path: str) -> dict[str, Any]:
        try:
            value = json.loads(self.request(path))
        except (ValueError, UnicodeError) as error:
            raise DeploymentError(f"AEM did not return valid JSON for {path}.") from error
        if not isinstance(value, dict):
            raise DeploymentError(f"AEM returned an unexpected JSON shape for {path}.")
        return value

    def installed_artifacts(self, plan: list[dict[str, Any]], started_at: float) -> list[dict[str, Any]]:
        records = []
        root = self.context.repo_root
        namespace = {"m": "http://maven.apache.org/POM/4.0.0"}
        modules = []
        for entry in plan:
            command = entry["command"]
            if "-pl" not in command:
                raise DeploymentError("Scoped deployment must identify its Maven module with -pl.")
            modules.extend(entry.get("verify_modules", command[command.index("-pl") + 1].split(",")))
        for value in dict.fromkeys(modules):
            module = relative_path(value)
            pom = ET.parse(root / module / "pom.xml").getroot()
            if pom.findtext("m:packaging", namespaces=namespace) != "content-package":
                continue
            artifact = pom.findtext("m:artifactId", namespaces=namespace)
            version = pom.findtext("m:version", namespaces=namespace) or pom.findtext("m:parent/m:version", namespaces=namespace)
            archive = root / module / "target" / f"{artifact}-{version}.zip"
            if not archive.is_file():
                raise DeploymentError(f"The built package is missing for {module}.")
            try:
                with zipfile.ZipFile(archive) as package:
                    properties = ET.fromstring(package.read("META-INF/vault/properties.xml"))
            except (zipfile.BadZipFile, KeyError, ET.ParseError) as error:
                raise DeploymentError(f"Package metadata is invalid for {module}.") from error
            coordinates = {entry.attrib.get("key"): entry.text for entry in properties.findall("entry")}
            if any(not coordinates.get(key) for key in ("group", "name", "version")):
                raise DeploymentError(f"Package metadata is incomplete for {module}.")
            definition = self.json(f"/etc/packages/{coordinates['group']}/{coordinates['name']}-{coordinates['version']}.zip/jcr:content/vlt:definition.json")
            unpacked = definition.get("lastUnpacked")
            try:
                stamp = float(unpacked) / 1000 if isinstance(unpacked, (int, float)) else datetime.fromisoformat(str(unpacked).replace("Z", "+00:00")).timestamp()
            except (ValueError, TypeError):
                raise DeploymentError(f"Package installation timestamp is missing for {module}.") from None
            if stamp < started_at - 5:
                raise DeploymentError(f"Package {module} has no current-attempt installation evidence.")
            records.append({"module": module, "package": coordinates, "lastUnpacked": unpacked, "sha256": digest(archive)})
        manifest = root / "core/target/classes/META-INF/MANIFEST.MF"
        if not manifest.is_file():
            raise DeploymentError("The built core bundle manifest is missing.")
        text = manifest.read_text(encoding="utf-8").replace("\n ", "")
        headers = dict(line.split(": ", 1) for line in text.splitlines() if ": " in line)
        symbolic_name = headers.get("Bundle-SymbolicName", "").split(";", 1)[0]
        version = headers.get("Bundle-Version")
        bundles = self.json("/system/console/bundles.json").get("data", [])
        matching = [bundle for bundle in bundles if bundle.get("symbolicName") == symbolic_name]
        if not symbolic_name or not version or len(matching) != 1 or matching[0].get("stateRaw") != 32 or matching[0].get("version") != version:
            raise DeploymentError("The expected core bundle version is not uniquely installed and active.")
        records.append({"bundle": symbolic_name, "version": version, "state": "Active"})
        return records

    def predeploy_assets(self, directory: Path) -> str:
        components = [row["plan"] for row in self.context.state.component_rows()]
        report = directory / "predeploy-assets.json"
        records, failures = [], []
        for asset in _declared_assets(self.context.settings, self.context.evidence_dir, components):
            try:
                payload = self.request(asset["dam_path"])
                if not payload:
                    raise DeploymentError("DAM asset is empty: " + asset["dam_path"])
                records.append({"path": asset["dam_path"], "bytes": len(payload), "status": "PASS"})
            except DeploymentError as error:
                if error.blocked:
                    report.write_text(json.dumps({"run_id": self.context.run_id, "assets": records, "error": str(error)}), encoding="utf-8")
                    raise
                failures.extend({"component_id": owner, "owning_layer": "assets", "hypothesis": str(error), "evidence": [str(report)]} for owner in set(asset["owners"]))
        report.write_text(json.dumps({"run_id": self.context.run_id, "assets": records, "failures": failures}, indent=2), encoding="utf-8")
        if failures:
            raise DeploymentError("Declared DAM assets are unavailable; deployment was not started.", feedback=failures)
        return str(report)

    def repository(self, files: list[str]) -> list[dict[str, Any]]:
        namespaces = self.context.settings.migration.get("shared_files.authored_page.namespaces", {})
        def decode_path(value: str) -> str:
            segments = []
            for segment in value.split("/"):
                for prefix in namespaces:
                    if segment.startswith("_" + prefix + "_"):
                        segment = prefix + ":" + segment[len(prefix) + 2:]
                        break
                segments.append(segment)
            return "/".join(segments)

        reports = []
        for value in files:
            name = relative_path(value)
            if "/jcr_root/" not in name:
                continue
            path = decode_path("/" + name.split("/jcr_root/", 1)[1])
            source = self.context.repo_root / name
            if not source.is_file():
                raise DeploymentError(f"Deleted repository content requires an explicit reconciliation policy: {name}")
            if name.endswith("/.content.xml"):
                path = path[:-len("/.content.xml")]
                expected = ET.parse(source).getroot()
                document_namespaces = {**namespaces, **{prefix: uri for _, (prefix, uri) in ET.iterparse(source, events=["start-ns"])}}
                filesystem_children = {decode_path(child.name) for child in source.parent.iterdir() if child.name != ".content.xml"}
                differences = repository_differences(expected, self.json(path + ".infinity.json"), document_namespaces, path, filesystem_children)
            elif path.startswith("/apps/"):
                actual = self.request(path + "/jcr:content/jcr:data")
                differences = [] if actual == source.read_bytes() else [{"path": path, "expected_sha256": digest(source), "actual_sha256": hashlib.sha256(actual).hexdigest(), "error": "Deployed source bytes differ from the built package intent."}]
            else:
                raise DeploymentError(f"No deterministic repository check is configured for {name}.")
            reports.append({"source": name, "path": path, "differences": differences})
        if not reports:
            raise DeploymentError("No checked-in repository intent was available for verification.")
        return reports

    def repository_feedback(self, reports: list[dict[str, Any]], components: list[dict[str, Any]], evidence: Path) -> list[dict[str, Any]]:
        from .merge import read_contributions
        contributions, _ = read_contributions(self.context.settings, self.context.evidence_dir, components)
        feedback = []
        for report in reports:
            if not report["differences"]:
                continue
            owners = {component["id"] for component in components if any(owns(report["source"], scope) for scope in component_scopes(self.context.settings, component))}
            for contribution in contributions:
                if contribution.page_path == report["path"]:
                    parent = contribution.parent_path or str(self.context.settings.migration.get("shared_files.authored_page.default_parent", "jcr:content/root"))
                    prefixes = [f"{contribution.page_path}/{parent.strip('/')}/{node.get('name', '')}" for node in contribution.nodes]
                    if any(any(delta["path"] == prefix or delta["path"].startswith(prefix + "/") for prefix in prefixes) for delta in report["differences"]):
                        owners.add(contribution.component_id)
            layer = "component"
            if any(owns(report["source"], scope) for scope in foundation_scopes(self.context.settings)):
                owners = {components[0]["id"]}
                layer = "foundation"
            feedback.extend({"component_id": identity, "owning_layer": layer, "hypothesis": "Live repository differs from package intent.", "diagnostic": {"differences": report["differences"]}, "evidence": [str(evidence)]} for identity in sorted(owners))
        return feedback

    def browser_input(self, components: list[dict[str, Any]]) -> dict[str, Any]:
        results = self.context.state.get("agent_results", {})
        configured = []
        for component in components:
            prefix = f"component-{component['id']}-attempt-"
            accepted = [(int(slug[len(prefix):]), result) for slug, result in results.items() if slug.startswith(prefix) and slug[len(prefix):].isdigit() and result.get("status") == "PASS" and result.get("run_id") == self.context.run_id]
            if not accepted:
                raise DeploymentError(f"No accepted current-run component result for {component['id']}.")
            output = max(accepted, key=lambda row: row[0])[1].get("outputs", {})
            targets = output.get("parity_targets")
            validate_targets(targets, component)
            try:
                runtime = self.component_runtime(component, output)
            except EnvelopeError as error:
                if isinstance(error, DeploymentError) and error.feedback:
                    raise
                raise DeploymentError(str(error), feedback=[{"component_id": component["id"], "owning_layer": "component", "hypothesis": str(error)}]) from error
            configured.append({**component, "targets": targets, **runtime})
        return {"schema_version": 1, "run_id": self.context.run_id, "aem_urls": {"disabled": self.context.disabled_url, "author": self.context.author_url},
                "target_page_path": self.context.target_page_path, "credentials_env": self.context.credentials_env,
                "breakpoints": self.context.contract.breakpoints, "modes": self.context.settings.migration.get("parity.modes", ["disabled", "author"]),
                "components": configured, "assets": _declared_assets(self.context.settings, self.context.evidence_dir, components),
                "token_prefix": self.context.settings.migration.get("css.token_layer.prefix", "--site-")}

    def component_runtime(self, component: dict[str, Any], output: dict[str, Any]) -> dict[str, Any]:
        root = self.context.repo_root
        scopes = component_scopes(self.context.settings, component)
        files = []
        for scope in scopes:
            path = root / (scope[:-3] if scope.endswith("/**") else scope)
            files.extend(path.rglob("*") if path.is_dir() else [path])
        required_models = set()
        model_sources = {}
        libraries = set()
        templates = {}
        for path in files:
            if not path.is_file():
                continue
            if path.suffix == ".java":
                text = path.read_text(encoding="utf-8")
                if re.search(r"@(?:org\.apache\.sling\.models\.annotations\.)?Model\s*\(", text):
                    package = re.search(r"\bpackage\s+([\w.]+)\s*;", text)
                    model = re.search(r"\b(?:class|interface)\s+(\w+)", text)
                    if not package or not model:
                        raise DeploymentError("Cannot identify a Sling Model for runtime verification: " + str(path))
                    required_models.add(package[1] + "." + model[1])
                    model_sources[package[1] + "." + model[1]] = text
            if path.suffix == ".html":
                text = path.read_text(encoding="utf-8")
                bindings = HtlBindings(text).models
                required_models.update(bindings)
                templates[path.relative_to(root).as_posix()] = (text, bindings)
            if path.name == ".content.xml":
                node = ET.parse(path).getroot()
                if node.get("{http://www.jcp.org/jcr/1.0}primaryType") == "cq:ClientLibraryFolder":
                    libraries.add(path.relative_to(root).as_posix())
        contract = output.get("runtime_contract", {})
        if not isinstance(contract, dict):
            raise DeploymentError("Component runtime_contract must be an object.")
        probes = contract.get("model_probes", [])
        clientlibs = contract.get("clientlibs", [])
        if not isinstance(probes, list) or not isinstance(clientlibs, list):
            raise DeploymentError("Model probes and clientlibs must be arrays.")
        covered = set()
        for probe in probes:
            if not isinstance(probe, dict) or probe.get("model") not in required_models or probe.get("kind") not in ("htl", "exporter"):
                raise DeploymentError("Runtime model probe has an unknown class or kind.")
            resource = probe.get("resource_path")
            authored = output.get("authored_paths", [])
            if not isinstance(resource, str) or not resource.startswith("/content/") or not any(resource == name or resource.startswith(name.rstrip("/") + "/") for name in authored if isinstance(name, str)):
                raise DeploymentError("Model probe must address an authored resource belonging to its component.")
            if any(segment in ("", ".", "..") for segment in resource.split("/")[1:]) or any(character in resource for character in "?#\\\r\n"):
                raise DeploymentError("Model probe needs a JCR resource path, not a URL.")
            if probe["kind"] == "htl":
                template = templates.get(probe.get("template"))
                expression = probe.get("expression")
                rendered_model = probe.get("via_model", probe["model"])
                binding = template[1].get(rendered_model) if template else None
                if rendered_model != probe["model"] and (rendered_model not in model_sources or not re.search(r"\b" + re.escape(probe["model"].rsplit(".", 1)[-1]) + r"\b", model_sources[rendered_model])):
                    raise DeploymentError("A child-model probe must reference its actual parent model source.")
                if not binding or not isinstance(expression, str) or not expression.startswith("${") or expression not in template[0] or not re.search(r"\b" + re.escape(binding) + r"\.", expression):
                    raise DeploymentError("HTL probe must identify an actual model-bound expression in its owned template.")
                if not isinstance(probe.get("selector"), str) or not probe["selector"] or not isinstance(probe.get("text"), str) or not probe["text"]:
                    raise DeploymentError("HTL model probe requires a selector and exact expected rendered text.")
            else:
                rendered_model = probe.get("via_model", probe["model"])
                model_source = model_sources.get(rendered_model, "")
                if not re.search(r"@(?:org\.apache\.sling\.models\.annotations\.)?Exporter\s*\(", model_source):
                    raise DeploymentError("Exporter probe must identify an existing exporter in the owned model source; use HTL otherwise.")
                if rendered_model != probe["model"] and not re.search(r"\b" + re.escape(probe["model"].rsplit(".", 1)[-1]) + r"\b", model_source):
                    raise DeploymentError("An exported child-model probe must reference its actual parent model source.")
                if not isinstance(probe.get("expected"), dict) or not probe["expected"] or not any(key != ":type" for key in probe["expected"]):
                    raise DeploymentError("Exporter probe requires expected model values, not only a resource type.")
            covered.add(probe["model"])
        missing = sorted(required_models - covered)
        if missing:
            raise DeploymentError("Missing live adaptation probes for: " + ", ".join(missing), feedback=[{"component_id": component["id"], "owning_layer": "component", "hypothesis": "Supply live HTL/exporter probes for these models, preserving application behavior.", "diagnostic": {"models": missing}}])
        covered_libraries = set()
        for library in clientlibs:
            if not isinstance(library, dict) or library.get("kind") not in ("stylesheet", "script") or not isinstance(library.get("path"), str) or not library["path"].startswith(("/etc.clientlibs/", "/apps/")):
                raise DeploymentError("Clientlib runtime mapping must identify a local CSS or JS request.")
            sources = library.get("sources", [])
            if not isinstance(sources, list) or not sources:
                raise DeploymentError("Clientlib mappings must name their source library definitions.")
            for name in sources:
                relative_path(name)
                if name not in libraries:
                    raise DeploymentError("Clientlib mapping names an unowned library definition.")
            self.validate_clientlib_mapping(library)
            covered_libraries.update(sources)
        if libraries - covered_libraries:
            raise DeploymentError("Missing runtime mappings for component clientlibs.", feedback=[{"component_id": component["id"], "owning_layer": "component", "hypothesis": "Map every component clientlib to its actual requested CSS/JS, including embedding bundles.", "diagnostic": {"clientlibs": sorted(libraries - covered_libraries)}}])
        identities = {(probe["model"], probe["resource_path"], probe["kind"]) for probe in probes}
        if len(identities) != len(probes):
            raise DeploymentError("Duplicate model probes for the same resource and transport.")
        return {"model_probes": probes, "clientlibs": clientlibs}

    def validate_clientlib_mapping(self, library: dict[str, Any]) -> None:
        path = urllib.parse.urlsplit(library["path"])
        if path.query or path.fragment or path.netloc or any(part in ("", ".", "..") for part in path.path.split("/")[1:]):
            raise DeploymentError("Clientlib mapping requires an exact local library path.")
        extension = ".css" if library["kind"] == "stylesheet" else ".js"
        if not path.path.endswith(extension):
            raise DeploymentError("Clientlib path extension does not match its resource kind.")
        jcr = path.path[:-len(extension)]
        if jcr.endswith(".min"):
            jcr = jcr[:-4]
        if jcr.startswith("/etc.clientlibs/"):
            jcr = "/apps/" + jcr[len("/etc.clientlibs/"):]
        directory = self.context.repo_root / "ui.apps/src/main/content/jcr_root"
        definition = directory / jcr[1:] / ".content.xml"
        if not definition.is_file():
            raise DeploymentError("Mapped clientlib definition does not exist: " + library["path"])
        definitions = {}
        for candidate in (directory / "apps" / str(self.context.settings.migration.require("project.name"))).rglob(".content.xml"):
            node = ET.parse(candidate).getroot()
            if node.get("{http://www.jcp.org/jcr/1.0}primaryType") == "cq:ClientLibraryFolder":
                definitions[candidate.resolve()] = node
        reachable = set()
        def visit(candidate: Path) -> None:
            candidate = candidate.resolve()
            if candidate in reachable:
                return
            reachable.add(candidate)
            node = definitions.get(candidate)
            if node is None:
                raise DeploymentError("Mapped request is not a project clientlib definition.")
            embedded = jcr_value(node.get("embed", "[]"))
            embedded = embedded if isinstance(embedded, list) else [embedded]
            for other, value in definitions.items():
                categories = jcr_value(value.get("categories", "[]"))
                categories = categories if isinstance(categories, list) else [categories]
                if set(categories) & set(embedded):
                    visit(other)
        visit(definition)
        if any((self.context.repo_root / name).resolve() not in reachable for name in library["sources"]):
            raise DeploymentError("Requested clientlib does not embed the declared component library.")

    def verify(self, files: list[str], plan: list[dict[str, Any]], directory: Path, environment: dict[str, str], started_at: float) -> dict[str, Any]:
        components = [row["plan"] for row in self.context.state.component_rows()]
        if not components:
            raise DeploymentError("Runtime verification requires the accepted component plan.")
        artifacts = self.installed_artifacts(plan, started_at)
        installed = directory / "installed-artifacts.json"
        installed.write_text(json.dumps({"run_id": self.context.run_id, "artifacts": artifacts}, indent=2), encoding="utf-8")
        repository = self.repository(files)
        reconciliation = directory / "repository.json"
        reconciliation.write_text(json.dumps({"run_id": self.context.run_id, "nodes": repository}, indent=2), encoding="utf-8")
        if any(row["differences"] for row in repository):
            raise DeploymentError(f"Live repository differs from package intent. See {reconciliation}", feedback=self.repository_feedback(repository, components, reconciliation), reactor_evidence=str(reconciliation))
        inputs = self.browser_input(components)
        input_path = directory / "runtime-input.json"
        input_path.write_text(json.dumps(inputs), encoding="utf-8")
        tool = Path(__file__).resolve().parents[1] / "tools/deploy.mjs"
        output = directory / "runtime.json"
        output.unlink(missing_ok=True)
        hashes = {str(path): digest(path) for path in (tool, input_path)}
        if any(value is None for value in hashes.values()):
            raise DeploymentError("Fixed deployment browser verifier is missing.")
        credentials = os.environ.get(self.context.credentials_env) or str(self.context.settings.migration.get("aem.default_credentials", ""))
        status = run_command(["node", str(tool), str(input_path), str(output)], tool.parent, directory / "runtime.log", {**environment, self.context.credentials_env: credentials})
        if status or any(digest(Path(name)) != checksum for name, checksum in hashes.items()):
            raise DeploymentError(f"Fixed deployment browser verifier failed. See {directory / 'runtime.log'}")
        result = json.loads(self.context.evidence_file(str(output)).read_text(encoding="utf-8"))
        if result.get("run_id") != self.context.run_id or result.get("schema_version") != 1:
            raise DeploymentError("Deployment runtime evidence belongs to a different run or schema.")
        expected_models = {(component["id"], probe["model"], probe["resource_path"], probe["kind"]) for component in inputs["components"] for probe in component["model_probes"]}
        models = result.get("models", [])
        measured_models = {(row.get("component_id"), row.get("model"), row.get("resource_path"), row.get("kind")) for row in models}
        if measured_models != expected_models or len(models) != len(expected_models):
            raise DeploymentError("Runtime evidence omitted or duplicated required model adaptation probes.")
        assets = result.get("assets", [])
        if {asset.get("path") for asset in assets} != {asset["dam_path"] for asset in inputs["assets"]} and not result.get("failures"):
            raise DeploymentError("Runtime evidence omitted required DAM assets.")
        expected = {(width, mode) for width in inputs["breakpoints"] for mode in inputs["modes"]}
        pages = result.get("pages", [])
        if len(pages) != len(expected) or {(page.get("breakpoint"), page.get("mode")) for page in pages} != expected:
            raise DeploymentError("Deployment runtime evidence omitted required page modes or breakpoints.")
        if result.get("status") != "PASS" or result.get("failures") or any(page.get("status") != "PASS" for page in pages) or any(model.get("status") != "PASS" for model in models):
            feedback = [{"component_id": row["component_id"], "owning_layer": row.get("owning_layer", "component"), "hypothesis": row["error"], "evidence": [str(output)]} for row in result.get("failures", []) if row.get("component_id")]
            raise DeploymentError(f"Live deployment runtime checks failed. See {output}", blocked=result.get("blocked") is True, feedback=feedback)
        checks = [{"name": "packages_and_bundles_active", "status": "PASS", "evidence": str(installed)},
                  {"name": "live_repository_matches_intent", "status": "PASS", "evidence": str(reconciliation)}]
        checks.extend({"name": name, "status": "PASS", "evidence": str(output)} for name in ("disabled_and_author_runtime_valid", "target_selectors_resolve_uniquely", "assets_reachable_and_decoded"))
        return {"checks": checks, "outputs": {"runtime_sweep": str(output), "repository_reconciliation": str(reconciliation), "asset_manifest": str(output), "clientlib_report": str(output)}}