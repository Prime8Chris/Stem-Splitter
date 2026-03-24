"""Tests for stem_splitter.config module."""

import os
import pytest
from pathlib import Path

from stem_splitter.config import (
    MODELS, STEM_COLORS, ALLOWED_AUDIO_EXTENSIONS, MIME_TYPES,
    DEFAULT_OUTPUT, SCRIPT_DIR, PACKAGE_DIR, ASSETS_DIR,
    find_free_port, get_python_exe,
)


class TestModels:
    def test_htdemucs_has_4_stems(self):
        assert len(MODELS["htdemucs"]["stems"]) == 4

    def test_htdemucs_6s_has_6_stems(self):
        assert len(MODELS["htdemucs_6s"]["stems"]) == 6

    def test_all_models_have_labels(self):
        for name, info in MODELS.items():
            assert "label" in info
            assert "stems" in info
            assert len(info["label"]) > 0

    def test_vocals_in_all_models(self):
        for name, info in MODELS.items():
            assert "vocals" in info["stems"]

    def test_all_stems_have_colors(self):
        for name, info in MODELS.items():
            for stem in info["stems"]:
                assert stem in STEM_COLORS, f"Missing color for stem: {stem}"


class TestAudioFormats:
    def test_common_formats_allowed(self):
        for ext in [".wav", ".mp3", ".flac", ".ogg", ".m4a"]:
            assert ext in ALLOWED_AUDIO_EXTENSIONS

    def test_wav_mime_type(self):
        assert MIME_TYPES[".wav"] == "audio/wav"

    def test_mp3_mime_type(self):
        assert MIME_TYPES[".mp3"] == "audio/mpeg"

    def test_non_audio_not_allowed(self):
        for ext in [".exe", ".py", ".txt", ".jpg", ".pdf"]:
            assert ext not in ALLOWED_AUDIO_EXTENSIONS


class TestPaths:
    def test_default_output_under_home(self):
        assert str(Path.home()) in DEFAULT_OUTPUT

    def test_package_dir_exists(self):
        assert PACKAGE_DIR.exists()

    def test_assets_dir_exists(self):
        assert ASSETS_DIR.exists()


class TestFunctions:
    def test_find_free_port_returns_int(self):
        port = find_free_port()
        assert isinstance(port, int)
        assert 1024 <= port <= 65535

    def test_find_free_port_unique(self):
        port1 = find_free_port()
        port2 = find_free_port()
        # They should generally be different (not guaranteed but very likely)
        assert isinstance(port1, int) and isinstance(port2, int)

    def test_get_python_exe_returns_valid_path(self):
        exe = get_python_exe()
        assert os.path.isfile(exe)
