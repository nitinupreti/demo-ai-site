"""Prune the evidence/ tree and other pipeline scratch after a Stage 04/05 run.

Default mode (safe): keeps the JSON/CSV reports and frozen source manifests,
removes the per-block raster crops, diff masks, side-by-sides, downloaded raw
assets (already copied to DAM), and the leftover node_modules folder.

--full : remove everything under evidence/ except a .gitkeep marker, and delete
         every pipeline scratch script/log at the repo root that this pipeline
         generated (see PIPELINE_SCRATCH). Use only after Stage 05 emits its
         completion report — the raster crops are the executable remediation
         queue during Stage 04.

--dry-run : print what would be removed without touching anything.
"""
from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
EVIDENCE = ROOT / "evidence"

# Scratch files this pipeline writes outside evidence/. Every entry is a path
# RELATIVE to the repo root. Only removed when --full is passed AND the file
# actually exists (safe to run repeatedly). The mandatory shipped runners
# (design/site-url/component_parity.py, design/site-url/cleanup_evidence.py)
# are NEVER in this list.
PIPELINE_SCRATCH = (
    "scripts/stage1_discovery.py",
    "scripts/stage2_download_assets.py",
    "scripts/stage2_place_dam.py",
    "scripts/stage3_author_xfs.py",
    "build.log",
    "ui.apps/build.log",
    "ui.content/build.log",
    "core/build.log",
)

KEEP_EXT = {".json", ".csv", ".md", ".yaml", ".yml"}
KEEP_PATTERNS = (
    "component-parity.json",
    "component-parity.csv",
    "manifest.json",
    "dam_manifest.json",
    "readiness.json",
    "coverage_report.json",
    "score_manifest.json",
    "motion_manifest.json",
    "media_manifest.json",
    "interactive_states.json",
    "dom_manifest.json",
    "hover-audit-",
    "source-manifest-",
    "target-manifest-",
    ".gitkeep",
)

PRUNE_ROOTS = (
    "02-assets",
    "node_modules",
    "component-parity-final",
)


def _keep(path: Path) -> bool:
    name = path.name
    if path.suffix.lower() in KEEP_EXT:
        return True
    if any(name.startswith(p) or name == p for p in KEEP_PATTERNS):
        return True
    return False


def safe_prune(dry_run: bool) -> tuple[int, int]:
    files_removed = 0
    bytes_removed = 0
    if not EVIDENCE.exists():
        return 0, 0

    for sub in PRUNE_ROOTS:
        p = EVIDENCE / sub
        if not p.exists():
            continue
        size = sum(f.stat().st_size for f in p.rglob("*") if f.is_file())
        count = sum(1 for f in p.rglob("*") if f.is_file())
        print(f"[prune-tree] {p.relative_to(ROOT)}  ({count} files, {size/1_048_576:.1f} MB)")
        files_removed += count
        bytes_removed += size
        if not dry_run:
            shutil.rmtree(p, ignore_errors=True)

    for f in EVIDENCE.rglob("*"):
        if not f.is_file() or _keep(f):
            continue
        try:
            rel = f.relative_to(ROOT)
        except ValueError:
            rel = f
        size = f.stat().st_size
        print(f"[prune-file] {rel}  ({size/1024:.0f} KB)")
        files_removed += 1
        bytes_removed += size
        if not dry_run:
            f.unlink(missing_ok=True)

    if not dry_run:
        for d in sorted((p for p in EVIDENCE.rglob("*") if p.is_dir()),
                        key=lambda x: len(x.parts), reverse=True):
            try:
                d.rmdir()
            except OSError:
                pass

    return files_removed, bytes_removed


def full_wipe(dry_run: bool) -> tuple[int, int]:
    files_removed = 0
    bytes_removed = 0

    if EVIDENCE.exists():
        e_files = sum(1 for f in EVIDENCE.rglob("*") if f.is_file())
        e_bytes = sum(f.stat().st_size for f in EVIDENCE.rglob("*") if f.is_file())
        print(f"[full-wipe] {EVIDENCE.relative_to(ROOT)}  ({e_files} files, {e_bytes/1_048_576:.1f} MB)")
        files_removed += e_files
        bytes_removed += e_bytes
        if not dry_run:
            for child in EVIDENCE.iterdir():
                if child.is_dir():
                    shutil.rmtree(child, ignore_errors=True)
                else:
                    child.unlink(missing_ok=True)
            (EVIDENCE / ".gitkeep").touch()

    for rel in PIPELINE_SCRATCH:
        p = ROOT / rel
        if not p.exists() or not p.is_file():
            continue
        size = p.stat().st_size
        print(f"[full-wipe] {rel}  ({size/1024:.0f} KB)")
        files_removed += 1
        bytes_removed += size
        if not dry_run:
            p.unlink(missing_ok=True)

    return files_removed, bytes_removed


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--full", action="store_true", help="Delete everything under evidence/ (keeps .gitkeep).")
    parser.add_argument("--dry-run", action="store_true", help="Preview only; make no changes.")
    args = parser.parse_args()

    if args.full:
        files, bytes_ = full_wipe(args.dry_run)
    else:
        files, bytes_ = safe_prune(args.dry_run)

    label = "would remove" if args.dry_run else "removed"
    print(f"\n{label}: {files} files, {bytes_/1_048_576:.1f} MB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
