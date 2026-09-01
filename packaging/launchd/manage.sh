#!/bin/sh
set -eu

LABEL="com.az-claude.agent-orchestrator"
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
TEMPLATE="$SCRIPT_DIR/$LABEL.plist.template"
USER_HOME=${AO_LAUNCHD_HOME:-${HOME:?HOME is required}}
TARGET_DIR="$USER_HOME/Library/LaunchAgents"
TARGET="$TARGET_DIR/$LABEL.plist"
DOMAIN="gui/$(id -u)"
LAUNCHCTL=${AO_LAUNCHD_LAUNCHCTL:-launchctl}
PLUTIL=${AO_LAUNCHD_PLUTIL:-plutil}
NODE_BIN=${AO_LAUNCHD_NODE:-node}
WORKDIR=${AO_LAUNCHD_WORKDIR:-}
CLI_PATH=${AO_LAUNCHD_CLI:-}
LOG_DIR=${AO_LAUNCHD_LOG_DIR:-$USER_HOME/Library/Logs/AgentOrchestrator}

usage() {
  echo "usage: $0 verify|status|install|uninstall" >&2
  exit 2
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || { echo "required command not found: $1" >&2; exit 1; }
}

verify_template() {
  [ -f "$TEMPLATE" ] || { echo "missing template: $TEMPLATE" >&2; exit 1; }
  require_command "$PLUTIL"
  "$PLUTIL" -lint "$TEMPLATE" >/dev/null
  echo "template: PASS"
}

verify_install_inputs() {
  [ -n "$WORKDIR" ] || { echo "AO_LAUNCHD_WORKDIR is required for install" >&2; exit 1; }
  [ -d "$WORKDIR" ] || { echo "workdir does not exist: $WORKDIR" >&2; exit 1; }
  [ -n "$CLI_PATH" ] || { echo "AO_LAUNCHD_CLI is required for install" >&2; exit 1; }
  [ -f "$CLI_PATH" ] || { echo "CLI entrypoint does not exist: $CLI_PATH" >&2; exit 1; }
  [ -x "$NODE_BIN" ] || command -v "$NODE_BIN" >/dev/null 2>&1 || { echo "node executable not found: $NODE_BIN" >&2; exit 1; }
}

render_target() {
  mkdir -p "$TARGET_DIR"
  temp=$(mktemp "$TARGET_DIR/.$LABEL.XXXXXX")
  trap 'rm -f "$temp"' EXIT HUP INT TERM
  "$NODE_BIN" "$SCRIPT_DIR/render.mjs" "$TEMPLATE" "$temp" "$NODE_BIN" "$CLI_PATH" "$WORKDIR" "$LOG_DIR"
  "$PLUTIL" -lint "$temp" >/dev/null
  chmod 600 "$temp"
  mv -f "$temp" "$TARGET"
  trap - EXIT HUP INT TERM
}

verify_template
command=${1:-}
case "$command" in
  verify)
    ;;
  status)
    require_command "$LAUNCHCTL"
    if "$LAUNCHCTL" print "$DOMAIN/$LABEL"; then
      echo "status: loaded"
    else
      echo "status: not-loaded"
      exit 1
    fi
    ;;
  install)
    require_command "$LAUNCHCTL"
    verify_install_inputs
    render_target
    "$LAUNCHCTL" bootout "$DOMAIN" "$TARGET" >/dev/null 2>&1 || true
    "$LAUNCHCTL" bootstrap "$DOMAIN" "$TARGET"
    echo "installed: $TARGET"
    ;;
  uninstall)
    require_command "$LAUNCHCTL"
    if [ -e "$TARGET" ]; then
      "$LAUNCHCTL" bootout "$DOMAIN" "$TARGET" >/dev/null 2>&1 || true
      rm -f "$TARGET"
    fi
    echo "uninstalled: $TARGET"
    ;;
  *)
    usage
    ;;
esac
