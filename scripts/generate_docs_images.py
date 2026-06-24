#!/usr/bin/env python3
"""
Generate branded placeholder images for Bonyan Archive System documentation.
These are illustrative screenshots for README and docs.
"""

from PIL import Image, ImageDraw, ImageFont
import os

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOCS_DIR = os.path.join(BASE_DIR, "docs")
IMAGES_DIR = os.path.join(DOCS_DIR, "images")
SCREENSHOTS_DIR = os.path.join(DOCS_DIR, "screenshots")
ASSETS_IMAGES_DIR = os.path.join(BASE_DIR, "src", "assets", "images")

PRIMARY = "#1e3a5f"
PRIMARY_LIGHT = "#2c5282"
SUCCESS = "#059669"
WARNING = "#d97706"
DANGER = "#dc2626"
WHITE = "#ffffff"
LIGHT_BG = "#f8fafc"
CARD_BG = "#ffffff"
TEXT = "#1f2937"
TEXT_LIGHT = "#6b7280"
BORDER = "#e5e7eb"


def get_font(size):
    """Try to load a good Arabic/English font, fall back to default."""
    candidates = [
        "/usr/share/fonts/truetype/noto/NotoSansArabicUI-Regular.ttf",
        "/usr/share/fonts/truetype/noto/NotoSansArabic-Regular.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    ]
    for path in candidates:
        if os.path.exists(path):
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def draw_rounded_rect(draw, xy, radius, fill, outline=None, width=1):
    x1, y1, x2, y2 = xy
    draw.rounded_rectangle(xy, radius=radius, fill=fill, outline=outline, width=width)


def create_screenshot(title, subtitle, elements, filename, size=(1024, 640)):
    """Create a generic screenshot placeholder."""
    img = Image.new("RGB", size, LIGHT_BG)
    draw = ImageDraw.Draw(img)

    # Header
    draw.rectangle([0, 0, size[0], 56], fill=PRIMARY)
    draw.text((20, 18), "نظام الأرشيف الإلكتروني — مركز البنيان", font=get_font(18), fill=WHITE)
    draw.text((size[0] - 120, 18), "🏠 admin | مدير", font=get_font(14), fill=WHITE)

    # Sidebar
    draw.rectangle([0, 56, 220, size[1]], fill=CARD_BG)
    draw.line([220, 56, 220, size[1]], fill=BORDER, width=1)
    sidebar_items = ["📊 لوحة التحكم", "📂 الوثائق", "📋 سجل التدقيق", "👥 المستخدمين", "📑 أنواع الوثائق", "📂 التصنيفات", "🔐 مركز الأمان", "📅 الجرد السنوي"]
    y = 80
    for item in sidebar_items:
        draw.text((20, y), item, font=get_font(14), fill=TEXT)
        y += 36

    # Content area
    x_content = 250
    y_content = 80

    # Breadcrumb
    draw.text((x_content, y_content), f"🏠 الرئيسية / {title}", font=get_font(13), fill=TEXT_LIGHT)
    y_content += 35

    # Page title
    draw.text((x_content, y_content), title, font=get_font(26), fill=PRIMARY)
    draw.text((x_content, y_content + 38), subtitle, font=get_font(14), fill=TEXT_LIGHT)
    y_content += 90

    # Cards / elements
    card_width = (size[0] - x_content - 40 - (len(elements) - 1) * 20) // len(elements) if len(elements) <= 4 else 200
    x_card = x_content
    for label, value, color in elements:
        draw_rounded_rect(draw, [x_card, y_content, x_card + card_width, y_content + 90], 10, CARD_BG, BORDER)
        draw.text((x_card + 15, y_content + 15), label, font=get_font(12), fill=TEXT_LIGHT)
        draw.text((x_card + 15, y_content + 40), value, font=get_font(28), fill=color)
        x_card += card_width + 20

    y_content += 120

    # Main panel
    draw_rounded_rect(draw, [x_content, y_content, size[0] - 30, size[1] - 40], 10, CARD_BG, BORDER)
    draw.text((x_content + 20, y_content + 20), "المحتوى الرئيسي", font=get_font(16), fill=TEXT_LIGHT)

    # Footer watermark
    draw.text((size[0] - 200, size[1] - 25), "© 2026 مركز البنيان", font=get_font(10), fill=TEXT_LIGHT)

    img.save(filename, "PNG")
    print(f"Created: {filename}")


def create_login_screenshot(filename, size=(800, 600)):
    img = Image.new("RGB", size, PRIMARY)
    draw = ImageDraw.Draw(img)

    # Card
    card_margin = 140
    draw_rounded_rect(draw, [card_margin, 80, size[0] - card_margin, size[1] - 80], 16, CARD_BG)

    # Title
    draw.text((size[0] // 2 - 160, 130), "نظام الأرشيف الإلكتروني", font=get_font(22), fill=PRIMARY)
    draw.text((size[0] // 2 - 80, 165), "مركز البنيان", font=get_font(14), fill=TEXT_LIGHT)

    # Icon circle with folder representation
    cx = size[0] // 2
    draw.ellipse([cx - 40, 210, cx + 40, 290], fill=PRIMARY_LIGHT)
    # Folder tab
    fx, fy = cx - 18, 235
    draw.polygon([(fx + 4, fy), (fx + 14, fy), (fx + 18, fy + 7), (fx, fy + 7)], fill=WHITE)
    # Folder body
    draw.rounded_rectangle([fx, fy + 6, fx + 22, fy + 30], radius=4, fill=WHITE)

    # Fields
    draw.text((card_margin + 30, 320), "اسم المستخدم", font=get_font(13), fill=TEXT)
    draw_rounded_rect(draw, [card_margin + 30, 345, size[0] - card_margin - 30, 380], 8, LIGHT_BG, BORDER)
    # Input fields left empty/clean

    draw.text((card_margin + 30, 400), "كلمة المرور", font=get_font(13), fill=TEXT)
    draw_rounded_rect(draw, [card_margin + 30, 425, size[0] - card_margin - 30, 460], 8, LIGHT_BG, BORDER)

    # Button
    draw_rounded_rect(draw, [card_margin + 30, 490, size[0] - card_margin - 30, 530], 8, SUCCESS)
    draw.text((size[0] // 2 - 55, 500), "تسجيل الدخول", font=get_font(15), fill=WHITE)

    img.save(filename, "PNG")
    print(f"Created: {filename}")


def create_logo(filename, size=(280, 280)):
    img = Image.new("RGBA", size, (255, 255, 255, 0))
    draw = ImageDraw.Draw(img)

    cx, cy = size[0] // 2, size[1] // 2

    # Outer circle
    margin = 20
    draw.ellipse([margin, margin, size[0] - margin, size[1] - margin], fill=PRIMARY, outline=PRIMARY_LIGHT, width=6)

    # Inner circle
    draw.ellipse([margin + 30, margin + 30, size[0] - margin - 30, size[1] - margin - 30], fill=WHITE)

    # Folder icon using shapes
    folder_color = PRIMARY
    folder_x, folder_y = cx - 55, cy - 35
    folder_w, folder_h = 90, 60
    tab_w, tab_h = 30, 14

    # Folder tab
    draw.polygon([
        (folder_x + 8, folder_y),
        (folder_x + tab_w, folder_y),
        (folder_x + tab_w + 10, folder_y + tab_h),
        (folder_x, folder_y + tab_h)
    ], fill=folder_color)

    # Folder body
    draw_rounded_rect(draw, [folder_x, folder_y + tab_h - 2, folder_x + folder_w, folder_y + tab_h + folder_h], 8, folder_color)

    # Checkmark circle
    check_cx, check_cy = cx + 42, cy + 22
    check_r = 22
    draw.ellipse([check_cx - check_r, check_cy - check_r, check_cx + check_r, check_cy + check_r], fill=SUCCESS)
    # Checkmark
    draw.polygon([
        (check_cx - 10, check_cy - 2),
        (check_cx - 3, check_cy + 8),
        (check_cx + 12, check_cy - 10)
    ], fill=WHITE)

    img.save(filename, "PNG")
    print(f"Created: {filename}")


def main():
    os.makedirs(IMAGES_DIR, exist_ok=True)
    os.makedirs(SCREENSHOTS_DIR, exist_ok=True)
    os.makedirs(ASSETS_IMAGES_DIR, exist_ok=True)

    create_logo(os.path.join(IMAGES_DIR, "bonyan-logo.png"))
    # Copy logo to assets
    create_logo(os.path.join(ASSETS_IMAGES_DIR, "bonyan-logo.png"))

    create_login_screenshot(os.path.join(SCREENSHOTS_DIR, "login.png"))

    create_screenshot(
        "لوحة التحكم",
        "إحصائيات وسجل النشاطات",
        [("إجمالي الوثائق", "1,245", PRIMARY), ("صادر", "420", SUCCESS), ("وارد", "380", WARNING), ("مراسلات", "445", "#2563eb")],
        os.path.join(SCREENSHOTS_DIR, "dashboard.png")
    )

    create_screenshot(
        "الوثائق",
        "إدارة وبحث الوثائق مع مستويات السرية",
        [("عادي", "980", SUCCESS), ("سري", "180", WARNING), ("سري للغاية", "85", DANGER)],
        os.path.join(SCREENSHOTS_DIR, "documents.png")
    )

    create_screenshot(
        "مركز الأمان",
        "توليد وإدارة رموز التحقق للوثائق السرية للغاية",
        [("الرمز الحالي", "••••••", DANGER), ("الصلاحية", "24 ساعة", WARNING), ("آخر توليد", "الآن", PRIMARY)],
        os.path.join(SCREENSHOTS_DIR, "security-center.png")
    )

    create_screenshot(
        "الجرد السنوي",
        "إغلاق السنة الحالية وأرشفة الوثائق",
        [("السنة الحالية", "2026", PRIMARY), ("الوثائق", "1,245", SUCCESS), ("السنوات المؤرشفة", "3", WARNING)],
        os.path.join(SCREENSHOTS_DIR, "annual-closing.png")
    )

    create_screenshot(
        "إدارة التصنيفات",
        "إدارة 177+ تصنيف منظمة في مجموعات",
        [("التصنيفات", "177", PRIMARY), ("المجموعات", "15", SUCCESS), ("مخصص", "0", WARNING)],
        os.path.join(SCREENSHOTS_DIR, "folder-management.png")
    )


if __name__ == "__main__":
    main()
