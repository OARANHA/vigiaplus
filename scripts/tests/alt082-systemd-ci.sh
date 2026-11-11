#!/usr/bin/env bash
# ALT-08.2: integration of a REAL systemd timer on an ephemeral GitHub runner.
# Must NEVER run on a permanent host, remote database or operational install.
set -Eeuo pipefail
if [[ "${CI:-}" != "true" || "${GITHUB_ACTIONS:-}" != "true" || -z "${RUNNER_TEMP:-}" || -z "${GITHUB_RUN_ID:-}" ]]; then
  echo "ALT082: allowed only on an ephemeral GitHub Actions runner" >&2
  exit 2
fi
if [[ -n "${DATABASE_URL:-}" || "${DEMO_MODE:-0}" == "1" ]]; then
  echo "ALT082: remote database or demo mode is not allowed" >&2
  exit 2
fi
[[ "$(ps -p 1 -o comm=)" == "systemd" ]] || { echo "systemd is not PID 1" >&2; exit 2; }
root="$(pwd -P)"
case "$root" in
  /home/runner/work/*) ;;
  *) echo "ALT082: untrusted workspace for ephemeral test" >&2; exit 2 ;;
esac
node_bin="$(command -v node)"
state_root="$(mktemp -d "${RUNNER_TEMP}/vigia-alt082-systemd-XXXXXXXX")"
data_dir="$state_root/database"
state_dir="$state_root/state"
unit="vigia-alt082-${GITHUB_RUN_ID}"
timer="${unit}.timer"
service="${unit}.service"
cleanup() {
  sudo systemctl stop "$timer" "$service" >/dev/null 2>&1 || true
  sudo systemctl reset-failed "$timer" "$service" >/dev/null 2>&1 || true
  rm -rf "$state_root"
}
trap cleanup EXIT
# --on-unit-inactive is measured after the previous service completion.
# Unit names are isolated to the disposable CI runner and are never enabled.
sudo systemd-run --quiet --unit="$unit" \
  --on-active=2s --on-unit-inactive=4s \
  --timer-property=AccuracySec=1s \
  --property=Type=oneshot \
  --property="WorkingDirectory=$root" \
  --property=TimeoutStartSec=90s \
  --setenv=VIGIA_NOTIFY_SCHEDULER=1 \
  --setenv=VIGIA_NOTIFY_DRY_RUN=1 \
  --setenv=DEMO_MODE=0 \
  --setenv=DATABASE_URL= \
  --setenv="PGLITE_DIR=$data_dir" \
  --setenv="VIGIA_NOTIFY_STATE_DIR=$state_dir" \
  "$node_bin" --import tsx "$root/scripts/workers/notify-supervised.ts"
sudo systemctl is-active --quiet "$timer"
declare -A seen=()
deadline=$((SECONDS+150))
while (( SECONDS < deadline )) && (( ${#seen[@]} < 3 )); do
  if [[ -s "$state_dir/latest.json" ]]; then
    # Ignore partially written checkpoints; the supervisor writes via rename().
    run_id="$(node -e 'try { const s=require(process.argv[1]);if(s.worker==="notify_dry_run"&&s.status==="success") process.stdout.write(s.runId); } catch {}' "$state_dir/latest.json" || true)"
    if [[ -n "$run_id" ]]; then seen["$run_id"]=1; fi
  fi
  sleep 2
done
if (( ${#seen[@]} < 3 )); then
  echo "ALT082: only ${#seen[@]} distinct scheduled dry-run cycles observed" >&2
  sudo systemctl status "$timer" "$service" --no-pager >&2 || true
  sudo journalctl -u "$service" -n 35 --no-pager >&2 || true
  exit 1
fi
sudo systemctl stop "$timer"
# Do not read PGlite while the systemd service owns its backing files.
for _ in $(seq 1 20); do
  if ! sudo systemctl is-active --quiet "$service"; then break; fi
  sleep 1
done
if sudo systemctl is-active --quiet "$service"; then
  echo "ALT082: service did not finish" >&2
  exit 1
fi
sudo chown -R "$(id -u):$(id -g)" "$state_root"
PGLITE_DIR="$data_dir" node --import tsx "$root/scripts/tests/alt082-verify-systemd.ts"
echo "ALT082: systemd timer produced 3+ distinct persisted dry-run cycles (no transports)"
