#!/usr/bin/env python3
"""Check handoff Markdown links, source snapshots, and PDF text coverage."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import unquote


SOURCE_FILES = [
    "docs/plans/2026-10-08-rano-dla-wojtka.md",
    "docs/plans/2026-10-08-umowa-i-odbior.md",
    "docs/plans/2026-10-09-checkpoint-0935.md",
    "docs/audit/2026-10-09/raport-local-qa.md",
    "docs/audit/2026-10-09/independent-qa-fixes/REPORT.md",
    "docs/audit/2026-10-09/current-qa-final/README.md",
    "docs/audit/2026-10-09/panel-instruction-final/README.md",
    "docs/audit/2026-10-09/ops-closure-final/README.md",
    "docs/audit/2026-10-09/ops-recheck-final/README.md",
    "docs/start-2026-10-09.md",
]
REPO_FILES = [
    "docs/panel-guide.md", "docs/operations.md", "docs/offsite-operations.md",
    "app/admin/layout.tsx", "app/admin/ProductEditor.tsx",
    "app/admin/SiteEditor.tsx", "app/admin/OrderActions.tsx",
    "app/admin/ShipmentActions.tsx", "app/admin/eksport/page.tsx",
]


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def normalize(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def plain(value: str) -> str:
    value = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", value)
    return value.replace("`", "").replace("**", "")


def segments(markdown: str) -> list[str]:
    """Match each paragraph/table cell, avoiding PDF reading-order ambiguity."""
    result: list[str] = []
    paragraph: list[str] = []

    def flush() -> None:
        if paragraph:
            result.append(plain(" ".join(paragraph)))
            paragraph.clear()

    for line in markdown.splitlines():
        line = line.strip()
        if not line or line.startswith("<!--"):
            flush()
        elif line.startswith("#"):
            flush()
            result.append(plain(re.sub(r"^#+ ", "", line)))
        elif line.startswith("|"):
            flush()
            cells = [cell.strip() for cell in line.strip("|").split("|")]
            if not all(re.fullmatch(r":?-+:?", cell) for cell in cells):
                result.extend(plain(cell) for cell in cells)
        else:
            paragraph.append(line)
    flush()
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-root", type=Path)
    args = parser.parse_args()
    folder = Path(__file__).resolve().parent
    repo = folder.parent.parent
    report_path = folder / "kontrola-pakietu-2026-10-09.json"
    if not report_path.exists():
        report_path.write_text("{}\n", encoding="utf-8")
    previous_report = json.loads(report_path.read_text(encoding="utf-8"))
    links = []
    failures = []
    for path in sorted(folder.glob("*.md")):
        for label, target in re.findall(r"\[([^\]]+)\]\(([^)]+)\)", path.read_text(encoding="utf-8")):
            if target.startswith(("https://", "http://", "mailto:")):
                links.append({"file": path.name, "label": label, "target": target,
                              "scope": "external", "checked": "not requested"})
                continue
            destination = (path.parent / unquote(target.split("#", 1)[0])).resolve()
            ok = destination.is_file()
            links.append({"file": path.name, "label": label, "target": target,
                          "scope": "local", "exists": ok})
            if not ok:
                failures.append(f"Broken local link: {path.name} -> {target}")

    snapshots = []
    if args.source_root:
        for name in SOURCE_FILES:
            path = args.source_root / name
            snapshots.append({"path": name, "scope": "original read-only",
                              "bytes": path.stat().st_size, "sha256": sha256(path)})
    for name in REPO_FILES:
        path = repo / name
        snapshots.append({"path": name, "scope": "repo reference read-only",
                          "bytes": path.stat().st_size, "sha256": sha256(path)})

    markdown_path = folder / "innochem-szkolenie-i-odbior-2026-10-09.md"
    pdf_path = markdown_path.with_suffix(".pdf")
    info = subprocess.check_output(["pdfinfo", str(pdf_path)], text=True)
    pages = int(re.search(r"^Pages:\s+(\d+)$", info, re.M).group(1))
    text = subprocess.check_output(["pdftotext", "-raw", str(pdf_path), "-"], text=True)
    normalized_pdf = normalize(text)
    expected = [normalize(segment) for segment in segments(markdown_path.read_text(encoding="utf-8"))]
    missing = [segment for segment in expected if segment not in normalized_pdf]
    if missing:
        failures.append(f"PDF is missing {len(missing)} Markdown segments")
    if pages != 7:
        failures.append(f"Expected 7 complete pages, found {pages}")
    if "\ufffd" in text or "\u25a0" in text:
        failures.append("PDF contains replacement or black-square glyph")

    source_text = markdown_path.read_text(encoding="utf-8")
    if any(re.search(pattern, source_text, re.I) for pattern in [r"token=", r"sk_live_", r"sk_test_", r"whsec_", r"BEGIN PRIVATE KEY"]):
        failures.append("Main handoff contains a possible secret marker")

    pdf_hash = sha256(pdf_path)
    previous_pdf = previous_report.get("pdf", {})
    visual_review = (
        previous_pdf.get("visual_review", "pending")
        if previous_pdf.get("sha256") == pdf_hash else "pending"
    )

    result = {
        "checked_at_utc": datetime.now(timezone.utc).isoformat(),
        "ok": not failures,
        "scope": "documentation-only; no new app/live/operator/client checks",
        "local_links_checked": sum(item["scope"] == "local" for item in links),
        "broken_local_links": sum(item.get("exists") is False for item in links),
        "links": links,
        "pdf": {"path": pdf_path.name, "bytes": pdf_path.stat().st_size,
                "sha256": pdf_hash, "pages": pages,
                "source_markdown_sha256": sha256(markdown_path),
                "renderer_sha256": sha256(folder / "render-handoff.py"),
                "checker_sha256": sha256(Path(__file__)),
                "markdown_segments_checked": len(expected),
                "missing_segments": missing, "visual_review": visual_review},
        "sources": snapshots,
        "failures": failures,
    }
    report_path.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({key: result[key] for key in ["ok", "local_links_checked", "broken_local_links", "failures"]}, ensure_ascii=False))
    print(f"PDF pages={pages}, text coverage={len(expected) - len(missing)}/{len(expected)}")
    raise SystemExit(0 if not failures else 1)


if __name__ == "__main__":
    main()
