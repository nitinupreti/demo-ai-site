"""Exact style validation for coordinator-owned browser measurements."""

from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path
from typing import Any, Mapping

from .envelope import AgentResult, EnvelopeError
from .runner import BackendError, run_command
from .workspaces import digest

STYLE_PROPERTIES = (
    "fontFamily", "fontSize", "fontWeight", "fontStyle", "fontStretch", "fontVariant",
    "fontKerning", "fontFeatureSettings", "fontVariationSettings", "fontOpticalSizing", "fontSynthesis",
    "lineHeight", "letterSpacing", "wordSpacing", "textTransform", "textAlign", "textIndent",
    "textDecorationLine", "textDecorationStyle", "textDecorationColor", "textDecorationThickness",
    "textUnderlineOffset", "whiteSpace", "wordBreak", "overflowWrap", "hyphens",
    "color", "webkitTextFillColor", "backgroundColor",
    "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
    "marginTop", "marginRight", "marginBottom", "marginLeft", "rowGap", "columnGap",
    "opacity", "transform", "borderRadius", "boxShadow", "objectFit", "objectPosition",
)


def compare_role(source: Mapping[str, Any], target: Mapping[str, Any]) -> list[dict[str, Any]]:
    differences = []
    source_styles = source.get("styles")
    target_styles = target.get("styles")
    source_styles = source_styles if isinstance(source_styles, Mapping) else {}
    target_styles = target_styles if isinstance(target_styles, Mapping) else {}
    for name in STYLE_PROPERTIES:
        expected, actual = source_styles.get(name), target_styles.get(name)
        if not isinstance(expected, str) or not expected or not isinstance(actual, str) or not actual or expected != actual:
            differences.append({"property": name, "source": expected, "target": actual})
    if source.get("kind") == "text" or source.get("has_text"):
        if source.get("text") != target.get("text"):
            differences.append({"property": "text", "source": source.get("text"), "target": target.get("text")})
        if source.get("font_ready") is not True or target.get("font_ready") is not True:
            differences.append({"property": "fontReadiness", "source": source.get("font_ready"), "target": target.get("font_ready")})
        fonts = []
        for role in (source, target):
            rows = role.get("fonts")
            if not isinstance(rows, list) or not rows or any(
                not isinstance(row, Mapping) or not isinstance(row.get("familyName"), str) or not row["familyName"]
                or not isinstance(row.get("postScriptName"), str) or type(row.get("isCustomFont")) is not bool
                for row in rows
            ):
                fonts.append(None)
            else:
                fonts.append(sorted((row["familyName"], row["postScriptName"], row["isCustomFont"]) for row in rows))
        if fonts[0] is None or fonts[1] is None or fonts[0] != fonts[1]:
            differences.append({"property": "renderedFonts", "source": source.get("fonts"), "target": target.get("fonts")})
        if "line_boxes" in source or "line_boxes" in target:
            if not isinstance(source.get("line_boxes"), list) or not isinstance(target.get("line_boxes"), list) or source["line_boxes"] != target["line_boxes"]:
                differences.append({"property": "textLineBoxes", "source": source.get("line_boxes"), "target": target.get("line_boxes")})
    return differences


def validate_targets(targets: Any, component: Mapping[str, Any]) -> None:
    if not isinstance(targets, list) or not targets:
        raise EnvelopeError("Component must provide parity_targets for coordinator-run comparison.")
    identities = set()
    planned = {row.get("instance_id") for row in component.get("source_selectors", [])}
    for target_index, target in enumerate(targets):
        if not isinstance(target, Mapping) or any(not isinstance(target.get(name), str) or not target[name] for name in ("instance_id", "selector")):
            raise EnvelopeError("Each parity target needs an instance_id and CSS selector.")
        width, mode, index = target.get("breakpoint"), target.get("mode"), target.get("match_index")
        if width is not None and (type(width) is not int or width < 240):
            raise EnvelopeError("Invalid target breakpoint.")
        if mode is not None and mode not in ("disabled", "author"):
            raise EnvelopeError("Invalid target mode.")
        if index is not None and (type(index) is not int or index < 0):
            raise EnvelopeError("Invalid target match index.")
        identity = (target["instance_id"], width, mode)
        if target["instance_id"] not in planned:
            raise EnvelopeError(f"{component.get('id', 'component')}: parity_targets[{target_index}].instance_id {target['instance_id']!r} does not belong to a planned instance; use one of {sorted(str(value) for value in planned)}.")
        if identity in identities:
            raise EnvelopeError("Duplicate parity target scope.")
        identities.add(identity)
        roles = target.get("roles", [])
        actions = target.get("interactions", [])
        if not isinstance(roles, list) or not isinstance(actions, list):
            raise EnvelopeError("Parity roles and interactions must be arrays.")
        for role_index, role in enumerate(roles):
            if not isinstance(role, Mapping) or any(not isinstance(role.get(name), str) or not role[name] for name in ("source_selector", "target_selector")):
                raise EnvelopeError(
                    f"{component.get('id', 'component')}: parity_targets[{target_index}].roles[{role_index}] "
                    "must be an object with nonempty source_selector and target_selector relative CSS selectors, not a role label."
                )
        action_ids = set()
        for action in actions:
            if not isinstance(action, Mapping) or any(not isinstance(action.get(name), str) or not action[name] for name in ("id", "type", "source_selector", "target_selector")):
                raise EnvelopeError("Interaction probes need an ID, type, and source/target controls.")
            if action["type"] not in ("hover", "focus", "click") or action["id"] in action_ids:
                raise EnvelopeError("Unsupported or duplicate interaction probe.")
            action_ids.add(action["id"])
            for name in ("source_state_selector", "target_state_selector"):
                if name in action and (not isinstance(action[name], str) or not action[name]):
                    raise EnvelopeError("Interaction state selectors must be nonempty CSS selectors.")
    if not planned or {row[0] for row in identities} != planned:
        raise EnvelopeError("Parity targets must cover every planned instance.")


def compare_snapshot(measured: Mapping[str, Any], tolerance: Mapping[str, Any]) -> list[dict[str, Any]]:
    differences = list(measured.get("errors") or [])
    sources, targets = measured.get("source_roles", []), measured.get("target_roles", [])
    source = {row["id"]: row for row in sources}
    target = {row["id"]: row for row in targets}
    if len(source) != len(sources) or len(target) != len(targets):
        raise EnvelopeError("Duplicate role identities in browser measurements.")
    seen_source, seen_target = set(), set()
    for pair in measured.get("pairs", []):
        source_id, target_id = pair.get("source"), pair.get("target")
        if source_id not in source or target_id not in target or source_id in seen_source or target_id in seen_target:
            differences.append({"error": "Invalid or repeated role correspondence."})
            continue
        seen_source.add(source_id)
        seen_target.add(target_id)
        live, aem = source[source_id], target[target_id]
        deltas = compare_role(live, aem)
        if live.get("state") != aem.get("state"):
            deltas.append({"property": "semanticState", "source": live.get("state"), "target": aem.get("state")})
        if not live.get("pseudo"):
            for name in ("x", "y", "width", "height"):
                expected, actual = live.get("rect", {}).get(name), aem.get("rect", {}).get(name)
                if type(expected) not in (int, float) or type(actual) not in (int, float) or not math.isfinite(expected) or not math.isfinite(actual) or abs(expected - actual) > tolerance.get(name, 1):
                    deltas.append({"property": f"rect.{name}", "source": expected, "target": actual})
        if live.get("media") or aem.get("media"):
            source_media, target_media = live.get("media", {}), aem.get("media", {})
            if source_media.get("ready") is not True or target_media.get("ready") is not True:
                deltas.append({"property": "mediaReadiness", "source": source_media, "target": target_media})
            if source_media != target_media:
                deltas.append({"property": "media", "source": source_media, "target": target_media})
        differences.extend({"source_selector": live["selector"] + live.get("pseudo", ""),
                            "target_selector": aem["selector"] + aem.get("pseudo", ""), **delta} for delta in deltas)
    if not source or seen_source != set(source):
        differences.append({"error": "Incomplete visible source-role coverage."})
    for identity, row in target.items():
        if identity not in seen_target and (row.get("kind") in ("text", "media", "pseudo") or row.get("has_text")):
            differences.append({"target_selector": row["selector"], "error": "Unmatched visible target content."})
    return differences


class BrowserParity:
    def __init__(self, context: Any) -> None:
        self.context = context
        self.tools = Path(__file__).resolve().parents[1] / "tools"

    def _groups(self, components: list[Mapping[str, Any]]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        results = self.context.state.get("agent_results", {})
        groups, failures = [], []
        for component in components:
            identity = component["id"]
            prefix = f"component-{identity}-attempt-"
            accepted = [(int(slug[len(prefix):]), result) for slug, result in results.items()
                        if slug.startswith(prefix) and slug[len(prefix):].isdigit() and result.get("status") == "PASS"]
            latest = max(accepted, key=lambda entry: entry[0])[1] if accepted else {}
            targets = latest.get("outputs", {}).get("parity_targets")
            try:
                validate_targets(targets, component)
                for width in self.context.contract.breakpoints:
                    if component.get("visible_breakpoints") is not None and width not in component["visible_breakpoints"]:
                        continue
                    selectors = [row for row in component.get("source_selectors", []) if row.get("breakpoint", width) == width]
                    if not selectors:
                        raise EnvelopeError(f"No planned source roots at breakpoint {width}.")
                    for selector in selectors:
                        if any(not isinstance(selector.get(name), str) or not selector[name] for name in ("instance_id", "selector")):
                            raise EnvelopeError("Planned roots must have stable instance IDs and CSS selectors.")
                        index = selector.get("match_index", 0)
                        if type(index) is not int or index < 0:
                            raise EnvelopeError("Invalid planned source match index.")
                        for mode in self.context.settings.migration.get("parity.modes", ["disabled", "author"]):
                            candidates = [row for row in targets if row["instance_id"] == selector["instance_id"] and row.get("breakpoint", width) == width and row.get("mode", mode) == mode]
                            candidates.sort(key=lambda row: int("breakpoint" in row) + int("mode" in row), reverse=True)
                            if not candidates or (len(candidates) > 1 and sum(name in candidates[0] for name in ("breakpoint", "mode")) == sum(name in candidates[1] for name in ("breakpoint", "mode"))):
                                raise EnvelopeError(f"Missing or ambiguous AEM target for {selector['instance_id']}/{width}/{mode}.")
                            selected = candidates[0]
                            groups.append({"component_id": identity, "instance_id": selector["instance_id"], "breakpoint": width, "mode": mode,
                                           "source_selector": selector["selector"], "source_match_index": index,
                                           "target_selector": selected["selector"], "target_match_index": selected.get("match_index"),
                                           "roles": selected.get("roles", []), "interactions": selected.get("interactions", []),
                                           "required_interactions": component.get("interactions", [])})
            except EnvelopeError as error:
                groups = [row for row in groups if row["component_id"] != identity]
                failures.append({"component_id": identity, "owning_layer": "htl", "hypothesis": str(error), "diagnostic": {"mapping_error": str(error)}})
        return groups, failures

    def capture(self, components: list[Mapping[str, Any]], directory: Path) -> AgentResult:
        context = self.context
        directory = directory.resolve()
        if not directory.is_relative_to(context.evidence_dir.resolve()):
            raise EnvelopeError("Parity captures must remain in current-run evidence.")
        directory.mkdir(parents=True, exist_ok=True)
        groups, failing = self._groups(components)
        inputs = {"schema_version": 1, "run_id": context.run_id, "live_url": context.contract.site_url,
                  "aem_urls": {"disabled": context.disabled_url, "author": context.author_url},
                  "target_page_path": context.target_page_path, "credentials_env": context.credentials_env,
                  "properties": STYLE_PROPERTIES, "groups": groups, "breakpoints": context.contract.breakpoints,
                  "modes": context.settings.migration.get("parity.modes", ["disabled", "author"]),
                  "stability_samples": context.settings.migration.get("parity.stability_samples", 3),
                  "stability_interval_ms": context.settings.migration.get("parity.stability_interval_ms", 500)}
        source_files = [self.tools / name for name in ("parity.mjs", "browser.mjs", "package.json", "package-lock.json")]
        hashes = {str(path): digest(path) for path in source_files}
        if any(value is None for value in hashes.values()):
            raise EnvelopeError("Fixed browser comparator is incomplete.")
        revision = hashlib.sha256(json.dumps(hashes, sort_keys=True).encode("utf-8")).hexdigest()
        config = directory / "input.json"
        config.write_text(json.dumps(inputs), encoding="utf-8")
        hashes[str(config)] = digest(config)
        if groups:
            environment = context.browser.environment() if context.browser else {}
            log = directory / "collector.log"
            try:
                status = run_command(["node", str(self.tools / "parity.mjs"), str(config), str(directory)], self.tools, log, environment)
            except BackendError as error:
                raise EnvelopeError(f"Fixed Playwright comparison failed: {error}") from error
            if status:
                raise EnvelopeError(f"Fixed Playwright comparison failed (exit {status}). See {log}")
            measured = json.loads((directory / "measured.json").read_text(encoding="utf-8"))
        else:
            measured = {"schema_version": 1, "run_id": context.run_id, "groups": [], "page_composites": []}
            (directory / "measured.json").write_text(json.dumps(measured), encoding="utf-8")
        if any(digest(Path(name)) != checksum for name, checksum in hashes.items()):
            raise EnvelopeError("Capture code or inputs changed during browser comparison.")
        if measured.get("run_id") != context.run_id or measured.get("schema_version") != 1:
            raise EnvelopeError("Browser measurements belong to another run/schema.")
        expected = {(row["component_id"], row["instance_id"], row["breakpoint"], row["mode"]): row for row in groups}
        seen = set()
        scores, states, diagnostics = [], [], []
        tolerance = context.settings.migration.get("parity.geometry_tolerance_px", {})
        for group in measured.get("groups", []):
            key = tuple(group.get(name) for name in ("component_id", "instance_id", "breakpoint", "mode"))
            if key not in expected or key in seen:
                raise EnvelopeError("Unknown or duplicate browser measurement group.")
            seen.add(key)
            differences = compare_snapshot(group, tolerance)
            required = expected[key].get("required_interactions", [])
            if any(not isinstance(name, str) for name in required):
                differences.append({"error": "Unsupported planned interaction contract; explicit string IDs are required."})
                required = []
            if not group.get("header_interactions_excluded"):
                actual = {state["id"] for state in group.get("states", [])}
                for name in required:
                    automatic = name in ("hover", "focus") and any(identity.startswith(name + ":") for identity in actual)
                    if name not in actual and not automatic:
                        differences.append({"error": f"Required interaction was not measured: {name}"})
            identity = {name: group[name] for name in ("component_id", "instance_id", "breakpoint", "mode", "live_url", "aem_url", "dpr")}
            if group.get("source_image") and group.get("target_image"):
                scores.append({**identity, **{name: group[name] for name in ("source_image", "target_image")}, "screenshot_validation": "PASS"})
            for state in group.get("states", []):
                state_deltas = compare_snapshot(state, tolerance)
                differences.extend({"state": state["id"], **delta} for delta in state_deltas)
                if state.get("source_image") and state.get("target_image"):
                    states.append({**identity, "state": state["id"], **{name: state[name] for name in ("source_image", "target_image")}, "screenshot_validation": "PASS"})
            if differences:
                diagnostic = {**identity, "difference_count": len(differences), "differences": differences}
                diagnostics.append(diagnostic)
                existing = next((row for row in failing if row["component_id"] == key[0]), None)
                if existing is None:
                    existing = {"component_id": key[0], "owning_layer": "css", "hypothesis": "Repair the independently measured style, geometry, content, media or interaction differences.", "diagnostic": {"groups": []}}
                    failing.append(existing)
                existing["diagnostic"]["groups"].append({"breakpoint": key[2], "mode": key[3], "differences": differences[:20], "total_differences": len(differences)})
        if seen != set(expected):
            raise EnvelopeError("Browser comparison omitted required component groups.")
        report_path = directory / "strict-checks.json"
        report = {"run_id": context.run_id, "collector_revision": revision, "status": "FAIL" if failing else "PASS",
                  "measured_sha256": digest(directory / "measured.json"), "groups": diagnostics, "mapping_failures": [row for row in failing if row["owning_layer"] == "htl"]}
        report_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
        for entry in failing:
            entry["evidence"] = [str(report_path), str(directory / "measured.json")]
        pages = [{**row, "screenshot_validation": "FAIL" if row.get("error") else "PASS"} for row in measured.get("page_composites", [])]
        checks = [{"name": name, "status": "FAIL" if failing else "PASS", "evidence": str(report_path)} for name in (
            "all_source_blocks_mapped_once", "all_live_and_aem_screenshot_pairs_valid", "all_geometry_and_properties_pass", "all_interactions_and_media_pass")]
        return AgentResult("parity", context.run_id, "FAIL" if failing else "PASS", outputs={
            "scores": scores, "interaction_scores": states, "page_composites": pages, "failing_components": failing,
            "strict_verification": {"path": str(report_path), "sha256": digest(report_path)},
            "runner": {"path": str(self.tools / "parity.mjs"), "revision": revision}, "comparison_model_calls": 0,
        }, checks=checks)