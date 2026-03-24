"""Tests for stem_splitter.processing module — progress parsing, error handling, commands, MIDI."""

import json
import os
import re
import tempfile
import pytest
from unittest.mock import MagicMock, patch, PropertyMock
from pathlib import Path

from stem_splitter.processing import DemucsProcessor, SplitCancelledError, MidiConverter
from stem_splitter.config import MODELS, PYTHON_EXE


class TestProgressParsing:
    """Test the regex used to parse Demucs progress output."""

    def test_matches_percentage(self):
        line = "  5%|█         | 1/20 [00:01<00:19, 1.00s/it]"
        match = re.search(r"(\d+)%\|", line)
        assert match is not None
        assert int(match.group(1)) == 5

    def test_matches_100_percent(self):
        line = "100%|██████████| 20/20 [00:20<00:00, 1.00s/it]"
        match = re.search(r"(\d+)%\|", line)
        assert match is not None
        assert int(match.group(1)) == 100

    def test_no_match_on_error(self):
        line = "Error: file not found"
        match = re.search(r"(\d+)%\|", line)
        assert match is None

    def test_no_match_on_empty(self):
        line = ""
        match = re.search(r"(\d+)%\|", line)
        assert match is None


class TestDemucsProcessor:
    def test_initial_state(self):
        proc = DemucsProcessor()
        assert proc.is_running is False
        assert proc._cancelled is False

    def test_cancel_sets_flag(self):
        proc = DemucsProcessor()
        proc.cancel()
        assert proc._cancelled is True

    def test_unknown_model_raises(self):
        proc = DemucsProcessor()
        with pytest.raises(ValueError, match="Unknown model"):
            proc.split("fake.mp3", "nonexistent_model", "/tmp/out")

    @patch("stem_splitter.processing.subprocess.Popen")
    def test_file_not_found_raises(self, mock_popen):
        mock_popen.side_effect = FileNotFoundError()
        proc = DemucsProcessor()
        with pytest.raises(FileNotFoundError, match="Demucs not found"):
            proc.split("test.mp3", "htdemucs", "/tmp/out")

    @patch("stem_splitter.processing.subprocess.Popen")
    def test_nonzero_exit_raises_runtime_error(self, mock_popen):
        mock_process = MagicMock()
        mock_process.stdout = iter(["Some error output\n"])
        mock_process.wait.return_value = None
        mock_process.returncode = 1
        mock_process.poll.return_value = None
        mock_popen.return_value = mock_process

        proc = DemucsProcessor()
        with pytest.raises(RuntimeError):
            proc.split("test.mp3", "htdemucs", "/tmp/out")

    @patch("stem_splitter.processing.subprocess.Popen")
    def test_cancel_during_processing_raises(self, mock_popen):
        def fake_stdout():
            yield "  5%|█         | 1/20\n"
            proc.cancel()  # Cancel mid-stream
            yield " 10%|██        | 2/20\n"

        mock_process = MagicMock()
        mock_process.stdout = fake_stdout()
        mock_process.poll.return_value = None
        mock_process.terminate = MagicMock()
        mock_popen.return_value = mock_process

        proc = DemucsProcessor()
        with pytest.raises(SplitCancelledError):
            proc.split("test.mp3", "htdemucs", "/tmp/out")
        mock_process.terminate.assert_called()

    @patch("stem_splitter.processing.subprocess.Popen")
    def test_successful_split_returns_stems(self, mock_popen):
        with tempfile.TemporaryDirectory() as tmpdir:
            # Create fake stem output files
            model = "htdemucs"
            song_name = "test"
            stem_dir = Path(tmpdir) / model / song_name
            stem_dir.mkdir(parents=True)
            for stem_name in MODELS[model]["stems"]:
                (stem_dir / f"{stem_name}.wav").write_bytes(b"fake")

            mock_process = MagicMock()
            mock_process.stdout = iter([" 50%|█████     | 10/20\n", "100%|██████████| 20/20\n"])
            mock_process.wait.return_value = None
            mock_process.returncode = 0
            mock_process.poll.return_value = None
            mock_popen.return_value = mock_process

            proc = DemucsProcessor()
            progress_calls = []
            stems = proc.split(
                "test.mp3", model, tmpdir,
                on_progress=lambda pct, status: progress_calls.append(pct)
            )

            assert len(stems) == 4
            assert stems[0]["name"] == "vocals"
            assert len(progress_calls) == 2


class TestCheckMethods:
    @patch("stem_splitter.processing.subprocess.run")
    def test_check_installed_true(self, mock_run):
        mock_run.return_value = MagicMock(returncode=0)
        proc = DemucsProcessor()
        assert proc.check_installed() is True

    @patch("stem_splitter.processing.subprocess.run")
    def test_check_installed_false(self, mock_run):
        mock_run.return_value = MagicMock(returncode=1)
        proc = DemucsProcessor()
        assert proc.check_installed() is False

    @patch("stem_splitter.processing.subprocess.run")
    def test_check_cuda_true_via_torch(self, mock_run):
        mock_run.return_value = MagicMock(returncode=0, stdout="True\n")
        proc = DemucsProcessor()
        assert proc.check_cuda_available() is True

    @patch("stem_splitter.processing.subprocess.run")
    def test_check_cuda_false_no_gpu(self, mock_run):
        """Both torch check and nvidia-smi fail → no GPU."""
        mock_run.return_value = MagicMock(returncode=1, stdout="")
        proc = DemucsProcessor()
        assert proc.check_cuda_available() is False

    @patch("stem_splitter.processing.subprocess.run")
    def test_check_cuda_true_via_nvidia_smi(self, mock_run):
        """torch says False but nvidia-smi finds a GPU → True."""
        def side_effect(cmd, **kwargs):
            if "nvidia-smi" in cmd:
                return MagicMock(returncode=0, stdout="NVIDIA GeForce RTX 4090\n")
            return MagicMock(returncode=0, stdout="False\n")
        mock_run.side_effect = side_effect
        proc = DemucsProcessor()
        assert proc.check_cuda_available() is True

    @patch("stem_splitter.processing.subprocess.run")
    def test_get_gpu_name(self, mock_run):
        mock_run.return_value = MagicMock(returncode=0, stdout="NVIDIA GeForce RTX 4090\n")
        proc = DemucsProcessor()
        assert proc.get_gpu_name() == "NVIDIA GeForce RTX 4090"

    @patch("stem_splitter.processing.subprocess.run")
    def test_check_torch_has_cuda_true(self, mock_run):
        mock_run.return_value = MagicMock(returncode=0, stdout="12.1\n")
        proc = DemucsProcessor()
        assert proc.check_torch_has_cuda() is True

    @patch("stem_splitter.processing.subprocess.run")
    def test_check_torch_has_cuda_false(self, mock_run):
        mock_run.return_value = MagicMock(returncode=0, stdout="None\n")
        proc = DemucsProcessor()
        assert proc.check_torch_has_cuda() is False


class TestMidiConverter:
    """Tests for MidiConverter — convert, read_notes, check_installed."""

    @patch("stem_splitter.processing.subprocess.Popen")
    def test_convert_success(self, mock_popen):
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
            f.write(b"RIFF" + b"\x00" * 100)
            wav_path = f.name

        try:
            lines = [
                json.dumps({"stage": "loading", "pct": 10}) + "\n",
                json.dumps({"stage": "analyzing", "pct": 25}) + "\n",
                json.dumps({
                    "ok": True,
                    "path": wav_path.replace(".wav", ".mid"),
                    "notes": [[0.0, 0.5, 60], [0.5, 1.0, 62]]
                }) + "\n",
            ]
            mock_process = MagicMock()
            mock_process.stdout = iter(lines)
            mock_process.wait.return_value = 0
            mock_popen.return_value = mock_process

            converter = MidiConverter()
            midi_path, notes = converter.convert(wav_path)
            assert midi_path.endswith(".mid")
            assert len(notes) == 2
            assert notes[0] == [0.0, 0.5, 60]
        finally:
            os.unlink(wav_path)

    def test_convert_file_not_found(self):
        converter = MidiConverter()
        with pytest.raises(FileNotFoundError):
            converter.convert("/nonexistent/file.wav")

    @patch("stem_splitter.processing.subprocess.Popen")
    def test_convert_runtime_error(self, mock_popen):
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
            f.write(b"RIFF" + b"\x00" * 100)
            wav_path = f.name

        try:
            lines = [json.dumps({"ok": False, "error": "TensorFlow failed"}) + "\n"]
            mock_process = MagicMock()
            mock_process.stdout = iter(lines)
            mock_process.wait.return_value = 0
            mock_popen.return_value = mock_process

            converter = MidiConverter()
            with pytest.raises(RuntimeError, match="TensorFlow failed"):
                converter.convert(wav_path)
        finally:
            os.unlink(wav_path)

    @patch("stem_splitter.processing.subprocess.Popen")
    def test_convert_no_output(self, mock_popen):
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
            f.write(b"RIFF" + b"\x00" * 100)
            wav_path = f.name

        try:
            mock_process = MagicMock()
            mock_process.stdout = iter([])
            mock_process.wait.return_value = 0
            mock_popen.return_value = mock_process

            converter = MidiConverter()
            with pytest.raises(RuntimeError, match="no output"):
                converter.convert(wav_path)
        finally:
            os.unlink(wav_path)

    @patch("stem_splitter.processing.subprocess.Popen")
    def test_convert_calls_on_progress(self, mock_popen):
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
            f.write(b"RIFF" + b"\x00" * 100)
            wav_path = f.name

        try:
            lines = [
                json.dumps({"stage": "loading", "pct": 10}) + "\n",
                json.dumps({"stage": "analyzing", "pct": 25}) + "\n",
                json.dumps({"ok": True, "path": "test.mid", "notes": []}) + "\n",
            ]
            mock_process = MagicMock()
            mock_process.stdout = iter(lines)
            mock_process.wait.return_value = 0
            mock_popen.return_value = mock_process

            progress_calls = []
            converter = MidiConverter()
            converter.convert(wav_path, on_progress=lambda s, p: progress_calls.append((s, p)))
            assert len(progress_calls) >= 3  # initial + loading + analyzing
            assert progress_calls[0] == ("Starting MIDI conversion...", 5)
            assert progress_calls[1] == ("Loading model...", 10)
            assert progress_calls[2] == ("Analyzing audio...", 25)
        finally:
            os.unlink(wav_path)

    @patch("stem_splitter.processing.subprocess.run")
    def test_read_notes_success(self, mock_run):
        with tempfile.NamedTemporaryFile(suffix=".mid", delete=False) as f:
            f.write(b"\x00" * 50)
            midi_path = f.name

        try:
            result_json = json.dumps({"ok": True, "notes": [[0.0, 0.5, 60]]})
            mock_run.return_value = MagicMock(
                returncode=0,
                stdout=result_json + "\n"
            )

            converter = MidiConverter()
            notes = converter.read_notes(midi_path)
            assert len(notes) == 1
            assert notes[0] == [0.0, 0.5, 60]
        finally:
            os.unlink(midi_path)

    def test_read_notes_file_not_found(self):
        converter = MidiConverter()
        result = converter.read_notes("/nonexistent/file.mid")
        assert result == []

    @patch("stem_splitter.processing.subprocess.run")
    def test_read_notes_parse_error(self, mock_run):
        with tempfile.NamedTemporaryFile(suffix=".mid", delete=False) as f:
            f.write(b"\x00" * 50)
            midi_path = f.name

        try:
            mock_run.return_value = MagicMock(returncode=0, stdout="not json\n")

            converter = MidiConverter()
            notes = converter.read_notes(midi_path)
            assert notes == []
        finally:
            os.unlink(midi_path)

    @patch("stem_splitter.processing.subprocess.run")
    def test_read_notes_subprocess_error(self, mock_run):
        with tempfile.NamedTemporaryFile(suffix=".mid", delete=False) as f:
            f.write(b"\x00" * 50)
            midi_path = f.name

        try:
            mock_run.side_effect = OSError("process failed")

            converter = MidiConverter()
            notes = converter.read_notes(midi_path)
            assert notes == []
        finally:
            os.unlink(midi_path)

    @patch("stem_splitter.processing.subprocess.run")
    def test_check_installed_true(self, mock_run):
        mock_run.return_value = MagicMock(returncode=0)
        converter = MidiConverter()
        assert converter.check_installed() is True

    @patch("stem_splitter.processing.subprocess.run")
    def test_check_installed_false(self, mock_run):
        mock_run.return_value = MagicMock(returncode=1)
        converter = MidiConverter()
        assert converter.check_installed() is False

    @patch("stem_splitter.processing.subprocess.run")
    def test_check_installed_exception(self, mock_run):
        mock_run.side_effect = OSError("not found")
        converter = MidiConverter()
        assert converter.check_installed() is False
