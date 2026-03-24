"""Tests for stem_splitter.api module — JS bridge, file picking, split workflow, MIDI, GPU."""

import json
import os
import tempfile
import pytest
from unittest.mock import MagicMock, patch, PropertyMock, call
from pathlib import Path

from stem_splitter.api import Api
from stem_splitter.processing import SplitCancelledError


@pytest.fixture
def mock_window():
    window = MagicMock()
    window.evaluate_js = MagicMock()
    window.create_file_dialog = MagicMock(return_value=None)
    return window


@pytest.fixture
def api(mock_window):
    window_ref = [mock_window]
    with patch("stem_splitter.api.DemucsProcessor"), \
         patch("stem_splitter.api.MidiConverter"):
        a = Api(window_ref)
    a._processor = MagicMock()
    a._midi_converter = MagicMock()
    return a


def get_js_calls(mock_window):
    """Extract all JS eval strings from the mock window."""
    return [c[0][0] for c in mock_window.evaluate_js.call_args_list]


# --- JS Bridge Safety ---

class TestJsBridge:
    def test_js_call_serializes_strings_safely(self, api, mock_window):
        """Ensure strings with quotes/special chars are properly escaped via json.dumps."""
        api._js_call("testFunc", "hello \"world\"")
        call_arg = mock_window.evaluate_js.call_args[0][0]
        assert 'testFunc("hello \\"world\\""' in call_arg

    def test_js_call_serializes_booleans(self, api, mock_window):
        api._js_call("testFunc", True, False)
        call_arg = mock_window.evaluate_js.call_args[0][0]
        assert "testFunc(true, false)" == call_arg

    def test_js_call_serializes_numbers(self, api, mock_window):
        api._js_call("testFunc", 42, 3.14)
        call_arg = mock_window.evaluate_js.call_args[0][0]
        assert "testFunc(42, 3.14)" == call_arg

    def test_js_call_escapes_injection_attempt(self, api, mock_window):
        malicious = '"); alert("xss"); //'
        api._js_call("testFunc", malicious)
        call_arg = mock_window.evaluate_js.call_args[0][0]
        expected = f"testFunc({json.dumps(malicious)})"
        assert call_arg == expected

    def test_js_call_handles_none(self, api, mock_window):
        api._js_call("testFunc", None)
        call_arg = mock_window.evaluate_js.call_args[0][0]
        assert "testFunc(null)" == call_arg

    def test_js_eval_failure_logged_not_raised(self, api, mock_window):
        """JS eval failures should be caught, not propagated."""
        mock_window.evaluate_js.side_effect = RuntimeError("window destroyed")
        # Should not raise
        api._js("console.log('test')")

    def test_js_call_with_list_arg(self, api, mock_window):
        api._js_call("testFunc", [1, 2, 3])
        call_arg = mock_window.evaluate_js.call_args[0][0]
        assert "testFunc([1, 2, 3])" == call_arg


# --- File Picking ---

class TestFilePicking:
    def test_pick_files_returns_none_when_cancelled(self, api, mock_window):
        mock_window.create_file_dialog.return_value = None
        result = api.pick_files()
        assert result is None

    def test_pick_files_returns_json(self, api, mock_window):
        mock_window.create_file_dialog.return_value = [
            "/music/song.mp3",
            "/music/other.wav",
        ]
        result = api.pick_files()
        parsed = json.loads(result)
        assert len(parsed) == 2
        assert parsed[0]["name"] == "song.mp3"
        assert parsed[0]["path"] == "/music/song.mp3"

    def test_pick_output_returns_none_when_cancelled(self, api, mock_window):
        mock_window.create_file_dialog.return_value = None
        result = api.pick_output()
        assert result is None

    def test_pick_output_returns_path(self, api, mock_window):
        mock_window.create_file_dialog.return_value = ["/music/output"]
        result = api.pick_output()
        assert result == "/music/output"
        assert api.default_output == "/music/output"

    def test_pick_output_updates_audio_server_dirs(self, api, mock_window):
        api._audio_server = MagicMock()
        api._audio_server.allowed_dirs = ["/existing"]
        mock_window.create_file_dialog.return_value = ["/new/output"]
        api.pick_output()
        assert "/new/output" in api._audio_server.allowed_dirs

    def test_pick_output_no_duplicate_audio_server_dir(self, api, mock_window):
        api._audio_server = MagicMock()
        api._audio_server.allowed_dirs = ["/existing"]
        mock_window.create_file_dialog.return_value = ["/existing"]
        api.pick_output()
        assert api._audio_server.allowed_dirs.count("/existing") == 1

    def test_get_default_output(self, api):
        result = api.get_default_output()
        assert isinstance(result, str)
        assert len(result) > 0


# --- Library Scanning ---

class TestScanLibrary:
    def test_scan_empty_output(self, api):
        api.default_output = "/nonexistent/path"
        result = json.loads(api.scan_library())
        assert result == []

    def test_scan_finds_stems(self, api):
        with tempfile.TemporaryDirectory() as tmpdir:
            api.default_output = tmpdir
            # Create htdemucs/song1 with stems
            stem_dir = Path(tmpdir) / "htdemucs" / "song1"
            stem_dir.mkdir(parents=True)
            for stem in ["vocals", "drums", "bass", "other"]:
                (stem_dir / f"{stem}.wav").write_bytes(b"fake")

            result = json.loads(api.scan_library())
            assert len(result) == 1
            assert result[0]["name"] == "song1"
            assert result[0]["model"] == "htdemucs"
            assert len(result[0]["stems"]) == 4

    def test_scan_finds_midi_files(self, api):
        with tempfile.TemporaryDirectory() as tmpdir:
            api.default_output = tmpdir
            stem_dir = Path(tmpdir) / "htdemucs" / "song1"
            stem_dir.mkdir(parents=True)
            (stem_dir / "vocals.wav").write_bytes(b"fake")
            (stem_dir / "vocals.mid").write_bytes(b"fake_midi")
            (stem_dir / "drums.wav").write_bytes(b"fake")

            result = json.loads(api.scan_library())
            stems = result[0]["stems"]
            vocals = next(s for s in stems if s["name"] == "vocals")
            drums = next(s for s in stems if s["name"] == "drums")
            assert "midiPath" in vocals
            assert "midiPath" not in drums

    def test_scan_ignores_non_directory_entries(self, api):
        with tempfile.TemporaryDirectory() as tmpdir:
            api.default_output = tmpdir
            model_dir = Path(tmpdir) / "htdemucs"
            model_dir.mkdir()
            # Create a file (not directory) inside model dir
            (model_dir / "not_a_song.txt").write_text("junk")

            result = json.loads(api.scan_library())
            assert result == []


# --- Split Workflow ---

class TestSplitWorkflow:
    def test_start_split_launches_thread(self, api):
        with patch("stem_splitter.api.threading.Thread") as mock_thread:
            mock_thread.return_value = MagicMock()
            api.start_split('["song.mp3"]', "htdemucs", "/output", "cpu")
            mock_thread.assert_called_once()
            mock_thread.return_value.start.assert_called_once()

    def test_cancel_split_delegates_to_processor(self, api):
        api.cancel_split()
        api._processor.cancel.assert_called_once()

    def test_run_split_success(self, api, mock_window):
        """Full successful split: calls JS progress and done callbacks."""
        api._processor.split.return_value = [
            {"name": "vocals", "path": "/out/htdemucs/song/vocals.wav"},
            {"name": "drums", "path": "/out/htdemucs/song/drums.wav"},
        ]

        api._run_split(["/music/song.mp3"], "htdemucs", "/out", "cpu")

        # Verify splitDone was called with success
        js_calls = get_js_calls(mock_window)
        assert any("splitDone(true" in c for c in js_calls)

    def test_run_split_cancelled(self, api, mock_window):
        api._processor.split.side_effect = SplitCancelledError("cancelled")

        api._run_split(["/music/song.mp3"], "htdemucs", "/out", "cpu")

        js_calls = get_js_calls(mock_window)
        assert any("splitDone(false" in c for c in js_calls)
        assert any("cancelled" in c.lower() for c in js_calls)

    def test_run_split_file_not_found(self, api, mock_window):
        api._processor.split.side_effect = FileNotFoundError("Demucs not found")

        api._run_split(["/music/song.mp3"], "htdemucs", "/out", "cpu")

        js_calls = get_js_calls(mock_window)
        assert any("splitDone(false" in c for c in js_calls)

    def test_run_split_runtime_error(self, api, mock_window):
        api._processor.split.side_effect = RuntimeError("GPU OOM")

        api._run_split(["/music/song.mp3"], "htdemucs", "/out", "cpu")

        js_calls = get_js_calls(mock_window)
        assert any("splitDone(false" in c for c in js_calls)

    def test_run_split_unexpected_error(self, api, mock_window):
        api._processor.split.side_effect = ValueError("unexpected")

        api._run_split(["/music/song.mp3"], "htdemucs", "/out", "cpu")

        js_calls = get_js_calls(mock_window)
        assert any("splitDone(false" in c for c in js_calls)
        assert any("Unexpected" in c for c in js_calls)

    def test_run_split_updates_audio_server_dirs(self, api, mock_window):
        api._audio_server = MagicMock()
        api._audio_server.allowed_dirs = []
        api._processor.split.return_value = []

        api._run_split(["/music/song.mp3"], "htdemucs", "/new/output", "cpu")

        assert "/new/output" in api._audio_server.allowed_dirs

    def test_run_split_multiple_files(self, api, mock_window):
        api._processor.split.return_value = [
            {"name": "vocals", "path": "/out/htdemucs/song/vocals.wav"},
        ]

        api._run_split(
            ["/music/song1.mp3", "/music/song2.mp3"],
            "htdemucs", "/out", "cpu"
        )

        # split should be called twice
        assert api._processor.split.call_count == 2
        js_calls = get_js_calls(mock_window)
        assert any("splitDone(true" in c for c in js_calls)


# --- MIDI Conversion ---

class TestMidiConversion:
    def test_get_midi_eligible_stems(self, api):
        result = json.loads(api.get_midi_eligible_stems())
        assert isinstance(result, list)
        assert "vocals" in result
        assert "drums" in result

    def test_convert_to_midi_launches_thread(self, api):
        with patch("stem_splitter.api.threading.Thread") as mock_thread:
            mock_thread.return_value = MagicMock()
            api.convert_to_midi("/path/vocals.wav", "vocals")
            mock_thread.assert_called_once()

    def test_run_midi_conversion_success(self, api, mock_window):
        api._midi_converter.check_installed.return_value = True
        api._midi_converter.convert.return_value = (
            "/path/vocals.mid",
            [[0.0, 0.5, 60], [0.5, 1.0, 62]]
        )

        api._run_midi_conversion("/path/vocals.wav", "vocals")

        js_calls = get_js_calls(mock_window)
        assert any("midiConvertDone" in c and "true" in c for c in js_calls)

    def test_run_midi_conversion_not_installed_installs(self, api, mock_window):
        api._midi_converter.check_installed.side_effect = [False, True]
        api._midi_converter.convert.return_value = ("/path/vocals.mid", [])

        with patch("stem_splitter.api.subprocess.run") as mock_run:
            mock_run.return_value = MagicMock(returncode=0)
            api._run_midi_conversion("/path/vocals.wav", "vocals")

        js_calls = get_js_calls(mock_window)
        assert any("midiConvertProgress" in c for c in js_calls)
        assert any("midiConvertDone" in c and "true" in c for c in js_calls)

    def test_run_midi_conversion_install_fails(self, api, mock_window):
        api._midi_converter.check_installed.return_value = False

        with patch("stem_splitter.api.subprocess.run") as mock_run:
            mock_run.return_value = MagicMock(returncode=0)
            api._run_midi_conversion("/path/vocals.wav", "vocals")

        js_calls = get_js_calls(mock_window)
        assert any("midiConvertDone" in c and "false" in c.lower() for c in js_calls)

    def test_run_midi_conversion_error(self, api, mock_window):
        api._midi_converter.check_installed.return_value = True
        api._midi_converter.convert.side_effect = RuntimeError("conversion failed")

        api._run_midi_conversion("/path/vocals.wav", "vocals")

        js_calls = get_js_calls(mock_window)
        assert any("midiConvertDone" in c and "false" in c.lower() for c in js_calls)

    def test_run_midi_conversion_file_not_found(self, api, mock_window):
        api._midi_converter.check_installed.return_value = True
        api._midi_converter.convert.side_effect = FileNotFoundError("file gone")

        api._run_midi_conversion("/path/vocals.wav", "vocals")

        js_calls = get_js_calls(mock_window)
        assert any("midiConvertDone" in c and "false" in c.lower() for c in js_calls)

    def test_load_midi_notes(self, api):
        api._midi_converter.read_notes.return_value = [[0.0, 0.5, 60]]
        result = json.loads(api.load_midi_notes("/path/vocals.mid"))
        assert len(result) == 1
        assert result[0] == [0.0, 0.5, 60]


# --- Startup Checks ---

class TestStartupChecks:
    def test_check_demucs_installed(self, api):
        api._processor.check_installed.return_value = True
        assert json.loads(api.check_demucs_installed()) is True

    def test_check_demucs_not_installed(self, api):
        api._processor.check_installed.return_value = False
        assert json.loads(api.check_demucs_installed()) is False

    def test_check_gpu_info_with_gpu(self, api):
        api._processor.check_cuda_available.return_value = True
        api._processor.get_gpu_name.return_value = "RTX 4090"
        api._processor.check_torch_has_cuda.return_value = True

        result = json.loads(api.check_gpu_info())
        assert result["gpu_available"] is True
        assert result["gpu_name"] == "RTX 4090"
        assert result["torch_has_cuda"] is True

    def test_check_gpu_info_no_gpu(self, api):
        api._processor.check_cuda_available.return_value = False

        result = json.loads(api.check_gpu_info())
        assert result["gpu_available"] is False
        assert result["gpu_name"] is None
        assert result["torch_has_cuda"] is False

    def test_check_cuda_available(self, api):
        api._processor.check_cuda_available.return_value = True
        assert json.loads(api.check_cuda_available()) is True


# --- Torch CUDA Install ---

class TestTorchCudaInstall:
    def test_install_launches_thread(self, api):
        with patch("stem_splitter.api.threading.Thread") as mock_thread:
            mock_thread.return_value = MagicMock()
            api.install_torch_cuda()
            mock_thread.assert_called_once()

    def test_do_install_torch_cuda_success(self, api, mock_window):
        with patch("stem_splitter.api.subprocess.run") as mock_run:
            mock_run.return_value = MagicMock(returncode=0)
            api._do_install_torch_cuda()

        js_calls = get_js_calls(mock_window)
        assert any("torchInstallStatus" in c and "success" in c for c in js_calls)

    def test_do_install_torch_cuda_failure(self, api, mock_window):
        with patch("stem_splitter.api.subprocess.run") as mock_run:
            mock_run.return_value = MagicMock(returncode=1, stderr="CUDA not found")
            api._do_install_torch_cuda()

        js_calls = get_js_calls(mock_window)
        assert any("torchInstallStatus" in c and "error" in c for c in js_calls)

    def test_do_install_torch_cuda_timeout(self, api, mock_window):
        import subprocess
        with patch("stem_splitter.api.subprocess.run") as mock_run:
            mock_run.side_effect = subprocess.TimeoutExpired(cmd="pip", timeout=600)
            api._do_install_torch_cuda()

        js_calls = get_js_calls(mock_window)
        assert any("torchInstallStatus" in c and "error" in c for c in js_calls)
        assert any("timed out" in c.lower() for c in js_calls)

    def test_do_install_torch_cuda_exception(self, api, mock_window):
        with patch("stem_splitter.api.subprocess.run") as mock_run:
            mock_run.side_effect = OSError("network error")
            api._do_install_torch_cuda()

        js_calls = get_js_calls(mock_window)
        assert any("torchInstallStatus" in c and "error" in c for c in js_calls)


# --- Misc ---

class TestMisc:
    def test_copy_to_clipboard(self, api, mock_window):
        api.copy_to_clipboard("some text")
        call_arg = mock_window.evaluate_js.call_args[0][0]
        assert "navigator.clipboard.writeText" in call_arg
        assert "some text" in call_arg

    @patch("stem_splitter.api.os.path.isdir", return_value=True)
    @patch("stem_splitter.api.os.startfile")
    def test_open_output_folder(self, mock_startfile, mock_isdir, api):
        api._last_stem_dir = "/output/stems"
        api.open_output_folder()
        mock_startfile.assert_called_once_with("/output/stems")

    @patch("stem_splitter.api.os.path.isfile", return_value=True)
    @patch("stem_splitter.api.subprocess.Popen")
    def test_open_file_location(self, mock_popen, mock_isfile, api):
        api.open_file_location("/path/to/file.mid")
        mock_popen.assert_called_once()


# --- Export Mix ---

class TestExportMix:
    def test_export_mix_launches_thread(self, api):
        with patch("stem_splitter.api.threading.Thread") as mock_thread:
            mock_thread.return_value = MagicMock()
            stems_json = json.dumps([
                {"path": "/out/vocals.wav", "volume": 100, "muted": False, "soloed": False},
            ])
            api.export_mix(stems_json, "/out/mix.wav")
            mock_thread.assert_called_once()
            mock_thread.return_value.start.assert_called_once()

    def test_run_export_mix_success(self, api, mock_window):
        import numpy as np

        fake_audio = np.zeros((44100, 2), dtype="float32")
        stems = [
            {"path": "/out/vocals.wav", "volume": 100, "muted": False, "soloed": False},
            {"path": "/out/drums.wav", "volume": 50, "muted": False, "soloed": False},
        ]

        with patch("stem_splitter.api.os.makedirs"), \
             patch("soundfile.read", return_value=(fake_audio, 44100)) as mock_read, \
             patch("soundfile.write") as mock_write:
            api._run_export_mix(stems, "/out/mix.wav")

        js_calls = get_js_calls(mock_window)
        assert any("exportMixDone" in c and "true" in c for c in js_calls)
        mock_write.assert_called_once()

    def test_run_export_mix_all_muted(self, api, mock_window):
        stems = [
            {"path": "/out/vocals.wav", "volume": 100, "muted": True, "soloed": False},
        ]

        api._run_export_mix(stems, "/out/mix.wav")

        js_calls = get_js_calls(mock_window)
        assert any("exportMixDone" in c and "false" in c.lower() for c in js_calls)
        assert any("muted" in c.lower() for c in js_calls)

    def test_run_export_mix_solo_filters(self, api, mock_window):
        import numpy as np

        fake_audio = np.zeros((44100, 2), dtype="float32")
        stems = [
            {"path": "/out/vocals.wav", "volume": 100, "muted": False, "soloed": True},
            {"path": "/out/drums.wav", "volume": 100, "muted": False, "soloed": False},
        ]

        with patch("stem_splitter.api.os.makedirs"), \
             patch("soundfile.read", return_value=(fake_audio, 44100)) as mock_read, \
             patch("soundfile.write") as mock_write:
            api._run_export_mix(stems, "/out/mix.wav")

        # Only vocals (soloed) should have been read
        assert mock_read.call_count == 1
        assert mock_read.call_args[0][0] == "/out/vocals.wav"

    def test_run_export_mix_missing_dependency(self, api, mock_window):
        stems = [{"path": "/out/vocals.wav", "volume": 100, "muted": False, "soloed": False}]

        with patch.dict("sys.modules", {"soundfile": None, "numpy": None}):
            # Force ImportError by patching the import inside the method
            with patch("builtins.__import__", side_effect=ImportError("No module named 'soundfile'")):
                api._run_export_mix(stems, "/out/mix.wav")

        js_calls = get_js_calls(mock_window)
        assert any("exportMixDone" in c and "false" in c.lower() for c in js_calls)

    def test_run_export_mix_read_error(self, api, mock_window):
        stems = [{"path": "/out/vocals.wav", "volume": 100, "muted": False, "soloed": False}]

        with patch("soundfile.read", side_effect=RuntimeError("corrupt file")), \
             patch("soundfile.write"):
            api._run_export_mix(stems, "/out/mix.wav")

        js_calls = get_js_calls(mock_window)
        assert any("exportMixDone" in c and "false" in c.lower() for c in js_calls)

    def test_run_export_mix_mono_audio(self, api, mock_window):
        """Mono stems should be converted to stereo."""
        import numpy as np

        mono_audio = np.zeros(44100, dtype="float32")
        stems = [
            {"path": "/out/vocals.wav", "volume": 100, "muted": False, "soloed": False},
        ]

        with patch("stem_splitter.api.os.makedirs"), \
             patch("soundfile.read", return_value=(mono_audio, 44100)), \
             patch("soundfile.write") as mock_write:
            api._run_export_mix(stems, "/out/mix.wav")

        # Output should be stereo (2 channels)
        written_data = mock_write.call_args[0][1]
        assert written_data.ndim == 2
        assert written_data.shape[1] == 2

    def test_run_export_mix_clipping_prevention(self, api, mock_window):
        """Audio exceeding 1.0 should be normalized."""
        import numpy as np

        loud_audio = np.full((44100, 2), 0.8, dtype="float32")
        stems = [
            {"path": "/out/vocals.wav", "volume": 100, "muted": False, "soloed": False},
            {"path": "/out/drums.wav", "volume": 100, "muted": False, "soloed": False},
        ]

        with patch("stem_splitter.api.os.makedirs"), \
             patch("soundfile.read", return_value=(loud_audio, 44100)), \
             patch("soundfile.write") as mock_write:
            api._run_export_mix(stems, "/out/mix.wav")

        written_data = mock_write.call_args[0][1]
        assert np.max(np.abs(written_data)) <= 1.0

    def test_run_export_mix_different_lengths(self, api, mock_window):
        """Stems of different lengths should be padded to match."""
        import numpy as np

        short_audio = np.zeros((22050, 2), dtype="float32")
        long_audio = np.zeros((44100, 2), dtype="float32")
        stems = [
            {"path": "/out/vocals.wav", "volume": 100, "muted": False, "soloed": False},
            {"path": "/out/drums.wav", "volume": 100, "muted": False, "soloed": False},
        ]

        def mock_read(path, **kwargs):
            if "vocals" in path:
                return short_audio, 44100
            return long_audio, 44100

        with patch("stem_splitter.api.os.makedirs"), \
             patch("soundfile.read", side_effect=mock_read), \
             patch("soundfile.write") as mock_write:
            api._run_export_mix(stems, "/out/mix.wav")

        written_data = mock_write.call_args[0][1]
        assert written_data.shape[0] == 44100  # Should match longer stem
