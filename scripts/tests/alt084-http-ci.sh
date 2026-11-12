#!/usr/bin/env bash
# ALT-08.4 genuine HTTP Next route with local auth DB + isolated remote Neon WS.
set -Eeuo pipefail
if [[ "${CI:-}" != "true" || "${GITHUB_ACTIONS:-}" != "true" ||
      -z "${RUNNER_TEMP:-}" || -n "${DATABASE_URL:-}" ||
      "${VIGIA_ALT084_EVIDENCE_MODE:-}" != "ci-read-only" ||
      "${VIGIA_RLS_MODE:-}" != "ci-experimental" ||
      "${VIGIA_ALT083_DISPOSABLE_CONFIRM:-}" != "YES-EMPTY-NEON-CI-DATABASE" ||
      -z "${RLS_DATABASE_URL:-}" ]]; then
  echo "ALT084: denied non-disposable HTTP integration run" >&2;exit 2
fi
case "$(pwd -P)" in /home/runner/work/*) ;; *) exit 2;; esac
root="$(pwd -P)"
state_root="$(mktemp -d "${RUNNER_TEMP}/vigia-alt084-http-XXXXXXXX")"
export PGLITE_DIR="$state_root/database"
export SESSION_SECRET='ALT084_Only_Experimental_HTTP_Secret_2026'
export ALT084_EPHEMERAL_HTTP=1
export DEMO_MODE=0
export DATABASE_URL=
export NEXT_TELEMETRY_DISABLED=1
server_pid=''
remote_created=0
cleanup(){
  if [[ -n "$server_pid" ]]; then
    kill "$server_pid" 2>/dev/null || true
    pkill -P "$server_pid" 2>/dev/null || true
    wait "$server_pid" 2>/dev/null || true
  fi
  if [[ "$remote_created" == 1 ]]; then
    node --import tsx scripts/tests/alt084-http-neon-setup.ts cleanup || echo "ALT084 CLEANUP FAILED — disposable DB requires attention" >&2
  fi
  rm -rf -- "$state_root"
}
trap cleanup EXIT
node --import tsx scripts/tests/alt084-http-neon-setup.ts setup
remote_created=1
export ALT084_HTTP_IDS="$(node --import tsx scripts/tests/alt084-http-fixture.ts)"
node node_modules/next/dist/bin/next dev --hostname 127.0.0.1 --port 3199 >"$state_root/next.log" 2>&1 &
server_pid=$!
if ! node --import tsx scripts/tests/alt084-http-verify.ts; then
  echo 'ALT084: HTTP test failed; last app log lines:' >&2
  tail -40 "$state_root/next.log" >&2 || true
  exit 1
fi
