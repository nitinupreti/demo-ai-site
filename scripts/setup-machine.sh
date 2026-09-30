#!/usr/bin/env bash
# One-time setup of a company laptop for this project, on Windows (in Git Bash) or macOS. Makes Node.js,
# Maven/Java and Git trust the company root certificate omnicomrootca01, applies the npm policy and
# installs the migration tools. Changes only your user account and is safe to run again.
#
#   bash scripts/setup-machine.sh [--java-home <JDK folder>] [--cert-dir <folder, default ~/certs>]
#                                 [--certificate-name omnicomrootca01] [--skip-tools]
set -euo pipefail

CERT_NAME="omnicomrootca01"
CERT_DIR="$HOME/certs"
JAVA_HOME_VALUE=""
SKIP_TOOLS=0
STORE_PASSWORD="changeit"
BLOCK_START="# >>> demo-ai-site setup >>>"
BLOCK_END="# <<< demo-ai-site setup <<<"

step() { printf '\n== %s\n' "$1"; }
ok() { printf '   OK  %s\n' "$1"; }
problem() { printf '   !!  %s\n' "$1"; }
die() { printf '\nERROR: %s\n' "$1" >&2; exit 1; }
usage() { sed -n '6,7p' "$0" | sed 's/^# \{0,1\}//'; }

while [ $# -gt 0 ]; do
  case "$1" in
    --certificate-name) CERT_NAME="${2:?$1 needs a value}"; shift 2 ;;
    --cert-dir) CERT_DIR="${2:?$1 needs a value}"; shift 2 ;;
    --java-home) JAVA_HOME_VALUE="${2:?$1 needs a value}"; shift 2 ;;
    --skip-tools) SKIP_TOOLS=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; die "unknown option $1" ;;
  esac
done

case "$(uname -s)" in
  Darwin) OS=macos; EXE="" ;;
  MINGW*|MSYS*|CYGWIN*) OS=windows; EXE=".exe" ;;
  *) die "run this script on macOS, or on Windows in Git Bash (it comes with Git for Windows), not in WSL." ;;
esac

# Windows programs are given Windows paths; Git Bash only converts some arguments by itself.
native_path() {
  if [ "$OS" = windows ]; then cygpath -w "$1"; else printf '%s' "$1"; fi
}
posix_path() {
  if [ "$OS" = windows ]; then cygpath -u "$1"; else printf '%s' "$1"; fi
}

CERT_DIR="$(posix_path "$CERT_DIR")"
case "$CERT_DIR" in
  *[[:space:]]*) die "--cert-dir must not contain spaces: Maven passes MAVEN_OPTS to Java unquoted." ;;
esac
if [ -n "$JAVA_HOME_VALUE" ]; then JAVA_HOME_VALUE="$(posix_path "$JAVA_HOME_VALUE")"; fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PEM_PATH="$CERT_DIR/$CERT_NAME.pem"
TRUSTSTORE="$CERT_DIR/java-truststore.p12"
GIT_BUNDLE="$CERT_DIR/git-ca-bundle.pem"
PREVIOUS_NODE_CERTS="${NODE_EXTRA_CA_CERTS:-}"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT
mkdir -p "$CERT_DIR"

# The certificate must be the self-signed root itself, still valid, with exactly this common name.
is_company_root() {
  local file="$1" form="$2" subject issuer
  subject="$(openssl x509 -inform "$form" -in "$file" -noout -subject -nameopt RFC2253 2>/dev/null | sed 's/^subject= *//')"
  issuer="$(openssl x509 -inform "$form" -in "$file" -noout -issuer -nameopt RFC2253 2>/dev/null | sed 's/^issuer= *//')"
  [ -n "$subject" ] && [ "$subject" = "$issuer" ] && printf '%s' "$subject" | grep -Eq "(^|,)CN=$CERT_NAME(,|$)" \
    && openssl x509 -inform "$form" -in "$file" -noout -checkend 0 >/dev/null 2>&1
}

# Windows: Trusted Root Certification Authorities, the machine's store first, then your own.
export_certificate_windows() {
  local der="$WORK_DIR/company-root.cer" options
  for options in "-store" "-user -store"; do
    rm -f "$der"
    # $options is split on purpose into certutil's flags.
    certutil $options Root "$CERT_NAME" "$(cygpath -w "$der")" >/dev/null 2>&1 || continue
    if is_company_root "$der" der; then
      openssl x509 -inform der -in "$der" -out "$PEM_PATH"
      return 0
    fi
  done
  return 1
}

# macOS: your keychains and the System keychain.
export_certificate_macos() {
  local file
  {
    security find-certificate -a -c "$CERT_NAME" -p 2>/dev/null || true
    security find-certificate -a -c "$CERT_NAME" -p /Library/Keychains/System.keychain 2>/dev/null || true
  } | awk -v dir="$WORK_DIR" '
    /-----BEGIN CERTIFICATE-----/ { count++; file = sprintf("%s/found-%03d.pem", dir, count) }
    file { print > file }
    /-----END CERTIFICATE-----/ { close(file); file = "" }'
  for file in "$WORK_DIR"/found-*.pem; do
    if [ -f "$file" ] && is_company_root "$file" pem; then
      cp "$file" "$PEM_PATH"
      chmod 644 "$PEM_PATH"
      return 0
    fi
  done
  return 1
}

# A copy of the JDK's trusted roots plus the company root; Maven uses it instead of the JDK default.
new_truststore() {
  local java_home="$1" keytool="$1/bin/keytool$EXE" output
  rm -f "$TRUSTSTORE"
  # Legacy PKCS12 algorithms keep the file readable by every JDK version the build may use.
  if ! output="$("$keytool" -J-Dkeystore.pkcs12.legacy -importkeystore -noprompt \
    -srckeystore "$(native_path "$java_home/lib/security/cacerts")" -srcstorepass "$STORE_PASSWORD" \
    -destkeystore "$(native_path "$TRUSTSTORE")" -deststoretype PKCS12 -deststorepass "$STORE_PASSWORD" 2>&1)"; then
    die "keytool could not copy the JDK's trusted roots: $output"
  fi
  if ! output="$("$keytool" -J-Dkeystore.pkcs12.legacy -importcert -noprompt -alias "$CERT_NAME" \
    -file "$(native_path "$PEM_PATH")" -keystore "$(native_path "$TRUSTSTORE")" -storetype PKCS12 \
    -storepass "$STORE_PASSWORD" 2>&1)"; then
    die "keytool could not add $CERT_NAME to $TRUSTSTORE: $output"
  fi
}

# The java.home a java binary reports, which is where keytool and the default trusted roots live.
java_home_of() {
  local reported
  reported="$("$1" -XshowSettings:properties -version 2>&1 | sed -n 's/^ *java\.home = //p' | tr -d '\r')"
  if [ -n "$reported" ]; then posix_path "$reported"; fi
}

# Windows: a user environment variable, like setx without /M; no admin rights needed.
save_windows_variable() {
  if MSYS_NO_PATHCONV=1 setx "$1" "$2" >/dev/null; then ok "$1 = $2"; else problem "setx $1 failed"; fi
}

# Replaces this script's block in a shell profile, keeping everything else in the file.
write_profile_block() {
  local profile="$1" kept="$WORK_DIR/profile"
  touch "$profile"
  awk -v start="$BLOCK_START" -v end="$BLOCK_END" '
    $0 == start { skipping = 1 }
    !skipping { print }
    $0 == end { skipping = 0 }' "$profile" > "$kept"
  { cat "$kept"; cat "$WORK_DIR/block"; } > "$profile"
}

step "Company root certificate ($CERT_NAME)"
if ! "export_certificate_$OS"; then
  if [ "$OS" = windows ]; then
    die "$CERT_NAME is not under Trusted Root Certification Authorities (certmgr.msc). Ask IT to install it, then run this script again."
  fi
  die "$CERT_NAME is not in your keychains (Keychain Access > System). Ask IT to install it, then run this script again."
fi
ok "$(native_path "$PEM_PATH") ($(openssl x509 -in "$PEM_PATH" -noout -enddate | sed 's/^notAfter=/expires /'))"
# Set for this run as well, so the checks at the end use it.
export NODE_EXTRA_CA_CERTS="$(native_path "$PEM_PATH")"

step "npm"
if command -v npm >/dev/null 2>&1; then
  if npm config set strict-ssl false >/dev/null 2>&1; then
    ok "strict-ssl = false in your user .npmrc (company policy)"
  else
    problem "npm config set strict-ssl false failed"
  fi
else
  problem "npm was not found; install Node.js, then run this script again."
fi

step "Java and Maven"
if [ -n "$JAVA_HOME_VALUE" ]; then
  [ -x "$JAVA_HOME_VALUE/bin/java$EXE" ] || die "--java-home '$JAVA_HOME_VALUE' has no bin/java$EXE."
  export JAVA_HOME="$(native_path "$JAVA_HOME_VALUE")"
fi
JAVA_BIN=""
if [ -n "${JAVA_HOME:-}" ]; then
  if [ -x "$(posix_path "$JAVA_HOME")/bin/java$EXE" ]; then
    JAVA_BIN="$(posix_path "$JAVA_HOME")/bin/java$EXE"
  else
    problem "JAVA_HOME is '$JAVA_HOME', which has no bin/java$EXE, so Maven will fail. Run this script again with --java-home <JDK folder>."
  fi
fi
if [ -z "$JAVA_BIN" ] && [ "$OS" = macos ]; then
  JDK="$(/usr/libexec/java_home 2>/dev/null || true)"
  if [ -n "$JDK" ]; then JAVA_BIN="$JDK/bin/java"; fi
fi
if [ -z "$JAVA_BIN" ]; then JAVA_BIN="$(command -v java || true)"; fi
JDK_HOME=""
if [ -n "$JAVA_BIN" ]; then JDK_HOME="$(java_home_of "$JAVA_BIN")"; fi
HAVE_TRUSTSTORE=0
if [ -n "$JDK_HOME" ]; then
  new_truststore "$JDK_HOME"
  HAVE_TRUSTSTORE=1
  ok "$(native_path "$TRUSTSTORE") (trusted roots of $(native_path "$JDK_HOME") plus $CERT_NAME)"
  # Your own MAVEN_OPTS flags are kept; only the trust store flags are replaced.
  MAVEN_OPTS="$(printf '%s' "${MAVEN_OPTS:-}" | sed -E 's/(^| )-Djavax\.net\.ssl\.trustStore[A-Za-z]*=[^ ]*//g; s/^ +//')"
  export MAVEN_OPTS="${MAVEN_OPTS:+$MAVEN_OPTS }-Djavax.net.ssl.trustStore=$(native_path "$TRUSTSTORE") -Djavax.net.ssl.trustStoreType=PKCS12 -Djavax.net.ssl.trustStorePassword=$STORE_PASSWORD"
else
  problem "No JDK was found; install one (the project builds with Java 21), then run this script again."
fi

step "Git"
if ! command -v git >/dev/null 2>&1; then
  problem "Git was not found; install it, then run this script again."
elif [ "$OS" = windows ]; then
  git config --global http.sslBackend schannel
  ok "http.sslBackend = schannel (the Windows certificate store, which holds $CERT_NAME)"
elif [ -f /etc/ssl/cert.pem ]; then
  cat /etc/ssl/cert.pem "$PEM_PATH" > "$GIT_BUNDLE"
  git config --global http.sslCAInfo "$GIT_BUNDLE"
  ok "http.sslCAInfo = $GIT_BUNDLE (the macOS public roots plus $CERT_NAME)"
else
  problem "/etc/ssl/cert.pem is missing, so Git was left unchanged."
fi

step "Save the settings for new terminals"
SETTINGS=(NODE_EXTRA_CA_CERTS)
if [ -n "$JAVA_HOME_VALUE" ]; then SETTINGS+=(JAVA_HOME); fi
if [ "$HAVE_TRUSTSTORE" = 1 ]; then SETTINGS+=(MAVEN_OPTS); fi
if [ "$OS" = windows ]; then
  for name in "${SETTINGS[@]}"; do save_windows_variable "$name" "${!name}"; done
else
  {
    printf '%s\n' "$BLOCK_START"
    printf '# Written by scripts/setup-machine.sh; run it again rather than editing this block.\n'
    printf 'export NODE_EXTRA_CA_CERTS=%q\n' "$PEM_PATH"
    if [ -n "$JAVA_HOME_VALUE" ]; then printf 'export JAVA_HOME=%q\n' "$JAVA_HOME_VALUE"; fi
    if [ "$HAVE_TRUSTSTORE" = 1 ]; then
      # Your own MAVEN_OPTS flags are kept; only the trust store flags are replaced.
      printf '%s\n' "MAVEN_OPTS=\"\$(printf '%s' \"\${MAVEN_OPTS:-}\" | sed -E 's/(^| )-Djavax\\.net\\.ssl\\.trustStore[A-Za-z]*=[^ ]*//g')\""
      printf 'export MAVEN_OPTS="${MAVEN_OPTS:+$MAVEN_OPTS }-Djavax.net.ssl.trustStore=%s -Djavax.net.ssl.trustStoreType=PKCS12 -Djavax.net.ssl.trustStorePassword=%s"\n' \
        "$TRUSTSTORE" "$STORE_PASSWORD"
    fi
    printf '%s\n' "$BLOCK_END"
  } > "$WORK_DIR/block"
  PROFILES=("$HOME/.zshrc")
  if [ -f "$HOME/.bash_profile" ]; then
    PROFILES+=("$HOME/.bash_profile")
  elif [ "${SHELL##*/}" = "bash" ]; then
    # bash reads only the first of these it finds, so an existing .profile is used rather than hidden.
    if [ -f "$HOME/.profile" ]; then PROFILES+=("$HOME/.profile"); else PROFILES+=("$HOME/.bash_profile"); fi
  fi
  for profile in "${PROFILES[@]}"; do write_profile_block "$profile"; done
  for name in "${SETTINGS[@]}"; do ok "$name = ${!name}"; done
  ok "written to ${PROFILES[*]}"
fi
if [ -n "$PREVIOUS_NODE_CERTS" ] && [ "$PREVIOUS_NODE_CERTS" != "$NODE_EXTRA_CA_CERTS" ]; then
  ok "NODE_EXTRA_CA_CERTS no longer points at $PREVIOUS_NODE_CERTS"
fi

step "Checks"
HAVE_NODE=0
if command -v node >/dev/null 2>&1; then
  HAVE_NODE=1
  status="$(node -e "fetch('https://registry.npmjs.org/').then((r) => console.log(r.status), (e) => console.log(e.cause ? e.cause.code : e.message))" 2>&1 || true)"
  if [ "$status" = "200" ]; then ok "Node.js reaches the npm registry (HTTP 200)"; else problem "Node.js could not reach the npm registry: $status"; fi
else
  problem "Node.js was not found."
fi
if command -v mvn >/dev/null 2>&1; then
  if maven="$(mvn -v 2>&1)"; then ok "${maven%%$'\n'*}"; else problem "mvn -v failed: $maven"; fi
else
  problem "Maven (mvn) was not found."
fi

if [ "$SKIP_TOOLS" = 0 ] && [ "$HAVE_NODE" = 1 ]; then
  step "Migration tools: Copilot CLI, Playwright and a browser check"
  node "$(native_path "$REPO_ROOT/design/site-url/tools/setup.mjs")" || problem "The migration tools setup failed; see the messages above."
fi

printf '\nDone. Open a new terminal and restart VS Code so they pick up the new settings.\n'
