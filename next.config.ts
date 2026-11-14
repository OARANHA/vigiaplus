import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Imagem Docker enxuta: o `next build` emite `.next/standalone` com apenas
  // os módulos necessários (ver deploy/Dockerfile).
  output: "standalone",
  // PGlite (WASM) e pdfkit (font AFM + dati) leggono file dal filesystem:
  // il bundling li romperebbe, restano esterni. L'SDK MCP porta con sé server
  // HTTP interi (express, hono): esterno anche lui, non va impacchettato.
  serverExternalPackages: ["@electric-sql/pglite", "pdfkit", "@modelcontextprotocol/sdk", "pg"],
};

export default nextConfig;
