"""User preferences — persisted to a JSON file next to the app."""

import json
import logging
import shutil
from pathlib import Path

from .config import DATA_DIR

logger = logging.getLogger(__name__)

SETTINGS_FILE = DATA_DIR / "settings.json"
SETTINGS_BACKUP = DATA_DIR / "settings.json.bak"

# Schema: maps each key to (default_value, allowed_type, validator_or_None)
_SCHEMA = {
    "theme": ("dark", str, lambda v: v in ("dark", "light", "system")),
    "high_contrast": (False, bool, None),
}

DEFAULTS = {k: v[0] for k, v in _SCHEMA.items()}

_cache = None


def _validate_value(key, value):
    """Validate a single setting value against the schema.

    Returns the validated value, or the default if invalid.
    """
    if key not in _SCHEMA:
        return None  # unknown key — discard
    default, expected_type, validator = _SCHEMA[key]
    if not isinstance(value, expected_type):
        logger.warning("Setting '%s' has wrong type %s (expected %s), using default",
                       key, type(value).__name__, expected_type.__name__)
        return default
    if validator and not validator(value):
        logger.warning("Setting '%s' has invalid value %r, using default", key, value)
        return default
    return value


def load_settings():
    """Load settings from disk, returning defaults for missing/invalid keys.

    Uses an in-memory cache — subsequent calls skip disk I/O.
    On corruption, restores from backup or falls back to defaults.
    """
    global _cache
    if _cache is not None:
        return dict(_cache)

    settings = dict(DEFAULTS)
    loaded = _try_load_file(SETTINGS_FILE)

    # If main file is corrupt, try backup
    if loaded is None and SETTINGS_BACKUP.exists():
        logger.warning("Settings file corrupt, trying backup")
        loaded = _try_load_file(SETTINGS_BACKUP)

    if loaded is not None:
        for k, v in loaded.items():
            validated = _validate_value(k, v)
            if validated is not None:
                settings[k] = validated

    _cache = settings
    return dict(settings)


def _try_load_file(path):
    """Attempt to read and parse a JSON settings file. Returns dict or None."""
    try:
        if path.exists():
            saved = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(saved, dict):
                return saved
            logger.warning("Settings file is not a JSON object: %s", path)
    except (json.JSONDecodeError, UnicodeDecodeError) as e:
        logger.warning("Settings file corrupt (%s): %s", path, e)
    except Exception as e:
        logger.warning("Failed to read settings (%s): %s", path, e)
    return None


def save_settings(settings):
    """Persist settings to disk and update cache. Creates a backup of the previous file."""
    global _cache
    # Validate all values before saving
    clean = {}
    for k in DEFAULTS:
        v = settings.get(k, DEFAULTS[k])
        validated = _validate_value(k, v)
        clean[k] = validated if validated is not None else DEFAULTS[k]
    _cache = dict(clean)
    try:
        # Back up existing file before overwriting
        if SETTINGS_FILE.exists():
            shutil.copy2(SETTINGS_FILE, SETTINGS_BACKUP)
        SETTINGS_FILE.write_text(json.dumps(clean, indent=2), encoding="utf-8")
    except Exception as e:
        logger.warning("Failed to save settings: %s", e)


def get_setting(key):
    """Get a single setting value."""
    return load_settings().get(key, DEFAULTS.get(key))


def set_setting(key, value):
    """Update a single setting and persist."""
    if key not in _SCHEMA:
        logger.warning("Ignoring unknown setting key: %s", key)
        return load_settings()
    validated = _validate_value(key, value)
    if validated is None:
        return load_settings()
    settings = load_settings()
    settings[key] = validated
    save_settings(settings)
    return settings
