#!/usr/bin/env python3
"""Launcher for the AEM migration agent pipeline.

Usage:
    python design/site-url/scripts/run_migration.py --show-plan
    python design/site-url/scripts/run_migration.py --url https://example.com/page

No separate setup step is required. On first run this creates its own virtual
environment, installs the pinned dependencies, and re-launches itself inside it.
Pass --no-bootstrap to manage the environment yourself.

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
