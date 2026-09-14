"""Command-line entry point for the migration agent pipeline."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from .config import ConfigError, Settings, find_repo_root
from .console import emit, get_logger
from .contract import ContractError, load_contract
from .orchestrator import Orchestrator, PipelineError
from .runner import BackendError

_EXIT = {"COMPLETE": 0, "FAIL": 1, "BLOCKED": 2}


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="run_migration.py",
        description=(
            "Plan, fan out, deploy, and visually verify an AEM page migration. "
            "SITE_URL and the parity threshold are read from the prompt contract; "
            "everything else is configured in design/site-url/scripts/config/."
        ),
    )
    parser.add_argument("--url", help="Override SITE_URL from the prompt contract.")
    parser.add_argument("--target-path", help="AEM page path to author into.")
    parser.add_argument("--breakpoints", help="Comma-separated widths, overriding the contract.")
    parser.add_argument("--config-dir", help="Directory holding migration.yaml and agents.yaml.")
    parser.add_argument("--evidence-dir", help="Override the generated evidence directory.")
    parser.add_argument("--run-id", help="Reuse a specific run id.")
    parser.add_argument("--model", help="Model id passed to the agent backend.")
    parser.add_argument("--effort", help="Reasoning effort, when the model advertises it.")
    parser.add_argument(
        "--max-parallel", type=int, help="Component agents to run concurrently."
    )
    parser.add_argument(
        "--max-attempts", type=int, help="Remediation attempts per component."
    )
    parser.add_argument(
        "--only",
        help="Comma-separated pipeline phase ids to run (default: all).",
    )
    parser.add_argument(
        "--skip-probe", action="store_true", help="Do not probe SITE_URL and AEM first."
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Resolve config, contract, and prompts without invoking any agent.",
    )
    parser.add_argument(
        "--show-plan",
        action="store_true",
        help="Print the resolved contract and pipeline, then exit.",
    )
    parser.add_argument(
        "--no-bootstrap",
        action="store_true",
        help=(
            "Do not create or reuse the launcher's virtual environment; "
            "handled before argument parsing, listed here so --help documents it."
        ),
    )
    parser.add_argument("--verbose", action="store_true", help="Debug logging to the log file.")
    return parser


def _overrides(args: argparse.Namespace) -> dict[str, Any]:
    overrides: dict[str, Any] = {}
    if args.model:
        overrides.setdefault("model", {})["default"] = args.model
    if args.effort:
        overrides.setdefault("model", {})["effort"] = args.effort
    if args.max_parallel:
        overrides.setdefault("fanout", {})["max_parallel"] = args.max_parallel
    if args.max_attempts:
        overrides.setdefault("pipeline", {}).setdefault("remediation", {})[
            "max_attempts"
        ] = args.max_attempts
    return overrides


def _contract_overrides(args: argparse.Namespace) -> dict[str, Any]:
    overrides: dict[str, Any] = {}
    if args.url:
        overrides["site_url"] = args.url
    if args.target_path:
        overrides["target_page_path"] = args.target_path
    if args.breakpoints:
        overrides["breakpoints"] = args.breakpoints
    return overrides


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)

    scripts_dir = Path(__file__).resolve().parent.parent
    repo_root = find_repo_root(scripts_dir)
    config_dir = Path(args.config_dir).resolve() if args.config_dir else scripts_dir / "config"

    try:
        settings = Settings.load(repo_root, config_dir, _overrides(args))
        contract = load_contract(settings, _contract_overrides(args))
    except (ConfigError, ContractError) as error:
        emit(f"ERROR: {error}", "red")
        return 1

    if args.show_plan:
        emit(json.dumps({
            "repo_root": str(repo_root),
            "config_dir": str(config_dir),
            "contract": contract.as_dict(),
            "phases": [dict(phase) for phase in settings.phases()],
            "agents": sorted(settings.agents),
            "max_parallel": settings.migration.get("fanout.max_parallel", 3),
        }, indent=2))
        return 0

    # Relative overrides resolve against the repo root, not the current directory.
    evidence_dir = settings.resolve(args.evidence_dir) if args.evidence_dir else None

    emit("\nAEM Migration Orchestrator", "cyan")
    emit(f"Repository: {repo_root}", "dim")
    emit(f"Contract:   {contract.source_file}", "dim")

    try:
        orchestrator = Orchestrator(
            settings,
            contract,
            run_id=args.run_id,
            dry_run=args.dry_run,
            skip_probe=args.skip_probe or args.dry_run,
            only_phases=[part.strip() for part in args.only.split(",")] if args.only else None,
            evidence_dir=evidence_dir,
            logger=get_logger(None, args.verbose),
        )
        orchestrator.logger = get_logger(
            orchestrator.evidence_dir / str(settings.migration.get("run.log_file", "orchestrator.log")),
            args.verbose,
        )
        status = orchestrator.run()
    except (ConfigError, ContractError, PipelineError, BackendError) as error:
        emit(f"\nERROR: {error}", "red")
        return 1
    except KeyboardInterrupt:
        emit("\nInterrupted.", "yellow")
        return 130

    return _EXIT.get(status, 1)


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
