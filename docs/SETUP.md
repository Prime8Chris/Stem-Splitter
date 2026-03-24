# Setup Guide

## Prerequisites

- **Python 3.11 or higher** — Required for the backend and subprocess management
- **pip** — Used by the application to auto-install dependencies at first launch
- **NVIDIA GPU + drivers** (optional) — Enables CUDA acceleration for faster stem separation

### Platform Notes

Stem Splitter is primarily developed for **Windows**. The codebase uses `os.startfile()` and `explorer.exe` for folder operations, which are Windows-specific. The core architecture (pywebview, subprocess-based processing) is cross-platform capable, but file browsing and folder-opening features would need adaptation for macOS/Linux.

## Installation

### Option A: Virtual Environment (Recommended)

```bash
git clone <repository-url>
cd "Stem Splitter"

# Create and activate virtual environment
python -m venv venv
venv\Scripts\activate          # Windows
# source venv/bin/activate     # macOS/Linux

# Install pywebview (not in requirements.txt — requires platform-specific backend)
pip install pywebview

# Install remaining dependencies
pip install -r requirements.txt
```

### Option B: System Python

```bash
pip install pywebview
pip install -r requirements.txt
```

### Dependencies Breakdown

**requirements.txt contents:**

| Package | Purpose |
|---------|---------|
| `demucs` | Meta's audio source separation model (pulls in PyTorch) |
| `basic-pitch` | Spotify's pitch detection for MIDI conversion (pulls in TensorFlow) |
| `soundfile` | Reading/writing WAV files for mix export |
| `numpy` | Array operations for audio mixing |

**Not in requirements.txt:**

| Package | Reason |
|---------|--------|
| `pywebview` | Requires platform-specific backend selection; must be installed manually |

> **Note:** `demucs` installs PyTorch as a dependency. If you have an NVIDIA GPU, the application will automatically reinstall PyTorch with CUDA support on first launch.

## Launching the Application

### From the command line

```bash
python -m stem_splitter
```

### Using the batch file (Windows)

Double-click `Stem Splitter.bat`, which runs:
```batch
@echo off
start "" pythonw -m stem_splitter
```

This uses `pythonw.exe` to launch without a console window.

## First-Run Setup

On the first launch, a splash screen appears and performs automatic setup:

1. **Demucs check** — Verifies that `import demucs` succeeds. If not, runs `pip install demucs --quiet`.
2. **GPU detection** — Runs `nvidia-smi --query-gpu=name --format=csv,noheader` to detect NVIDIA GPUs.
3. **CUDA PyTorch** — If a GPU is detected and the installed PyTorch lacks CUDA support, reinstalls PyTorch from `https://download.pytorch.org/whl/cu121`.

Results are cached to `~/.stem_splitter/setup_state.json`. Subsequent launches skip these checks and start immediately (a quick Demucs import verification still runs).

### Forcing a Re-check

Delete the state file to trigger a full re-check:
```bash
del "%USERPROFILE%\.stem_splitter\setup_state.json"
```

## Configuration

### User Data Directory

All user data is stored in `~/.stem_splitter/` (i.e., `%USERPROFILE%\.stem_splitter\` on Windows):

| File | Description |
|------|-------------|
| `settings.json` | Theme and accessibility preferences |
| `settings.json.bak` | Automatic backup created before each settings write |
| `setup_state.json` | Cached setup results (GPU name, Demucs status) |
| `logs/stem_splitter.log` | Warning and error log (created at launch) |

### Settings Schema

| Key | Type | Default | Valid Values |
|-----|------|---------|--------------|
| `theme` | string | `"dark"` | `"dark"`, `"light"`, `"system"` |
| `high_contrast` | boolean | `false` | `true`, `false` |

Settings are validated on load. Invalid values are replaced with defaults. Unknown keys are discarded.

### Default Output Directory

Separated stems are saved to `~/Music/Stem Splitter Output/` by default. This can be changed at runtime using the output directory picker in the UI. The choice is not persisted between sessions — it resets to the default on each launch.

## GPU Acceleration

### Requirements

- NVIDIA GPU with CUDA-compatible drivers
- The application handles PyTorch CUDA installation automatically

### How GPU Detection Works

1. **PyTorch check:** `import torch; torch.cuda.is_available()` — if the installed PyTorch has CUDA support
2. **nvidia-smi fallback:** Detects GPU presence even if PyTorch is CPU-only (prompts CUDA PyTorch installation)

### Manual CUDA PyTorch Installation

If automatic installation fails:
```bash
pip install torch --force-reinstall --index-url https://download.pytorch.org/whl/cu121
```

### Verifying GPU Access

After setup, the application UI shows:
- **Device selector:** Displays "GPU (GPU Name)" if GPU acceleration is available
- **Without GPU:** Only "CPU" appears in the device selector

## Troubleshooting

### "Demucs not found" error

Demucs failed to install automatically. Install manually:
```bash
pip install demucs
```

### Splash screen hangs

The splash screen waits for dependency installation. On slow connections, PyTorch and Demucs downloads can take several minutes. Check `~/.stem_splitter/logs/stem_splitter.log` for errors.

### No GPU option in device selector

- Verify NVIDIA drivers are installed: run `nvidia-smi` in a terminal
- Delete `~/.stem_splitter/setup_state.json` and restart to re-run GPU detection
- Manually install CUDA PyTorch (see above)

### Application window is blank

Ensure pywebview is installed with a working backend:
```bash
pip install pywebview
```
On Windows, pywebview uses EdgeChromium (Edge WebView2). If Edge is not installed, install the [WebView2 Runtime](https://developer.microsoft.com/en-us/microsoft-edge/webview2/).

### Settings file corruption

The application maintains a backup at `settings.json.bak`. If `settings.json` is unreadable, the backup is loaded automatically. If both are corrupt, defaults are used and a fresh file is written on the next settings change.

### MIDI conversion fails

`basic-pitch` is installed lazily on first MIDI conversion. If installation fails:
```bash
pip install basic-pitch
```

Note: `basic-pitch` depends on TensorFlow, which is a large download (~500 MB+).

### Log file location

Warnings and errors are logged to:
```
~/.stem_splitter/logs/stem_splitter.log
```

The log uses `WARNING` level by default — routine operations are not logged.
