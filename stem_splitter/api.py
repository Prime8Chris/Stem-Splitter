"""Python API exposed to the pywebview frontend."""

import json
import logging
import os
import subprocess
import threading
from pathlib import Path

import webview

from .config import DEFAULT_OUTPUT, MODELS, MIDI_ELIGIBLE_STEMS, CREATE_NO_WINDOW
from .processing import DemucsProcessor, SplitCancelledError, MidiConverter
from .settings import load_settings, set_setting

logger = logging.getLogger(__name__)


class Api:
    """Backend API callable from JavaScript via pywebview."""

    def __init__(self, window_ref):
        self._window_ref = window_ref
        self.default_output = DEFAULT_OUTPUT
        self._last_stem_dir = None
        self._audio_server = None
        self._processor = DemucsProcessor()
        self._midi_converter = MidiConverter()
        self._scan_lock = threading.Lock()

    @property
    def window(self):
        return self._window_ref[0]

    # --- Safe JS bridge ---

    def _js(self, code):
        try:
            self.window.evaluate_js(code)
        except Exception as e:
            logger.warning("JS eval failed: %s", e)

    def _js_call(self, func_name, *args):
        """Safely call a JS function with properly serialized arguments."""
        args_json = ", ".join(json.dumps(a) for a in args)
        self._js(f"{func_name}({args_json})")

    # --- File picking ---

    def get_default_output(self):
        return self.default_output

    def pick_files(self):
        result = self.window.create_file_dialog(
            webview.OPEN_DIALOG,
            allow_multiple=True,
            file_types=(
                "Audio Files (*.mp3;*.wav;*.flac;*.ogg;*.m4a;*.wma;*.aiff;*.au)",
                "All Files (*.*)",
            ),
        )
        if not result:
            return None
        files = [{"name": Path(p).name, "path": p} for p in result]
        return json.dumps(files)

    def pick_output(self):
        result = self.window.create_file_dialog(webview.FOLDER_DIALOG)
        if result and len(result) > 0:
            path = result[0] if isinstance(result, (list, tuple)) else result
            self.default_output = path
            # Update audio server allowed dirs
            if self._audio_server and path not in self._audio_server.allowed_dirs:
                self._audio_server.allowed_dirs.append(path)
            return path
        return None

    def open_output_folder(self):
        folder = self._last_stem_dir or self.default_output
        if os.path.isdir(folder):
            os.startfile(folder)
        elif os.path.isdir(self.default_output):
            os.startfile(self.default_output)

    def copy_to_clipboard(self, text):
        self._js(f"navigator.clipboard.writeText({json.dumps(text)})")

    def open_file_location(self, filepath):
        """Open the folder containing a file and select it in Explorer."""
        filepath = os.path.normpath(filepath)
        if os.path.isfile(filepath):
            subprocess.Popen(
                ["explorer", "/select,", filepath],
                creationflags=CREATE_NO_WINDOW,
            )
        elif os.path.isdir(os.path.dirname(filepath)):
            os.startfile(os.path.dirname(filepath))

    # --- Library ---

    def scan_library(self):
        """Scan output directory for previously split songs."""
        with self._scan_lock:
            output = Path(self.default_output)
            results = []
            if not output.exists():
                return json.dumps(results)

            for model_name, model_info in MODELS.items():
                model_dir = output / model_name
                if not model_dir.is_dir():
                    continue
                for song_dir in sorted(model_dir.iterdir()):
                    if not song_dir.is_dir():
                        continue
                    stems = []
                    for sn in model_info["stems"]:
                        stem_path = song_dir / f"{sn}.wav"
                        if stem_path.exists():
                            stem_data = {"name": sn, "path": str(stem_path)}
                            midi_path = stem_path.with_suffix(".mid")
                            if midi_path.exists():
                                stem_data["midiPath"] = str(midi_path)
                            stems.append(stem_data)
                    if stems:
                        # Use most recent stem file mtime as the split timestamp
                        mtime = max(
                            (song_dir / f"{s['name']}.wav").stat().st_mtime
                            for s in stems
                        )
                        results.append({
                            "name": song_dir.name,
                            "model": model_name,
                            "stemDir": str(song_dir),
                            "stems": stems,
                            "timestamp": mtime,
                        })
            return json.dumps(results)

    # --- Splitting ---

    def start_split(self, paths_json, model, output_dir, device="cpu"):
        threading.Thread(
            target=self._run_split,
            args=(json.loads(paths_json), model, output_dir, device),
            daemon=True,
        ).start()

    def cancel_split(self):
        """Cancel the current split operation."""
        self._processor.cancel()

    def _run_split(self, paths, model, output_dir, device="cpu"):
        total = len(paths)

        # Ensure output dir is in audio server allowed dirs
        if self._audio_server and output_dir not in self._audio_server.allowed_dirs:
            self._audio_server.allowed_dirs.append(output_dir)

        for i, filepath in enumerate(paths):
            name = Path(filepath).name

            self._js_call("markFileProcessing", i)
            self._js_call("updateProgress", (i / total) * 100, f"Processing {i+1}/{total}: {name}")

            def on_progress(pct, status):
                overall = (i / total * 100) + (pct / total)
                self._js_call("updateProgress", overall, f"Separating {i+1}/{total}: {name}")

            try:
                stems = self._processor.split(
                    filepath, model, output_dir, device=device, on_progress=on_progress
                )
            except SplitCancelledError:
                self._js_call("splitDone", False, "Split cancelled.")
                return
            except FileNotFoundError as e:
                self._js_call("splitDone", False, str(e))
                return
            except RuntimeError as e:
                self._js_call("splitDone", False, f"Error: {e}")
                return
            except Exception as e:
                logger.exception("Unexpected error during split")
                self._js_call("splitDone", False, f"Unexpected error: {e}")
                return

            stem_dir = str(Path(output_dir) / model / Path(filepath).stem)
            self._last_stem_dir = stem_dir

            self._js_call("markFileDone", i, stems)
            self._js_call("setOutputReady", stem_dir)
            self._js_call("updateProgress", ((i + 1) / total) * 100, f"Done {i+1}/{total}")

        self._js_call("splitDone", True, f"Done! {total} file(s) separated.")

    # --- MIDI Conversion ---

    def get_midi_eligible_stems(self):
        """Returns JSON list of stem names eligible for MIDI conversion."""
        return json.dumps(list(MIDI_ELIGIBLE_STEMS))

    def convert_to_midi(self, stem_path, stem_name):
        """Start MIDI conversion for a stem in a background thread."""
        threading.Thread(
            target=self._run_midi_conversion,
            args=(stem_path, stem_name),
            daemon=True,
        ).start()

    def _run_midi_conversion(self, stem_path, stem_name):
        # Lazy install: ensure basic-pitch is available before first conversion
        if not self._midi_converter.check_installed():
            self._js_call("midiConvertProgress", stem_path, "Installing basic-pitch...")
            from .config import PYTHON_EXE
            try:
                subprocess.run(
                    [PYTHON_EXE, "-m", "pip", "install", "basic-pitch", "--quiet"],
                    capture_output=True, text=True, timeout=300,
                    creationflags=CREATE_NO_WINDOW,
                )
            except Exception as e:
                self._js_call("midiConvertDone", stem_path, False, f"Failed to install basic-pitch: {e}")
                return

            if not self._midi_converter.check_installed():
                self._js_call("midiConvertDone", stem_path, False, "Failed to install basic-pitch")
                return

        self._js_call("midiConvertProgress", stem_path, "Converting...")
        self._js_call("updateProgress", 5, f"Converting {stem_name} to MIDI...")

        def on_progress(status, pct=0):
            self._js_call("midiConvertProgress", stem_path, status)
            self._js_call("updateProgress", pct, f"Converting {stem_name}: {status}")

        try:
            midi_path, notes = self._midi_converter.convert(stem_path, on_progress=on_progress)
            self._js_call("midiConvertDone", stem_path, True, midi_path, notes)
        except FileNotFoundError as e:
            self._js_call("midiConvertDone", stem_path, False, str(e), [])
        except RuntimeError as e:
            self._js_call("midiConvertDone", stem_path, False, str(e), [])
        except Exception as e:
            logger.exception("Unexpected error during MIDI conversion")
            self._js_call("midiConvertDone", stem_path, False, f"Unexpected error: {e}", [])

    def load_midi_notes(self, midi_path):
        """Load note events from an existing MIDI file. Returns JSON array."""
        notes = self._midi_converter.read_notes(midi_path)
        return json.dumps(notes)

    # --- Export Mix ---

    def export_mix(self, stems_json, output_path):
        """Export a mix of stems to a WAV file in a background thread.

        Args:
            stems_json: JSON array of {"path": str, "volume": 0-100, "muted": bool, "soloed": bool}
            output_path: Destination WAV file path.
        """
        stems = json.loads(stems_json) if isinstance(stems_json, str) else stems_json
        threading.Thread(
            target=self._run_export_mix,
            args=(stems, output_path),
            daemon=True,
        ).start()

    def _run_export_mix(self, stems, output_path):
        try:
            import numpy as np
            import soundfile as sf
        except ImportError as e:
            self._js_call("exportMixDone", False, f"Missing dependency: {e}")
            return

        self._js_call("exportMixProgress", 0, "Mixing stems...")

        try:
            any_soloed = any(s.get("soloed", False) for s in stems)

            mixed = None
            sample_rate = None

            for i, stem in enumerate(stems):
                vol = stem.get("volume", 100) / 100.0
                muted = stem.get("muted", False)
                soloed = stem.get("soloed", False)

                # Skip muted stems; if any solo is active, skip non-soloed
                if muted:
                    continue
                if any_soloed and not soloed:
                    continue

                data, sr = sf.read(stem["path"], dtype="float32")
                if sample_rate is None:
                    sample_rate = sr
                # Convert mono to stereo if needed
                if data.ndim == 1:
                    data = np.column_stack([data, data])

                data = data * vol

                if mixed is None:
                    mixed = data
                else:
                    # Pad shorter array to match length
                    if len(data) > len(mixed):
                        mixed = np.pad(mixed, ((0, len(data) - len(mixed)), (0, 0)))
                    elif len(mixed) > len(data):
                        data = np.pad(data, ((0, len(mixed) - len(data)), (0, 0)))
                    mixed = mixed + data

                pct = int(((i + 1) / len(stems)) * 80)
                self._js_call("exportMixProgress", pct, f"Mixing stem {i+1}/{len(stems)}...")

            if mixed is None:
                self._js_call("exportMixDone", False, "All stems are muted — nothing to export.")
                return

            # Clip to prevent distortion
            peak = np.max(np.abs(mixed))
            if peak > 1.0:
                mixed = mixed / peak

            self._js_call("exportMixProgress", 90, "Writing file...")

            os.makedirs(os.path.dirname(output_path), exist_ok=True)
            sf.write(output_path, mixed, sample_rate)

            self._js_call("exportMixProgress", 100, "Export complete!")
            self._js_call("exportMixDone", True, output_path)
        except Exception as e:
            logger.exception("Export mix failed")
            self._js_call("exportMixDone", False, f"Export failed: {e}")

    # --- Startup checks ---

    def check_demucs_installed(self):
        """Returns JSON bool of whether Demucs is installed."""
        return json.dumps(self._processor.check_installed())

    def check_gpu_info(self):
        """Returns JSON with GPU availability, name, and torch CUDA status.

        Result: {"gpu_available": bool, "gpu_name": str|null, "torch_has_cuda": bool}
        """
        gpu_available = self._processor.check_cuda_available()
        gpu_name = self._processor.get_gpu_name() if gpu_available else None
        torch_has_cuda = self._processor.check_torch_has_cuda() if gpu_available else False
        return json.dumps({
            "gpu_available": gpu_available,
            "gpu_name": gpu_name,
            "torch_has_cuda": torch_has_cuda,
        })

    def check_cuda_available(self):
        """Returns JSON bool of whether CUDA GPU is available."""
        return json.dumps(self._processor.check_cuda_available())

    def install_torch_cuda(self):
        """Install CUDA-enabled PyTorch. Runs in a thread, reports progress via JS."""
        threading.Thread(target=self._do_install_torch_cuda, daemon=True).start()

    def _do_install_torch_cuda(self):
        self._js_call("torchInstallStatus", "installing", "Installing CUDA PyTorch... this may take a few minutes.")
        try:
            from .config import PYTHON_EXE
            result = subprocess.run(
                [PYTHON_EXE, "-m", "pip", "install", "torch", "--index-url",
                 "https://download.pytorch.org/whl/cu121", "--quiet"],
                capture_output=True,
                text=True,
                timeout=600,
                creationflags=CREATE_NO_WINDOW,
            )
            if result.returncode == 0:
                self._js_call("torchInstallStatus", "success", "CUDA PyTorch installed! GPU acceleration is ready.")
            else:
                err = result.stderr.strip().split("\n")[-1] if result.stderr.strip() else "Unknown error"
                self._js_call("torchInstallStatus", "error", f"Install failed: {err}")
        except subprocess.TimeoutExpired:
            self._js_call("torchInstallStatus", "error", "Install timed out. Try running manually in a terminal.")
        except Exception as e:
            self._js_call("torchInstallStatus", "error", f"Install failed: {e}")

    # --- Settings ---

    def get_settings(self):
        """Return all settings as JSON."""
        return json.dumps(load_settings())

    def update_setting(self, key, value):
        """Update a single setting. Returns updated settings as JSON."""
        settings = set_setting(key, value)
        return json.dumps(settings)
