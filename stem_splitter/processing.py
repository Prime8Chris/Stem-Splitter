"""Demucs audio stem separation subprocess wrapper."""

import json
import logging
import os
import re
import subprocess
from pathlib import Path

from .config import PYTHON_EXE, MODELS, MIDI_ELIGIBLE_STEMS, CREATE_NO_WINDOW

logger = logging.getLogger(__name__)


class SplitCancelledError(Exception):
    """Raised when a split operation is cancelled by the user."""
    pass


class DemucsProcessor:
    """Wraps Demucs subprocess with progress tracking and cancellation."""

    def __init__(self):
        self._process = None
        self._cancelled = False

    @property
    def is_running(self):
        return self._process is not None and self._process.poll() is None

    def cancel(self):
        """Cancel the current split operation."""
        self._cancelled = True
        if self._process and self._process.poll() is None:
            self._process.terminate()
            logger.info("Demucs process terminated by user")

    def split(self, filepath, model, output_dir, device="cpu", on_progress=None):
        """
        Run Demucs on a single file.

        Args:
            filepath: Path to the audio file
            model: Model name (e.g., "htdemucs", "htdemucs_6s")
            output_dir: Output directory path
            device: "cpu" or "cuda"
            on_progress: Callback(percent: float, status: str)

        Returns:
            List of stem dicts [{"name": str, "path": str}, ...]

        Raises:
            SplitCancelledError: If cancelled by user
            FileNotFoundError: If Demucs is not installed
            RuntimeError: If Demucs exits with error
        """
        self._cancelled = False
        os.makedirs(output_dir, exist_ok=True)

        model_info = MODELS.get(model)
        if not model_info:
            raise ValueError(f"Unknown model: {model}")

        name_no_ext = Path(filepath).stem
        cmd = [PYTHON_EXE, "-m", "demucs", "-n", model, "-o", output_dir]
        if device == "cuda":
            cmd.extend(["--device", "cuda"])
        cmd.append(filepath)

        try:
            self._process = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
                creationflags=CREATE_NO_WINDOW,
            )
        except FileNotFoundError:
            raise FileNotFoundError("Demucs not found. Run: pip install demucs")

        last_error = ""
        for line in self._process.stdout:
            if self._cancelled:
                self._process.terminate()
                raise SplitCancelledError("Split cancelled by user")

            line = line.strip()
            if not line:
                continue

            pct_match = re.search(r"(\d+)%\|", line)
            if pct_match:
                pct = int(pct_match.group(1))
                if on_progress:
                    on_progress(pct, "Separating...")
            elif "error" in line.lower():
                last_error = line

        self._process.wait()

        if self._cancelled:
            raise SplitCancelledError("Split cancelled by user")

        if self._process.returncode != 0:
            raise RuntimeError(last_error or "Unknown Demucs error")

        # Collect output stems
        stem_dir = Path(output_dir) / model / name_no_ext
        stems = []
        for stem_name in model_info["stems"]:
            stem_path = stem_dir / f"{stem_name}.wav"
            if stem_path.exists():
                stems.append({"name": stem_name, "path": str(stem_path)})

        self._process = None
        return stems

    def check_installed(self):
        """Check if Demucs is available."""
        try:
            result = subprocess.run(
                [PYTHON_EXE, "-c", "import demucs"],
                capture_output=True,
                text=True,
                creationflags=CREATE_NO_WINDOW,
            )
            return result.returncode == 0
        except Exception:
            return False

    def check_cuda_available(self):
        """Check if CUDA GPU is available using multiple detection methods.

        Checks in order:
        1. torch.cuda.is_available() — works if CUDA-enabled PyTorch is installed
        2. nvidia-smi — works even with CPU-only PyTorch (GPU still usable by reinstalling torch)
        """
        # Method 1: Ask PyTorch directly
        try:
            result = subprocess.run(
                [PYTHON_EXE, "-c", "import torch; print(torch.cuda.is_available())"],
                capture_output=True,
                text=True,
                timeout=10,
                creationflags=CREATE_NO_WINDOW,
            )
            if result.stdout.strip() == "True":
                return True
        except Exception:
            pass

        # Method 2: Check nvidia-smi (GPU exists even if torch is CPU-only build)
        return self.get_gpu_name() is not None

    def get_gpu_name(self):
        """Get the GPU name for display, or None if no GPU found."""
        try:
            result = subprocess.run(
                ["nvidia-smi", "--query-gpu=name", "--format=csv,noheader"],
                capture_output=True,
                text=True,
                timeout=5,
                creationflags=CREATE_NO_WINDOW,
            )
            if result.returncode == 0 and result.stdout.strip():
                return result.stdout.strip().split("\n")[0]
        except Exception:
            pass
        return None

    def check_torch_has_cuda(self):
        """Check if the installed PyTorch build supports CUDA."""
        try:
            result = subprocess.run(
                [PYTHON_EXE, "-c", "import torch; print(torch.version.cuda or 'None')"],
                capture_output=True,
                text=True,
                timeout=10,
                creationflags=CREATE_NO_WINDOW,
            )
            cuda_ver = result.stdout.strip()
            return cuda_ver != "None" and cuda_ver != ""
        except Exception:
            return False


class MidiConverter:
    """Converts WAV stems to MIDI using basic-pitch."""

    # Inline Python script run as subprocess to avoid loading TensorFlow in main process
    _CONVERT_SCRIPT = """
import sys, json
wav_path = sys.argv[1]
midi_path = sys.argv[2]
try:
    print(json.dumps({"stage": "loading", "pct": 10}), flush=True)
    from basic_pitch.inference import predict
    print(json.dumps({"stage": "analyzing", "pct": 25}), flush=True)
    model_output, midi_data, note_events = predict(wav_path)
    print(json.dumps({"stage": "writing", "pct": 85}), flush=True)
    midi_data.write(midi_path)
    notes = [[round(n[0], 3), round(n[1], 3), int(n[2])] for n in note_events]
    print(json.dumps({"ok": True, "path": midi_path, "notes": notes}), flush=True)
except Exception as e:
    print(json.dumps({"ok": False, "error": str(e)}), flush=True)
"""

    # Stage labels for progress reporting
    _STAGE_LABELS = {
        "loading": "Loading model...",
        "analyzing": "Analyzing audio...",
        "writing": "Writing MIDI file...",
    }

    def convert(self, wav_path, on_progress=None):
        """Convert a WAV file to MIDI using basic-pitch.

        Args:
            wav_path: Path to the WAV stem file.
            on_progress: Callback(status: str, pct: int) for status updates.

        Returns:
            tuple: (midi_path: str, notes: list) — path and note events [[start, end, pitch], ...].

        Raises:
            FileNotFoundError: If basic-pitch is not installed.
            RuntimeError: If conversion fails.
        """
        wav_path = Path(wav_path)
        if not wav_path.exists():
            raise FileNotFoundError(f"WAV file not found: {wav_path}")

        midi_path = wav_path.with_suffix(".mid")

        if on_progress:
            on_progress("Starting MIDI conversion...", 5)

        cmd = [PYTHON_EXE, "-c", self._CONVERT_SCRIPT, str(wav_path), str(midi_path)]

        try:
            process = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                bufsize=1,
                creationflags=CREATE_NO_WINDOW,
            )
        except FileNotFoundError:
            raise FileNotFoundError("Python executable not found")

        # Read lines as they arrive for real-time progress
        final_result = None
        for line in process.stdout:
            line = line.strip()
            if not line:
                continue
            try:
                data = json.loads(line)
                if data.get("ok") is not None:
                    final_result = data
                elif "stage" in data and on_progress:
                    label = self._STAGE_LABELS.get(data["stage"], data["stage"])
                    on_progress(label, data.get("pct", 0))
            except json.JSONDecodeError:
                continue

        process.wait(timeout=600)

        if final_result:
            if final_result.get("ok"):
                return final_result["path"], final_result.get("notes", [])
            else:
                raise RuntimeError(final_result.get("error", "Unknown error"))

        raise RuntimeError("MIDI conversion failed — no output from basic-pitch")

    _READ_NOTES_SCRIPT = """
import sys, json
midi_path = sys.argv[1]
try:
    import pretty_midi
    pm = pretty_midi.PrettyMIDI(midi_path)
    notes = []
    for inst in pm.instruments:
        for n in inst.notes:
            notes.append([round(n.start, 3), round(n.end, 3), n.pitch])
    notes.sort(key=lambda x: x[0])
    print(json.dumps({"ok": True, "notes": notes}))
except ImportError:
    print(json.dumps({"ok": False, "error": "pretty_midi not installed"}))
except Exception as e:
    print(json.dumps({"ok": False, "error": str(e)}))
"""

    def read_notes(self, midi_path):
        """Read note events from an existing MIDI file.

        Returns:
            list: Note events [[start, end, pitch], ...] or empty list on failure.
        """
        midi_path = Path(midi_path)
        if not midi_path.exists():
            return []

        cmd = [PYTHON_EXE, "-c", self._READ_NOTES_SCRIPT, str(midi_path)]
        try:
            result = subprocess.run(
                cmd, capture_output=True, text=True, timeout=30,
                creationflags=CREATE_NO_WINDOW,
            )
            for line in result.stdout.strip().split("\n"):
                line = line.strip()
                if not line:
                    continue
                try:
                    data = json.loads(line)
                    if data.get("ok"):
                        return data.get("notes", [])
                except json.JSONDecodeError:
                    continue
        except Exception:
            pass
        return []

    def check_installed(self):
        """Check if basic-pitch is available."""
        try:
            result = subprocess.run(
                [PYTHON_EXE, "-c", "import basic_pitch"],
                capture_output=True,
                text=True,
                timeout=10,
                creationflags=CREATE_NO_WINDOW,
            )
            return result.returncode == 0
        except Exception:
            return False
