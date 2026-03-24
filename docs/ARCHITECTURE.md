# Architecture

Stem Splitter is a desktop application built on **pywebview**, which embeds a web-based UI inside a native window. The Python backend handles audio processing, file I/O, and system integration. The JavaScript frontend handles rendering, audio playback, and user interaction. Communication between the two layers happens through pywebview's JavaScript bridge.

## System Overview

```
┌────────────────────────────────────────────────────────────────────┐
│                        pywebview Window                            │
│                                                                    │
│  ┌─────────────────────────┐    ┌────────────────────────────────┐ │
│  │     Frontend (JS)       │    │      Backend (Python)          │ │
│  │                         │    │                                │ │
│  │  app.js      render.js  │◄──►│  Api class (pywebview bridge)  │ │
│  │  mixer.js    settings.js│    │  DemucsProcessor               │ │
│  │  waveform.js eq.js      │    │  MidiConverter                 │ │
│  │                         │    │  AudioServer (HTTP)            │ │
│  │  Web Audio API          │◄───│  Settings manager              │ │
│  │  Canvas 2D              │    │  Setup manager                 │ │
│  └─────────────────────────┘    └────────────────────────────────┘ │
│           │                              │                         │
│           │ HTTP (localhost)              │ subprocess              │
│           ▼                              ▼                         │
│  ┌─────────────────┐           ┌──────────────────┐               │
│  │  Audio Server   │           │  Demucs / basic-  │               │
│  │  (127.0.0.1)    │           │  pitch processes  │               │
│  └─────────────────┘           └──────────────────┘               │
└────────────────────────────────────────────────────────────────────┘
```

## Startup Sequence

The application launches in two phases:

### Phase 1: Splash Screen

1. `__main__.py` calls `app.main()`
2. A frameless splash window is created with `SPLASH_HTML`
3. A daemon thread runs `ensure_dependencies()` which:
   - Loads cached state from `~/.stem_splitter/setup_state.json`
   - If cached and valid, verifies Demucs is still importable and returns
   - Otherwise: checks/installs Demucs, detects GPU via `nvidia-smi`, installs CUDA PyTorch if needed
   - Saves results to the state file for future launches
4. Progress is streamed to the splash window via `evaluate_js()`
5. On completion, the splash window is destroyed

### Phase 2: Main Application

1. An `Api` instance is created with a mutable window reference
2. An `AudioServer` is started on a random free port bound to `127.0.0.1`
3. `_load_html()` assembles the final HTML by:
   - Reading `index.html`, `style.css`, and all JS files from `static/`
   - Inlining everything into a single HTML string
   - Injecting `AUDIO_PORT`, `SETUP_RESULT`, and `INITIAL_SETTINGS` as JS constants
   - Replacing the `__AUDIO_PORT__` placeholder with the actual port number
4. The main pywebview window is created with `html=` mode and `js_api=api`
5. The JS `init()` function runs on page load, initializing all modules

## Module Responsibilities

### Python Backend

| Module | File | Responsibility |
|--------|------|----------------|
| **App** | `app.py` | Application entry point, splash screen, HTML assembly, window lifecycle |
| **Api** | `api.py` | JavaScript bridge — exposes all backend functionality to the frontend |
| **Config** | `config.py` | Constants: paths, window dimensions, models, stem colors, audio formats |
| **Processing** | `processing.py` | `DemucsProcessor` (stem separation) and `MidiConverter` (MIDI generation) |
| **Server** | `server.py` | HTTP server for streaming audio files to the Web Audio API |
| **Settings** | `settings.py` | JSON-based user preferences with validation, caching, and backup |
| **Setup** | `setup.py` | First-run dependency installation and GPU detection |

### JavaScript Frontend

| Module | File | Responsibility |
|--------|------|----------------|
| **App** | `app.js` | Global state (`App` namespace), file object management, initialization, pywebview callback handlers |
| **Mixer** | `mixer.js` | Web Audio API playback, gain nodes, volume/mute/solo logic, playhead tracking |
| **Waveform** | `waveform.js` | Waveform peak calculation from decoded audio, canvas rendering, MIDI note overlay |
| **EQ** | `eq.js` | 8-band frequency spectrum visualization using `AnalyserNode` |
| **Render** | `render.js` | DOM construction for file list, mixer panels, stem controls, event binding |
| **Settings** | `settings.js` | Theme application (CSS variable switching), high-contrast mode, settings panel |

## Communication Patterns

### JavaScript → Python (API Calls)

The frontend calls Python methods through `pywebview.api`:

```javascript
// Example: start a split operation
pywebview.api.start_split(JSON.stringify(paths), model, outputDir, device);
```

All `Api` methods are synchronous from the JS perspective but launch daemon threads for long-running operations (splitting, MIDI conversion, mix export).

### Python → JavaScript (Callbacks)

The backend pushes updates to the frontend using `window.evaluate_js()`:

```python
# Safe JS bridge — all arguments serialized via json.dumps()
self._js_call("updateProgress", 50, "Separating 1/3: song.mp3")
```

The `_js_call()` method serializes every argument with `json.dumps()` to prevent injection of raw JavaScript.

### Audio Streaming (HTTP)

The Web Audio API cannot directly access local files. An HTTP server on `127.0.0.1:<random_port>` serves audio files:

```
Frontend                        Audio Server
   │                                │
   │  GET /audio?path=C:/...wav     │
   │ ──────────────────────────────►│
   │                                │── Path validation
   │                                │── Extension check
   │                                │── Magic byte verification
   │  200 OK (audio/wav)            │
   │ ◄──────────────────────────────│
   │                                │
   │  Range: bytes=1024-2047        │  (seekable playback)
   │ ──────────────────────────────►│
   │  206 Partial Content           │
   │ ◄──────────────────────────────│
```

## Data Flow: Stem Separation

```
User selects files
       │
       ▼
Api.pick_files() ──► File dialog ──► JSON list of {name, path}
       │
       ▼
Api.start_split() ──► Daemon thread
       │
       ▼
DemucsProcessor.split()
       │
       ├── subprocess.Popen([python, -m, demucs, -n, MODEL, -o, DIR, FILE])
       │
       ├── Parse stdout line by line
       │   └── Regex: (\d+)%\| → progress percentage
       │
       ├── on_progress callback → _js_call("updateProgress", pct, status)
       │
       └── Return stem list [{name, path}, ...]
              │
              ▼
       _js_call("markFileDone", index, stems)
       _js_call("splitDone", true, "Done!")
```

## Data Flow: Audio Playback

```
User clicks Play on a stem
       │
       ▼
mixer.js: togglePlay()
       │
       ├── Create/resume AudioContext
       ├── Fetch audio via Audio Server HTTP
       ├── Decode to AudioBuffer
       │
       ├── For each stem:
       │   └── BufferSource → GainNode → Destination
       │       (volume, mute, solo applied via gain values)
       │
       ├── Start playback with offset
       ├── requestAnimationFrame loop:
       │   ├── Update playhead position on waveform canvas
       │   └── Draw EQ frequency spectrum (8 bands)
       │
       └── On ended: reset playhead, clean up nodes
```

## Data Flow: MIDI Conversion

```
User clicks MIDI button on a stem
       │
       ▼
Api.convert_to_midi(stem_path, stem_name)
       │
       ├── Check basic-pitch installed (lazy install via pip if missing)
       │
       ├── MidiConverter.convert(wav_path)
       │   └── subprocess.Popen([python, -c, CONVERT_SCRIPT, wav, mid])
       │       ├── Load basic-pitch model
       │       ├── Run pitch inference
       │       ├── Write MIDI file
       │       └── Stream JSON progress: {stage, pct} / {ok, path, notes}
       │
       └── _js_call("midiConvertDone", path, true, midi_path, notes)
              │
              ▼
       waveform.js: drawMidiNotes() overlays notes on canvas
```

## Data Flow: Mix Export

```
User clicks Export Mix
       │
       ▼
Api.export_mix(stems_json, output_path)
       │
       ├── For each stem:
       │   ├── Read WAV via soundfile
       │   ├── Apply volume (0–100 → 0.0–1.0)
       │   ├── Skip if muted
       │   ├── Skip if any solo active and not soloed
       │   └── Sum into mixed array (pad shorter arrays)
       │
       ├── Peak normalization (divide by max if > 1.0)
       │
       └── soundfile.write(output_path, mixed, sample_rate)
```

## Threading Model

All long-running operations run on daemon threads to keep the UI responsive:

| Operation | Thread | Cancellable |
|-----------|--------|-------------|
| Stem separation | Daemon thread per `start_split()` call | Yes — `cancel_split()` terminates subprocess |
| MIDI conversion | Daemon thread per `convert_to_midi()` call | No |
| Mix export | Daemon thread per `export_mix()` call | No |
| Audio server | Daemon thread (runs for app lifetime) | N/A |
| Library scan | Main thread with lock | N/A |
| Setup/install | Daemon thread during splash phase | No |

The `_scan_lock` mutex prevents concurrent library scans.

## Configuration Constants

All configuration is centralized in `config.py`:

| Constant | Value | Purpose |
|----------|-------|---------|
| `DATA_DIR` | `~/.stem_splitter/` | User data directory |
| `DEFAULT_OUTPUT` | `~/Music/Stem Splitter Output/` | Default stem output location |
| `WINDOW_WIDTH` | 750 | Main window width |
| `WINDOW_HEIGHT` | 840 | Main window height |
| `WINDOW_MIN_SIZE` | (650, 560) | Minimum window dimensions |
| `AUDIO_HOST` | `127.0.0.1` | Audio server bind address |
| `ALLOWED_AUDIO_EXTENSIONS` | `.wav`, `.mp3`, `.flac`, `.ogg`, `.m4a`, `.wma`, `.aiff`, `.au` | Accepted input/output formats |
| `MODELS` | `htdemucs`, `htdemucs_6s` | Demucs model definitions with stem lists |
| `STEM_COLORS` | Per-stem hex colors | UI color coding for each stem type |
| `MIDI_ELIGIBLE_STEMS` | `vocals`, `bass`, `guitar`, `piano`, `drums` | Stems that support MIDI conversion |

## External Dependencies

Stem Splitter has no cloud dependencies. All processing runs locally:

| Dependency | Used For | Loaded When |
|------------|----------|-------------|
| Demucs (PyTorch) | Stem separation | Split operation via subprocess |
| basic-pitch (TensorFlow) | MIDI conversion | First MIDI conversion (lazy-installed via pip) |
| soundfile | WAV file I/O | Mix export |
| NumPy | Audio array operations | Mix export |
| pywebview | Desktop window + JS bridge | Application startup |
| nvidia-smi | GPU name detection | Setup phase |
| PyTorch CUDA wheels | GPU acceleration | Setup phase (if GPU detected) |
