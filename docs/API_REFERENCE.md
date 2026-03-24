# API Reference

## Python Backend API

The `Api` class in `api.py` is the bridge between the JavaScript frontend and the Python backend. All public methods are callable from JavaScript via `pywebview.api.<method_name>()`.

### File Operations

#### `pick_files() → str | None`

Opens a file dialog for selecting audio files. Returns a JSON string containing an array of file objects, or `None` if the dialog is cancelled.

**Returns:** `'[{"name": "song.mp3", "path": "C:/Music/song.mp3"}, ...]'` or `None`

**File type filter:** `*.mp3, *.wav, *.flac, *.ogg, *.m4a, *.wma, *.aiff, *.au`

#### `pick_output() → str | None`

Opens a folder dialog for selecting the output directory. Updates the default output path and adds the new directory to the audio server's allowed directories. Returns the selected path or `None`.

#### `get_default_output() → str`

Returns the current default output directory path (`~/Music/Stem Splitter Output/` initially).

#### `open_output_folder()`

Opens the most recently used stem output directory in Windows Explorer. Falls back to the default output directory if the last directory doesn't exist.

#### `open_file_location(filepath: str)`

Opens the containing folder in Windows Explorer and selects the specified file. Uses `explorer /select,` on Windows.

#### `copy_to_clipboard(text: str)`

Copies the given text to the system clipboard via the browser's `navigator.clipboard.writeText()` API.

### Splitting

#### `start_split(paths_json: str, model: str, output_dir: str, device: str = "cpu")`

Starts stem separation on a background thread. Processes files sequentially.

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `paths_json` | str | JSON array of file paths: `'["C:/file1.mp3", "C:/file2.wav"]'` |
| `model` | str | Demucs model name: `"htdemucs"` (4 stems) or `"htdemucs_6s"` (6 stems) |
| `output_dir` | str | Directory for stem output |
| `device` | str | `"cpu"` or `"cuda"` |

**JS callbacks triggered:**

| Callback | Arguments | When |
|----------|-----------|------|
| `markFileProcessing(index)` | File index | Before processing each file |
| `updateProgress(pct, status)` | 0–100, message | During separation |
| `markFileDone(index, stems)` | File index, stem array | After each file completes |
| `setOutputReady(stemDir)` | Output directory path | After each file completes |
| `splitDone(success, message)` | Boolean, status message | After all files complete or on error |

**Stem array format:** `[{"name": "vocals", "path": "C:/.../vocals.wav"}, ...]`

#### `cancel_split()`

Cancels the current split by terminating the Demucs subprocess. Triggers `splitDone(false, "Split cancelled.")`.

### MIDI Conversion

#### `convert_to_midi(stem_path: str, stem_name: str)`

Starts MIDI conversion for a stem WAV file on a background thread. Lazily installs `basic-pitch` on first use.

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `stem_path` | str | Path to the stem WAV file |
| `stem_name` | str | Stem name (e.g., `"vocals"`, `"drums"`) |

**JS callbacks triggered:**

| Callback | Arguments | When |
|----------|-----------|------|
| `midiConvertProgress(path, status)` | Stem path, message | During conversion |
| `updateProgress(pct, status)` | 0–100, message | During conversion |
| `midiConvertDone(path, success, midiPath, notes)` | Stem path, boolean, MIDI file path, note array | On completion |

**Note array format:** `[[start_seconds, end_seconds, midi_pitch], ...]`

#### `load_midi_notes(midi_path: str) → str`

Reads note events from an existing MIDI file. Returns a JSON array of `[start, end, pitch]` triples, or `[]` on failure. Uses `pretty_midi` internally.

#### `get_midi_eligible_stems() → str`

Returns a JSON array of stem names that support MIDI conversion: `["vocals", "bass", "guitar", "piano", "drums"]`.

### Mix Export

#### `export_mix(stems_json: str, output_path: str)`

Exports a custom stem mix to a WAV file on a background thread.

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `stems_json` | str | JSON array of stem mix settings |
| `output_path` | str | Destination WAV file path |

**Stem mix settings format:**
```json
[
  {"path": "C:/.../vocals.wav", "volume": 80, "muted": false, "soloed": true},
  {"path": "C:/.../drums.wav", "volume": 100, "muted": false, "soloed": false}
]
```

- `volume`: 0–100 (mapped to 0.0–1.0 gain)
- `muted`: If `true`, stem is excluded
- `soloed`: If any stem has `soloed: true`, only soloed stems are included

**JS callbacks triggered:**

| Callback | Arguments | When |
|----------|-----------|------|
| `exportMixProgress(pct, status)` | 0–100, message | During mixing |
| `exportMixDone(success, pathOrMessage)` | Boolean, output path or error | On completion |

### Library

#### `scan_library() → str`

Scans the output directory for previously split songs. Returns a JSON array.

**Return format:**
```json
[
  {
    "name": "Song Name",
    "model": "htdemucs",
    "stemDir": "C:/.../htdemucs/Song Name",
    "stems": [
      {"name": "vocals", "path": "C:/.../vocals.wav", "midiPath": "C:/.../vocals.mid"},
      {"name": "drums", "path": "C:/.../drums.wav"}
    ]
  }
]
```

The `midiPath` field is present only if a `.mid` file exists alongside the stem WAV.

### Settings

#### `get_settings() → str`

Returns all user settings as a JSON object: `{"theme": "dark", "high_contrast": false}`.

#### `update_setting(key: str, value: any) → str`

Updates a single setting. Returns the full updated settings object as JSON. Invalid keys or values are ignored.

### GPU / Setup Status

#### `check_demucs_installed() → str`

Returns `"true"` or `"false"` (JSON boolean) indicating whether Demucs can be imported.

#### `check_gpu_info() → str`

Returns a JSON object with GPU status:
```json
{
  "gpu_available": true,
  "gpu_name": "NVIDIA GeForce RTX 4090",
  "torch_has_cuda": true
}
```

#### `check_cuda_available() → str`

Returns `"true"` or `"false"` (JSON boolean) indicating whether CUDA GPU acceleration is available.

#### `install_torch_cuda()`

Installs CUDA-enabled PyTorch on a background thread. Reports progress via:

| Callback | Arguments | When |
|----------|-----------|------|
| `torchInstallStatus(status, message)` | `"installing"` / `"success"` / `"error"`, message | During/after install |

---

## Python Processing Classes

### `DemucsProcessor` (`processing.py`)

Wraps the Demucs command-line tool as a subprocess.

#### `split(filepath, model, output_dir, device="cpu", on_progress=None) → list`

Runs Demucs on a single audio file. Returns a list of stem dicts.

**Raises:**
- `SplitCancelledError` — User cancelled via `cancel()`
- `FileNotFoundError` — Demucs not installed
- `RuntimeError` — Demucs exited with an error
- `ValueError` — Unknown model name

#### `cancel()`

Terminates the running Demucs subprocess.

#### `check_installed() → bool`

Returns `True` if `import demucs` succeeds.

#### `check_cuda_available() → bool`

Returns `True` if CUDA is available (via PyTorch or nvidia-smi).

#### `get_gpu_name() → str | None`

Returns the GPU name from nvidia-smi, or `None`.

#### `check_torch_has_cuda() → bool`

Returns `True` if the installed PyTorch has CUDA support (`torch.version.cuda` is set).

### `MidiConverter` (`processing.py`)

Converts WAV stems to MIDI using basic-pitch in a subprocess.

#### `convert(wav_path, on_progress=None) → tuple[str, list]`

Converts a WAV file to MIDI. Returns `(midi_path, notes)` where notes is `[[start, end, pitch], ...]`.

**Raises:**
- `FileNotFoundError` — WAV file or Python executable not found
- `RuntimeError` — Conversion failed

#### `read_notes(midi_path) → list`

Reads note events from an existing MIDI file using `pretty_midi`. Returns `[[start, end, pitch], ...]` or `[]` on failure.

#### `check_installed() → bool`

Returns `True` if `import basic_pitch` succeeds.

### `SplitCancelledError` (`processing.py`)

Exception raised when a split operation is cancelled by the user.

---

## Audio Server (`server.py`)

### `start_audio_server(port, allowed_dirs=None) → ThreadingHTTPServer`

Starts a threaded HTTP server on `127.0.0.1:<port>` for serving audio files.

### Endpoints

#### `GET /audio?path=<url_encoded_path>`

Serves an audio file after validation:
1. Path must be within an allowed directory (realpath check)
2. File extension must be in `ALLOWED_AUDIO_EXTENSIONS`
3. File header must match expected magic bytes for the extension

Supports HTTP Range requests for seekable playback.

**Responses:**
- `200` — Full file response
- `206` — Partial content (range request)
- `403` — Path traversal attempt, invalid extension, or magic byte mismatch
- `404` — File not found

#### `GET /logo.png`

Serves the dark theme logo from `assets/StemSplitterLogo.png`.

#### `GET /logo-light.png`

Serves the light theme logo from `assets/StemSplitterLogoWhite.png`.

#### `OPTIONS /audio?...`

CORS preflight handler. Returns allowed methods and headers.

---

## Settings Manager (`settings.py`)

### `load_settings() → dict`

Returns the current settings as a dictionary. Uses in-memory cache after first load. Falls back to backup file or defaults on corruption.

### `save_settings(settings: dict)`

Validates and persists settings to disk. Creates a backup of the previous file before writing.

### `get_setting(key: str) → any`

Returns a single setting value, or its default.

### `set_setting(key: str, value: any) → dict`

Updates a single setting and returns the full settings dictionary. Unknown keys are ignored.

### Settings Schema

| Key | Type | Default | Validator |
|-----|------|---------|-----------|
| `theme` | `str` | `"dark"` | Must be `"dark"`, `"light"`, or `"system"` |
| `high_contrast` | `bool` | `false` | Type check only |

---

## JavaScript Modules

### `App` Namespace (`app.js`)

Global state and shared utilities.

**State Properties:**

| Property | Type | Description |
|----------|------|-------------|
| `App.files` | Array | Queue of file objects to split |
| `App.library` | Array | Previously split songs loaded from the output directory |
| `App.activePlayer` | Object\|null | Currently playing audio state |
| `App.audioCtx` | AudioContext\|null | Web Audio API context |
| `App.STEM_COLORS` | Object | Color hex codes keyed by stem name |
| `App.MIDI_ELIGIBLE_STEMS` | Set | Stem names that support MIDI conversion |

**Key Functions:**

| Function | Description |
|----------|-------------|
| `App.getFileObj(identifier)` | Find a file/library object by path, stem path, or stem dir |
| `App.audioUrl(filePath)` | Build an audio server URL for a file path |
| `App.init()` | Initialize the application — load settings, scan library, bind events |

**Callback Functions (called from Python):**

| Function | Description |
|----------|-------------|
| `updateProgress(pct, status)` | Update progress bar and status text |
| `markFileProcessing(index)` | Mark a queued file as currently processing |
| `markFileDone(index, stems)` | Mark a queued file as completed with stem data |
| `splitDone(success, message)` | Handle split completion or failure |
| `setOutputReady(stemDir)` | Enable the "Open Folder" button |
| `midiConvertProgress(path, status)` | Update MIDI conversion progress for a stem |
| `midiConvertDone(path, success, midiPath, notes)` | Handle MIDI conversion completion |
| `exportMixProgress(pct, status)` | Update mix export progress |
| `exportMixDone(success, pathOrMessage)` | Handle mix export completion |
| `torchInstallStatus(status, message)` | Handle CUDA PyTorch installation status |

### Mixer Module (`mixer.js`)

Audio playback and mixing.

| Function | Description |
|----------|-------------|
| `togglePlay(fileObj, stemName)` | Start/stop synchronized playback of all stems for a file |
| `applyMixState(fileObj)` | Apply volume, mute, and solo settings to active gain nodes |
| `stopPlayback()` | Stop all audio and reset playhead |

### Waveform Module (`waveform.js`)

Waveform visualization.

| Function | Description |
|----------|-------------|
| `generateWaveform(audioBuffer, width)` | Calculate peak amplitudes from decoded audio |
| `drawWaveform(canvas, peaks, color)` | Render a waveform on a canvas element |
| `drawMidiNotes(canvas, notes, duration, color)` | Overlay MIDI note rectangles on a waveform |

### EQ Module (`eq.js`)

Frequency spectrum visualization.

| Function | Description |
|----------|-------------|
| `drawEQ(canvas, analyserNode)` | Draw an 8-band frequency spectrum from an AnalyserNode |

**Frequency bands:** 60 Hz, 170 Hz, 310 Hz, 600 Hz, 1 kHz, 3 kHz, 6 kHz, 12 kHz

### Render Module (`render.js`)

DOM rendering and event handling.

| Function | Description |
|----------|-------------|
| `renderFiles()` | Render the file queue and library list |
| `renderMixer(fileObj, container)` | Render the stem mixer panel for a file |

### Settings Module (`settings.js`)

Theme and accessibility.

| Function | Description |
|----------|-------------|
| `toggleSettings()` | Show/hide the settings panel |
| `applyTheme(theme)` | Apply a theme by switching CSS variables |
| `changeSetting(key, value)` | Update a setting and persist via the Python API |
