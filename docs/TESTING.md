# Testing Guide

Stem Splitter has two test suites: **pytest** for the Python backend and **Jest** for the JavaScript frontend.

## Backend Tests (pytest)

Located in `stem_splitter/tests/`.

### Running Tests

```bash
# From the project root
python -m pytest stem_splitter/tests/ -v

# Run a specific test file
python -m pytest stem_splitter/tests/test_api.py -v

# Run a specific test
python -m pytest stem_splitter/tests/test_api.py::TestApi::test_pick_files -v
```

### Test Files

| File | Tests | Focus |
|------|-------|-------|
| `test_api.py` | Api class methods | File picking, splitting, MIDI conversion, mix export, GPU detection, settings, JS bridge safety |
| `test_config.py` | Configuration constants | Model definitions, stem colors, paths, audio extensions, MIME types |
| `test_processing.py` | DemucsProcessor, MidiConverter | Subprocess management, progress parsing, cancellation, CUDA detection, MIDI note reading |
| `test_server.py` | AudioHandler, AudioServer | Path validation, extension filtering, magic byte verification, CORS headers, range requests |
| `test_settings.py` | Settings manager | Load/save, schema validation, corruption recovery, backup creation, caching |
| `test_setup.py` | Setup manager | Demucs installation check, GPU detection, state caching, `ensure_dependencies()` flow |
| `test_integration.py` | End-to-end workflows | Full split pipeline, library scanning, file processing sequences |

### Testing Approach

The backend tests heavily use `unittest.mock` to avoid real ML model execution:

- **Subprocess mocking** — `subprocess.Popen` and `subprocess.run` are patched to simulate Demucs and basic-pitch behavior
- **File system mocking** — `tempfile.TemporaryDirectory` and path mocking for settings and state files
- **Thread testing** — Tests verify daemon threads start correctly and callbacks fire
- **pywebview mocking** — `webview.Window` is mocked for file dialogs and JS evaluation

Key patterns:

```python
# Mocking a Demucs subprocess
@patch("stem_splitter.processing.subprocess.Popen")
def test_split(self, mock_popen):
    mock_process = MagicMock()
    mock_process.stdout = iter(["50%|...\n", "100%|...\n"])
    mock_process.wait.return_value = None
    mock_process.returncode = 0
    mock_popen.return_value = mock_process
    # ... test split logic

# Mocking the JS bridge to verify callback arguments
@patch.object(Api, "_js_call")
def test_progress_callbacks(self, mock_js_call):
    # ... trigger operation
    mock_js_call.assert_any_call("updateProgress", 50, "Separating 1/1: song.mp3")
```

### JS Bridge Safety Tests

`test_api.py` includes tests verifying that the `_js_call()` method properly escapes:
- Strings with quotes and special characters
- Path separators (backslashes)
- User-controlled file names that could inject JavaScript

## Frontend Tests (Jest)

Located in `stem_splitter/static/js/__tests__/`.

### Running Tests

```bash
cd stem_splitter/static/js

# Install dependencies (first time)
npm install

# Run all tests
npm test

# Verbose output
npm run test:verbose

# With coverage report
npm run test:coverage
```

### Test Files

| File | Focus |
|------|-------|
| `test_app.js` | App namespace state management, file object operations, `getFileObj()`, `audioUrl()` |
| `test_mixer.js` | Audio playback logic, gain node creation, volume/mute/solo application |
| `test_waveform.js` | Waveform peak generation, canvas rendering, MIDI note overlay drawing |
| `test_eq.js` | EQ frequency spectrum drawing, canvas context operations |
| `test_render.js` | DOM rendering, HTML structure, XSS prevention in rendered content |
| `test_settings.js` | Theme application, CSS variable switching, settings persistence |
| `setup.js` | Common test utilities and shared mocks |

### Testing Approach

Frontend tests use **jsdom** as the DOM environment:

```javascript
// jest.config.js
module.exports = {
  testEnvironment: "jsdom",
};
```

Key mocking patterns:

- **Web Audio API** — `AudioContext`, `GainNode`, `AnalyserNode`, and `AudioBufferSourceNode` are mocked
- **Canvas** — `canvas.getContext("2d")` returns a mock context with stubbed drawing methods
- **pywebview** — `window.pywebview.api` is mocked to simulate backend calls
- **DOM** — Tests create and query DOM elements to verify rendering

```javascript
// Mocking Web Audio API
const mockAudioContext = {
  createGain: jest.fn(() => ({ gain: { value: 1 }, connect: jest.fn() })),
  createBufferSource: jest.fn(() => ({ connect: jest.fn(), start: jest.fn() })),
  decodeAudioData: jest.fn(),
  currentTime: 0,
};

// Mocking pywebview API
window.pywebview = {
  api: {
    pick_files: jest.fn(),
    start_split: jest.fn(),
    get_settings: jest.fn(() => JSON.stringify({ theme: "dark" })),
  },
};
```

### XSS Prevention Tests

`test_render.js` verifies that user-controlled data (file names, paths) is safely escaped when inserted into the DOM, preventing cross-site scripting attacks.

## Test Configuration

### pytest

No `pytest.ini` or `pyproject.toml` configuration is required. Tests are discovered automatically from `stem_splitter/tests/test_*.py`.

### Jest

Configuration in `stem_splitter/static/js/jest.config.js`:

```javascript
module.exports = {
  testEnvironment: "jsdom",
  testMatch: ["**/__tests__/test_*.js"],
};
```

### Dependencies

**Backend:** No test-specific dependencies beyond pytest and the standard library's `unittest.mock`.

**Frontend:**
- `jest` (v29.7.0) — Test runner
- `jest-environment-jsdom` (v29.7.0) — DOM simulation

## Writing New Tests

### Backend

1. Add test functions to the appropriate `test_*.py` file (or create a new one matching the `test_*.py` pattern)
2. Use `unittest.mock.patch` to isolate from subprocess calls, file I/O, and pywebview
3. Avoid importing ML libraries (demucs, basic-pitch, torch) — mock `subprocess.run` and `subprocess.Popen` instead

### Frontend

1. Add test functions to the appropriate `test_*.js` file in `__tests__/`
2. Mock browser APIs (Web Audio, Canvas, Clipboard) before each test
3. Use `setup.js` for shared fixtures
4. Clean up DOM state in `afterEach` to prevent test pollution
