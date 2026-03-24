<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="stem_splitter/assets/StemSplitterLogo.png">
    <source media="(prefers-color-scheme: light)" srcset="stem_splitter/assets/StemSplitterLogoWhite.png">
    <img alt="Stem Splitter" src="stem_splitter/assets/StemSplitterLogo.png" width="320">
  </picture>
</p>

<p align="center">
  <strong>AI-powered audio stem separation with a professional mixing interface</strong>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-22d3ee?style=for-the-badge" alt="MIT License"></a>
  <img src="https://img.shields.io/badge/version-2.0.0-818cf8?style=for-the-badge" alt="Version 2.0.0">
  <img src="https://img.shields.io/badge/python-3.11+-3776AB?style=for-the-badge&logo=python&logoColor=white" alt="Python 3.11+">
  <img src="https://img.shields.io/badge/platform-Windows-0078D4?style=for-the-badge&logo=windows&logoColor=white" alt="Windows">
  <img src="https://img.shields.io/badge/AI-Demucs%20%C2%B7%20PyTorch-EE4C2C?style=for-the-badge&logo=pytorch&logoColor=white" alt="Demucs PyTorch">
  <img src="https://img.shields.io/badge/GPU-CUDA%20Accelerated-76B900?style=for-the-badge&logo=nvidia&logoColor=white" alt="CUDA Accelerated">
</p>

<br>

<p align="center">
  Split any song into <strong>vocals</strong>, <strong>drums</strong>, <strong>bass</strong>, <strong>guitar</strong>, <strong>piano</strong>, and <strong>other</strong> — then play, mix, and export stems right in the app.
</p>

<br>

---

<br>

## Features

<table>
  <tr>
    <td width="50%">

**Stem Separation**
> Split audio into 4 or 6 stems using Meta's Demucs deep learning model. Supports WAV, MP3, FLAC, OGG, M4A, WMA, AIFF, and AU.

**Real-Time Mixer**
> Per-stem volume sliders, mute/solo toggles, and synchronized playback via the Web Audio API.

**Waveform Display**
> Normalized waveform visualization for every stem with a real-time playhead indicator.

  </td>
  <td width="50%">

**MIDI Conversion**
> Convert vocals, drums, bass, guitar, or piano stems to MIDI using Spotify's basic-pitch model. Notes are visualized on the waveform.

**GPU Acceleration**
> Automatically detects NVIDIA GPUs and installs CUDA-enabled PyTorch for significantly faster processing.

**EQ Spectrum**
> Live 8-band frequency spectrum visualization (60 Hz – 12 kHz) during playback.

  </td>
  </tr>
</table>

<p align="center">
  <sub>
    Also: batch processing &bull; song library &bull; mix export to WAV &bull; dark / light / system themes &bull; high-contrast mode &bull; automatic first-run setup
  </sub>
</p>

<br>

---

<br>

## Quick Start

```bash
# Clone the repository
git clone https://github.com/Prime8Chris/Stem-Splitter.git
cd Stem-Splitter

# Create a virtual environment
python -m venv venv
venv\Scripts\activate

# Install dependencies
pip install pywebview
pip install -r requirements.txt

# Launch
python -m stem_splitter
```

Or on Windows, double-click **`Stem Splitter.bat`**.

> [!NOTE]
> On first launch, a splash screen handles all setup automatically — installing Demucs, detecting your GPU, and configuring CUDA PyTorch if available. This is cached so subsequent launches are instant.

<br>

---

<br>

## How It Works

```
  Audio File (.mp3, .wav, .flac, ...)
          │
          ▼
  ┌───────────────┐
  │    Demucs      │   AI stem separation (Meta)
  │   (PyTorch)    │   4-stem or 6-stem model
  └───────┬───────┘
          │
    ┌─────┼─────┬─────┬─────┬─────┐
    ▼     ▼     ▼     ▼     ▼     ▼
 Vocals Drums  Bass Guitar Piano Other
    │     │     │     │     │     │
    └─────┴─────┴─────┴─────┴─────┘
          │
          ▼
  ┌───────────────┐
  │  Stem Mixer    │   Play, mix, mute, solo
  │  + Waveforms   │   Volume control per stem
  │  + EQ Display  │   Real-time visualization
  └───────┬───────┘
          │
    ┌─────┴─────┐
    ▼           ▼
  Export      MIDI
  (.wav)     (.mid)
```

<br>

---

<br>

## Usage

| Step | Action |
|:----:|--------|
| **1** | Click the drop zone or **Browse** to add audio files |
| **2** | Choose a model — **4 stems** (vocals, drums, bass, other) or **6 stems** (+ guitar, piano) |
| **3** | Set your output directory (default: `~/Music/Stem Splitter Output/`) |
| **4** | Select **CPU** or **GPU** if available |
| **5** | Click **Split** — real-time progress is displayed |
| **6** | Expand a completed file to access the **mixer panel** |
| **7** | Adjust volume, mute/solo stems, click **MIDI** to convert |
| **8** | Click **Export Mix** to save your custom stem combination |

<br>

---

<br>

## Output Structure

```
~/Music/Stem Splitter Output/
├── htdemucs/                    ← 4-stem model
│   └── My Song/
│       ├── vocals.wav
│       ├── drums.wav
│       ├── bass.wav
│       └── other.wav
└── htdemucs_6s/                 ← 6-stem model
    └── My Song/
        ├── vocals.wav
        ├── vocals.mid           ← MIDI (when converted)
        ├── drums.wav
        ├── bass.wav
        ├── guitar.wav
        ├── piano.wav
        └── other.wav
```

<br>

---

<br>

## Tech Stack

<table>
  <tr>
    <td><strong>Desktop</strong></td>
    <td><a href="https://pywebview.flowrl.com/">pywebview</a> — native window with embedded web UI</td>
  </tr>
  <tr>
    <td><strong>Separation</strong></td>
    <td><a href="https://github.com/facebookresearch/demucs">Demucs</a> — Meta's audio source separation model (PyTorch)</td>
  </tr>
  <tr>
    <td><strong>MIDI</strong></td>
    <td><a href="https://github.com/spotify/basic-pitch">basic-pitch</a> — Spotify's pitch detection model (TensorFlow)</td>
  </tr>
  <tr>
    <td><strong>Audio</strong></td>
    <td>Web Audio API &bull; soundfile &bull; NumPy</td>
  </tr>
  <tr>
    <td><strong>Frontend</strong></td>
    <td>Vanilla JavaScript &bull; CSS glassmorphism &bull; Canvas 2D</td>
  </tr>
  <tr>
    <td><strong>Testing</strong></td>
    <td>pytest (backend) &bull; Jest + jsdom (frontend)</td>
  </tr>
</table>

<br>

---

<br>

## Requirements

| Requirement | Details |
|-------------|---------|
| **Python** | 3.11 or higher |
| **pip** | For automatic dependency installation at first launch |
| **NVIDIA GPU** | Optional — enables CUDA acceleration for faster splits |
| **pywebview** | Installed separately ([requires platform-specific backend](https://pywebview.flowrl.com/guide/installation.html)) |

<br>

---

<br>

<details>
<summary><strong>Project Structure</strong></summary>

<br>

```
Stem Splitter/
├── Stem Splitter.bat              # Windows launcher (pythonw, no console)
├── requirements.txt               # Python dependencies
├── stem_splitter/
│   ├── __init__.py                # Package version (2.0.0)
│   ├── __main__.py                # Entry point → app.main()
│   ├── app.py                     # Splash screen, HTML assembly, window lifecycle
│   ├── api.py                     # Python ↔ JavaScript bridge (all backend methods)
│   ├── config.py                  # Constants: paths, models, colors, formats
│   ├── processing.py              # DemucsProcessor + MidiConverter (subprocess wrappers)
│   ├── server.py                  # HTTP audio server with path/extension/magic-byte validation
│   ├── settings.py                # User preferences (JSON, schema-validated, cached)
│   ├── setup.py                   # First-run dependency installation + GPU detection
│   ├── assets/                    # Application logos (dark + light)
│   ├── static/
│   │   ├── index.html             # HTML template
│   │   ├── style.css              # Glassmorphism UI + theme variables
│   │   └── js/
│   │       ├── app.js             # State management, initialization
│   │       ├── mixer.js           # Web Audio playback, gain, mute/solo
│   │       ├── waveform.js        # Waveform generation + MIDI note overlay
│   │       ├── eq.js              # 8-band EQ frequency spectrum
│   │       ├── render.js          # DOM rendering + event handlers
│   │       ├── settings.js        # Theme + high-contrast management
│   │       └── __tests__/         # Jest frontend tests
│   └── tests/                     # pytest backend tests
└── docs/                          # Full documentation suite
```

</details>

<details>
<summary><strong>Testing</strong></summary>

<br>

**Backend (pytest):**
```bash
python -m pytest stem_splitter/tests/ -v
```

**Frontend (Jest):**
```bash
cd stem_splitter/static/js
npm install
npm test
```

See [docs/TESTING.md](docs/TESTING.md) for test architecture, mocking patterns, and coverage details.

</details>

<details>
<summary><strong>Security</strong></summary>

<br>

Stem Splitter runs entirely offline with no cloud dependencies, API keys, or telemetry.

- **Audio server** binds to `127.0.0.1` only — inaccessible from other machines
- **3-layer file validation** — directory allowlist, extension whitelist, magic byte verification
- **JS bridge injection prevention** — all Python-to-JS arguments serialized via `json.dumps()`
- **Subprocess isolation** — ML models run in separate processes (crash + memory isolation)
- **Settings integrity** — schema validation with automatic backup for corruption recovery

See [docs/SECURITY.md](docs/SECURITY.md) for the full security model.

</details>

<details>
<summary><strong>User Data</strong></summary>

<br>

Settings and state are stored in `~/.stem_splitter/`:

| File | Purpose |
|------|---------|
| `settings.json` | Theme and accessibility preferences |
| `settings.json.bak` | Automatic backup for corruption recovery |
| `setup_state.json` | Cached dependency check results |
| `logs/stem_splitter.log` | Application warnings and errors |

</details>

<br>

---

<br>

## Documentation

| Document | Description |
|----------|-------------|
| [Architecture](docs/ARCHITECTURE.md) | System design, data flow, module responsibilities, threading model |
| [Setup Guide](docs/SETUP.md) | Installation, configuration, GPU setup, troubleshooting |
| [User Guide](docs/USER_GUIDE.md) | Complete walkthrough of every feature |
| [API Reference](docs/API_REFERENCE.md) | Python API, JS modules, audio server endpoints |
| [Security](docs/SECURITY.md) | Security model and threat mitigations |
| [Testing](docs/TESTING.md) | Test architecture, running tests, writing new tests |
| [Contributing](docs/CONTRIBUTING.md) | Code conventions and development workflow |

<br>

---

<p align="center">
  <sub>Built with Demucs by Meta and basic-pitch by Spotify</sub>
</p>
