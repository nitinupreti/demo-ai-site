#!/usr/bin/env bash
# Bootstraps the AEM migration agent pipeline on macOS and Linux.
#
# Creates a virtual environment beside this script, installs the Python
# dependencies into it, and reports on the external tooling the agents need.
# Safe to re-run.
#
#   bash design/site-url/scripts/setup.sh [--recreate] [--venv PATH]

set -euo pipefail

SCRIPTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_PATH="${SCRIPTS_DIR}/.venv"
RECREATE=0
MIN_PYTHON="3.10"
OK=1

REPO_ROOT="$SCRIPTS_DIR"
while [[ "$REPO_ROOT" != "/" && ! -f "${REPO_ROOT}/pom.xml" ]]; do
  REPO_ROOT="$(dirname "$REPO_ROOT")"
done
LAUNCHER="${SCRIPTS_DIR#"${REPO_ROOT}"/}/run_migration.py"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --recreate) RECREATE=1; shift ;;
    --venv) VENV_PATH="$2"; shift 2 ;;
    -h|--help) sed -n '2,10p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

if [[ -t 1 ]]; then
  CYAN=$'\033[36m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; RED=$'\033[31m'; RESET=$'\033[0m'
else
  CYAN=""; GREEN=""; YELLOW=""; RED=""; RESET=""
fi

step() { printf '\n%s%s%s\n' "$CYAN" "$1" "$RESET"; }
good() { printf '  %sOK   %s %s\n' "$GREEN" "$RESET" "$1"; }
warn() { printf '  %sWARN %s %s\n' "$YELLOW" "$RESET" "$1"; }
bad()  { printf '  %sMISS %s %s\n' "$RED" "$RESET" "$1"; OK=0; }

version_at_least() {
  [[ "$(printf '%s\n%s\n' "$2" "$1" | sort -V | head -n1)" == "$2" ]]
}

# --- Python -----------------------------------------------------------------

step "Checking Python"

PYTHON=""
for candidate in python3 python; do
  command -v "$candidate" >/dev/null 2>&1 || continue
  reported="$("$candidate" -c 'import platform; print(platform.python_version())' 2>/dev/null || true)"
  [[ -n "$reported" ]] || continue
  if version_at_least "$reported" "$MIN_PYTHON"; then
    PYTHON="$(command -v "$candidate")"
    good "Python $reported at $PYTHON"
    break
  fi
  warn "Python $reported at $(command -v "$candidate") is older than $MIN_PYTHON"
done

if [[ -z "$PYTHON" ]]; then
  printf '  %sMISS %s Python %s or newer was not found.\n' "$RED" "$RESET" "$MIN_PYTHON"
  cat <<'EOF'

  Install Python, then re-run this script:

    macOS         brew install python@3.12
    Debian/Ubuntu sudo apt-get install python3 python3-venv python3-pip
    Fedora/RHEL   sudo dnf install python3 python3-pip
    any platform  https://www.python.org/downloads/

EOF
  exit 1
fi

# --- Virtual environment ----------------------------------------------------

step "Preparing virtual environment at ${VENV_PATH}"

if [[ "$RECREATE" -eq 1 && -d "$VENV_PATH" ]]; then
  rm -rf "$VENV_PATH"
  good "Removed the existing environment"
fi

if [[ ! -x "${VENV_PATH}/bin/python" ]]; then
  if ! "$PYTHON" -m venv "$VENV_PATH" 2>/dev/null; then
    echo "  Could not create the virtual environment." >&2
    echo "  On Debian/Ubuntu install the venv package first: sudo apt-get install python3-venv" >&2
    exit 1
  fi
  good "Created"
else
  good "Already present"
fi

VENV_PYTHON="${VENV_PATH}/bin/python"

step "Installing Python dependencies"
"$VENV_PYTHON" -m pip install --upgrade pip --quiet
"$VENV_PYTHON" -m pip install -r "${SCRIPTS_DIR}/requirements.txt" --quiet
good "PyYAML $("$VENV_PYTHON" -c 'import yaml; print(yaml.__version__)')"

# --- External tooling -------------------------------------------------------

step "Checking external tooling"

first_line() { "$@" 2>&1 | head -n1 | sed 's/[[:space:]]*$//'; }

if command -v node >/dev/null 2>&1; then
  good "Node.js $(first_line node --version)"
else
  bad "Node.js 18+ - https://nodejs.org/"
fi

if command -v copilot >/dev/null 2>&1; then
  good "GitHub Copilot CLI $(first_line copilot --version)"
  warn "Run \`copilot login\` if you have not authenticated on this machine."
else
  bad "GitHub Copilot CLI - \`npm install -g @github/copilot\` then \`copilot login\`"
fi

if command -v mvn >/dev/null 2>&1; then
  good "$(first_line mvn -v)"
else
  bad "Maven - https://maven.apache.org/download.cgi"
fi

if command -v java >/dev/null 2>&1; then
  good "$(first_line java -version)"
else
  bad "Java JDK - see .cloudmanager/java-version for the expected major version"
fi

# --- Local AEM --------------------------------------------------------------

step "Checking local AEM author"

AEM_HOST_VALUE="${AEM_HOST:-localhost}"
AEM_PORT_VALUE="${AEM_PORT:-4502}"
AEM_URL="http://${AEM_HOST_VALUE}:${AEM_PORT_VALUE}/libs/granite/core/content/login.html"

if command -v curl >/dev/null 2>&1 \
   && status="$(curl -s -o /dev/null -w '%{http_code}' -m 10 -I "$AEM_URL" 2>/dev/null)" \
   && [[ "$status" != "000" ]]; then
  good "AEM author reachable on http://${AEM_HOST_VALUE}:${AEM_PORT_VALUE} (HTTP ${status})"
else
  warn "AEM author is not reachable on http://${AEM_HOST_VALUE}:${AEM_PORT_VALUE}. Start the SDK quickstart before a real run."
fi

if [[ -z "${AEM_CREDENTIALS:-}" ]]; then
  warn "AEM_CREDENTIALS is not set; the agents will fall back to the config default."
fi

# --- Next steps -------------------------------------------------------------

step "Next steps"
cat <<EOF
  1. Activate the environment:

       source ${VENV_PATH}/bin/activate

  2. Set the AEM credentials for this session (never commit them):

       export AEM_CREDENTIALS='admin:admin'

  3. From the repository root (${REPO_ROOT}), verify the resolved contract:

       python ${LAUNCHER} --show-plan
       python ${LAUNCHER} --dry-run

  4. Run a migration:

       python ${LAUNCHER} --url https://example.com/page --max-parallel 1
EOF

if [[ "$OK" -ne 1 ]]; then
  printf '\n%sSome external tooling is missing. Install it before a real run.%s\n' "$YELLOW" "$RESET"
  exit 1
fi
printf '\n%sSetup complete.%s\n' "$GREEN" "$RESET"
