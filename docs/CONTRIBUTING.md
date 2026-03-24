# Contributing

## Project Conventions

### Architecture

- **Backend (Python):** All processing runs in subprocesses via `processing.py`. The `Api` class in `api.py` is the only interface between Python and JavaScript. Long-running operations use daemon threads.
- **Frontend (JavaScript):** Vanilla JS with no build step or framework. All modules attach to the global `App` namespace. Files are inlined into a single HTML string at runtime by `app.py`.
- **No bundler or transpiler** — JavaScript runs as-is in pywebview's embedded browser.

### Code Style

**Python:**
- Docstrings on public methods and classes
- Type hints in method signatures
- Logging via `logging.getLogger(__name__)` at `WARNING` level
- Constants in `config.py`, not scattered across modules

**JavaScript:**
- JSDoc comments with `@typedef` for complex objects
- Functions attached to the `App` namespace or module-scoped
- No `var` — use `const` and `let`
- HTML escaping for user-controlled data inserted into the DOM

### File Organization

```
stem_splitter/
├── app.py          # Entry point and window management only
├── api.py          # JS bridge — all methods callable from frontend
├── config.py       # Constants and configuration only
├── processing.py   # ML model subprocess wrappers
├── server.py       # Audio HTTP server
├── settings.py     # User preferences
├── setup.py        # First-run dependency installation
├── static/
│   ├── index.html  # HTML structure only (no inline JS)
│   ├── style.css   # All styling
│   └── js/         # Frontend modules
└── tests/          # pytest tests
```

### Adding a New Backend Feature

1. Add constants to `config.py` if needed
2. Implement the processing logic in the appropriate module (or create a new one)
3. Expose it to JavaScript by adding a method to the `Api` class in `api.py`
4. For long-running operations, use a daemon thread and report progress via `_js_call()`
5. Add corresponding callback handlers in `app.js`
6. Add tests in `stem_splitter/tests/`

### Adding a New Frontend Feature

1. Add the UI rendering in `render.js`
2. Add event handling and state management in the appropriate module
3. Add styling in `style.css` using CSS variables for theme compatibility
4. Ensure any user-controlled text is escaped before DOM insertion
5. Add tests in `stem_splitter/static/js/__tests__/`

### Security Checklist

- [ ] User-controlled strings passed to `_js_call()` (not raw `_js()`)
- [ ] New file paths validated against the audio server allowlist
- [ ] No `eval()` or `innerHTML` with unescaped user input in frontend code
- [ ] Subprocesses created with `CREATE_NO_WINDOW` on Windows
- [ ] Subprocess commands use list form (not shell strings)

## Running Tests

**Backend:**
```bash
python -m pytest stem_splitter/tests/ -v
```

**Frontend:**
```bash
cd stem_splitter/static/js
npm test
```

Run both before submitting changes.

## Development Workflow

1. Create a virtual environment and install dependencies (see [Setup Guide](SETUP.md))
2. Make changes
3. Run tests
4. Test manually by launching: `python -m stem_splitter`
5. Verify themes (dark, light, system) and high-contrast mode if UI was changed

### Manual Testing Checklist

For UI or playback changes:
- [ ] File selection and queue management
- [ ] Split with both 4-stem and 6-stem models
- [ ] Playback with volume, mute, and solo controls
- [ ] MIDI conversion and note visualization
- [ ] Mix export
- [ ] Theme switching (dark/light/system)
- [ ] High-contrast mode
- [ ] Library loading of previously split songs

## Dependencies

Adding new dependencies should be done carefully:

- **Python runtime deps** — Add to `requirements.txt`. Consider whether lazy installation (like basic-pitch) is appropriate for large packages.
- **Python test deps** — pytest and the standard library are sufficient. Avoid adding test-specific packages unless strongly justified.
- **JavaScript deps** — The frontend has no runtime dependencies. Jest is the only dev dependency.
- **pywebview** — Not in `requirements.txt` because it requires platform-specific backend selection.
