#!/usr/bin/env python3
"""Render README architecture diagrams (Solana-style 2.5D blocks) to docs/diagrams/*.svg.

Layout rule: every arrow runs through an empty corridor between blocks — never across one.
"""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BRAND = ROOT / "docs" / "diagrams" / "brand"
OUT = ROOT / "docs" / "diagrams"

D = 14  # extrusion depth (up-right oblique)
PURPLE = "#9945FF"
GREEN = "#14F195"
MAGENTA = "#DC1FFF"
LIME = "#C9F31D"
ORANGE = "#FF7A3D"
MUTED = "#A99CD9"
INK = "#F4F1FF"


def mark(name: str, size: float) -> str:
    raw = (BRAND / f"{name}.svg").read_text()
    inner = re.search(r"<svg[^>]*>(.*)</svg>", raw, re.S).group(1)
    # Brand tiles use distinct ids; namespace them so multiple copies don't clash.
    inner = inner.replace('id="m"', f'id="m-{name}"').replace("url(#m)", f"url(#m-{name})")
    return f'<g transform="scale({size / 64:.4f})">{inner}</g>'


def defs() -> str:
    markers = "".join(
        f'<marker id="ah-{k}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" '
        f'markerHeight="9" markerUnits="userSpaceOnUse" orient="auto-start-reverse">'
        f'<path d="M0,0 L10,5 L0,10 z" fill="{c}"/></marker>'
        for k, c in {"purple": "#B57BFF", "green": GREEN, "magenta": MAGENTA, "lime": LIME}.items()
    )
    return f"""<defs>
  <linearGradient id="sol" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="{PURPLE}"/><stop offset="1" stop-color="{GREEN}"/>
  </linearGradient>
  <linearGradient id="sol-h" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="{PURPLE}"/><stop offset="1" stop-color="{GREEN}"/>
  </linearGradient>
  <linearGradient id="face" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#1D1638"/><stop offset="1" stop-color="#110D22"/>
  </linearGradient>
  <radialGradient id="glow-p" cx="0.15" cy="0.1" r="0.6">
    <stop offset="0" stop-color="{PURPLE}" stop-opacity="0.28"/><stop offset="1" stop-color="{PURPLE}" stop-opacity="0"/>
  </radialGradient>
  <radialGradient id="glow-g" cx="0.9" cy="0.95" r="0.55">
    <stop offset="0" stop-color="{GREEN}" stop-opacity="0.18"/><stop offset="1" stop-color="{GREEN}" stop-opacity="0"/>
  </radialGradient>
  <pattern id="dots" width="22" height="22" patternUnits="userSpaceOnUse">
    <circle cx="1" cy="1" r="1" fill="{PURPLE}" fill-opacity="0.22"/>
  </pattern>
  <filter id="shadow" x="-20%" y="-20%" width="140%" height="160%">
    <feDropShadow dx="6" dy="10" stdDeviation="8" flood-color="#000" flood-opacity="0.55"/>
  </filter>
  {markers}
</defs>"""


def background(w: int, h: int, title: str, subtitle: str) -> str:
    return f"""<rect width="{w}" height="{h}" rx="18" fill="#0B0915"/>
<rect width="{w}" height="{h}" rx="18" fill="url(#dots)"/>
<rect width="{w}" height="{h}" rx="18" fill="url(#glow-p)"/>
<rect width="{w}" height="{h}" rx="18" fill="url(#glow-g)"/>
<text x="40" y="44" font-family="ui-monospace,SFMono-Regular,Menlo,monospace" font-size="13" letter-spacing="3" font-weight="700" fill="url(#sol-h)">{title}</text>
<text x="40" y="68" font-family="Inter,ui-sans-serif,system-ui,sans-serif" font-size="14" fill="{MUTED}">{subtitle}</text>"""


def plate(x: float, y: float, w: float, h: float, label: str, color: str) -> str:
    d = 10
    return f"""<g>
  <polygon points="{x},{y} {x+w},{y} {x+w+d},{y-d} {x+d},{y-d}" fill="{color}" fill-opacity="0.10"/>
  <polygon points="{x+w},{y} {x+w+d},{y-d} {x+w+d},{y+h-d} {x+w},{y+h}" fill="{color}" fill-opacity="0.06"/>
  <rect x="{x}" y="{y}" width="{w}" height="{h}" fill="{color}" fill-opacity="0.045" stroke="{color}" stroke-opacity="0.38" stroke-width="1"/>
  <rect x="{x+14}" y="{y+12}" width="{len(label)*8.2+18}" height="20" rx="10" fill="{color}" fill-opacity="0.16" stroke="{color}" stroke-opacity="0.55"/>
  <text x="{x+23}" y="{y+26}" font-family="ui-monospace,SFMono-Regular,Menlo,monospace" font-size="11" letter-spacing="2" font-weight="700" fill="{color}">{label}</text>
</g>"""


def block(x: float, y: float, w: float, h: float, title: str, sub: str, logo: str | None = None) -> str:
    logo_svg = ""
    tx = x + 16
    if logo:
        s = min(40, h - 26)
        logo_svg = f'<g transform="translate({x+14},{y+(h-s)/2})">{mark(logo, s)}</g>'
        tx = x + 14 + s + 12
    ty = y + h / 2
    return f"""<g filter="url(#shadow)">
  <polygon points="{x},{y} {x+w},{y} {x+w+D},{y-D} {x+D},{y-D}" fill="#2E2358"/>
  <polygon points="{x+w},{y} {x+w+D},{y-D} {x+w+D},{y+h-D} {x+w},{y+h}" fill="#0D0A1B"/>
  <rect x="{x}" y="{y}" width="{w}" height="{h}" fill="url(#face)"/>
  <polyline points="{x},{y+h} {x},{y} {x+w},{y} {x+w+D},{y-D}" fill="none" stroke="url(#sol)" stroke-width="1.4"/>
  <polygon points="{x},{y} {x+w},{y} {x+w+D},{y-D} {x+D},{y-D}" fill="none" stroke="url(#sol)" stroke-opacity="0.7" stroke-width="1"/>
  <rect x="{x}" y="{y}" width="{w}" height="{h}" fill="none" stroke="url(#sol)" stroke-opacity="0.55" stroke-width="1"/>
</g>
{logo_svg}
<text x="{tx}" y="{ty-3}" font-family="Inter,ui-sans-serif,system-ui,sans-serif" font-size="15" font-weight="650" fill="{INK}">{title}</text>
<text x="{tx}" y="{ty+15}" font-family="ui-monospace,SFMono-Regular,Menlo,monospace" font-size="11" fill="{MUTED}">{sub}</text>"""


def path(points: list[tuple[float, float]], color: str, dashed: bool = False) -> str:
    stroke = {"purple": "#B57BFF", "green": GREEN, "magenta": MAGENTA, "lime": LIME}[color]
    d = " ".join(("M" if i == 0 else "L") + f"{px},{py}" for i, (px, py) in enumerate(points))
    dash = ' stroke-dasharray="6 5"' if dashed else ""
    return (
        f'<path d="{d}" fill="none" stroke="{stroke}" stroke-width="1.8" stroke-linejoin="round"'
        f'{dash} marker-end="url(#ah-{color})"/>'
    )


def pill(cx: float, cy: float, text: str, color: str) -> str:
    stroke = {"purple": "#B57BFF", "green": GREEN, "magenta": MAGENTA, "lime": LIME}[color]
    w = len(text) * 6.4 + 18
    return (
        f'<rect x="{cx-w/2:.1f}" y="{cy-10}" width="{w:.1f}" height="20" rx="10" fill="#0B0915" '
        f'stroke="{stroke}" stroke-opacity="0.6"/>'
        f'<text x="{cx}" y="{cy+4}" text-anchor="middle" font-family="ui-monospace,SFMono-Regular,Menlo,monospace" '
        f'font-size="10.5" fill="{INK}">{text}</text>'
    )


def svg(w: int, h: int, label: str, body: str) -> str:
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}" '
        f'role="img" aria-label="{label}">\n{defs()}\n{body}\n</svg>\n'
    )


def split_diagram() -> str:
    W, H = 1130, 610
    bw, bh = 200, 70
    # Tier A (off-chain) → Tier B (programs) → Tier C (accounts & mints)
    xs, cre = (200, 122), (520, 122)
    reg, div = (520, 280), (840, 280)
    cw, ch, cy = 176, 64, 440
    kids = [
        ("StripMarket", "per xStock mint"),
        ("StripSeries n", "one yield window"),
        ("xStock vault", "escrow until redeem"),
        ("strip PT", "capital leg"),
        ("strip YT", "yield leg"),
    ]
    kx = [60 + i * 206 for i in range(5)]
    bus_y = 398

    parts = [
        background(W, H, "DIVSTRIP · SPLIT PATH", "xStocks API → Chainlink CRE → ca_registry → divstrip → PT / YT"),
        plate(40, 88, 1050, 120, "OFF-CHAIN", "#00C2FF"),
        plate(40, 236, 1050, 296, "ON-CHAIN · SOLANA", GREEN),
        # arrows (corridors only)
        path([(xs[0] + bw + D + 4, xs[1] + 35), (cre[0] - 4, cre[1] + 35)], "purple"),
        pill((xs[0] + bw + D + cre[0]) / 2, xs[1] + 17, "CA calendar", "purple"),
        path([(cre[0] + bw / 2, cre[1] + bh + 4), (reg[0] + bw / 2, reg[1] - D - 4)], "purple"),
        pill(cre[0] + bw / 2 + 76, 222, "typed CA events", "purple"),
        path([(reg[0] + bw + D + 4, reg[1] + 35), (div[0] - 4, div[1] + 35)], "green"),
        pill((reg[0] + bw + D + div[0]) / 2, reg[1] + 17, "nonce · cum_y", "green"),
        f'<path d="M{div[0]+bw/2},{div[1]+bh+4} L{div[0]+bw/2},{bus_y} M{kx[0]+cw/2},{bus_y} L{kx[-1]+cw/2},{bus_y}" '
        f'fill="none" stroke="{GREEN}" stroke-width="1.8"/>',
        *[path([(x + cw / 2, bus_y), (x + cw / 2, cy - D - 4)], "green") for x in kx],
        pill(div[0] + bw / 2 + 64, 368, "wrap · mint 1:1", "green"),
        # blocks
        block(*xs, bw, bh, "xStocks API", "CA calendar", "xstocks"),
        block(*cre, bw, bh, "Chainlink CRE", "yield vs supply", "chainlink"),
        block(*reg, bw, bh, "ca_registry", "tip · cum_y · nonce"),
        block(*div, bw, bh, "divstrip", "wrap / redeem"),
        *[block(x, cy, cw, ch, t, s) for x, (t, s) in zip(kx, kids)],
        f'<text x="40" y="582" font-family="Inter,ui-sans-serif,system-ui,sans-serif" font-size="13" fill="{MUTED}">'
        f'After maturity: PT redeems Yₛ/Yₜ of the underlying · YT redeems 1 − Yₛ/Yₜ</text>',
    ]
    return svg(W, H, "DivStrip split path", "\n".join(parts))


def curve_diagram() -> str:
    W, H = 1180, 700
    bw, bh = 230, 76
    c1, c2, c3 = 70, 475, 880
    r1, r2, r3 = 170, 350, 550
    mid = bh / 2
    up, dn = r2 + 22, r2 + 56  # two lanes for paired arrows

    parts = [
        background(W, H, "CURVE MARKET · GRADUATION", "Meteora DBC price discovery → DivStrip vault (lcYT) → DAMM v2 · Kamino park"),
        plate(46, 108, 292, 542, "METEORA", ORANGE),
        plate(451, 108, 292, 330, "DESK", PURPLE),
        plate(856, 108, 292, 330, "DIVSTRIP", GREEN),
        plate(856, 482, 292, 168, "YIELD", LIME),
        # launch (admin) flows
        path([(c2 + bw + D + 4, r1 + mid), (c3 - 4, r1 + mid)], "purple"),
        pill((c2 + bw + D + c3) / 2, r1 + mid - 20, "register · init vault", "purple"),
        path([(c2 - 4, r1 + mid), (c1 + bw / 2, r1 + mid), (c1 + bw / 2, r2 - D - 4)], "purple"),
        pill(c1 + bw / 2 + 80, r1 + mid - 20, "create pool", "purple"),
        path([(c3 + bw / 2, r1 + bh + 4), (c3 + bw / 2, r2 - D - 4)], "purple"),
        pill(c3 + bw / 2 + 58, (r1 + bh + r2 - D) / 2, "vault PDA", "purple"),
        # money flows: trader ↔ DBC, trader ↔ vault
        path([(c2 - 4, up), (c1 + bw + D + 4, up)], "green"),
        pill((c1 + bw + D + c2) / 2, up - 18, "① USDC", "green"),
        path([(c1 + bw + D + 4, dn), (c2 - 4, dn)], "green"),
        pill((c1 + bw + D + c2) / 2, dn + 20, "② curve-YT", "green"),
        path([(c2 + bw + D + 4, up), (c3 - 4, up)], "green"),
        pill((c2 + bw + D + c3) / 2, up - 18, "③ deposit curve-YT", "green"),
        path([(c3 - 4, dn), (c2 + bw + D + 4, dn)], "green"),
        pill((c2 + bw + D + c3) / 2, dn + 20, "④ mint lcYT", "green"),
        # lifecycle
        path([(c1 + bw / 2, r2 + bh + 4), (c1 + bw / 2, r3 - D - 4)], "magenta"),
        pill(c1 + bw / 2 + 56, 456, "graduate", "magenta"),
        path([(c3 + bw / 2, r2 + bh + 4), (c3 + bw / 2, r3 - D - 4)], "lime", dashed=True),
        pill(c3 + bw / 2 + 74, 456, "park idle USDC", "lime"),
        # blocks
        block(c2, r1, bw, bh, "Launch backend", "Meteora txs · register", "server"),
        block(c3, r1, bw, bh, "divstrip", "register_curve_launch"),
        block(c1, r2, bw, bh, "DBC bonding", "USDC ↔ curve-YT", "meteora"),
        block(c2, r2, bw, bh, "Trader wallet", "pays USDC · holds hops"),
        block(c3, r2, bw, bh, "curve-YT vault", "holds curve-YT · lcYT"),
        block(c1, r3, bw, bh, "DAMM v2", "post-graduation AMM", "meteora"),
        block(c3, r3, bw, bh, "Kamino cUSDC", "vault-side USDC park", "kamino"),
        f'<text x="40" y="680" font-family="Inter,ui-sans-serif,system-ui,sans-serif" font-size="13" fill="{MUTED}">'
        f'The vault never pulls curve-YT from Meteora — the trader wallet is the hop (② → ③).</text>',
    ]
    return svg(W, H, "Curve market system map", "\n".join(parts))


if __name__ == "__main__":
    (OUT / "split-onchain.svg").write_text(split_diagram())
    (OUT / "curve-system.svg").write_text(curve_diagram())
    print("wrote", OUT / "split-onchain.svg", OUT / "curve-system.svg")
