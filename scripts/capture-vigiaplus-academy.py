#!/usr/bin/env python3
"""Captura interface LOCAL real e gera aulas por tela. Sem cookies persistidos."""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import sys
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
ROUTES = ROOT / "skills/vigiaplus-screen-academy/references/telas.json"
MASK = ["input[type=password]", "input[type=email]", "[data-sensitive]",
        "[data-private]", "[autocomplete=email]", "[autocomplete=tel]"]


def safe(value, limit=150):
    value = " ".join(str(value or "").split())
    value = re.sub(r"[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}",
                   "[email oculto]", value, flags=re.I)
    value = re.sub(r"\b\d{3}\.\d{3}\.\d{3}-\d{2}\b", "[CPF oculto]", value)
    value = re.sub(r"\b\d{2}\.\d{3}\.\d{3}/\d{4}-\d{2}\b", "[CNPJ oculto]", value)
    return value[:limit].replace(chr(96), "'")


def strings(page, selector):
    found = []
    for item in page.locator(selector).all_text_contents():
        text = safe(item, 100)
        if text and text not in found:
            found.append(text)
        if len(found) >= 15:
            break
    return found


def lesson(item, theme, title, headings, actions, png):
    lines = ["# Aula — " + title, "", "Rota: " + item["path"],
             "Perfil: " + ", ".join(item["roles"]), "Tema: " + theme, "",
             "## Objetivo", "", safe(item["goal"]), "",
             "## Tela capturada", "",
             "![Interface VigiaPlus](../capturas/" + png + ")", "",
             "## Acesso e navegação", "",
             "1. Abra a rota " + item["path"] + " em localhost.",
             "2. Utilize a conta autorizada para este perfil."]
    if item.get("tab"):
        lines.append("3. Selecione a aba " + safe(item["tab"]) + ".")
    lines.extend(["", "## Elementos observados", ""])
    lines.extend(["- " + x for x in headings] or ["Nenhum título identificado."])
    lines.extend(["", "## Controles visíveis", ""])
    lines.extend(["- " + x for x in actions] or ["Nenhum controle identificado."])
    lines.extend(["", "## Exercício orientado", "",
                  "Identifique o título e os controles listados no print. Não execute",
                  "ações que alterem dados sem autorização.", "",
                  "## Limites", "",
                  "Descrição baseada exclusivamente no DOM capturado; não comprova",
                  "funcionalidade das ações, disponibilidade de dados ou segurança de produção.",
                  "Revisar dados pessoais antes de divulgar qualquer captura.", ""])
    return "\n".join(lines)


def main():
    ap = argparse.ArgumentParser(description="Academia VigiaPlus: capturar e documentar telas reais")
    ap.add_argument("--role", required=True, choices=["public", "owner", "client", "analyst"])
    ap.add_argument("--base-url", default="http://127.0.0.1:3199")
    ap.add_argument("--themes", choices=["light", "dark", "both"], default="both")
    ap.add_argument("--list", action="store_true")
    args = ap.parse_args()
    routes = [r for r in json.loads(ROUTES.read_text(encoding="utf-8"))["routes"]
              if args.role in r["roles"]]
    if args.list:
        for item in routes:
            print(item["id"], item["path"], item.get("tab", ""))
        return 0
    url = urlparse(args.base_url)
    if (url.scheme != "http" or url.hostname not in ["localhost", "127.0.0.1"]
            or url.username or url.password or url.path not in ["", "/"]
            or url.query or url.fragment):
        ap.error("Permite somente URL localhost ou 127.0.0.1 via HTTP.")
    base = "http://127.0.0.1:" + str(url.port or 80)
    output = ROOT / ".data/academia-vigiaplus" / args.role
    shots, docs = output / "capturas", output / "aulas"
    shots.mkdir(parents=True, exist_ok=True)
    docs.mkdir(parents=True, exist_ok=True)
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("Instale: python -m pip install playwright; python -m playwright install chromium",
              file=sys.stderr)
        return 2

    outcomes = []
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=False)
        context = browser.new_context(
            viewport={"width": 1440, "height": 900}, locale="pt-BR",
            reduced_motion="reduce", service_workers="block")
        page = context.new_page()
        page.set_default_timeout(10000)
        try:
            page.goto(base + "/login", wait_until="domcontentloaded", timeout=25000)
            if args.role != "public":
                print("Entre MANUALMENTE no navegador aberto. Não salve sua senha em arquivos.")
                input("Após completar o login, pressione ENTER neste terminal...")
                if urlparse(page.url).path in ["/login", "/recuperar"]:
                    raise RuntimeError("Login não concluído: captura abortada.")
            for item in routes:
                themes = ["light", "dark"] if args.themes == "both" else [args.themes]
                for preferred in themes:
                    code, theme = item["id"], preferred
                    try:
                        page.goto(base + item["path"], wait_until="domcontentloaded",
                                  timeout=25000)
                        if urlparse(page.url).hostname not in ["localhost", "127.0.0.1"]:
                            raise RuntimeError("Redirecionamento externo bloqueado.")
                        if urlparse(page.url).path == "/login" and item["path"] != "/login":
                            raise RuntimeError("Sem acesso à rota ou sessão expirada.")
                        if page.locator(".vpx-app").count():
                            page.evaluate(
                                "(t) => localStorage.setItem('vigiaplus-dashboard-theme', t)",
                                preferred)
                            page.reload(wait_until="domcontentloaded", timeout=25000)
                        else:
                            if preferred == "dark":
                                continue
                            theme = "padrao"
                        if item.get("tab"):
                            tab = page.get_by_role("button", name=item["tab"], exact=True)
                            if not tab.count():
                                tab = page.get_by_text(item["tab"], exact=True)
                            if not tab.count():
                                raise RuntimeError("Aba ausente: " + item["tab"])
                            tab.first.click(timeout=8000)
                        page.wait_for_timeout(800)
                        if page.locator("h1").filter(has_text="404").count():
                            raise RuntimeError("Página 404.")
                        headings = strings(page, "h1,h2,h3")
                        actions = strings(page, "main button,nav button,.vpx-app button")
                        title = headings[0] if headings else safe(page.title()) or code
                        filename = code + "-" + theme + ".png"
                        page.screenshot(path=str(shots / filename), full_page=True,
                                        animations="disabled", scale="css",
                                        mask=[page.locator(sel) for sel in MASK],
                                        mask_color="#334155")
                        (docs / (code + "-" + theme + ".md")).write_text(
                            lesson(item, theme, title, headings, actions, filename),
                            encoding="utf-8")
                        outcomes.append({"screen": code, "theme": theme,
                                         "status": "capturado", "title": title})
                        print("OK", code, theme)
                    except Exception as ex:
                        reason = safe(ex, 160)
                        outcomes.append({"screen": code, "theme": theme,
                                         "status": "pendente", "reason": reason})
                        print("PENDENTE", code, reason)
        finally:
            context.close()  # Nenhum storage_state/cookie é gravado no disco.
            browser.close()
    index = ["# Academia VigiaPlus — " + args.role, "",
             "Gerado em: " + datetime.now(timezone.utc).isoformat(), "",
             "Capturas locais ignoradas pelo Git.", ""]
    for r in outcomes:
        if r["status"] == "capturado":
            index.append("- [" + safe(r["title"]) + "](aulas/" + r["screen"] +
                         "-" + r["theme"] + ".md)")
        else:
            index.append("- PENDENTE: " + r["screen"] + " — " + r["reason"])
    (output / "index.md").write_text("\n".join(index) + "\n", encoding="utf-8")
    (output / "resultado.json").write_text(json.dumps(outcomes, indent=2,
                     ensure_ascii=False), encoding="utf-8")
    print("Índice:", output / "index.md")
    return 0 if all(r["status"] == "capturado" for r in outcomes) else 1


if __name__ == "__main__":
    raise SystemExit(main())
