"""Stem Splitter application entry point."""

import json
import logging
import os
import re
import time
import threading

import webview

from .config import (
    STATIC_DIR, ASSETS_DIR, PACKAGE_DIR,
    WINDOW_TITLE, WINDOW_WIDTH, WINDOW_HEIGHT, WINDOW_MIN_SIZE, WINDOW_BG_COLOR,
    find_free_port,
)
from .server import start_audio_server
from .api import Api
from .setup import ensure_dependencies
from .settings import load_settings

# Configure logging — write to user data directory
from .config import DATA_DIR
_log_dir = str(DATA_DIR / "logs")
os.makedirs(_log_dir, exist_ok=True)
logging.basicConfig(
    filename=os.path.join(_log_dir, "stem_splitter.log"),
    level=logging.WARNING,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)


# --- Splash screen shown during first-time setup ---

SPLASH_HTML = """<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&display=swap');
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: 'Inter', sans-serif;
    background: #0a0a1a;
    color: #e0e0f0;
    height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    user-select: none;
  }
  .bg {
    position: fixed; inset: 0; z-index: 0; overflow: hidden;
  }
  .bg::before {
    content: '';
    position: absolute;
    width: 500px; height: 500px;
    background: radial-gradient(circle, rgba(99,102,241,0.3) 0%, transparent 70%);
    top: -80px; left: -80px;
    animation: float1 8s ease-in-out infinite;
  }
  .bg::after {
    content: '';
    position: absolute;
    width: 400px; height: 400px;
    background: radial-gradient(circle, rgba(236,72,153,0.2) 0%, transparent 70%);
    bottom: -80px; right: -80px;
    animation: float2 10s ease-in-out infinite;
  }
  @keyframes float1 {
    0%, 100% { transform: translate(0, 0) scale(1); }
    50% { transform: translate(60px, 40px) scale(1.15); }
  }
  @keyframes float2 {
    0%, 100% { transform: translate(0, 0) scale(1); }
    50% { transform: translate(-40px, -60px) scale(1.1); }
  }
  .content {
    position: relative; z-index: 1;
    text-align: center;
    padding: 40px;
  }
  h1 {
    font-size: 22px;
    font-weight: 600;
    margin-bottom: 24px;
    background: linear-gradient(135deg, #818cf8, #c084fc, #f472b6);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
  }
  .status {
    font-size: 13px;
    color: rgba(255,255,255,0.5);
    margin-bottom: 20px;
    min-height: 20px;
    transition: opacity 0.3s;
  }
  .progress-track {
    width: 260px;
    height: 4px;
    border-radius: 2px;
    background: rgba(255,255,255,0.08);
    overflow: hidden;
    margin: 0 auto;
  }
  .progress-fill {
    height: 100%;
    border-radius: 2px;
    background: linear-gradient(90deg, #818cf8, #c084fc, #f472b6);
    background-size: 200% 100%;
    animation: shimmer 1.5s linear infinite;
    width: 30%;
    transition: width 0.5s ease;
  }
  @keyframes shimmer {
    0% { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }
</style>
</head>
<body>
  <div class="bg"></div>
  <div class="content">
    <h1>Stem Splitter</h1>
    <div class="status" id="status">Checking dependencies...</div>
    <div class="progress-track"><div class="progress-fill" id="progressFill"></div></div>
  </div>
  <script>
    function updateStatus(msg) {
      document.getElementById('status').textContent = msg;
    }
    function setProgress(pct) {
      document.getElementById('progressFill').style.width = pct + '%';
    }
  </script>
</body></html>
"""


def _load_html(audio_port, setup_result):
    """Load and assemble the main app HTML, injecting port and setup results."""
    html_path = STATIC_DIR / "index.html"
    css_path = STATIC_DIR / "style.css"

    html = html_path.read_text(encoding="utf-8")
    css = css_path.read_text(encoding="utf-8")

    js_files = ["app.js", "waveform.js", "eq.js", "mixer.js", "settings.js", "render.js"]
    js_parts = []
    for js_file in js_files:
        js_path = STATIC_DIR / "js" / js_file
        js_parts.append(js_path.read_text(encoding="utf-8"))
    js = "\n".join(js_parts)

    user_settings = load_settings()
    setup_js = f"const SETUP_RESULT = {json.dumps(setup_result)};\n"
    setup_js += f"const INITIAL_SETTINGS = {json.dumps(user_settings)};\n"

    inline_html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{WINDOW_TITLE}</title>
<style>
{css}
</style>
</head>
<body>
"""
    body_start = html.find("<body>")
    body_end = html.find("</body>")
    if body_start >= 0 and body_end >= 0:
        body_content = html[body_start + 6:body_end]
        body_content = re.sub(r'<script src="[^"]*"></script>\s*', '', body_content)
        body_content = body_content.strip()
    else:
        body_content = html

    inline_html += body_content
    inline_html += f"""
<script>
{setup_js}
{js}
</script>
</body>
</html>"""

    inline_html = inline_html.replace("__AUDIO_PORT__", str(audio_port))
    return inline_html


def _run_setup_with_splash(splash_window, callback):
    """Run dependency setup, updating the splash window, then call back with results."""
    def on_status(msg):
        try:
            splash_window.evaluate_js(f"updateStatus({json.dumps(msg)})")
        except Exception:
            pass

    # Small delay so splash renders before heavy work starts
    time.sleep(0.3)

    try:
        splash_window.evaluate_js("setProgress(15)")
    except Exception:
        pass
    on_status("Checking dependencies...")

    result = ensure_dependencies(on_status=on_status)

    try:
        splash_window.evaluate_js("setProgress(100)")
        splash_window.evaluate_js("updateStatus('Ready!')")
    except Exception:
        pass

    time.sleep(0.5)

    callback(result)


def main():
    """Launch the Stem Splitter application."""
    audio_port = find_free_port()
    setup_result = {"gpu_name": None, "gpu_ready": False, "demucs_ok": False, "errors": []}

    # Phase 1: Show splash and run setup
    splash = webview.create_window(
        "Stem Splitter — Setting Up",
        html=SPLASH_HTML,
        width=380,
        height=220,
        resizable=False,
        frameless=True,
        background_color="#0a0a1a",
    )

    def on_setup_done(result):
        nonlocal setup_result
        setup_result = result
        splash.destroy()

    def on_splash_loaded():
        threading.Thread(
            target=_run_setup_with_splash,
            args=(splash, on_setup_done),
            daemon=True,
        ).start()

    webview.start(on_splash_loaded)

    # Phase 2: Launch main app (splash is closed, setup is done)
    window_ref = [None]
    api = Api(window_ref)
    api._setup_result = setup_result

    allowed_dirs = [str(ASSETS_DIR), str(PACKAGE_DIR.parent), api.default_output]
    audio_server = start_audio_server(audio_port, allowed_dirs=allowed_dirs)
    api._audio_server = audio_server

    html = _load_html(audio_port, setup_result)
    window = webview.create_window(
        WINDOW_TITLE,
        html=html,
        js_api=api,
        width=WINDOW_WIDTH,
        height=WINDOW_HEIGHT,
        min_size=WINDOW_MIN_SIZE,
        background_color=WINDOW_BG_COLOR,
    )
    window_ref[0] = window
    webview.start()
