#!/usr/bin/env python3
"""Launcher for the AEM migration agent pipeline.

Usage:
    python design/site-url/scripts/run_migration.py --show-plan
    python design/site-url/scripts/run_migration.py --url https://example.com/page

With the documented host runtimes available, no separate project-dependency setup
is required. The launcher enters its isolated Python environment with exact library
versions. Migration preflight checks the required Node/Java/Maven tools and prepares
locked Node packages and matching Chromium before agents. --no-bootstrap disables
installation but still validates dependencies.

setup.ps1 / setup.sh remain available and additionally check the external tooling
the agents drive: Node.js, GitHub Copilot CLI, Maven, Java, and a running AEM author.
"""

from __future__ import annotations

import sys
from pathlib import Path

SCRIPT = Path(__file__).resolve()
sys.path.insert(0, str(SCRIPT.parent))

from aem_agents.bootstrap import BootstrapError, ensure_environment  # noqa: E402

try:
    ensure_environment(SCRIPT, sys.argv[1:])
except BootstrapError as error:
    sys.exit(f"ERROR: {error}")

from aem_agents.cli import main  # noqa: E402

if __name__ == "__main__":
    sys.exit(main())
