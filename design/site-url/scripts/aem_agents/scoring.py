"""Coordinator-owned pixel comparison; agent-supplied counts are never authoritative."""

from __future__ import annotations

import hashlib
import json
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw

from .envelope import EnvelopeError
from .workspaces import digest

TOOLS = Path(__file__).resolve().parents[1] / "tools"


class PixelScorer:
    def __init__(self) -> None:
        self.revision = self.tooling_revision()
        self.node = shutil.which("node")
        if not self.node:
            raise EnvelopeError("Node.js is required for deterministic visual verification.")

    @staticmethod
    def tooling_revision() -> str:
        paths = [TOOLS / name for name in ("score.mjs", "package.json", "package-lock.json")]
        for package in ("pixelmatch", "pngjs"):
            directory = TOOLS / "node_modules" / package
            if not directory.is_dir():
                raise EnvelopeError("Install the pinned scorer: npm ci --prefix design/site-url/scripts/tools --ignore-scripts")
            paths.extend(sorted(directory.rglob("*.js")))
            paths.append(directory / "package.json")
        if any(not path.is_file() for path in paths):
            raise EnvelopeError("The pinned scorer installation is incomplete; run npm ci in scripts/tools.")
        hashes = {path.relative_to(TOOLS).as_posix(): digest(path) for path in paths}
        return hashlib.sha256(json.dumps(hashes, sort_keys=True).encode("utf-8")).hexdigest()

    def score(self, rows: list[dict[str, Any]], directory: Path, *, run_id: str) -> dict[str, Any]:
        if self.tooling_revision() != self.revision:
            raise EnvelopeError("Scoring code or dependencies changed during agent execution.")
        directory.mkdir(parents=True, exist_ok=True)
        output = Path(tempfile.mkdtemp(prefix="verification-", dir=directory))
        pairs = []
        for index, row in enumerate(rows):
            pair = {}
            for role in ("source", "target"):
                original = Path(row[f"{role}_image"])
                target = output / f"{index}-{role}.png"
                checksum = digest(original)
                shutil.copy2(original, target)
                if digest(target) != checksum:
                    raise EnvelopeError("Screenshot changed while verification was starting.")
                pair[role] = {"original": str(original), "sha256": checksum}
            pairs.append(pair)
        manifest = output / "input.json"
        manifest.write_text(json.dumps({"schema_version": 1, "run_id": run_id, "pairs": pairs}), encoding="utf-8")
        try:
            process = subprocess.run(
                [self.node, str(TOOLS / "score.mjs"), str(manifest)],
                cwd=TOOLS, capture_output=True, text=True, encoding="utf-8", errors="replace",
                timeout=300, check=False, shell=False,
            )
        except (OSError, subprocess.SubprocessError) as error:
            raise EnvelopeError(f"Deterministic pixel comparison failed: {error}") from error
        if process.returncode:
            raise EnvelopeError(f"Deterministic pixel comparison failed: {process.stderr.strip()[:1000]}")
        if self.tooling_revision() != self.revision:
            raise EnvelopeError("Scoring code changed during comparison.")
        try:
            measurements = json.loads((output / "measured.json").read_text(encoding="utf-8"))
            if not isinstance(measurements, list) or len(measurements) != len(rows):
                raise ValueError("Incomplete measurement response")
            for index, (row, measurement) in enumerate(zip(rows, measurements)):
                matched = measurement["matched_pixels"]
                total = measurement["total_pixels"]
                if measurement["index"] != index or type(matched) is not int or type(total) is not int or not 0 <= matched <= total or total <= 0:
                    raise ValueError("Invalid measured pixel counts")
                source = output / f"{index}-source.png"
                target = output / f"{index}-target.png"
                if digest(source) != pairs[index]["source"]["sha256"] or digest(target) != pairs[index]["target"]["sha256"]:
                    raise ValueError("Comparison inputs changed")
                side_by_side = output / f"{index}-comparison.png"
                with Image.open(source) as live, Image.open(target) as aem:
                    if live.size != aem.size or live.width * live.height != total:
                        raise ValueError("Measured pixel totals do not match the images")
                    comparison = Image.new("RGB", (live.width * 2, live.height + 24), "white")
                    comparison.paste(live, (0, 24))
                    comparison.paste(aem, (live.width, 24))
                    draw = ImageDraw.Draw(comparison)
                    draw.text((4, 4), "LIVE SITE", fill="black")
                    draw.text((live.width + 4, 4), "AEM", fill="black")
                    comparison.save(side_by_side)
                artifacts = {
                    "source_image": str(source), "target_image": str(target),
                    "diff_mask": str(output / f"{index}-diff.png"), "side_by_side": str(side_by_side),
                }
                row.update(artifacts, matched_pixels=matched, total_pixels=total, ratio=matched / total,
                           scorer_revision=self.revision, image_hashes={key: digest(Path(path)) for key, path in artifacts.items()})
        except (OSError, KeyError, TypeError, ValueError) as error:
            raise EnvelopeError(f"Invalid deterministic comparison output: {error}") from error
        receipt = {"schema_version": 1, "run_id": run_id, "scorer_revision": self.revision,
                   "input_sha256": digest(manifest), "measurements": rows}
        receipt_path = output / "receipt.json"
        receipt_path.write_text(json.dumps(receipt, indent=2, allow_nan=False), encoding="utf-8")
        return {"path": str(receipt_path), "sha256": digest(receipt_path), "scorer_revision": self.revision}