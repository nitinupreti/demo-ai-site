"""Deterministic merge of component contributions into shared files.

Component agents run in parallel against one working tree. Any file more than one
component must change is a lost-update hazard, and a lost node is invisible: the
agent still reports PASS while its authored content silently disappears.

So agents never edit shared files. Each declares what it needs in a
``contributions.json``, and this module — single-threaded, run once after the
fan-out joins — applies every contribution. That makes races impossible rather
than unlikely, and lets node order follow the planner's source order instead of
whichever agent happened to finish first.
"""

from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Mapping
from xml.etree import ElementTree

from .config import Settings
from .workspaces import WorkspaceError, validate_contribution_targets

_PREFIXED = re.compile(r"^\{([^}]+)\}(.+)$")


class MergeError(RuntimeError):
    """Raised when contributions cannot be merged or a component is missing."""


@dataclass
class Contribution:
    component_id: str
    source_order: int
    page_path: str | None = None
    parent_path: str | None = None
    nodes: list[dict[str, Any]] = field(default_factory=list)
    filter_roots: list[str] = field(default_factory=list)
    path: Path | None = None
    template_path: str | None = None
    page_properties: dict[str, str] = field(default_factory=dict)


@dataclass
class MergeReport:
    merged_files: list[str] = field(default_factory=list)
    nodes_written: list[str] = field(default_factory=list)
    missing_components: list[str] = field(default_factory=list)
    skipped_components: list[str] = field(default_factory=list)
    filter_roots_added: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.missing_components

    def to_dict(self) -> dict[str, Any]:
        return {
            "merged_files": self.merged_files,
            "nodes_written": self.nodes_written,
            "missing_components": self.missing_components,
            "skipped_components": self.skipped_components,
            "filter_roots_added": self.filter_roots_added,
        }


def _register_namespaces(namespaces: Mapping[str, str]) -> None:
    for prefix, uri in namespaces.items():
        ElementTree.register_namespace(prefix, uri)


def _qualify(name: str, namespaces: Mapping[str, str]) -> str:
    """Turn ``jcr:content`` into ``{uri}content`` for ElementTree lookups."""
    if ":" not in name:
        return name
    prefix, local = name.split(":", 1)
    uri = namespaces.get(prefix)
    return f"{{{uri}}}{local}" if uri else name


def _tag_name(element: ElementTree.Element, namespaces: Mapping[str, str]) -> str:
    match = _PREFIXED.match(element.tag)
    if not match:
        return element.tag
    uri, local = match.groups()
    for prefix, candidate in namespaces.items():
        if candidate == uri:
            return f"{prefix}:{local}"
    return local


def _find_parent(
    root: ElementTree.Element, parent_path: str, namespaces: Mapping[str, str]
) -> ElementTree.Element:
    node = root
    for segment in [part for part in parent_path.split("/") if part]:
        found = node.find(_qualify(segment, namespaces))
        if found is None:
            raise MergeError(
                f"Parent path '{parent_path}' does not exist: no '{segment}' under "
                f"'{_tag_name(node, namespaces)}'."
            )
        node = found
    return node


def _parse_fragment(xml: str, namespaces: Mapping[str, str]) -> ElementTree.Element:
    """Parse a node fragment, supplying the namespace declarations it relies on."""
    declarations = " ".join(f'xmlns:{prefix}="{uri}"' for prefix, uri in namespaces.items())
    try:
        wrapper = ElementTree.fromstring(f"<merge-wrapper {declarations}>{xml}</merge-wrapper>")
    except ElementTree.ParseError as error:
        raise MergeError(f"Contributed node XML is not well-formed: {error}") from error
    children = list(wrapper)
    if len(children) != 1:
        raise MergeError(
            f"Each contributed node must be exactly one XML element; got {len(children)}."
        )
    return children[0]


def latest_contribution_path(settings: Settings, evidence_dir: Path, component_id: str, *, attempt: int | None = None) -> Path | None:
    workspace = evidence_dir / str(settings.migration.get("run.agent_workspace_dir", "agents"))
    filename = str(settings.migration.get("shared_files.contribution_file", "contributions.json"))
    if attempt is not None:
        if type(attempt) is not int or attempt < 1:
            raise MergeError("Contribution attempt must be a positive integer.")
        return workspace / f"component-{component_id}-attempt-{attempt}" / filename
    pattern = re.compile(rf"component-{re.escape(component_id)}-attempt-(\d+)$")
    candidates = [
        (int(match.group(1)), directory / filename)
        for directory in workspace.glob(f"component-{component_id}-attempt-*")
        if directory.is_dir() and (match := pattern.fullmatch(directory.name))
    ]
    return max(candidates, key=lambda item: item[0])[1] if candidates else None


def read_contributions(
    settings: Settings, evidence_dir: Path, components: list[Mapping[str, Any]], *, attempt: int | None = None
) -> tuple[list[Contribution], list[str]]:
    """Collect one contribution per planned component, newest attempt wins."""
    order_by_id = {
        str(component["id"]): int(component.get("source_order", index))
        for index, component in enumerate(components)
    }
    try:
        targets_by_id = {str(component["id"]): validate_contribution_targets(settings, component) for component in components}
    except WorkspaceError as error:
        raise MergeError(str(error)) from error

    contributions: list[Contribution] = []
    missing: list[str] = []
    for component_id, source_order in order_by_id.items():
        raw = latest_contribution_path(settings, evidence_dir, component_id, attempt=attempt)
        if raw is None or not raw.is_file():
            missing.append(component_id)
            continue
        try:
            data = json.loads(raw.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            raise MergeError(f"Could not read {raw}: {error}") from error
        if not isinstance(data, Mapping) or data.get("component_id") != component_id:
            raise MergeError(f"Contribution identity does not match {component_id}: {raw}")
        if data.get("source_order", source_order) != source_order:
            raise MergeError(f"Contribution from {component_id} changed the planner's source_order.")
        pages = data.get("pages", [data])
        if not isinstance(pages, list) or not pages:
            raise MergeError(f"Contribution from {component_id} has no page targets.")
        required_targets = targets_by_id[component_id]
        missing_targets = [target for target in required_targets if not any(isinstance(page, Mapping) and page.get("page_path") == target for page in pages)]
        if missing_targets:
            raise MergeError(f"Contribution from {component_id} omits required page/XF targets: {', '.join(missing_targets)}")
        for page_index, page in enumerate(pages):
            if not isinstance(page, Mapping) or not isinstance(page.get("nodes"), list) or not page["nodes"]:
                target = page.get("page_path", "missing page_path") if isinstance(page, Mapping) else "invalid page entry"
                raise MergeError(f"Contribution from {component_id} has no authored nodes (pages[{page_index}], target: {target}).")
            properties = page.get("page_properties", {})
            if not isinstance(properties, Mapping) or any(not isinstance(value, str) for value in properties.values()):
                raise MergeError(f"Invalid page_properties in {raw}.")
            contributions.append(
                Contribution(
                    component_id=component_id, source_order=source_order,
                    page_path=page.get("page_path"), parent_path=page.get("parent_path"),
                    nodes=list(page["nodes"]),
                    filter_roots=[str(item) for item in page.get("filter_roots", data.get("filter_roots", []))],
                    path=raw, template_path=page.get("template_path"), page_properties=dict(properties),
                )
            )
    contributions.sort(key=lambda item: (item.source_order, item.component_id))
    return contributions, missing


def merge_authored_page(
    settings: Settings, contributions: list[Contribution], report: MergeReport
) -> None:
    """Rewrite each page's component children from the contributions, in source order."""
    config = settings.migration.section("shared_files.authored_page")
    namespaces: dict[str, str] = dict(config.get("namespaces", {}))
    _register_namespaces(namespaces)
    default_parent = str(config.get("default_parent", "jcr:content/root"))
    template = str(config.require("file"))

    by_page: dict[str, list[Contribution]] = {}
    for contribution in contributions:
        if not contribution.nodes:
            continue
        if not contribution.page_path:
            raise MergeError(
                f"Contribution from '{contribution.component_id}' has nodes but no page_path."
            )
        by_page.setdefault(contribution.page_path, []).append(contribution)

    prepared: list[tuple[Path, ElementTree.ElementTree]] = []
    for page_path, page_contributions in by_page.items():
        if not page_path.startswith("/content/") or any(part in (".", "..") for part in page_path.split("/")) or "\\" in page_path:
            raise MergeError(f"Invalid authored page path: {page_path}")
        target = settings.resolve(template.format(page_path=page_path.rstrip("/")))
        properties: dict[str, str] = {}
        for contribution in page_contributions:
            for name, value in contribution.page_properties.items():
                if name in properties and properties[name] != value:
                    raise MergeError(f"Conflicting page property {name} for {page_path}.")
                properties[name] = value
        if target.is_file():
            tree = ElementTree.parse(target)
        else:
            templates = {entry.template_path for entry in page_contributions if entry.template_path}
            if len(templates) != 1 or not properties.get("jcr:title"):
                raise MergeError(f"New page {page_path} needs one template_path and an authored jcr:title.")
            selected = templates.pop()
            if not selected.startswith("/conf/") or any(part in (".", "..") for part in selected.split("/")) or "\\" in selected:
                raise MergeError(f"Invalid template_path: {selected}")
            initial = settings.resolve(template.format(page_path=selected + "/initial"))
            if not initial.is_file():
                raise MergeError(f"Selected template initial content is missing: {initial}")
            tree = ElementTree.parse(initial)
            properties["cq:template"] = selected
        root = tree.getroot()
        content = _find_parent(root, "jcr:content", namespaces)
        for name, value in properties.items():
            content.set(_qualify(name, namespaces), value)
        grouped_nodes: dict[str, dict[str, ElementTree.Element]] = {}
        for contribution in page_contributions:
            parent_path = contribution.parent_path or default_parent
            owned = grouped_nodes.setdefault(parent_path, {})
            for node in contribution.nodes:
                if not isinstance(node, Mapping):
                    raise MergeError(f"Invalid node from {contribution.component_id}.")
                name = str(node.get("name") or "")
                xml = str(node.get("xml") or "")
                if not name or not xml:
                    raise MergeError(
                        f"Contribution from '{contribution.component_id}' has a node "
                        "without a name or xml."
                    )
                fragment = _parse_fragment(xml, namespaces)
                if _tag_name(fragment, namespaces) != name or name in owned:
                    raise MergeError(f"Duplicate or mismatched node name {name} in {page_path}/{parent_path}.")
                owned[name] = fragment
                report.nodes_written.append(f"{contribution.component_id}:{name}")
        for parent_path, nodes in grouped_nodes.items():
            parent = _find_parent(root, parent_path, namespaces)
            for existing in list(parent):
                if _tag_name(existing, namespaces) in nodes:
                    parent.remove(existing)
            parent.extend(nodes.values())
        ElementTree.indent(tree, space="    ")
        prepared.append((target, tree))

    for target, tree in prepared:
        target.parent.mkdir(parents=True, exist_ok=True)
        temporary = target.with_name(target.name + ".merge.tmp")
        tree.write(temporary, encoding="UTF-8", xml_declaration=True)
        os.replace(temporary, target)
        report.merged_files.append(settings.relative_to_repo(target))


def merge_vault_filter(
    settings: Settings, contributions: list[Contribution], report: MergeReport
) -> None:
    """Append any missing filter roots without rewriting the existing entries."""
    config = settings.migration.section("shared_files.vault_filter")
    target = settings.resolve(str(config.require("file")))
    tree = ElementTree.parse(target, parser=ElementTree.XMLParser(target=ElementTree.TreeBuilder(insert_comments=True))) if target.is_file() else ElementTree.ElementTree(ElementTree.Element("workspaceFilter", version="1.0"))
    root_element = tree.getroot()
    rejected = tuple(str(prefix) for prefix in config.get("reject_prefixes", []))
    wanted = sorted(
        {
            root
            for contribution in contributions
            for root in [*contribution.filter_roots, contribution.page_path]
            if root
        }
    )
    if any(root == "/content/dam" or (rejected and root.startswith(rejected)) for root in wanted):
        raise MergeError("DAM roots cannot be packaged in ui.content.")
    existing_roots = [entry.get("root", "").rstrip("/") for entry in root_element.findall("filter")]
    additions = [root for root in wanted if not any(root == existing or root.startswith(existing + "/") for existing in existing_roots)]
    if not additions:
        return

    entry_template = str(config.get("entry", '<filter root="{root}" mode="merge"/>'))
    for root in additions:
        entry = ElementTree.fromstring(entry_template.format(root="placeholder"))
        entry.set("root", root)
        root_element.append(entry)
    target.parent.mkdir(parents=True, exist_ok=True)
    ElementTree.indent(tree, space="    ")
    tree.write(target, encoding="UTF-8", xml_declaration=True)
    report.filter_roots_added.extend(additions)
    report.merged_files.append(settings.relative_to_repo(target))


def merge_contributions(
    settings: Settings, evidence_dir: Path, components: list[Mapping[str, Any]]
) -> MergeReport:
    """Apply every component contribution to the shared files exactly once."""
    report = MergeReport()
    contributions, missing = read_contributions(settings, evidence_dir, components)
    report.missing_components = missing
    report.skipped_components = [c.component_id for c in contributions if not c.nodes]

    if contributions and not missing:
        try:
            merge_authored_page(settings, contributions, report)
            merge_vault_filter(settings, contributions, report)
        except (OSError, ElementTree.ParseError, TypeError, ValueError) as error:
            raise MergeError(f"Could not merge authored content: {error}") from error
    return report
