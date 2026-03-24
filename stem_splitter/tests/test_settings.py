"""Tests for stem_splitter.settings module — load, save, get, set, caching, validation."""

import json
import pytest
from unittest.mock import patch, MagicMock

import stem_splitter.settings as settings_mod
from stem_splitter.settings import (
    load_settings, save_settings, get_setting, set_setting, DEFAULTS,
    _validate_value,
)


@pytest.fixture(autouse=True)
def clear_cache():
    """Reset the in-memory cache before each test."""
    settings_mod._cache = None
    yield
    settings_mod._cache = None


class TestLoadSettings:
    def test_returns_defaults_when_no_file(self):
        with patch("stem_splitter.settings.SETTINGS_FILE") as mock_file:
            mock_file.exists.return_value = False
            result = load_settings()
            assert result == DEFAULTS

    def test_returns_saved_values(self):
        saved = {"theme": "light", "high_contrast": True}
        with patch("stem_splitter.settings.SETTINGS_FILE") as mock_file:
            mock_file.exists.return_value = True
            mock_file.read_text.return_value = json.dumps(saved)
            result = load_settings()
            assert result["theme"] == "light"
            assert result["high_contrast"] is True

    def test_merges_with_defaults_for_missing_keys(self):
        saved = {"theme": "light"}
        with patch("stem_splitter.settings.SETTINGS_FILE") as mock_file:
            mock_file.exists.return_value = True
            mock_file.read_text.return_value = json.dumps(saved)
            result = load_settings()
            assert result["theme"] == "light"
            assert result["high_contrast"] == DEFAULTS["high_contrast"]

    def test_filters_unknown_keys(self):
        saved = {"theme": "light", "unknown_key": "should_be_dropped"}
        with patch("stem_splitter.settings.SETTINGS_FILE") as mock_file:
            mock_file.exists.return_value = True
            mock_file.read_text.return_value = json.dumps(saved)
            result = load_settings()
            assert "unknown_key" not in result
            assert result["theme"] == "light"

    def test_handles_corrupt_json(self):
        with patch("stem_splitter.settings.SETTINGS_FILE") as mock_file:
            mock_file.exists.return_value = True
            mock_file.read_text.return_value = "not valid json{{"
            result = load_settings()
            assert result == DEFAULTS

    def test_handles_non_dict_json(self):
        with patch("stem_splitter.settings.SETTINGS_FILE") as mock_file:
            mock_file.exists.return_value = True
            mock_file.read_text.return_value = '"just a string"'
            result = load_settings()
            assert result == DEFAULTS

    def test_handles_read_error(self):
        with patch("stem_splitter.settings.SETTINGS_FILE") as mock_file:
            mock_file.exists.return_value = True
            mock_file.read_text.side_effect = PermissionError("denied")
            result = load_settings()
            assert result == DEFAULTS

    def test_uses_cache_on_second_call(self):
        with patch("stem_splitter.settings.SETTINGS_FILE") as mock_file:
            mock_file.exists.return_value = False
            load_settings()
            load_settings()
            # exists() called only once (first load), not on cached call
            assert mock_file.exists.call_count == 1

    def test_returns_copy_not_reference(self):
        with patch("stem_splitter.settings.SETTINGS_FILE") as mock_file:
            mock_file.exists.return_value = False
            result1 = load_settings()
            result1["theme"] = "modified"
            result2 = load_settings()
            assert result2["theme"] == "dark"


class TestSaveSettings:
    def test_writes_json_with_utf8(self):
        data = {"theme": "dark", "high_contrast": False}
        with patch("stem_splitter.settings.SETTINGS_FILE") as mock_file, \
             patch("stem_splitter.settings.shutil.copy2"):
            mock_file.exists.return_value = False
            save_settings(data)
            mock_file.write_text.assert_called_once()
            written = mock_file.write_text.call_args[0][0]
            assert json.loads(written) == data
            assert mock_file.write_text.call_args[1]["encoding"] == "utf-8"

    def test_handles_write_error(self):
        with patch("stem_splitter.settings.SETTINGS_FILE") as mock_file, \
             patch("stem_splitter.settings.shutil.copy2"):
            mock_file.exists.return_value = False
            mock_file.write_text.side_effect = PermissionError("read-only")
            save_settings({"theme": "dark"})

    def test_updates_cache(self):
        with patch("stem_splitter.settings.SETTINGS_FILE") as mock_file:
            mock_file.write_text = MagicMock()
            save_settings({"theme": "light", "high_contrast": True})
            # Cache should be updated — next load should not hit disk
            mock_file.exists.return_value = False
            result = load_settings()
            assert result["theme"] == "light"


class TestGetSetting:
    def test_get_existing_key(self):
        with patch("stem_splitter.settings.load_settings", return_value={"theme": "light", "high_contrast": False}):
            assert get_setting("theme") == "light"

    def test_get_missing_key_returns_default(self):
        with patch("stem_splitter.settings.load_settings", return_value={}):
            assert get_setting("theme") == "dark"

    def test_get_unknown_key_returns_none(self):
        with patch("stem_splitter.settings.load_settings", return_value={}):
            assert get_setting("nonexistent") is None


class TestSetSetting:
    def test_updates_and_saves(self):
        with patch("stem_splitter.settings.load_settings", return_value=dict(DEFAULTS)), \
             patch("stem_splitter.settings.save_settings") as mock_save:
            result = set_setting("theme", "light")
            assert result["theme"] == "light"
            mock_save.assert_called_once()
            saved = mock_save.call_args[0][0]
            assert saved["theme"] == "light"

    def test_preserves_other_settings(self):
        existing = {"theme": "dark", "high_contrast": True}
        with patch("stem_splitter.settings.load_settings", return_value=dict(existing)), \
             patch("stem_splitter.settings.save_settings") as mock_save:
            result = set_setting("theme", "light")
            assert result["theme"] == "light"
            assert result["high_contrast"] is True

    def test_rejects_unknown_key(self):
        with patch("stem_splitter.settings.load_settings", return_value=dict(DEFAULTS)), \
             patch("stem_splitter.settings.save_settings") as mock_save:
            result = set_setting("unknown_key", "value")
            mock_save.assert_not_called()
            assert "unknown_key" not in result


class TestValidation:
    def test_valid_theme_values(self):
        assert _validate_value("theme", "dark") == "dark"
        assert _validate_value("theme", "light") == "light"
        assert _validate_value("theme", "system") == "system"

    def test_invalid_theme_value_returns_default(self):
        assert _validate_value("theme", "neon") == "dark"

    def test_wrong_type_returns_default(self):
        assert _validate_value("theme", 123) == "dark"
        assert _validate_value("high_contrast", "yes") is False

    def test_unknown_key_returns_none(self):
        assert _validate_value("nonexistent", "value") is None

    def test_valid_high_contrast(self):
        assert _validate_value("high_contrast", True) is True
        assert _validate_value("high_contrast", False) is False

    def test_corrupt_file_falls_back_to_backup(self):
        settings_mod._cache = None
        with patch("stem_splitter.settings.SETTINGS_FILE") as mock_main, \
             patch("stem_splitter.settings.SETTINGS_BACKUP") as mock_backup:
            mock_main.exists.return_value = True
            mock_main.read_text.return_value = "corrupt{{"
            mock_backup.exists.return_value = True
            mock_backup.read_text.return_value = json.dumps({"theme": "light", "high_contrast": True})
            result = load_settings()
            assert result["theme"] == "light"
            assert result["high_contrast"] is True

    def test_save_creates_backup(self):
        with patch("stem_splitter.settings.SETTINGS_FILE") as mock_file, \
             patch("stem_splitter.settings.shutil.copy2") as mock_copy:
            mock_file.exists.return_value = True
            mock_file.write_text = MagicMock()
            save_settings({"theme": "dark", "high_contrast": False})
            mock_copy.assert_called_once()

    def test_save_validates_values(self):
        with patch("stem_splitter.settings.SETTINGS_FILE") as mock_file, \
             patch("stem_splitter.settings.shutil.copy2"):
            mock_file.exists.return_value = False
            mock_file.write_text = MagicMock()
            save_settings({"theme": "invalid_theme", "high_contrast": "not_bool"})
            written = json.loads(mock_file.write_text.call_args[0][0])
            assert written["theme"] == "dark"  # reset to default
            assert written["high_contrast"] is False  # reset to default
