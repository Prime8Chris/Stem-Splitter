"""Stem Splitter configuration — single source of truth for all constants."""

import os
import sys
import socket
import subprocess
from pathlib import Path

# Subprocess flag to hide console windows on Windows
CREATE_NO_WINDOW = subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0

# Paths
SCRIPT_DIR = Path(__file__).resolve().parent.parent
PACKAGE_DIR = Path(__file__).resolve().parent
STATIC_DIR = PACKAGE_DIR / "static"
ASSETS_DIR = PACKAGE_DIR / "assets"

# User data directory — platform-appropriate location
if sys.platform == "win32":
    _app_data = os.environ.get("APPDATA")
    DATA_DIR = Path(_app_data) / "StemSplitter" if _app_data else Path.home() / ".stem_splitter"
elif sys.platform == "darwin":
    DATA_DIR = Path.home() / "Library" / "Application Support" / "StemSplitter"
else:
    _xdg = os.environ.get("XDG_DATA_HOME")
    DATA_DIR = Path(_xdg) / "stem_splitter" if _xdg else Path.home() / ".local" / "share" / "stem_splitter"
DATA_DIR.mkdir(parents=True, exist_ok=True)

# Default output
DEFAULT_OUTPUT = str(Path.home() / "Music" / "Stem Splitter Output")

# Window
WINDOW_TITLE = "Stem Splitter"
WINDOW_WIDTH = 750
WINDOW_HEIGHT = 840
WINDOW_MIN_SIZE = (650, 560)
WINDOW_BG_COLOR = "#0a0a1a"

# Audio server
def find_free_port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]

AUDIO_HOST = "127.0.0.1"

# Supported audio formats
ALLOWED_AUDIO_EXTENSIONS = {".wav", ".mp3", ".flac", ".ogg", ".m4a", ".wma", ".aiff", ".au"}

MIME_TYPES = {
    ".wav": "audio/wav",
    ".mp3": "audio/mpeg",
    ".flac": "audio/flac",
    ".ogg": "audio/ogg",
    ".m4a": "audio/mp4",
    ".aiff": "audio/aiff",
    ".wma": "audio/x-ms-wma",
    ".au": "audio/basic",
}

# Demucs models and stem definitions
MODELS = {
    "htdemucs": {
        "label": "4 stems — vocals, drums, bass, other",
        "stems": ["vocals", "drums", "bass", "other"],
    },
    "htdemucs_6s": {
        "label": "6 stems — vocals, drums, bass, guitar, piano, other",
        "stems": ["vocals", "drums", "bass", "guitar", "piano", "other"],
    },
}

# Stem colors for UI (also used in JS)
STEM_COLORS = {
    "vocals": "#f472b6",
    "drums": "#818cf8",
    "bass": "#34d399",
    "other": "#fbbf24",
    "guitar": "#fb923c",
    "piano": "#22d3ee",
}

# Python executable detection
def get_python_exe():
    exe = sys.executable
    # On Windows, pythonw.exe can't run console subprocesses properly
    if sys.platform == "win32" and exe.lower().endswith("pythonw.exe"):
        candidate = exe[:-len("pythonw.exe")] + "python.exe"
        if os.path.isfile(candidate):
            return candidate
    return exe

PYTHON_EXE = get_python_exe()

# Stems eligible for MIDI conversion (pitched instruments + drums)
MIDI_ELIGIBLE_STEMS = {"vocals", "bass", "guitar", "piano", "drums"}
