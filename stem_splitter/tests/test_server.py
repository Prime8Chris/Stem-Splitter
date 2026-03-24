"""Tests for stem_splitter.server module — path validation, range requests, MIME types."""

import os
import tempfile
import pytest
from unittest.mock import MagicMock, patch
from io import BytesIO
from http.server import HTTPServer

from stem_splitter.server import AudioHandler, ThreadingHTTPServer, start_audio_server
from stem_splitter.config import find_free_port


@pytest.fixture
def temp_audio_dir():
    """Create a temp directory with a fake audio file."""
    with tempfile.TemporaryDirectory() as tmpdir:
        wav_path = os.path.join(tmpdir, "test.wav")
        with open(wav_path, "wb") as f:
            f.write(b"RIFF" + b"\x00" * 100)  # Fake WAV header
        yield tmpdir, wav_path


@pytest.fixture
def handler_with_dirs(temp_audio_dir):
    """Create a mock AudioHandler with allowed_dirs set."""
    tmpdir, wav_path = temp_audio_dir

    # Create a mock server with allowed_dirs
    mock_server = MagicMock()
    mock_server.allowed_dirs = [tmpdir]

    handler = AudioHandler.__new__(AudioHandler)
    handler.server = mock_server
    return handler, tmpdir, wav_path


class TestPathValidation:
    def test_allowed_path_within_dir(self, handler_with_dirs):
        handler, tmpdir, wav_path = handler_with_dirs
        assert handler._is_path_allowed(wav_path) is True

    def test_blocked_path_outside_dir(self, handler_with_dirs):
        handler, tmpdir, wav_path = handler_with_dirs
        assert handler._is_path_allowed("/etc/passwd") is False
        assert handler._is_path_allowed("C:\\Windows\\System32\\cmd.exe") is False

    def test_blocked_path_traversal(self, handler_with_dirs):
        handler, tmpdir, wav_path = handler_with_dirs
        traversal_path = os.path.join(tmpdir, "..", "..", "etc", "passwd")
        assert handler._is_path_allowed(traversal_path) is False

    def test_empty_allowed_dirs(self, temp_audio_dir):
        tmpdir, wav_path = temp_audio_dir
        mock_server = MagicMock()
        mock_server.allowed_dirs = []

        handler = AudioHandler.__new__(AudioHandler)
        handler.server = mock_server
        assert handler._is_path_allowed(wav_path) is False

    def test_no_allowed_dirs_attr(self, temp_audio_dir):
        tmpdir, wav_path = temp_audio_dir
        mock_server = MagicMock(spec=[])  # No attributes

        handler = AudioHandler.__new__(AudioHandler)
        handler.server = mock_server
        assert handler._is_path_allowed(wav_path) is False


class TestServerInit:
    def test_allowed_dirs_stored(self, temp_audio_dir):
        tmpdir, _ = temp_audio_dir
        port = find_free_port()
        server = ThreadingHTTPServer(
            ("127.0.0.1", port), AudioHandler, allowed_dirs=[tmpdir]
        )
        assert server.allowed_dirs == [tmpdir]
        server.server_close()

    def test_default_allowed_dirs_empty(self):
        port = find_free_port()
        server = ThreadingHTTPServer(
            ("127.0.0.1", port), AudioHandler
        )
        assert server.allowed_dirs == []
        server.server_close()


class TestMagicByteValidation:
    def test_valid_wav_header(self, temp_audio_dir):
        tmpdir, wav_path = temp_audio_dir
        assert AudioHandler._validate_magic_bytes(wav_path, ".wav") is True

    def test_invalid_wav_header(self):
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
            f.write(b"NOT_RIFF" + b"\x00" * 100)
            path = f.name
        try:
            assert AudioHandler._validate_magic_bytes(path, ".wav") is False
        finally:
            os.unlink(path)

    def test_valid_mp3_id3_header(self):
        with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as f:
            f.write(b"ID3" + b"\x00" * 100)
            path = f.name
        try:
            assert AudioHandler._validate_magic_bytes(path, ".mp3") is True
        finally:
            os.unlink(path)

    def test_valid_mp3_sync_header(self):
        with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as f:
            f.write(b"\xff\xfb" + b"\x00" * 100)
            path = f.name
        try:
            assert AudioHandler._validate_magic_bytes(path, ".mp3") is True
        finally:
            os.unlink(path)

    def test_valid_flac_header(self):
        with tempfile.NamedTemporaryFile(suffix=".flac", delete=False) as f:
            f.write(b"fLaC" + b"\x00" * 100)
            path = f.name
        try:
            assert AudioHandler._validate_magic_bytes(path, ".flac") is True
        finally:
            os.unlink(path)

    def test_valid_ogg_header(self):
        with tempfile.NamedTemporaryFile(suffix=".ogg", delete=False) as f:
            f.write(b"OggS" + b"\x00" * 100)
            path = f.name
        try:
            assert AudioHandler._validate_magic_bytes(path, ".ogg") is True
        finally:
            os.unlink(path)

    def test_nonexistent_file(self):
        assert AudioHandler._validate_magic_bytes("/nonexistent/file.wav", ".wav") is False

    def test_unknown_extension_passes(self):
        with tempfile.NamedTemporaryFile(suffix=".xyz", delete=False) as f:
            f.write(b"anything")
            path = f.name
        try:
            assert AudioHandler._validate_magic_bytes(path, ".xyz") is True
        finally:
            os.unlink(path)

    def test_empty_file_fails(self):
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
            path = f.name
        try:
            assert AudioHandler._validate_magic_bytes(path, ".wav") is False
        finally:
            os.unlink(path)

    def test_valid_wma_header(self):
        with tempfile.NamedTemporaryFile(suffix=".wma", delete=False) as f:
            # ASF header GUID: 30 26 B2 75 8E 66 CF 11
            f.write(b"\x30\x26\xb2\x75\x8e\x66\xcf\x11" + b"\x00" * 100)
            path = f.name
        try:
            assert AudioHandler._validate_magic_bytes(path, ".wma") is True
        finally:
            os.unlink(path)

    def test_invalid_wma_header(self):
        with tempfile.NamedTemporaryFile(suffix=".wma", delete=False) as f:
            f.write(b"NOT_A_WMA_FILE" + b"\x00" * 100)
            path = f.name
        try:
            assert AudioHandler._validate_magic_bytes(path, ".wma") is False
        finally:
            os.unlink(path)


class TestStartServer:
    def test_start_returns_server(self, temp_audio_dir):
        tmpdir, _ = temp_audio_dir
        port = find_free_port()
        server = start_audio_server(port, allowed_dirs=[tmpdir])
        assert server is not None
        assert hasattr(server, "allowed_dirs")
        server.shutdown()
