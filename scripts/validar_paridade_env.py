#!/usr/bin/env python3
"""Valida paridade visual prod/homolog e regras de CSS de ambiente.

Uso:
  python scripts/validar_paridade_env.py           # checagens locais
  python scripts/validar_paridade_env.py --live    # inclui fetch prod + homolog
"""
from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
STATIC = ROOT / "static"
TEMPLATES = ROOT / "templates"

# WMS Pro no Render (override via WMS_PROD_URL / WMS_HML_URL)
PROD_LOGIN = os.environ.get(
    "WMS_PROD_URL",
    "https://doca-livre-wms-pro.onrender.com/?sair=1",
)
HML_LOGIN = os.environ.get(
    "WMS_HML_URL",
    "https://doca-livre-wms-pro-homologacao.onrender.com/?sair=1",
)
GIT_REMOTE = os.environ.get("WMS_GIT_REMOTE", "pro")

# Paginas shell com banner de ambiente (WMS unico: moldura /app, login e telas do PRO)
SHELL_PAGES = ("wms_shell.html", "login.html", "index.html", "entrada_modulos.html")

ALLOWED_HOMOLOG_DIFFS = (
    "app-env-banner",
    "app-env-homologacao",
    "intro-ambiente--homolog",
    "Homologação",
    "Homologacao",
)


def fail(msg: str) -> None:
    print(f"FALHA: {msg}", file=sys.stderr)
    sys.exit(1)


def ok(msg: str) -> None:
    print(f"OK: {msg}")


def git_same_commit() -> None:
    subprocess.run(
        ["git", "fetch", GIT_REMOTE], cwd=ROOT, check=False, capture_output=True
    )
    main = subprocess.check_output(
        ["git", "rev-parse", f"{GIT_REMOTE}/main"], cwd=ROOT, text=True
    ).strip()
    homolog = subprocess.check_output(
        ["git", "rev-parse", f"{GIT_REMOTE}/homolog"], cwd=ROOT, text=True
    ).strip()
    if main != homolog:
        fail(f"branches divergentes: main={main[:8]} homolog={homolog[:8]}")
    ok(f"main e homolog no mesmo commit ({main[:8]})")


def pages_load_doca_css() -> None:
    """Toda pagina com banner de ambiente deve carregar doca-livre-pro.css (banner fixo)."""
    offenders: list[str] = []
    for name in SHELL_PAGES:
        path = TEMPLATES / name
        if not path.exists():
            continue
        text = path.read_text(encoding="utf-8")
        if "doca-livre-pro.css" not in text:
            offenders.append(name)
    if offenders:
        fail(
            "paginas shell sem doca-livre-pro.css: " + ", ".join(offenders)
        )
    ok("paginas shell carregam doca-livre-pro.css")


def css_uses_banner_variable() -> None:
    doca = (STATIC / "doca-livre-pro.css").read_text(encoding="utf-8")
    if "--app-env-banner-h" not in doca:
        fail("doca-livre-pro.css sem --app-env-banner-h")
    if "position: fixed" not in doca or ".app-env-banner" not in doca:
        fail("doca-livre-pro.css sem .app-env-banner fixo")
    if "body.login-page-body" not in doca or "padding-top: 0" not in doca:
        fail("login sem regra padding-top: 0 para paridade")

    stock = (STATIC / "stock-system.css").read_text(encoding="utf-8")
    if re.search(r"body\.app-env-homologacao\s*\{[^}]*padding-top:\s*40px", stock):
        fail("stock-system.css ainda usa padding-top no body (quebra login)")

    bad = []
    for css_path in STATIC.glob("*.css"):
        if css_path.name == "doca-livre-pro.css":
            continue
        text = css_path.read_text(encoding="utf-8")
        if re.search(r"body\.app-env-homologacao\s*\{[^}]*padding-top:", text):
            bad.append(css_path.name)
    if bad:
        fail(f"padding-top no body.app-env-homologacao fora do padrao: {', '.join(bad)}")

    ok("CSS de ambiente usa --app-env-banner-h (sem body padding global)")


def cache_bust_aligned() -> None:
    """Versoes ?v= de doca-livre-pro.css devem ser iguais nos templates principais."""
    versions: set[str] = set()
    for name in SHELL_PAGES:
        path = TEMPLATES / name
        if not path.exists():
            continue
        text = path.read_text(encoding="utf-8")
        m = re.search(r"doca-livre-pro\.css[^?]*\?v=([^\s\"']+)", text)
        if m:
            versions.add(m.group(1))
    if len(versions) > 1:
        fail(f"versoes doca-livre-pro.css divergentes nos templates: {versions}")
    if not versions:
        fail("nenhum template principal com doca-livre-pro.css?v=")
    ok(f"cache bust doca-livre-pro.css alinhado ({next(iter(versions))})")


def normalize_html(html: str) -> str:
    html = re.sub(r"<!--.*?-->", "", html, flags=re.S)
    html = re.sub(
        r'<div class="app-env-banner"[^>]*>.*?</div>', "", html, flags=re.S
    )
    html = html.replace(" app-env-homologacao", "")
    html = re.sub(
        r'<p class="intro-ambiente intro-ambiente--homolog">Homologação</p>\s*',
        "",
        html,
    )
    html = re.sub(r">\s+<", "><", html)
    html = re.sub(r"\s+", " ", html).strip()
    return html


def fetch(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": "WMS-parity-check/1.0"})
    with urllib.request.urlopen(req, timeout=45) as resp:
        return resp.read().decode("utf-8", errors="replace")


def live_parity() -> None:
    try:
        prod = fetch(PROD_LOGIN)
        hml = fetch(HML_LOGIN)
    except urllib.error.URLError as exc:
        fail(f"fetch live falhou: {exc}")

    for label, html in (("prod", prod), ("hml", hml)):
        if "doca-livre-pro.css" not in html:
            fail(f"{label}: pagina raiz sem doca-livre-pro.css")
        v = re.search(r"doca-livre-pro\.css[^?]*\?v=([^\s\"']+)", html)
        if not v:
            fail(f"{label}: sem cache bust doca-livre-pro.css")
    prod_v = re.search(r"doca-livre-pro\.css[^?]*\?v=([^\s\"']+)", prod).group(1)
    hml_v = re.search(r"doca-livre-pro\.css[^?]*\?v=([^\s\"']+)", hml).group(1)
    if prod_v != hml_v:
        fail(
            f"versoes CSS live divergentes: prod={prod_v} hml={hml_v} "
            "(aguarde Render ou confira deploy)"
        )

    if "app-env-banner" not in hml or '<div class="app-env-banner"' not in hml:
        fail("homolog live sem banner HTML (esperado)")
    if '<div class="app-env-banner"' in prod:
        fail("producao live com banner HTML de homolog (inesperado)")

    np = normalize_html(prod)
    nh = normalize_html(hml)
    if np != nh:
        for i, (a, b) in enumerate(zip(np, nh)):
            if a != b:
                fail(
                    "HTML raiz normalizado difere entre prod e homolog "
                    f"(pos {i}): prod=...{np[max(0,i-40):i+60]!r} "
                    f"hml=...{nh[max(0,i-40):i+60]!r}"
                )
        if len(np) != len(nh):
            fail(f"tamanho HTML normalizado difere: prod={len(np)} hml={len(nh)}")

    ok("raiz live prod/homolog identico (exceto banner homolog)")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--live", action="store_true", help="comparar URLs Render")
    args = parser.parse_args()

    git_same_commit()
    pages_load_doca_css()
    css_uses_banner_variable()
    cache_bust_aligned()
    if args.live:
        live_parity()
    print("\nParidade prod/homolog validada.")


if __name__ == "__main__":
    main()
