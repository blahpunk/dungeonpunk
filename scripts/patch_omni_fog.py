#!/usr/bin/env python3
# scripts/patch_omni_fog.py
#
# Patch engine "view" visibility so fog/visible_cells are computed in all 4 directions
# from the player's current cell (same depth/occlusion rules as the forward ray),
# instead of only in the direction the player is facing.
#
# Usage:
#   cd /var/www/dungeonpunk/dungeon_crawler
#   python3 scripts/patch_omni_fog.py
#   npm -w engine run test

from __future__ import annotations

import re
import sys
from pathlib import Path
from typing import List, Tuple


ROOT = Path.cwd()
ENGINE_SRC = ROOT / "engine" / "src"

if not ENGINE_SRC.exists():
    print(f"ERROR: {ENGINE_SRC} not found. Run this from repo root.", file=sys.stderr)
    sys.exit(2)


def find_candidates() -> List[Path]:
    out: List[Path] = []
    for p in ENGINE_SRC.rglob("*.ts"):
        try:
            t = p.read_text(encoding="utf-8")
        except Exception:
            continue
        # Heuristic: "visibleCells" + "face" in same file is a strong signal.
        if "visibleCells" in t and ("face" in t or "player.face" in t):
            out.append(p)
    return out


def patch_forward_only_block(txt: str) -> Tuple[str, int]:
    """
    Patch a common forward-only pattern to omni-direction rays.
    We look for a tight region that:
      - declares visibleCells array
      - uses player.face (or face) to trace a ray
    and transform the loop to iterate N/E/S/W.

    Returns (new_text, num_patches_applied)
    """
    n = 0
    t = txt

    # Pattern A: `const dir = player.face; for (let i=...){ ... }`
    pat_a = re.compile(
        r"""
(?P<head>
(?:const|let)\s+visibleCells\s*=\s*\[[^\]]*\]\s*;\s*
(?:\r?\n)+
.*?
)
(?P<dirdecl>
(?:const|let)\s+dir\s*=\s*(?:player\.)?face\s*;\s*
)
(?P<ray>
for\s*\(\s*let\s+\w+\s*=\s*1\s*;\s*\w+\s*<=\s*(?:VIEW_DEPTH|viewDepth|depth|3)\s*;\s*\w+\+\+\s*\)\s*\{
.*?
\}
)
""",
        re.VERBOSE | re.DOTALL,
    )

    def repl_a(m: re.Match) -> str:
        nonlocal n
        n += 1
        head = m.group("head")
        ray = m.group("ray")

        # Replace any usage of `dir` inside ray with `face` (loop variable).
        ray2 = re.sub(r"\bdir\b", "face", ray)

        injected = (
            "const dirs = ['N','E','S','W'] as const;\n"
            "for (const face of dirs) {\n"
            f"{indent_block(ray2, 2)}\n"
            "}\n"
        )
        return head + injected

    t2, k = pat_a.subn(repl_a, t, count=1)
    t = t2

    # Pattern B: `const dirs = [player.face] as const; for (const dir of dirs){...}`
    pat_b = re.compile(
        r"""
(?P<dirsdecl>
const\s+dirs\s*=\s*\[\s*(?:player\.)?face\s*\]\s+as\s+const\s*;\s*
)
""",
        re.VERBOSE | re.DOTALL,
    )
    t, k2 = pat_b.subn("const dirs = ['N','E','S','W'] as const;\n", t, count=1)
    n += k2

    # Pattern C: `const url = ...` not relevant; ignore.

    return t, n


def indent_block(block: str, spaces: int) -> str:
    pad = " " * spaces
    return "\n".join(pad + line if line.strip() else line for line in block.splitlines())


def ensure_dedupe_visiblecells(txt: str) -> Tuple[str, int]:
    """
    If the visibleCells are built by pushing without dedupe, add a small dedupe gate.

    We look for a `visibleCells.push(cell)` pattern and ensure a `seen` Set is used.
    Only applies if not already present.
    """
    if "const seen = new Set" in txt or "seen.has" in txt:
        return txt, 0

    # Add `const seen = new Set<string>();` right after `visibleCells = [...]`
    pat_vis = re.compile(r"(?:const|let)\s+visibleCells\s*=\s*\[[^\]]*\]\s*;\s*", re.DOTALL)
    m = pat_vis.search(txt)
    if not m:
        return txt, 0

    insert_at = m.end()
    txt2 = txt[:insert_at] + "\nconst seen = new Set<string>();\n" + txt[insert_at:]

    # Patch pushes: visibleCells.push({x,y,edges}) => if unseen then push
    pat_push = re.compile(r"\bvisibleCells\.push\(\s*(?P<expr>[^)]+)\s*\)\s*;")
    # We'll only patch the first 10 pushes to avoid unexpected mass edits.
    count = 0

    def repl_push(pm: re.Match) -> str:
        nonlocal count
        if count >= 10:
            return pm.group(0)
        count += 1
        expr = pm.group("expr").strip()
        # best-effort: assume expr has `.x`/`.y` or `{ x: ..., y: ... }`
        return (
            f"{{\n"
            f"  const __c = {expr};\n"
            f"  const __k = `${{__c.x}}:${{__c.y}}`;\n"
            f"  if (!seen.has(__k)) {{ seen.add(__k); visibleCells.push(__c); }}\n"
            f"}}\n"
        )

    txt3 = pat_push.sub(repl_push, txt2)
    return txt3, (1 if txt3 != txt else 0)


def main() -> None:
    candidates = find_candidates()
    if not candidates:
        print("ERROR: Could not find an engine source file containing both 'visibleCells' and 'face'.", file=sys.stderr)
        sys.exit(2)

    patched_any = False
    report = []

    for p in candidates:
        original = p.read_text(encoding="utf-8")
        t, n1 = patch_forward_only_block(original)
        t, n2 = ensure_dedupe_visiblecells(t)

        if (n1 + n2) > 0 and t != original:
            backup = p.with_suffix(p.suffix + ".bak_omni_fog")
            if not backup.exists():
                backup.write_text(original, encoding="utf-8")
            p.write_text(t, encoding="utf-8")
            patched_any = True
            report.append(f"- patched {p.relative_to(ROOT)} (changes={n1+n2})")

    if not patched_any:
        print(
            "ERROR: Found candidate files, but no known forward-only visibility pattern matched.\n"
            "Paste the engine file that builds 'visibleCells' / 'view()' and I will provide an exact full-file update.",
            file=sys.stderr,
        )
        sys.exit(2)

    print("OK: Omni-direction fog patch applied:")
    print("\n".join(report))


if __name__ == "__main__":
    main()
