# Security Model

Stem Splitter runs entirely locally with no cloud dependencies, authentication, or telemetry. Its security concerns center on the HTTP audio server, the Python-to-JavaScript bridge, and subprocess management.

## Audio Server Security

The internal HTTP server (`server.py`) streams audio files from disk to the Web Audio API. It binds exclusively to `127.0.0.1` (localhost) on a randomly selected port, making it inaccessible from other machines.

### Path Validation

Every audio file request (`GET /audio?path=...`) passes through three validation layers:

**1. Directory allowlist**

```python
real_path = os.path.realpath(file_path)
return any(
    real_path.startswith(os.path.realpath(d) + os.sep)
    or real_path == os.path.realpath(d)
    for d in allowed_dirs
)
```

The server maintains a list of allowed directories:
- `assets/` (application logos)
- The project root directory
- The current output directory

File paths are resolved to their real path (following symlinks, resolving `..` components) before checking against the allowlist. This prevents directory traversal attacks like `../../etc/passwd`.

Path traversal attempts are logged as warnings.

**2. Extension validation**

Only files with these extensions are served: `.wav`, `.mp3`, `.flac`, `.ogg`, `.m4a`, `.wma`, `.aiff`, `.au`.

**3. Magic byte verification**

Before serving a file, its header bytes are compared against known audio format signatures:

| Extension | Expected Header |
|-----------|----------------|
| `.wav` | `RIFF` at offset 0 |
| `.mp3` | `ID3`, `\xff\xfb`, `\xff\xf3`, or `\xff\xf2` at offset 0 |
| `.flac` | `fLaC` at offset 0 |
| `.ogg` | `OggS` at offset 0 |
| `.m4a` | `ftyp` at offset 4 |
| `.aiff` | `FORM` at offset 0 |
| `.au` | `.snd` at offset 0 |
| `.wma` | ASF header GUID at offset 0 |

This prevents serving arbitrary files that have been renamed with an audio extension.

### CORS Headers

The server sends `Access-Control-Allow-Origin: *` on all responses. This is necessary because pywebview's `html=` mode loads content with origin `null`, making any localhost fetch cross-origin. The actual security boundary is the path validation described above, not CORS restrictions. Since the server only binds to `127.0.0.1`, it is not accessible from other machines regardless of CORS policy.

### Range Request Support

The server supports HTTP Range requests (`206 Partial Content`) for efficient audio streaming. Files are streamed in 64 KB chunks rather than loaded entirely into memory.

## JavaScript Bridge Security

Communication from Python to JavaScript uses `window.evaluate_js()` to call JS functions. The `_js_call()` method serializes every argument with `json.dumps()`:

```python
def _js_call(self, func_name, *args):
    args_json = ", ".join(json.dumps(a) for a in args)
    self._js(f"{func_name}({args_json})")
```

This prevents injection of raw JavaScript through user-controlled data (file names, paths, error messages). For example, a file named `"); alert("xss"); //` would be serialized as `"\"\\); alert(\\\"xss\\\"); //"` — a safe JSON string, not executable code.

JS evaluation failures are caught and logged, not propagated to the user.

## Subprocess Isolation

ML models (Demucs, basic-pitch) run in separate Python subprocesses rather than in the main application process. This provides:

- **Memory isolation** — Model memory is freed when the subprocess exits
- **Crash isolation** — A model crash doesn't take down the application
- **Cancellation** — Subprocesses can be terminated cleanly via `process.terminate()`
- **No TensorFlow in main process** — basic-pitch's TensorFlow dependency is only loaded in its subprocess

### Subprocess Flags

On Windows, all subprocesses are created with `subprocess.CREATE_NO_WINDOW` to prevent console windows from flashing.

## Dependency Installation

The application installs dependencies via `pip` at runtime:

- **Demucs** — Installed during first-run setup if not present
- **CUDA PyTorch** — Installed during setup if an NVIDIA GPU is detected (`--index-url https://download.pytorch.org/whl/cu121`)
- **basic-pitch** — Lazily installed on first MIDI conversion

All pip commands use `--quiet` to suppress output and have timeouts (600s for Demucs/basic-pitch, 900s for CUDA PyTorch).

## File System Access

The application writes to two locations:

1. **User data directory** (`~/.stem_splitter/`) — Settings, setup state, logs
2. **Output directory** (`~/Music/Stem Splitter Output/` or user-selected) — Separated stems, MIDI files, exported mixes

The application does not modify any other files on disk. The user data directory is created at import time by `config.py`.

## Logging

The application logs at `WARNING` level to `~/.stem_splitter/logs/stem_splitter.log`. Security-relevant events logged include:
- Path traversal attempts blocked by the audio server
- Magic byte mismatches
- JS evaluation failures
- Settings file corruption

## Summary of Security Boundaries

| Boundary | Mechanism |
|----------|-----------|
| Network exposure | Server binds to `127.0.0.1` only |
| File access | Directory allowlist + extension check + magic byte validation |
| JS injection | All Python→JS arguments serialized via `json.dumps()` |
| Process isolation | ML models run as subprocesses |
| Settings integrity | Schema validation + backup file for corruption recovery |
| Dependency installs | pip with timeouts; no arbitrary code execution |
