"""
Generates a PDF with 3 Talkie logo concepts (one per page) for easy screenshot + crop.

1. Microphone + "Talkie" wordmark
2. Speech bubble + "Talkie" wordmark
3. Microphone only (no text)

Brand: Nunito font family, primary blue #0EA5E9, white background.
"""

from pathlib import Path

from reportlab.lib.colors import HexColor, white
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

PRIMARY = HexColor("#0EA5E9")
PRIMARY_DARK = HexColor("#0284C7")
PRIMARY_LIGHT = HexColor("#BAE6FD")
TEXT = HexColor("#0F172A")

PAGE_W, PAGE_H = A4
CENTER_X = PAGE_W / 2
CENTER_Y = PAGE_H / 2

ROOT = Path(__file__).resolve().parent
NUNITO_BLACK = ROOT / "mobile" / "node_modules" / "@expo-google-fonts" / "nunito" / "900Black" / "Nunito_900Black.ttf"
NUNITO_EXTRABOLD = ROOT / "mobile" / "node_modules" / "@expo-google-fonts" / "nunito" / "800ExtraBold" / "Nunito_800ExtraBold.ttf"

if NUNITO_BLACK.exists():
    pdfmetrics.registerFont(TTFont("Nunito-Black", str(NUNITO_BLACK)))
    BLACK_FONT = "Nunito-Black"
else:
    BLACK_FONT = "Helvetica-Bold"

if NUNITO_EXTRABOLD.exists():
    pdfmetrics.registerFont(TTFont("Nunito-ExtraBold", str(NUNITO_EXTRABOLD)))
    EXTRABOLD_FONT = "Nunito-ExtraBold"
else:
    EXTRABOLD_FONT = "Helvetica-Bold"


def draw_microphone(c: canvas.Canvas, cx: float, cy: float, scale: float = 1.0, color=PRIMARY) -> None:
    """Stylized rounded microphone, centered at (cx, cy). Reference height ~ 220 * scale."""
    c.saveState()
    c.setFillColor(color)
    c.setStrokeColor(color)

    # Mic capsule (rounded rectangle)
    capsule_w = 70 * scale
    capsule_h = 110 * scale
    capsule_x = cx - capsule_w / 2
    capsule_y = cy - 10 * scale
    c.roundRect(capsule_x, capsule_y, capsule_w, capsule_h, capsule_w / 2, stroke=0, fill=1)

    # U-shaped stand: half-ring under the capsule
    ring_radius_outer = 56 * scale
    ring_radius_inner = 42 * scale
    ring_thickness = ring_radius_outer - ring_radius_inner
    # Approximate with stroked arc
    c.setLineWidth(ring_thickness)
    c.setStrokeColor(color)
    # arc from 180deg to 360deg (bottom half)
    mid_r = (ring_radius_outer + ring_radius_inner) / 2
    c.arc(
        cx - mid_r,
        capsule_y - mid_r,
        cx + mid_r,
        capsule_y + mid_r,
        startAng=180,
        extent=180,
    )
    # Wait — reportlab's `arc` draws an arc inside a bounding box. Let's redo with a path.
    # Reset: clear last arc by overpainting won't work; instead use Path.
    c.restoreState()

    # Redo cleanly with a Path for the U-stand.
    c.saveState()
    c.setFillColor(color)
    c.setStrokeColor(color)

    # Capsule again
    c.roundRect(capsule_x, capsule_y, capsule_w, capsule_h, capsule_w / 2, stroke=0, fill=1)

    # U-stand drawn as a path: outer half-circle + inner half-circle (subtracted via even-odd)
    from reportlab.pdfgen.pathobject import PDFPathObject

    path = c.beginPath()
    # Outer half-circle (top of stand sits at capsule_y, opens downward)
    # We want a "U" shape so: start at left outer, arc down to right outer, then back via inner arc.
    cy_stand = capsule_y
    # outer arc (bottom half) from left to right
    path.moveTo(cx - ring_radius_outer, cy_stand)
    # bezier approximation of a half-circle for outer
    # Easier: use arcTo via small segments? reportlab path supports arcTo with bezier.
    # Use path.arcTo on a bounding box for half circle.
    # Outer arc: bottom half of circle centered at (cx, cy_stand), radius ring_radius_outer
    path.arcTo(
        cx - ring_radius_outer,
        cy_stand - ring_radius_outer,
        cx + ring_radius_outer,
        cy_stand + ring_radius_outer,
        startAng=180,
        extent=180,
    )
    # Now at (cx + ring_radius_outer, cy_stand). Line up to inner radius.
    path.lineTo(cx + ring_radius_inner, cy_stand)
    # Inner arc back (top half of smaller circle? No - bottom half going opposite direction)
    path.arcTo(
        cx - ring_radius_inner,
        cy_stand - ring_radius_inner,
        cx + ring_radius_inner,
        cy_stand + ring_radius_inner,
        startAng=0,
        extent=-180,
    )
    path.close()
    c.drawPath(path, stroke=0, fill=1)

    # Vertical stem from bottom of U down
    stem_w = 8 * scale
    stem_h = 26 * scale
    stem_top_y = cy_stand - ring_radius_outer + (ring_radius_outer - ring_radius_inner) / 2
    # Place stem just below the U
    stem_y = cy_stand - ring_radius_outer - stem_h + 2 * scale
    c.roundRect(cx - stem_w / 2, stem_y, stem_w, stem_h, stem_w / 2, stroke=0, fill=1)

    # Horizontal base
    base_w = 60 * scale
    base_h = 8 * scale
    c.roundRect(cx - base_w / 2, stem_y - 2 * scale, base_w, base_h, base_h / 2, stroke=0, fill=1)

    c.restoreState()


def draw_speech_bubble(c: canvas.Canvas, cx: float, cy: float, scale: float = 1.0, color=PRIMARY) -> None:
    """Rounded speech bubble with three small dots inside. Bubble width ~ 240 * scale."""
    c.saveState()
    c.setFillColor(color)
    c.setStrokeColor(color)

    bw = 240 * scale
    bh = 170 * scale
    bx = cx - bw / 2
    by = cy - bh / 2 + 14 * scale  # lift slightly so tail sits below center

    # Main rounded bubble
    c.roundRect(bx, by, bw, bh, 36 * scale, stroke=0, fill=1)

    # Tail: a triangle on the bottom-left
    tail_path = c.beginPath()
    tail_anchor_x = bx + bw * 0.28
    tail_anchor_y = by
    tail_path.moveTo(tail_anchor_x, tail_anchor_y + 2)
    tail_path.lineTo(tail_anchor_x - 30 * scale, by - 38 * scale)
    tail_path.lineTo(tail_anchor_x + 36 * scale, tail_anchor_y + 2)
    tail_path.close()
    c.drawPath(tail_path, stroke=0, fill=1)

    # Three white dots inside
    c.setFillColor(white)
    dot_r = 11 * scale
    gap = 38 * scale
    dot_cy = by + bh / 2
    for i in (-1, 0, 1):
        c.circle(cx + i * gap, dot_cy, dot_r, stroke=0, fill=1)

    c.restoreState()


def draw_wordmark(c: canvas.Canvas, cx: float, cy: float, text: str = "Talkie", size: float = 64, color=TEXT) -> None:
    c.saveState()
    c.setFillColor(color)
    c.setFont(BLACK_FONT, size)
    text_w = c.stringWidth(text, BLACK_FONT, size)
    c.drawString(cx - text_w / 2, cy - size * 0.32, text)
    c.restoreState()


def draw_footer_label(c: canvas.Canvas, label: str) -> None:
    c.saveState()
    c.setFillColor(HexColor("#94A3B8"))
    c.setFont(EXTRABOLD_FONT, 11)
    tw = c.stringWidth(label, EXTRABOLD_FONT, 11)
    c.drawString(CENTER_X - tw / 2, 36, label)
    c.restoreState()


def page_mic_and_text(c: canvas.Canvas) -> None:
    c.setFillColor(white)
    c.rect(0, 0, PAGE_W, PAGE_H, stroke=0, fill=1)

    # Microphone above wordmark, both centered, stacked
    mic_cy = CENTER_Y + 70
    draw_microphone(c, CENTER_X, mic_cy, scale=1.3)

    # Wordmark below
    draw_wordmark(c, CENTER_X, CENTER_Y - 110, text="Talkie", size=72, color=TEXT)

    draw_footer_label(c, "Logo 1 - Microfone + wordmark")
    c.showPage()


def page_bubble_and_text(c: canvas.Canvas) -> None:
    c.setFillColor(white)
    c.rect(0, 0, PAGE_W, PAGE_H, stroke=0, fill=1)

    # Speech bubble above, wordmark below
    draw_speech_bubble(c, CENTER_X, CENTER_Y + 70, scale=1.1)
    draw_wordmark(c, CENTER_X, CENTER_Y - 130, text="Talkie", size=72, color=TEXT)

    draw_footer_label(c, "Logo 2 - Bolha de fala + wordmark")
    c.showPage()


def page_mic_only(c: canvas.Canvas) -> None:
    c.setFillColor(white)
    c.rect(0, 0, PAGE_W, PAGE_H, stroke=0, fill=1)

    # Microphone large and centered, no text
    draw_microphone(c, CENTER_X, CENTER_Y, scale=1.8)

    draw_footer_label(c, "Logo 3 - So microfone (sem texto)")
    c.showPage()


def main() -> None:
    out_path = ROOT / "Talkie_logos.pdf"
    c = canvas.Canvas(str(out_path), pagesize=A4)
    c.setTitle("Talkie — logo concepts")

    page_mic_and_text(c)
    page_bubble_and_text(c)
    page_mic_only(c)

    c.save()
    print(f"Wrote {out_path}")


if __name__ == "__main__":
    main()
