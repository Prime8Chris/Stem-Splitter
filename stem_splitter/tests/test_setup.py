"""Tests for stem_splitter.setup module — dependency detection, install logic, state caching."""

import json
import subprocess
import tempfile
import pytest
from pathlib import Path
from unittest.mock import MagicMock, patch, mock_open

from stem_splitter.setup import (
    check_demucs_installed, check_gpu_available,
    check_torch_has_cuda, ensure_dependencies,
    _load_state, _save_state, _run_pip,
)


class TestChecks:
    @patch("stem_splitter.processing.subprocess.run")
    def test_demucs_installed(self, mock_run):
        mock_run.return_value = MagicMock(returncode=0)
        assert check_demucs_installed() is True

    @patch("stem_splitter.processing.subprocess.run")
    def test_demucs_not_installed(self, mock_run):
        mock_run.return_value = MagicMock(returncode=1)
        assert check_demucs_installed() is False

    @patch("stem_splitter.processing.subprocess.run")
    def test_gpu_available(self, mock_run):
        mock_run.return_value = MagicMock(returncode=0, stdout="NVIDIA GeForce RTX 4090\n")
        assert check_gpu_available() == "NVIDIA GeForce RTX 4090"

    @patch("stem_splitter.processing.subprocess.run")
    def test_no_gpu(self, mock_run):
        mock_run.side_effect = FileNotFoundError()
        assert check_gpu_available() is None

    @patch("stem_splitter.processing.subprocess.run")
    def test_torch_has_cuda(self, mock_run):
        mock_run.return_value = MagicMock(returncode=0, stdout="12.1\n")
        assert check_torch_has_cuda() is True

    @patch("stem_splitter.processing.subprocess.run")
    def test_torch_no_cuda(self, mock_run):
        mock_run.return_value = MagicMock(returncode=0, stdout="None\n")
        assert check_torch_has_cuda() is False


class TestEnsureDependencies:
    """All tests bypass the state cache and save to prevent side effects."""

    @patch("stem_splitter.setup._save_state")
    @patch("stem_splitter.setup._load_state", return_value=None)
    @patch("stem_splitter.setup.check_torch_has_cuda", return_value=True)
    @patch("stem_splitter.setup.check_gpu_available", return_value="RTX 4090")
    @patch("stem_splitter.setup.check_demucs_installed", return_value=True)
    def test_all_ready(self, mock_demucs, mock_gpu, mock_cuda, mock_load, mock_save):
        result = ensure_dependencies()
        assert result["demucs_ok"] is True
        assert result["gpu_ready"] is True
        assert result["gpu_name"] == "RTX 4090"
        assert result["errors"] == []
        mock_save.assert_called_once()

    @patch("stem_splitter.setup._save_state")
    @patch("stem_splitter.setup._load_state", return_value=None)
    @patch("stem_splitter.setup.check_torch_has_cuda", return_value=False)
    @patch("stem_splitter.setup.check_gpu_available", return_value=None)
    @patch("stem_splitter.setup.check_demucs_installed", return_value=True)
    def test_no_gpu(self, mock_demucs, mock_gpu, mock_cuda, mock_load, mock_save):
        result = ensure_dependencies()
        assert result["gpu_name"] is None
        assert result["gpu_ready"] is False

    @patch("stem_splitter.setup._save_state")
    @patch("stem_splitter.setup._load_state", return_value=None)
    @patch("stem_splitter.setup._run_pip", return_value=(True, None))
    @patch("stem_splitter.setup.check_gpu_available", return_value=None)
    @patch("stem_splitter.setup.check_demucs_installed", side_effect=[False, True, True])
    def test_installs_demucs(self, mock_demucs, mock_gpu, mock_pip, mock_load, mock_save):
        result = ensure_dependencies()
        assert result["demucs_ok"] is True
        mock_pip.assert_called_once()

    @patch("stem_splitter.setup._save_state")
    @patch("stem_splitter.setup._load_state", return_value=None)
    @patch("stem_splitter.setup._run_pip", return_value=(True, None))
    @patch("stem_splitter.setup.check_torch_has_cuda", side_effect=[False, True])
    @patch("stem_splitter.setup.check_gpu_available", return_value="RTX 4090")
    @patch("stem_splitter.setup.check_demucs_installed", return_value=True)
    def test_installs_cuda_torch(self, mock_demucs, mock_gpu, mock_cuda, mock_pip, mock_load, mock_save):
        result = ensure_dependencies()
        assert result["gpu_ready"] is True
        mock_pip.assert_called_once()

    @patch("stem_splitter.setup._save_state")
    @patch("stem_splitter.setup._load_state", return_value={"demucs_ok": True, "gpu_ready": True, "gpu_name": "RTX 4090", "setup_complete": True})
    @patch("stem_splitter.setup.check_demucs_installed", return_value=True)
    def test_cached_state_skips_setup(self, mock_demucs, mock_load, mock_save):
        """When state is cached and valid, should return immediately."""
        result = ensure_dependencies()
        assert result["gpu_ready"] is True
        assert result["gpu_name"] == "RTX 4090"
        # Should NOT have saved again (no changes)
        mock_save.assert_not_called()

    @patch("stem_splitter.setup._save_state")
    @patch("stem_splitter.setup._load_state", return_value={"demucs_ok": True, "setup_complete": True})
    @patch("stem_splitter.setup.check_demucs_installed", return_value=False)
    @patch("stem_splitter.setup._run_pip", return_value=(True, None))
    @patch("stem_splitter.setup.check_gpu_available", return_value=None)
    def test_cache_invalidated_when_demucs_gone(self, mock_gpu, mock_pip, mock_demucs, mock_load, mock_save):
        """If cached but demucs no longer found, should re-run full setup."""
        result = ensure_dependencies()
        # Should have fallen through to full setup and called pip
        mock_pip.assert_called_once()

    @patch("stem_splitter.setup._save_state")
    @patch("stem_splitter.setup._load_state", return_value=None)
    @patch("stem_splitter.setup._run_pip", return_value=(False, "Network error"))
    @patch("stem_splitter.setup.check_gpu_available", return_value=None)
    @patch("stem_splitter.setup.check_demucs_installed", side_effect=[False, False])
    def test_demucs_install_fails(self, mock_demucs, mock_gpu, mock_pip, mock_load, mock_save):
        """When demucs install fails, result should have errors."""
        result = ensure_dependencies()
        assert result["demucs_ok"] is False
        assert len(result["errors"]) > 0
        assert "Failed to install Demucs" in result["errors"][0]

    @patch("stem_splitter.setup._save_state")
    @patch("stem_splitter.setup._load_state", return_value=None)
    @patch("stem_splitter.setup._run_pip", return_value=(False, "Timeout"))
    @patch("stem_splitter.setup.check_torch_has_cuda", return_value=False)
    @patch("stem_splitter.setup.check_gpu_available", return_value="RTX 4090")
    @patch("stem_splitter.setup.check_demucs_installed", return_value=True)
    def test_cuda_torch_install_fails(self, mock_demucs, mock_gpu, mock_cuda, mock_pip, mock_load, mock_save):
        """GPU found but CUDA torch install fails — gpu_ready should be False."""
        result = ensure_dependencies()
        assert result["gpu_name"] == "RTX 4090"
        assert result["gpu_ready"] is False
        assert len(result["errors"]) > 0

    @patch("stem_splitter.setup._save_state")
    @patch("stem_splitter.setup._load_state", return_value=None)
    @patch("stem_splitter.setup._run_pip", return_value=(True, None))
    @patch("stem_splitter.setup.check_torch_has_cuda", side_effect=[False, False])
    @patch("stem_splitter.setup.check_gpu_available", return_value="RTX 4090")
    @patch("stem_splitter.setup.check_demucs_installed", return_value=True)
    def test_cuda_installed_but_still_no_cuda(self, mock_demucs, mock_gpu, mock_cuda, mock_pip, mock_load, mock_save):
        """CUDA torch installed OK but still no CUDA detected — error reported."""
        result = ensure_dependencies()
        assert result["gpu_ready"] is False
        assert any("still not detected" in e for e in result["errors"])

    def test_on_status_callback(self):
        """Ensure on_status callback is called with progress messages."""
        status_msgs = []
        with patch("stem_splitter.setup._save_state"), \
             patch("stem_splitter.setup._load_state", return_value=None), \
             patch("stem_splitter.setup.check_gpu_available", return_value=None), \
             patch("stem_splitter.setup.check_demucs_installed", return_value=True):
            ensure_dependencies(on_status=lambda msg: status_msgs.append(msg))
        assert len(status_msgs) > 0
        assert any("ready" in msg.lower() or "Ready" in msg for msg in status_msgs)


class TestStateIO:
    def test_load_state_returns_none_when_missing(self):
        with patch("stem_splitter.setup.STATE_FILE") as mock_file:
            mock_file.exists.return_value = False
            assert _load_state() is None

    def test_load_state_returns_dict_when_valid(self):
        data = {"demucs_ok": True, "setup_complete": True}
        with patch("stem_splitter.setup.STATE_FILE") as mock_file:
            mock_file.exists.return_value = True
            mock_file.read_text.return_value = json.dumps(data)
            result = _load_state()
            assert result == data

    def test_load_state_returns_none_on_corrupt_json(self):
        with patch("stem_splitter.setup.STATE_FILE") as mock_file:
            mock_file.exists.return_value = True
            mock_file.read_text.return_value = "not json{{"
            result = _load_state()
            assert result is None

    def test_save_state_writes_json(self):
        data = {"demucs_ok": True}
        with patch("stem_splitter.setup.STATE_FILE") as mock_file:
            _save_state(data)
            mock_file.write_text.assert_called_once()
            written = mock_file.write_text.call_args[0][0]
            assert json.loads(written) == data

    def test_save_state_handles_write_error(self):
        """Save state should not raise even if file write fails."""
        with patch("stem_splitter.setup.STATE_FILE") as mock_file:
            mock_file.write_text.side_effect = PermissionError("read-only")
            # Should not raise
            _save_state({"test": True})


class TestRunPip:
    @patch("stem_splitter.setup.subprocess.run")
    def test_success(self, mock_run):
        mock_run.return_value = MagicMock(returncode=0)
        ok, err = _run_pip(["pip", "install", "test"])
        assert ok is True
        assert err is None

    @patch("stem_splitter.setup.subprocess.run")
    def test_failure(self, mock_run):
        mock_run.return_value = MagicMock(returncode=1, stderr="ERROR: No matching distribution\n")
        ok, err = _run_pip(["pip", "install", "test"])
        assert ok is False
        assert "No matching distribution" in err

    @patch("stem_splitter.setup.subprocess.run")
    def test_timeout(self, mock_run):
        mock_run.side_effect = subprocess.TimeoutExpired(cmd="pip", timeout=600)
        ok, err = _run_pip(["pip", "install", "test"])
        assert ok is False
        assert "Timed out" in err

    @patch("stem_splitter.setup.subprocess.run")
    def test_exception(self, mock_run):
        mock_run.side_effect = OSError("no such file")
        ok, err = _run_pip(["pip", "install", "test"])
        assert ok is False
        assert "no such file" in err

    @patch("stem_splitter.setup.subprocess.run")
    def test_empty_stderr(self, mock_run):
        mock_run.return_value = MagicMock(returncode=1, stderr="")
        ok, err = _run_pip(["pip", "install", "test"])
        assert ok is False
        assert err == "Unknown error"


class TestCheckEdgeCases:
    @patch("stem_splitter.processing.subprocess.run")
    def test_demucs_check_timeout(self, mock_run):
        mock_run.side_effect = subprocess.TimeoutExpired(cmd="python", timeout=10)
        assert check_demucs_installed() is False

    @patch("stem_splitter.processing.subprocess.run")
    def test_gpu_empty_stdout(self, mock_run):
        mock_run.return_value = MagicMock(returncode=0, stdout="")
        assert check_gpu_available() is None

    @patch("stem_splitter.processing.subprocess.run")
    def test_gpu_nonzero_return(self, mock_run):
        mock_run.return_value = MagicMock(returncode=1, stdout="")
        assert check_gpu_available() is None

    @patch("stem_splitter.processing.subprocess.run")
    def test_torch_cuda_check_exception(self, mock_run):
        mock_run.side_effect = OSError("python not found")
        assert check_torch_has_cuda() is False
