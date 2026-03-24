"""Audio file server with path validation security."""

import os
import logging
import threading
import urllib.parse
from http.server import SimpleHTTPRequestHandler
from pathlib import Path
from socketserver import ThreadingMixIn, TCPServer

from .config import ALLOWED_AUDIO_EXTENSIONS, MIME_TYPES, ASSETS_DIR, AUDIO_HOST

logger = logging.getLogger(__name__)

# File magic bytes for audio format validation (offset, bytes)
_MAGIC_BYTES = {
    ".wav": [(0, b"RIFF")],
    ".mp3": [(0, b"ID3"), (0, b"\xff\xfb"), (0, b"\xff\xf3"), (0, b"\xff\xf2")],
    ".flac": [(0, b"fLaC")],
    ".ogg": [(0, b"OggS")],
    ".m4a": [(4, b"ftyp")],
    ".aiff": [(0, b"FORM")],
    ".au": [(0, b".snd")],
    ".wma": [(0, b"\x30\x26\xb2\x75\x8e\x66\xcf\x11")],  # ASF header GUID
}


class AudioHandler(SimpleHTTPRequestHandler):
    """Serves audio files and static assets with path validation."""

    def _is_path_allowed(self, file_path):
        """Validate that file_path is within an allowed directory."""
        try:
            real = Path(os.path.realpath(file_path))
            allowed_dirs = getattr(self.server, "allowed_dirs", [])
            for d in allowed_dirs:
                allowed = Path(os.path.realpath(d))
                try:
                    real.relative_to(allowed)
                    return True
                except ValueError:
                    continue
            return False
        except (ValueError, OSError):
            return False

    @staticmethod
    def _validate_magic_bytes(file_path, ext):
        """Validate that a file's header matches expected magic bytes for its extension."""
        signatures = _MAGIC_BYTES.get(ext)
        if not signatures:
            return True  # no signature defined — allow (extension already validated)
        try:
            with open(file_path, "rb") as f:
                header = f.read(12)  # enough for all checks
            return any(
                len(header) > offset and header[offset:offset + len(magic)] == magic
                for offset, magic in signatures
            )
        except (OSError, IOError):
            return False

    def _send_cors_headers(self):
        """CORS is required because pywebview html= mode uses origin 'null',
        making requests to localhost cross-origin. Path validation on the
        server side is the actual security boundary."""
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Range")

    def do_OPTIONS(self):
        """Handle CORS preflight requests."""
        self.send_response(200)
        self._send_cors_headers()
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.end_headers()

    def do_GET(self):
        if self.path == "/logo.png":
            logo_path = ASSETS_DIR / "StemSplitterLogo.png"
            if logo_path.exists():
                self._serve_file(str(logo_path), "image/png")
            else:
                self.send_error(404)
        elif self.path == "/logo-light.png":
            logo_path = ASSETS_DIR / "StemSplitterLogoWhite.png"
            if logo_path.exists():
                self._serve_file(str(logo_path), "image/png")
            else:
                self.send_error(404)
        elif self.path.startswith("/audio?path="):
            query = self.path.split("?path=", 1)[1]
            file_path = urllib.parse.unquote(query)

            # Validate path is within allowed directories
            if not self._is_path_allowed(file_path):
                logger.warning("Blocked path traversal attempt: %s", file_path)
                self.send_error(403)
                return

            # Validate file extension
            ext = os.path.splitext(file_path)[1].lower()
            if ext not in ALLOWED_AUDIO_EXTENSIONS:
                self.send_error(403)
                return

            if os.path.isfile(file_path):
                if not self._validate_magic_bytes(file_path, ext):
                    logger.warning("File magic bytes mismatch for: %s", file_path)
                    self.send_error(403)
                    return
                ct = MIME_TYPES.get(ext, "application/octet-stream")
                self._serve_file(file_path, ct)
            else:
                self.send_error(404)
        else:
            self.send_error(404)

    def _serve_file(self, file_path, content_type):
        try:
            file_size = os.path.getsize(file_path)
            range_header = self.headers.get("Range")

            if range_header and range_header.startswith("bytes="):
                range_spec = range_header[6:]
                start_str, end_str = range_spec.split("-", 1)
                start = int(start_str) if start_str else 0
                end = int(end_str) if end_str else file_size - 1
                end = min(end, file_size - 1)
                length = end - start + 1

                self.send_response(206)
                self.send_header("Content-Type", content_type)
                self._send_cors_headers()
                self.send_header("Accept-Ranges", "bytes")
                self.send_header("Content-Range", f"bytes {start}-{end}/{file_size}")
                self.send_header("Content-Length", str(length))
                self.end_headers()

                with open(file_path, "rb") as f:
                    f.seek(start)
                    remaining = length
                    while remaining > 0:
                        chunk = f.read(min(65536, remaining))
                        if not chunk:
                            break
                        self.wfile.write(chunk)
                        remaining -= len(chunk)
            else:
                self.send_response(200)
                self.send_header("Content-Type", content_type)
                self._send_cors_headers()
                self.send_header("Accept-Ranges", "bytes")
                self.send_header("Content-Length", str(file_size))
                self.end_headers()
                with open(file_path, "rb") as f:
                    while chunk := f.read(65536):
                        self.wfile.write(chunk)
        except (ConnectionResetError, ConnectionAbortedError, BrokenPipeError):
            pass

    def log_message(self, *args):
        pass


class ThreadingHTTPServer(ThreadingMixIn, TCPServer):
    allow_reuse_address = True
    daemon_threads = True

    def __init__(self, server_address, handler_class, allowed_dirs=None):
        self.allowed_dirs = allowed_dirs or []
        super().__init__(server_address, handler_class)


def start_audio_server(port, allowed_dirs=None):
    """Start the audio file server on the given port. Returns the server instance."""
    dirs = allowed_dirs or []
    server = ThreadingHTTPServer((AUDIO_HOST, port), AudioHandler, allowed_dirs=dirs)
    t = threading.Thread(target=server.serve_forever, daemon=True)
    t.start()
    return server
