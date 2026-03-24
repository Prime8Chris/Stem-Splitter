"""Integration tests — real subprocess spawning, concurrent operations, error recovery."""

import json
import os
import sys
import subprocess
import tempfile
import threading
import time
import pytest

from stem_splitter.config import PYTHON_EXE
from stem_splitter.processing import DemucsProcessor, MidiConverter, SplitCancelledError
from stem_splitter.server import AudioHandler, start_audio_server
from stem_splitter.config import find_free_port


class TestRealSubprocess:
    """Tests that actually spawn subprocesses (no mocking)."""

    def test_python_exe_is_valid(self):
        """Verify PYTHON_EXE can actually run Python code."""
        result = subprocess.run(
            [PYTHON_EXE, "-c", "print('hello')"],
            capture_output=True, text=True, timeout=10,
        )
        assert result.returncode == 0
        assert result.stdout.strip() == "hello"

    def test_demucs_check_installed_real(self):
        """check_installed() runs a real subprocess — should not crash."""
        proc = DemucsProcessor()
        # Result depends on environment, but should not raise
        result = proc.check_installed()
        assert isinstance(result, bool)

    def test_midi_check_installed_real(self):
        """check_installed() runs a real subprocess — should not crash."""
        conv = MidiConverter()
        result = conv.check_installed()
        assert isinstance(result, bool)

    def test_midi_convert_script_syntax_valid(self):
        """Verify the inline conversion script has valid Python syntax."""
        result = subprocess.run(
            [PYTHON_EXE, "-c", f"import ast; ast.parse({MidiConverter._CONVERT_SCRIPT!r})"],
            capture_output=True, text=True, timeout=10,
        )
        assert result.returncode == 0, f"Syntax error in convert script: {result.stderr}"

    def test_midi_read_notes_script_syntax_valid(self):
        """Verify the inline read_notes script has valid Python syntax."""
        result = subprocess.run(
            [PYTHON_EXE, "-c", f"import ast; ast.parse({MidiConverter._READ_NOTES_SCRIPT!r})"],
            capture_output=True, text=True, timeout=10,
        )
        assert result.returncode == 0, f"Syntax error in read_notes script: {result.stderr}"

    def test_midi_read_notes_nonexistent_file(self):
        """read_notes on a nonexistent file returns empty list without crashing."""
        conv = MidiConverter()
        result = conv.read_notes("/nonexistent/file.mid")
        assert result == []

    def test_gpu_detection_real(self):
        """GPU detection runs real subprocesses — should not crash regardless of hardware."""
        proc = DemucsProcessor()
        cuda = proc.check_cuda_available()
        assert isinstance(cuda, bool)
        name = proc.get_gpu_name()
        assert name is None or isinstance(name, str)
        has_cuda = proc.check_torch_has_cuda()
        assert isinstance(has_cuda, bool)


class TestConcurrentOperations:
    """Tests for concurrent access patterns."""

    def test_concurrent_library_scan(self):
        """Multiple concurrent scan_library calls should not deadlock."""
        from stem_splitter.api import Api
        from unittest.mock import MagicMock

        window = MagicMock()
        window_ref = [window]
        api = Api(window_ref)

        with tempfile.TemporaryDirectory() as tmpdir:
            api.default_output = tmpdir
            results = []
            errors = []

            def scan():
                try:
                    r = api.scan_library()
                    results.append(json.loads(r))
                except Exception as e:
                    errors.append(e)

            threads = [threading.Thread(target=scan) for _ in range(5)]
            for t in threads:
                t.start()
            for t in threads:
                t.join(timeout=10)

            assert len(errors) == 0, f"Errors during concurrent scan: {errors}"
            assert len(results) == 5
            # All should return the same (empty) result
            for r in results:
                assert r == []

    def test_cancel_before_split_starts(self):
        """Cancelling before split starts should not crash."""
        proc = DemucsProcessor()
        proc.cancel()
        assert proc._cancelled is True
        # Cancellation flag resets on next split call (tested via mock elsewhere)

    def test_rapid_cancel_calls(self):
        """Multiple rapid cancel calls should not crash."""
        proc = DemucsProcessor()
        for _ in range(10):
            proc.cancel()
        assert proc._cancelled is True


class TestAudioServerIntegration:
    """Integration tests for the audio server serving real files."""

    def test_serve_real_wav_file(self):
        """Server can serve a real WAV file and return correct headers."""
        import urllib.request

        with tempfile.TemporaryDirectory() as tmpdir:
            wav_path = os.path.join(tmpdir, "test.wav")
            # Write a minimal valid WAV header
            with open(wav_path, "wb") as f:
                f.write(b"RIFF")
                f.write((36).to_bytes(4, "little"))  # file size - 8
                f.write(b"WAVE")
                f.write(b"fmt ")
                f.write((16).to_bytes(4, "little"))   # chunk size
                f.write((1).to_bytes(2, "little"))     # PCM
                f.write((1).to_bytes(2, "little"))     # mono
                f.write((44100).to_bytes(4, "little")) # sample rate
                f.write((44100).to_bytes(4, "little")) # byte rate
                f.write((1).to_bytes(2, "little"))     # block align
                f.write((8).to_bytes(2, "little"))     # bits per sample
                f.write(b"data")
                f.write((0).to_bytes(4, "little"))     # data size

            port = find_free_port()
            server = start_audio_server(port, allowed_dirs=[tmpdir])

            try:
                url = f"http://127.0.0.1:{port}/audio?path={urllib.parse.quote(wav_path)}"
                req = urllib.request.Request(url)
                with urllib.request.urlopen(req, timeout=5) as resp:
                    assert resp.status == 200
                    assert "audio/wav" in resp.headers.get("Content-Type", "")
                    data = resp.read()
                    assert data[:4] == b"RIFF"
            finally:
                server.shutdown()

    def test_server_blocks_traversal_real(self):
        """Server blocks path traversal attempts on a real running server."""
        import urllib.request
        import urllib.error

        with tempfile.TemporaryDirectory() as tmpdir:
            port = find_free_port()
            server = start_audio_server(port, allowed_dirs=[tmpdir])

            try:
                # Try to access a file outside the allowed dir
                traversal = os.path.join(tmpdir, "..", "..", "etc", "passwd")
                url = f"http://127.0.0.1:{port}/audio?path={urllib.parse.quote(traversal)}"
                with pytest.raises(urllib.error.HTTPError) as exc_info:
                    urllib.request.urlopen(url, timeout=5)
                assert exc_info.value.code in (403, 404)
            finally:
                server.shutdown()

    def test_server_blocks_bad_magic_bytes_real(self):
        """Server blocks files with wrong magic bytes on a real running server."""
        import urllib.request
        import urllib.error

        with tempfile.TemporaryDirectory() as tmpdir:
            # Write a file with .wav extension but wrong content
            fake_wav = os.path.join(tmpdir, "fake.wav")
            with open(fake_wav, "wb") as f:
                f.write(b"NOT_A_REAL_WAV_FILE" + b"\x00" * 100)

            port = find_free_port()
            server = start_audio_server(port, allowed_dirs=[tmpdir])

            try:
                url = f"http://127.0.0.1:{port}/audio?path={urllib.parse.quote(fake_wav)}"
                with pytest.raises(urllib.error.HTTPError) as exc_info:
                    urllib.request.urlopen(url, timeout=5)
                assert exc_info.value.code == 403
            finally:
                server.shutdown()


class TestErrorRecovery:
    """Tests for error recovery and edge cases."""

    def test_split_with_nonexistent_file(self):
        """split() with a file that doesn't exist raises an error or returns empty stems."""
        proc = DemucsProcessor()
        # Demucs may raise FileNotFoundError, RuntimeError, or succeed with empty stems
        # depending on whether demucs is installed. The key is it shouldn't hang.
        try:
            result = proc.split(
                "/nonexistent/audio.wav", "htdemucs",
                tempfile.gettempdir(), device="cpu",
            )
            # If it didn't raise, stems should be empty (no output files)
            assert isinstance(result, list)
        except (FileNotFoundError, RuntimeError, OSError):
            pass  # expected

    def test_midi_convert_nonexistent_wav(self):
        """convert() with nonexistent file raises FileNotFoundError."""
        conv = MidiConverter()
        with pytest.raises(FileNotFoundError):
            conv.convert("/nonexistent/file.wav")

    def test_settings_roundtrip(self):
        """Settings can be saved and loaded back correctly."""
        import stem_splitter.settings as settings_mod
        from stem_splitter.settings import save_settings, load_settings, DEFAULTS

        with tempfile.TemporaryDirectory() as tmpdir:
            test_file = os.path.join(tmpdir, "test_settings.json")
            backup_file = os.path.join(tmpdir, "test_settings.json.bak")

            # Patch file paths
            from pathlib import Path
            orig_file = settings_mod.SETTINGS_FILE
            orig_backup = settings_mod.SETTINGS_BACKUP
            settings_mod.SETTINGS_FILE = Path(test_file)
            settings_mod.SETTINGS_BACKUP = Path(backup_file)
            settings_mod._cache = None

            try:
                # Save custom settings
                save_settings({"theme": "light", "high_contrast": True})

                # Clear cache and reload
                settings_mod._cache = None
                loaded = load_settings()
                assert loaded["theme"] == "light"
                assert loaded["high_contrast"] is True

                # Verify backup was created on second save
                save_settings({"theme": "system", "high_contrast": False})
                assert os.path.exists(backup_file)

                # Corrupt the main file
                Path(test_file).write_text("corrupt{{", encoding="utf-8")
                settings_mod._cache = None

                # Should fall back to backup
                loaded = load_settings()
                assert loaded["theme"] == "light"  # from backup (first save)
            finally:
                settings_mod.SETTINGS_FILE = orig_file
                settings_mod.SETTINGS_BACKUP = orig_backup
                settings_mod._cache = None
