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
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Mapping
from xml.etree import ElementTree

from .config import Settings

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


def read_contributions(
    settings: Settings, evidence_dir: Path, components: list[Mapping[str, Any]]
) -> tuple[list[Contribution], list[str]]:
    """Collect one contribution per planned component, newest attempt wins."""
    migration = settings.migration
    workspace_root = evidence_dir / str(migration.get("run.agent_workspace_dir", "agents"))
    filename = str(migration.get("shared_files.contribution_file", "contributions.json"))

    order_by_id = {
        str(component["id"]): int(component.get("source_order", index))
        for index, component in enumerate(components)
    }

    contributions: list[Contribution] = []
    missing: list[str] = []
    for component_id, source_order in order_by_id.items():
        candidates = sorted(workspace_root.glob(f"component-{component_id}-attempt-*/{filename}"))
        if not candidates:
            missing.append(component_id)
            continue
        raw = candidates[-1]
        try:
            data = json.loads(raw.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            raise MergeError(f"Could not read {raw}: {error}") from error
        contributions.append(
            Contribution(
                component_id=component_id,
                source_order=int(data.get("source_order", source_order)),
                page_path=data.get("page_path"),
                parent_path=data.get("parent_path"),
                nodes=list(data.get("nodes") or []),
                filter_roots=[str(item) for item in (data.get("filter_roots") or [])],
                path=raw,
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

    for page_path, page_contributions in by_page.items():
        target = settings.resolve(template.format(page_path=page_path.rstrip("/")))
        if not target.is_file():
            raise MergeError(f"Authored page content file not found: {target}")

        tree = ElementTree.parse(target)
        root = tree.getroot()
        contributed_names = {
            str(node.get("name"))
            for contribution in page_contributions
            for node in contribution.nodes
            if node.get("name")
        }

        for contribution in page_contributions:
            parent_path = contribution.parent_path or default_parent
            parent = _find_parent(root, parent_path, namespaces)

            # Idempotency: drop any previous copy before re-inserting in order.
            for existing in list(parent):
                if _tag_name(existing, namespaces) in contributed_names:
                    parent.remove(existing)

        for contribution in page_contributions:
            parent = _find_parent(root, contribution.parent_path or default_parent, namespaces)
            for node in contribution.nodes:
                name = str(node.get("name") or "")
                xml = str(node.get("xml") or "")
                if not name or not xml:
                    raise MergeError(
                        f"Contribution from '{contribution.component_id}' has a node "
                        "without a name or xml."
                    )
                parent.append(_parse_fragment(xml, namespaces))
                report.nodes_written.append(f"{contribution.component_id}:{name}")

        ElementTree.indent(tree, space="    ")
        tree.write(target, encoding="UTF-8", xml_declaration=True)
        report.merged_files.append(settings.relative_to_repo(target))


def merge_vault_filter(
    settings: Settings, contributions: list[Contribution], report: MergeReport
) -> None:
    """Append any missing filter roots without rewriting the existing entries."""
    config = settings.migration.section("shared_files.vault_filter")
    target = settings.resolve(str(config.require("file")))
    if not target.is_file():
        return
    entry_template = str(config.get("entry", '<filter root="{root}" mode="merge"/>'))

    text = target.read_text(encoding="utf-8")
    rejected = tuple(str(prefix) for prefix in config.get("reject_prefixes", []))
    wanted = sorted(
        {
            root
            for contribution in contributions
            for root in contribution.filter_roots
            # DAM is uploaded over HTTP; packaging it would defeat that.
            if not (rejected and str(root).startswith(rejected))
        }
    )
    additions = [root for root in wanted if f'root="{root}"' not in text]
    if not additions:
        return

    indent = "    "
    block = "\n".join(f"{indent}{entry_template.format(root=root)}" for root in additions)
    text = text.replace("</workspaceFilter>", f"{block}\n</workspaceFilter>")
    target.write_text(text, encoding="utf-8")
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

    if contributions:
        merge_authored_page(settings, contributions, report)
        merge_vault_filter(settings, contributions, report)
    return report
