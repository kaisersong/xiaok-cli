#!/usr/bin/env python3
"""
screenshot.py — Full-page screenshot of any HTML file.

Captures the complete rendered page using a headless browser.
Uses system Chrome/Edge/Brave first; falls back to Playwright Chromium.

Usage:
    python screenshot.py <file.html> [output.png] [--width W] [--scale N]

Examples:
    python screenshot.py report.html                    # 1440px wide, 2x (default)
    python screenshot.py report.html out.png --scale 3  # 3x ultra quality
    python screenshot.py report.html --width 800        # Mobile-ish width

Dependencies:
    pip install playwright
"""

import sys
import argparse
from pathlib import Path


# ─── Dependency check ─────────────────────────────────────────────────────────

def check_deps():
    try:
        from playwright.sync_api import sync_playwright  # noqa
    except ImportError:
        print("Missing dependency. Install with:")
        print("  pip install playwright")
        sys.exit(1)

check_deps()

from playwright.sync_api import sync_playwright


# ─── Browser launch ───────────────────────────────────────────────────────────

def find_and_launch_browser(playwright):
    import platform
    is_linux = platform.system() == 'Linux'
    extra_args = ['--no-sandbox', '--disable-setuid-sandbox'] if is_linux else []

    for channel in ['chrome', 'msedge', 'chromium']:
        try:
            browser = playwright.chromium.launch(channel=channel, headless=True, args=extra_args)
            print(f"  Using browser: {channel}")
            return browser
        except Exception:
            continue

    try:
        browser = playwright.chromium.launch(headless=True, args=extra_args)
        print("  Using browser: playwright-chromium")
        return browser
    except Exception as e:
        print("\nNo browser found.")
        if is_linux:
            print("  apt install chromium-browser  OR  playwright install chromium")
        else:
            print("  Install Google Chrome: https://www.google.com/chrome/")
            print("  Or run: playwright install chromium")
        raise SystemExit(1) from e


# ─── Screenshot ───────────────────────────────────────────────────────────────

# Disable animations so all content is visible in the screenshot.
# Also reveal any elements hidden by IntersectionObserver (opacity:0 until scrolled into view).
DISABLE_ANIMATIONS_CSS = """
*, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-delay: 0.01ms !important;
    transition-duration: 0.01ms !important;
    transition-delay: 0.01ms !important;
}
[class*="reveal"], [class*="fade"], [class*="animate"] {
    opacity: 1 !important;
    transform: none !important;
    filter: none !important;
}
"""


def screenshot(html_path, output_path=None, width=1440, scale=1):
    html_path = Path(html_path).resolve()
    if not html_path.exists():
        print(f"Error: file not found: {html_path}")
        sys.exit(1)

    output_path = Path(output_path) if output_path else html_path.with_suffix('.png')
    url = f"file://{html_path}"

    print(f"Screenshotting: {html_path.name}")
    print(f"Width: {width}px  Scale: {scale}x")

    with sync_playwright() as p:
        browser = find_and_launch_browser(p)
        page = browser.new_page(
            viewport={"width": width, "height": 900},
            device_scale_factor=scale
        )
        page.goto(url, wait_until="networkidle")
        page.wait_for_timeout(800)

        # Disable animations and force-reveal hidden elements
        page.add_style_tag(content=DISABLE_ANIMATIONS_CSS)
        page.evaluate("""
            // Trigger IntersectionObserver-gated elements
            document.querySelectorAll('[class*="fade"], [class*="reveal"], [class*="animate"]')
                .forEach(el => { el.style.opacity = '1'; el.style.transform = 'none'; });
            // Scroll to bottom to trigger any lazy content, then back to top
            window.scrollTo(0, document.body.scrollHeight);
        """)
        page.wait_for_timeout(300)
        page.evaluate("window.scrollTo(0, 0)")
        page.wait_for_timeout(200)

        page.screenshot(path=str(output_path), full_page=True)
        browser.close()

    print(f"✓ Saved: {output_path}")
    return output_path


# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("html", help="Path to the HTML file")
    parser.add_argument("output", nargs="?", help="Output .png path (default: same name as HTML)")
    parser.add_argument("--width", type=int, default=1440, help="Viewport width in pixels (default: 1440)")
    parser.add_argument("--scale", type=int, default=2, help="Device pixel ratio, e.g. 2 for retina (default: 2)")
    args = parser.parse_args()
    screenshot(args.html, args.output, args.width, args.scale)


if __name__ == "__main__":
    main()
