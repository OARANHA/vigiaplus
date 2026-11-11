#!/usr/bin/env bash
# ALT-08.3 authenticated HTTP E2E, disposable GitHub Actions runner only.
set -Eeuo pipefail
if [[ "${CI:-}" != "true" || "${GITHUB_ACTIONS:-}" != "true" || -z "${RUNNER_TEMP:-}" || -n "${DATABASE_URL:-}" ]]; then
  echo "ALT083: ephemeral GitHub CI and no remote DB required" >&2
  exit 2
fi
case "$(pwd -P)" in /home/runner/work/*) ;; *) exit 2;; esac
root="$(pwd -P)"
state_root="$(mktemp -d "${RUNNER_TEMP}/vigia-alt083-http-XXXXXXXX")"
export PGLITE_DIR="$state_root/database"
export SESSION_SECRET='ALT083_Test_Only_Secret_2026_11_11_Protected'
export ALT083_EPHEMERAL_HTTP=1
export DEMO_MODE=0
export DATABASE_URL=
export NEXT_TELEMETRY_DISABLED=1
server_pid=''
cleanup() {
  if [[ -n "$server_pid" ]]; then
    kill "$server_pid" 2>/dev/null || true
    pkill -P "$server_pid" 2>/dev/null || true
    wait "$server_pid" 2>/dev/null || true
  fi
  rm -rf -- "$state_root"
}
trap cleanup EXIT
fixture_ids="$(node --import tsx scripts/tests/alt083-http-fixture.ts)"
export ALT083_FIXTURE_IDS="$fixture_ids"
# Node directly instead of npm wrapper: process signal and lifecycle are predictable.
node node_modules/next/dist/bin/next dev --hostname 127.0.0.1 --port 3199 \
  >"$state_root/next.log" 2>&1 &
server_pid=$!
if ! node --import tsx scripts/tests/alt083-http-verify.ts; then
  echo 'ALT083: HTTP test failure; last app log lines:' >&2
  tail -35 "$state_root/next.log" >&2 || true
  exit 1
fi
