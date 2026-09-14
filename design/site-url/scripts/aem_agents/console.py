"""Console and file logging for the orchestrator."""

from __future__ import annotations

import logging
import sys
import threading
from pathlib import Path

_ANSI = {
    "cyan": "\033[36m",
    "green": "\033[32m",
    "yellow": "\033[33m",
    "red": "\033[31m",
    "dim": "\033[2m",
    "reset": "\033[0m",
}

_print_lock = threading.Lock()


def _colors_enabled() -> bool:
    import os

    return sys.stdout.isatty() and not os.environ.get("NO_COLOR")


def paint(text: str, color: str) -> str:
    if color not in _ANSI or not _colors_enabled():
        return text
    return f"{_ANSI[color]}{text}{_ANSI['reset']}"


def emit(text: str, color: str | None = None) -> None:
    """Thread-safe console write; fan-out agents log concurrently."""
    with _print_lock:
        print(paint(text, color) if color else text, flush=True)


def get_logger(log_file: Path | None = None, verbose: bool = False) -> logging.Logger:
    logger = logging.getLogger("aem_agents")
    logger.setLevel(logging.DEBUG if verbose else logging.INFO)
    logger.handlers.clear()
    logger.propagate = False

    if log_file is not None:
        log_file.parent.mkdir(parents=True, exist_ok=True)
        handler = logging.FileHandler(log_file, encoding="utf-8")
        handler.setFormatter(
            logging.Formatter("%(asctime)s %(levelname)-7s %(threadName)-18s %(message)s")
        )
        logger.addHandler(handler)
    return logger
