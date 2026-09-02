#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
WORKDIR=${AO_LAUNCHD_WORKDIR:-}
NODE_BIN=${AO_LAUNCHD_NODE:-node}
CLI_PATH=${AO_LAUNCHD_CLI:-}
CONFIG_PATH=${AO_CONFIG_PATH:-}

is_absolute() { case "$1" in /*) return 0;; *) return 1;; esac; }
require_absolute_existing_file() {
  name=$1
  value=$2
  is_absolute "$value" || { echo "$name must be an absolute path" >&2; exit 1; }
  [ -f "$value" ] || { echo "$name does not exist: $value" >&2; exit 1; }
}

"$SCRIPT_DIR/manage.sh" verify
[ -n "$WORKDIR" ] && is_absolute "$WORKDIR" || { echo "AO_LAUNCHD_WORKDIR must be an absolute path" >&2; exit 1; }
[ -d "$WORKDIR" ] || { echo "AO_LAUNCHD_WORKDIR does not exist: $WORKDIR" >&2; exit 1; }
[ -n "$CLI_PATH" ] || CLI_PATH="$WORKDIR/bin/agent-orchestrator.mjs"
require_absolute_existing_file AO_LAUNCHD_CLI "$CLI_PATH"
require_absolute_existing_file AO_CONFIG_PATH "$CONFIG_PATH"
[ -x "$NODE_BIN" ] || command -v "$NODE_BIN" >/dev/null 2>&1 || { echo "AO_LAUNCHD_NODE not executable: $NODE_BIN" >&2; exit 1; }

"$NODE_BIN" --check "$CLI_PATH"
help=$("$NODE_BIN" "$CLI_PATH" --help)
case "$help" in
  *"bootstrap"*"run-once"*"daemon"*"reconcile"*"status"*) ;;
  *) echo "entrypoint does not expose the required command shape" >&2; exit 1;;
esac
# status is intentionally read-only and validates the canonical config and
# versioned delta manifest without calling gh, git, launchctl, or an LLM.
status=$("$NODE_BIN" "$CLI_PATH" status)
case "$status" in
  *"agent-orchestrator-preinstall-delta"*"version"*) ;;
  *) echo "entrypoint status did not validate the canonical delta" >&2; exit 1;;
esac
echo "preflight: PASS (read-only)"
