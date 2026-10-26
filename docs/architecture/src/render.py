"""Render the diagram sources in this folder to PNG (2x device scale) with Playwright.

    python3.11 -I docs/architecture/src/render.py            # all diagrams
    python3.11 -I docs/architecture/src/render.py run-flow   # one diagram

Serves the repo over a local HTTP server so the pages can load the Inter / JetBrains Mono
fonts from node_modules (run `npm ci` first; the pages fall back to the system font otherwise).
"""
import functools
import http.server
import pathlib
import sys
import threading

from playwright.sync_api import sync_playwright

HERE = pathlib.Path(__file__).resolve().parent
OUT = HERE.parent
ROOT = HERE.parents[2]
DIAGRAMS = ['architecture', 'run-flow', 'user-flow']


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def main(names):
    handler = functools.partial(Quiet, directory=str(ROOT))
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f'http://127.0.0.1:{server.server_address[1]}/{HERE.relative_to(ROOT).as_posix()}'
    with sync_playwright() as p:
        browser = p.chromium.launch(channel='chrome')
        page = browser.new_page(viewport={'width': 1600, 'height': 1000}, device_scale_factor=2)
        page.on('console', lambda m: print(f'  console: {m.text}') if m.type in ('error', 'warning') else None)
        page.on('pageerror', lambda e: print(f'  page error: {e}'))
        for name in names:
            page.goto(f'{base}/{name}.html')
            page.wait_for_function('window.__ready === true', timeout=15000)
            fonts = page.evaluate("[...document.fonts].filter(f => f.status === 'loaded').map(f => f.family)")
            issues = page.evaluate('window.__issues || []')
            out = OUT / f'{name}.png'
            page.locator('#canvas').screenshot(path=str(out))
            print(f'{name}: {out.relative_to(ROOT)}  fonts={sorted(set(fonts))}')
            for i in issues:
                print(f'  ! {i}')
        browser.close()
    server.shutdown()


if __name__ == '__main__':
    main(sys.argv[1:] or DIAGRAMS)
