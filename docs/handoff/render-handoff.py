#!/usr/bin/env python3
"""Render the repo-native Innochem handoff Markdown as an A4 PDF."""

from __future__ import annotations

import argparse
import html
import re
import subprocess
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)


PURPLE = colors.HexColor("#4A2C70")
INK = colors.HexColor("#20212B")
MUTED = colors.HexColor("#5D6070")
LINE = colors.HexColor("#DDDEE5")
PALE = colors.HexColor("#F4F1F8")


def inline(value: str) -> str:
    """Escape Markdown content, keeping safe HTTP links and emphasis."""
    value = html.escape(value, quote=True)

    def link(match: re.Match[str]) -> str:
        label, target = match.groups()
        if target.startswith(("https://", "http://")):
            return f'<link href="{target}" color="#4A2C70">{label}</link>'
        return label

    value = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", link, value)
    value = re.sub(r"`([^`]+)`", r'<font name="Arial">\1</font>', value)
    value = re.sub(r"\*\*([^*]+)\*\*", r"<b>\1</b>", value)
    return value


def build_styles() -> dict[str, ParagraphStyle]:
    body = ParagraphStyle(
        "Body",
        fontName="Arial",
        fontSize=10,
        leading=13.5,
        textColor=INK,
        spaceAfter=8,
        alignment=TA_LEFT,
        allowWidows=0,
        allowOrphans=0,
    )
    return {
        "body": body,
        "h1": ParagraphStyle(
            "Title", parent=body, fontName="Arial-Bold", fontSize=23,
            leading=27, textColor=PURPLE, spaceAfter=13, keepWithNext=True,
        ),
        "h2": ParagraphStyle(
            "Section", parent=body, fontName="Arial-Bold", fontSize=15,
            leading=19, textColor=PURPLE, spaceBefore=5, spaceAfter=11,
            keepWithNext=True,
        ),
        "h3": ParagraphStyle(
            "Subsection", parent=body, fontName="Arial-Bold", fontSize=11.2,
            leading=14, spaceBefore=7, spaceAfter=6, keepWithNext=True,
        ),
        "cell": ParagraphStyle(
            "Cell", parent=body, fontSize=9.1, leading=12.1, spaceAfter=0,
        ),
        "cell_header": ParagraphStyle(
            "CellHeader", parent=body, fontName="Arial-Bold", fontSize=9.1,
            leading=12.1, textColor=colors.white, spaceAfter=0,
        ),
    }


def table_flowable(lines: list[str], styles: dict, width: float) -> Table:
    rows = [line.strip().strip("|").split("|") for line in lines]
    rows = [[cell.strip() for cell in row] for row in rows]
    rows = [row for row in rows if not all(re.fullmatch(r":?-+:?", c) for c in row)]
    count = len(rows[0])
    if any(len(row) != count for row in rows):
        raise ValueError("Markdown table has inconsistent column counts")
    cells = [
        [Paragraph(inline(cell), styles["cell_header" if index == 0 else "cell"])
         for cell in row]
        for index, row in enumerate(rows)
    ]
    if count == 2:
        left = 0.5 if rows[0][0] == "Potwierdzone w raportach" else 0.32
        widths = [width * left, width * (1 - left)]
    else:
        widths = [width / count] * count
    table = Table(cells, colWidths=widths, repeatRows=1, hAlign="LEFT")
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), PURPLE),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, PALE]),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 7),
        ("RIGHTPADDING", (0, 0), (-1, -1), 7),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("LINEBELOW", (0, 0), (-1, 0), 0.5, PURPLE),
        ("LINEBELOW", (0, 1), (-1, -1), 0.4, LINE),
    ]))
    return table


def parse_markdown(markdown: str, styles: dict, width: float) -> list:
    lines = markdown.splitlines()
    result = []
    index = 0
    while index < len(lines):
        line = lines[index].strip()
        if not line:
            index += 1
            continue
        if line == "<!-- pdf-pagebreak -->":
            result.append(PageBreak())
            index += 1
            continue
        if line.startswith("|"):
            table_lines = []
            while index < len(lines) and lines[index].strip().startswith("|"):
                table_lines.append(lines[index])
                index += 1
            result.extend([table_flowable(table_lines, styles, width), Spacer(1, 10)])
            continue
        heading = re.match(r"^(#{1,3}) (.+)$", line)
        if heading:
            result.append(Paragraph(inline(heading.group(2)), styles[f"h{len(heading.group(1))}"]))
            index += 1
            continue
        paragraph = [line]
        index += 1
        while index < len(lines) and lines[index].strip():
            following = lines[index].strip()
            if following.startswith(("#", "|", "<!--")):
                break
            paragraph.append(following)
            index += 1
        result.append(Paragraph(inline(" ".join(paragraph)), styles["body"]))
    return result


def frame(canvas, doc) -> None:
    canvas.saveState()
    width, height = A4
    canvas.setFillColor(PURPLE)
    canvas.setFont("Arial-Bold", 9)
    canvas.drawString(18 * mm, height - 13.5 * mm, "INNOCHEM")
    canvas.setFillColor(MUTED)
    canvas.setFont("Arial", 8)
    canvas.drawRightString(width - 18 * mm, height - 13.5 * mm, "Szkolenie i odbiór | 09.10.2026")
    canvas.setStrokeColor(LINE)
    canvas.line(18 * mm, height - 17 * mm, width - 18 * mm, height - 17 * mm)
    canvas.line(18 * mm, 16 * mm, width - 18 * mm, 16 * mm)
    canvas.setFillColor(MUTED)
    canvas.setFont("Arial", 8)
    canvas.drawString(18 * mm, 11.5 * mm, "Materiał do uzupełnienia; odbiór pozostaje otwarty")
    canvas.drawRightString(width - 18 * mm, 11.5 * mm, f"{doc.page}")
    canvas.restoreState()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    folder = Path(__file__).resolve().parent
    parser.add_argument("--source", type=Path, default=folder / "innochem-szkolenie-i-odbior-2026-10-09.md")
    parser.add_argument("--output", type=Path, default=folder / "innochem-szkolenie-i-odbior-2026-10-09.pdf")
    parser.add_argument("--font-dir", type=Path, default=Path("/System/Library/Fonts/Supplemental"))
    parser.add_argument("--render-dir", type=Path, default=folder / ".pdf-qa")
    parser.add_argument("--skip-page-render", action="store_true")
    args = parser.parse_args()
    pdfmetrics.registerFont(TTFont("Arial", str(args.font_dir / "Arial.ttf")))
    pdfmetrics.registerFont(TTFont("Arial-Bold", str(args.font_dir / "Arial Bold.ttf")))
    pdfmetrics.registerFontFamily("Arial", normal="Arial", bold="Arial-Bold", italic="Arial", boldItalic="Arial-Bold")
    margin = 18 * mm
    styles = build_styles()
    doc = SimpleDocTemplate(
        str(args.output), pagesize=A4, rightMargin=margin, leftMargin=margin,
        topMargin=23 * mm, bottomMargin=21 * mm,
        title="INNOCHEM: szkolenie i odbiór sklepu",
        author="Wojciech Płonka",
        subject="Ćwiczenia panelu, bramki uruchomienia i zapis rzeczywistego odbioru",
        pageCompression=1,
    )
    story = parse_markdown(args.source.read_text(encoding="utf-8"), styles, A4[0] - 2 * margin)
    doc.build(story, onFirstPage=frame, onLaterPages=frame)
    print(f"Rendered {args.output.name}")
    if not args.skip_page_render:
        args.render_dir.mkdir(parents=True, exist_ok=True)
        subprocess.run(
            ["pdftoppm", "-r", "110", "-png", str(args.output), str(args.render_dir / "page")],
            check=True,
        )
        print(f"Rendered all PDF pages to {args.render_dir.name}")


if __name__ == "__main__":
    main()
