import { NextResponse } from "next/server";

// Liveness / healthcheck usado por orquestradores (Docker, Traefik, k8s).
// Fica de propósito leve: NÃO toca o banco para não disparar o seed a cada
// chamada de probe. O readiness real é o próprio boot da app (seed + migrations).
export const dynamic = "force-dynamic";

export async function GET() {
  const payload = {
    status: "ok",
    service: "vigiaplus",
    ts: Date.now(),
  };
  return NextResponse.json(payload, {
    status: 200,
    headers: { "Cache-Control": "no-store" },
  });
}
