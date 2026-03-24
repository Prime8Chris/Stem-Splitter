"""Pre-launch dependency setup — runs before the main window appears.

Checks for and installs required dependencies silently so the user
never has to touch a terminal. Caches results so subsequent launches are instant.
"""

import json
import logging
import os
import subprocess
import sys

from .config import PYTHON_EXE, DATA_DIR, CREATE_NO_WINDOW
from .processing import DemucsProcessor

logger = logging.getLogger(__name__)

# Shared processor instance for dependency checks
_processor = DemucsProcessor()

# State file persists setup results between launches
STATE_FILE = DATA_DIR / "setup_state.json"

# pip install commands
DEMUCS_INSTALL = [PYTHON_EXE, "-m", "pip", "install", "demucs", "--quiet"]
TORCH_CUDA_INSTALL = [
    PYTHON_EXE, "-m", "pip", "install",
    "torch", "--force-reinstall",
    "--index-url", "https://download.pytorch.org/whl/cu121",
]


def _load_state():
    """Load cached setup state from disk."""
    try:
        if STATE_FILE.exists():
            return json.loads(STATE_FILE.read_text(encoding="utf-8"))
    except Exception:
        pass
    return None


def _save_state(state):
    """Persist setup state to disk."""
    try:
        STATE_FILE.write_text(json.dumps(state), encoding="utf-8")
    except Exception as e:
        logger.warning("Failed to save setup state: %s", e)


def _run_pip(cmd, timeout=600):
    """Run a pip command, return (success, error_message)."""
    try:
        result = subprocess.run(
            cmd, capture_output=True, text=True,
            timeout=timeout, creationflags=CREATE_NO_WINDOW,
        )
        if result.returncode == 0:
            return True, None
        err = result.stderr.strip().split("\n")[-1] if result.stderr.strip() else "Unknown error"
        return False, err
    except subprocess.TimeoutExpired:
        return False, "Timed out"
    except Exception as e:
        return False, str(e)


def check_demucs_installed():
    """Check if demucs module is importable."""
    return _processor.check_installed()


def check_gpu_available():
    """Check if an NVIDIA GPU is present via nvidia-smi. Returns GPU name or None."""
    return _processor.get_gpu_name()


def check_torch_has_cuda():
    """Check if the installed PyTorch build has CUDA support."""
    return _processor.check_torch_has_cuda()


def ensure_dependencies(on_status=None):
    """Check and install all dependencies before app launch.

    Uses cached state to skip checks on subsequent launches.
    Only re-checks if something was missing last time.

    Args:
        on_status: Callback(message: str) for progress updates.

    Returns:
        dict: {gpu_name, gpu_ready, demucs_ok, errors}
    """
    def status(msg):
        logger.info(msg)
        if on_status:
            on_status(msg)

    # Check cached state — if everything was ready last time, just verify quickly
    cached = _load_state()
    if cached and cached.get("demucs_ok") and cached.get("setup_complete"):
        status("Verifying setup...")
        # Quick sanity check — demucs still installed?
        if check_demucs_installed():
            status("Ready!")
            return cached
        # If not, fall through to full setup
        status("Re-checking dependencies...")

    errors = []
    gpu_name = None
    gpu_ready = False

    # Step 1: Demucs
    if check_demucs_installed():
        status("Demucs ready.")
    else:
        status("Installing Demucs (first-time setup)...")
        ok, err = _run_pip(DEMUCS_INSTALL)
        if ok:
            status("Demucs installed.")
        else:
            errors.append(f"Failed to install Demucs: {err}")
            status(f"Demucs install failed: {err}")

    # Step 2: GPU detection (CUDA is NVIDIA-only, not available on macOS)
    gpu_name = None if sys.platform == "darwin" else check_gpu_available()
    if gpu_name:
        status(f"GPU detected: {gpu_name}")

        # Step 3: Ensure torch has CUDA (force-reinstall replaces CPU build)
        if check_torch_has_cuda():
            gpu_ready = True
            status(f"GPU acceleration ready ({gpu_name}).")
        else:
            status(f"Installing GPU support for {gpu_name} — this may take a few minutes...")
            ok, err = _run_pip(TORCH_CUDA_INSTALL, timeout=900)
            if ok and check_torch_has_cuda():
                gpu_ready = True
                status(f"GPU acceleration ready ({gpu_name}).")
            else:
                if not ok:
                    errors.append(f"Failed to install CUDA PyTorch: {err}")
                else:
                    errors.append("CUDA PyTorch installed but GPU still not detected.")
                status("GPU setup failed — using CPU.")
    else:
        status("No GPU detected — using CPU.")

    result = {
        "gpu_name": gpu_name,
        "gpu_ready": gpu_ready,
        "demucs_ok": check_demucs_installed(),
        "errors": errors,
        "setup_complete": True,
    }

    # Save state so next launch is instant
    _save_state(result)
    return result
