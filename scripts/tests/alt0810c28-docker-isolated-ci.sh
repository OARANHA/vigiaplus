#!/usr/bin/env bash
# ALT-08.10C.28 — Docker real em GitHub Actions descartável.
# Build local exclusivamente. Sem push/pull de imagens VIGIAPLUS, sem Neon,
# sem rede para o container e sem qualquer segredo operacional.
set -Eeuo pipefail

: "${CI:?CI required}"
: "${GITHUB_ACTIONS:?GITHUB_ACTIONS required}"
: "${RUNNER_TEMP:?RUNNER_TEMP required}"
[[ "${CI}" == "true" && "${GITHUB_ACTIONS}" == "true" && "${RUNNER_OS:-}" == "Linux" &&
   "${ALT0810C28_EPHEMERAL:-}" == "1" ]] || {
  echo "ALT0810C28_DISPOSABLE_RUNNER_ONLY" >&2; exit 1;
}
[[ -z "${DATABASE_URL:-}" && -z "${RLS_DATABASE_URL:-}" ]] || {
  echo "ALT0810C28_DATABASE_URL_FORBIDDEN" >&2; exit 1;
}
command -v docker >/dev/null
docker info >/dev/null

image="vigia-alt0810c28-ci:${GITHUB_SHA:-local}"
container="vigia-alt0810c28-${GITHUB_RUN_ID:-test}"
cleanup() {
  docker rm -f "${container}" >/dev/null 2>&1 || true
  docker image rm -f "${image}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# Build usa somente o Dockerfile real: npm ci, Next build, standalone.
# Nenhum --build-arg, env de banco ou token é enviado à imagem.
docker build --progress=plain -f deploy/Dockerfile -t "${image}" .

docker image inspect "${image}" --format '{{.Config.User}}' | grep -Fx 'nextjs'
docker image inspect "${image}" --format '{{json .Config.Cmd}}' | grep -F '"server.js"'

# Sem network namespace externo: nenhuma conexão com Neon/PostgreSQL remoto
# é possível durante execução; HTTP é inspecionado via docker exec localhost.
docker run -d --name "${container}" --network none --cap-drop ALL \
  --security-opt no-new-privileges \
  --env PORT=3000 --env HOSTNAME=127.0.0.1 --env DEMO_MODE=0 \
  --env SESSION_SECRET=ALT0810C28_Only_Disposable_Docker_Smoke_Key_2026_ABCDEF \
  "${image}" >/dev/null

docker inspect "${container}" --format '{{.HostConfig.NetworkMode}}' | grep -Fx none
[[ "$(docker inspect "${container}" --format '{{.State.Running}}')" == "true" ]]
docker inspect "${container}" --format '{{range .Config.Env}}{{println .}}{{end}}' \
  | grep -Ev '^(DATABASE_URL|RLS_DATABASE_URL|PGHOST|PGPASSWORD|PGUSER|PGDATABASE)=' >/dev/null
if docker inspect "${container}" --format '{{range .Config.Env}}{{println .}}{{end}}' \
  | grep -Eq '^(DATABASE_URL|RLS_DATABASE_URL|PGHOST|PGPASSWORD|PGUSER|PGDATABASE)='; then
  echo "ALT0810C28_OPERATIONAL_DB_ENV_LEAK" >&2; exit 1
fi

# Manifesto REAL do container: rota CI não existe no artefato final.
docker exec "${container}" node -e '
const fs=require("node:fs"), assert=require("node:assert/strict");
const p="/app/.next/server/app-paths-manifest.json";
assert(fs.existsSync(p),"manifest missing in Docker image");
const routes=JSON.stringify(JSON.parse(fs.readFileSync(p,"utf8")));
assert(!routes.includes("alt0810c25"),"CI-only handler leaked into Docker image");
console.log("ALT0810C28 Docker App Router manifest: CI route absent");
'

# Aguarda boot do servidor dentro do container sem publicar qualquer porta.
# Verifica status 404 também com cookie arbitrário e que não é uma resposta 401
# ou 500 de dependência externa. O proxy bloqueia antes de usar banco.
docker exec "${container}" node -e '
const assert=require("node:assert/strict");
const {setTimeout:wait}=require("node:timers/promises");
(async()=>{
 let last="";
 for(let i=0;i<35;i++){
   try{
     const r=await fetch("http://127.0.0.1:3000/api/ci/alt0810c25?tenant=101",{
       headers:{cookie:"sr_session=ci-synthetic-cookie"},
       signal:AbortSignal.timeout(2000),redirect:"manual"});
     const data=await r.json();
     assert.equal(r.status,404,"CI-only Docker route must be HTTP 404");
     assert.equal(data.error,"not_found");
     assert.equal(r.headers.get("cache-control"),"no-store");
     console.log("ALT0810C28 Docker HTTP: 404 not_found, no-store, no DB and no network");
     return;
   }catch(e){
     if(e?.code==="ERR_ASSERTION" || String(e).includes("AssertionError")) throw e;
     last=String(e);
     await wait(500);
   }
 }
 throw Error("Docker server did not serve isolated CI route: "+last);
})().catch(e=>{console.error(e);process.exitCode=1;});
'

echo 'ALT0810C28: Docker built and started; no container network, DB env or CI route. No image published.'
