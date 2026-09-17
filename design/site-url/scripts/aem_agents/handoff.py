"""Prepare bounded, traceable inputs without changing source or acceptance rules."""

from __future__ import annotations

import json
from pathlib import Path
import time
from typing import Any, Iterable, Mapping
import xml.etree.ElementTree as ET

from .envelope import EnvelopeError
from .workspaces import digest, foundation_scopes, relative_path

PACKET_BYTES = 8000


def _encoded(value: Any) -> str:
    return json.dumps(value, indent=2, ensure_ascii=True) + "\n"


def _write(path: Path, value: Any) -> Path:
    path.write_text(_encoded(value), encoding="utf-8", newline="\n")
    return path


def write_packets(directory: Path, label: str, records: Iterable[Mapping[str, Any]]) -> tuple[list[dict[str, Any]], list[Path]]:
    pages = []
    artifacts = []
    batch: list[Mapping[str, Any]] = []

    def flush() -> None:
        if batch:
            target = _write(directory / f"{label}-{len(pages) + 1}.json", {"records": batch})
            artifacts.append(target)
            pages.append({"file": target.name, "records": len(batch), "bytes": target.stat().st_size})
            batch.clear()

    for index, original in enumerate(records):
        row: Mapping[str, Any] = original
        if len(_encoded({"records": [row]}).encode("utf-8")) > PACKET_BYTES:
            target = _write(directory / f"{label}-record-{index}.json", row)
            artifacts.append(target)
            row = {"record_file": target.name, "bytes": target.stat().st_size,
                   "read": "Oversized record: use a JSON field query or ranged read, not a whole-file view. No fields were discarded."}
        if len(_encoded({"records": [*batch, row]}).encode("utf-8")) > PACKET_BYTES:
            flush()
        batch.append(row)
    flush()
    return pages, artifacts


def _token_records(tokens: Any, path: Path) -> list[dict[str, Any]]:
    categories = tokens.items() if isinstance(tokens, dict) else [("", tokens)]
    rows = []
    fields = ("name", "value", "measured_value", "classification", "css_property", "role",
              "occurrence_count", "distinct_owner_count", "visible_breakpoints", "components")
    for category, entries in categories:
        pointer = "/" + category.replace("~", "~0").replace("/", "~1") if isinstance(tokens, dict) else ""
        if not isinstance(entries, list):
            rows.append({"category": category, "value": entries, "source": path.name, "pointer": pointer})
            continue
        for index, entry in enumerate(entries):
            row = {"category": category, "source": path.name, "pointer": f"{pointer}/{index}"}
            if isinstance(entry, dict):
                row.update({key: entry[key] for key in fields if key in entry})
                row["detail_fields"] = [key for key in entry if key not in fields]
            else:
                row["value"] = entry
            rows.append(row)
    return rows


def prepare_planner_handoff(context: Any, directory: Path, discovery: Any) -> dict[str, Any]:
    started = time.monotonic()
    directory = directory.resolve()
    if not directory.is_relative_to(context.evidence_dir.resolve()):
        raise EnvelopeError("Planner handoff must remain inside this run's evidence directory.")
    directory.mkdir(parents=True, exist_ok=True)
    artifacts, inputs = [], {}
    groups, schemas, counts = {}, {}, {}

    def load(path: Path) -> Any:
        path = context.evidence_file(str(path))
        inputs[str(path)] = digest(path)
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except (ValueError, UnicodeError) as error:
            raise EnvelopeError(f"Invalid planner input JSON: {path}") from error

    def packet(label: str, rows: list[dict[str, Any]]) -> None:
        pages, written = write_packets(directory, label, rows)
        groups[label] = pages
        counts[label] = len(rows)
        artifacts.extend(written)

    def project(rows: Any, source: Path, fields: tuple[str, ...], pointer: str = "") -> list[dict[str, Any]]:
        if not isinstance(rows, list) or any(not isinstance(row, dict) for row in rows):
            raise EnvelopeError(f"Expected object records in {source}{pointer}.")
        schemas[str(source) + pointer] = sorted({key for row in rows for key in row})
        projected = []
        for index, row in enumerate(rows):
            item = {key: row[key] for key in fields if key in row}
            item.update(source=str(source), pointer=f"{pointer}/{index}", detail_fields=[key for key in row if key not in fields])
            if isinstance(item.get("text"), str):
                item["text_characters"] = len(item["text"])
                item["text"] = item["text"][:240]
            projected.append(item)
        return projected

    summary_path, inventory_path = discovery.summary.resolve(), discovery.inventory.resolve()
    summary, inventory = load(summary_path), load(inventory_path)
    if summary.get("run_id") != context.run_id or summary.get("site_url") != context.contract.site_url:
        raise EnvelopeError("Prepared planner input identity differs from this run.")
    packet("inventory-roots", project(inventory.get("roots"), inventory_path, ("kind", "path", "exists"), "/roots"))
    definitions = project(inventory.get("definitions"), inventory_path, ("path", "attributes"), "/definitions")
    for row, original in zip(definitions, inventory["definitions"]):
        row["field_count"] = len(original.get("fields", []))
    packet("inventory-definitions", definitions)
    pages = summary.get("pages", [])
    if not isinstance(pages, list) or {page.get("breakpoint") for page in pages} != set(context.contract.breakpoints) or len(pages) != len(context.contract.breakpoints):
        raise EnvelopeError("Planner handoff needs each required breakpoint exactly once.")
    overview = []
    for page_index, page in enumerate(pages):
        width = page["breakpoint"]
        source = discovery.manifest.parent / str(width)
        observations_path, tokens_path = source / "observations.json", source / "tokens.json"
        observations, tokens = load(observations_path), load(tokens_path)
        nodes = project(observations, observations_path, ("selector", "parent", "tag", "observation_state", "visible", "in_header", "rect", "text", "signals"))
        packet(f"nodes-{width}", nodes)
        wide = [row for row in nodes if isinstance(row.get("rect"), dict) and
                isinstance(row["rect"].get("width"), (int, float)) and isinstance(row["rect"].get("height"), (int, float)) and
                row["rect"]["width"] >= width * 0.6 and row["rect"]["height"] >= 8]
        packet(f"wide-nodes-{width}", wide)
        values = project(tokens, tokens_path, ("property", "value", "count"))
        packet(f"tokens-{width}", values)
        packet(f"headings-{width}", project(page.get("headings", []), summary_path, ("selector", "tag", "text", "rect"), f"/pages/{page_index}/headings"))
        overview.append({key: page[key] for key in ("breakpoint", "viewport", "title", "issues", "signals_executed", "candidate_count", "media_count", "conditional_selectors", "third_party_embeds") if key in page})
        overview[-1].update(observed_nodes=len(nodes), wide_nodes=len(wide), measured_token_values=len(values), source=str(summary_path), pointer=f"/pages/{page_index}")
    packet("overview", overview)
    index = {"schema_version": 1, "run_id": context.run_id, "site_url": context.contract.site_url,
             "manifest": str(discovery.manifest), "counts": counts, "packets": groups, "input_schemas": schemas,
             "reading_contract": {
                 "order": "Read overview, inventory-definitions and wide-nodes first; then all nodes for every breakpoint. Token tables already contain measured property/value/count records.",
                 "references": "Packet paths resolve relative to this index; source is an absolute immutable input path and pointer is a JSON pointer into it. No source fields were deleted.",
                 "text": "text is a preview of at most 240 characters, never final copy. Read the full source record for exact content and attributes.",
                 "scope": "Wide nodes are a navigation aid, NOT accepted sections. All observations remain in nodes packets; hidden/conditional nodes and all discovery signals still require coverage reconciliation.",
                 "decisions": "These projections do not certify readiness, coverage, reuse or tokens. Keep every existing acceptance gate. Read raw detail fields only where needed, using field queries rather than whole-file dumps.",
             }}
    index_path = _write(directory / "index.json", index)
    artifacts.append(index_path)
    if any(digest(Path(path)) != checksum for path, checksum in inputs.items()):
        raise EnvelopeError("Discovery evidence changed while preparing planner inputs.")
    return {"index_path": str(index_path), "packet_count": sum(len(pages) for pages in groups.values()),
            "input_bytes": sum(Path(path).stat().st_size for path in inputs), "elapsed_seconds": time.monotonic() - started,
            "artifacts": [str(path) for path in artifacts], "hashes": {**inputs, **{str(path): digest(path) for path in artifacts}}}


def prepare_shared_handoff(context: Any, directory: Path, components: list[Mapping[str, Any]]) -> dict[str, Any]:
    directory = directory.resolve()
    if not directory.is_relative_to(context.evidence_dir.resolve()):
        raise EnvelopeError("Shared handoff must remain inside this run's evidence directory.")
    directory.mkdir(parents=True, exist_ok=True)
    planner = context.state.get("agent_results", {}).get("planner", {}).get("outputs", {})
    original_tokens = context.evidence_file(planner.get("design_tokens"))
    try:
        tokens = json.loads(original_tokens.read_text(encoding="utf-8"))
    except (ValueError, UnicodeError) as error:
        raise EnvelopeError(f"Cannot prepare shared work from invalid token JSON: {original_tokens}") from error
    plan_path = _write(directory / "accepted-plan.json", {"run_id": context.run_id, "components": components})
    tokens_path = _write(directory / "measured-tokens.json", tokens)
    artifacts = [plan_path, tokens_path]
    groups = {}

    def packet(label: str, rows: Iterable[Mapping[str, Any]]) -> None:
        pages, paths = write_packets(directory, label, rows)
        groups[label] = pages
        artifacts.extend(paths)

    token_rows = _token_records(tokens, tokens_path)
    packet("tokens", token_rows)
    component_fields = ("id", "resource_type", "delivery", "source_order", "visible_breakpoints",
                        "depends_on", "contribution_targets", "reuse_target")
    packet("components", [
        {**{key: component[key] for key in component_fields if key in component},
         "source": plan_path.name, "pointer": f"/components/{index}",
         "detail_fields": [key for key in component if key not in component_fields]}
        for index, component in enumerate(components)
    ])
    root = context.repo_root.resolve()
    inventory = {}
    policies = []
    for scope in foundation_scopes(context.settings):
        target = root / relative_path(scope[:-3] if scope.endswith("/**") else scope)
        if not target.resolve().is_relative_to(root):
            raise EnvelopeError(f"Shared source path escapes the worker checkout: {scope}")
        files = sorted(target.rglob("*")) if scope.endswith("/**") and target.is_dir() else [target]
        for path in files:
            if not path.is_file():
                continue
            if not path.resolve().is_relative_to(root):
                raise EnvelopeError(f"Shared source path escapes the worker checkout: {path}")
            name = path.relative_to(root).as_posix()
            if name in inventory:
                continue
            inventory[name] = {"path": name, "bytes": path.stat().st_size, "sha256": digest(path)}
            if path.suffix == ".xml" and "policies" in path.parts:
                try:
                    document = ET.parse(path)
                    def visit(element: ET.Element, location: list[int]) -> None:
                        if "components" in element.attrib:
                            policies.append({"path": name, "element": element.tag, "child_indexes": location,
                                             "components": element.attrib["components"]})
                        for index, child in enumerate(element):
                            visit(child, [*location, index])
                    visit(document.getroot(), [])
                except ET.ParseError as error:
                    policies.append({"path": name, "parse_error": str(error), "action": "Inspect and validate the original XML; this is not a policy pass."})
    packet("source-index", [inventory[name] for name in sorted(inventory)])
    packet("policies", policies)
    frontend = str(context.settings.migration.get("deploy.frontend.root", "ui.frontend"))
    seeds = [str(context.settings.migration.require("css.token_layer.scss_source")),
             f"{frontend}/src/main/webpack/site/main.scss", f"{frontend}/src/main/webpack/site/_base.scss",
             f"{frontend}/package.json", f"{frontend}/webpack.common.js", f"{frontend}/clientlib.config.js"]
    source_rows = []
    for name in dict.fromkeys(seeds):
        path = root / relative_path(name)
        if not path.resolve().is_relative_to(root):
            raise EnvelopeError(f"Handoff source escapes the worker checkout: {name}")
        if not path.is_file():
            source_rows.append({"path": name, "exists": False})
            continue
        checksum = digest(path)
        text = path.read_text(encoding="utf-8-sig")
        for offset in range(0, max(1, len(text)), 1000):
            source_rows.append({"path": name, "sha256": checksum, "character_offset": offset,
                                "total_characters": len(text), "content": text[offset:offset + 1000]})
    packet("source-context", source_rows)
    counts = {}
    for row in token_rows:
        category_counts = counts.setdefault(row["category"], {"records": 0, "classifications": {}})
        category_counts["records"] += 1
        classification = row.get("classification", "unspecified")
        if isinstance(classification, str):
            category_counts["classifications"][classification] = category_counts["classifications"].get(classification, 0) + 1
    index = {
        "schema_version": 1, "run_id": context.run_id, "source_root": str(root),
        "plan_path": str(plan_path), "tokens_path": str(tokens_path), "original_tokens": str(original_tokens),
        "component_count": len(components), "token_counts": counts, "packets": groups,
        "planner_references": {key: value for key, value in planner.items() if key in (
            "discovery_manifest", "discovery_summary", "discovery_inventory", "coverage_report",
            "source_selector_map", "inventory_audit", "target_page_path", "target_page_template")},
        "reading_contract": {
            "paths": "Packet files and record_file/source references resolve relative to this index directory; source path fields resolve under source_root.",
            "tokens": "Projected measured fields. detail_fields remain verbatim in tokens_path at the JSON pointer; read them for provenance or ambiguity.",
            "components": "Identity and shared dependencies only. Full accepted components are in plan_path, including notes, selectors and authoring requirements.",
            "source-context": "Ordered text fragments of existing source, not generated replacements. Re-read edited files for post-edit validation.",
            "policies": "Existing allow-list locations; child_indexes are zero-based child positions from the XML root. Not a decision to edit every policy. Preserve template mappings and unrelated entries.",
            "oversized": "A record_file reference preserves a single large record; query its fields or use ranged reads.",
        },
    }
    index_path = _write(directory / "index.json", index)
    artifacts.append(index_path)
    return {"index_path": str(index_path), "plan_path": str(plan_path), "tokens_path": str(tokens_path),
            "component_count": len(components), "token_records": len(token_rows),
            "packet_count": sum(len(pages) for pages in groups.values()),
            "input_token_bytes": original_tokens.stat().st_size,
            "artifacts": [str(path) for path in artifacts],
            "hashes": {str(path): digest(path) for path in [original_tokens, *artifacts]}}