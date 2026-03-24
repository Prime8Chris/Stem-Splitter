<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="stem_splitter/assets/StemSplitterLogo.png">
    <source media="(prefers-color-scheme: light)" srcset="stem_splitter/assets/StemSplitterLogoWhite.png">
    <img alt="Stem Splitter" src="stem_splitter/assets/StemSplitterLogo.png" width="320">
  </picture>
</p>

<h3 align="center">Open Source Stem Separation Tool</h3>

<p align="center">
  Split any song into <strong>vocals</strong>, <strong>drums</strong>, <strong>bass</strong>, <strong>guitar</strong>, <strong>piano</strong>, and <strong>other</strong><br>
  then play, mix, and export stems right in the app.
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-22d3ee?style=flat-square" alt="MIT License"></a>
  <img src="https://img.shields.io/badge/version-2.0.0-818cf8?style=flat-square" alt="Version 2.0.0">
  <img src="https://img.shields.io/badge/python-3.11+-3776AB?style=flat-square&logo=python&logoColor=white" alt="Python 3.11+">
  <img src="https://img.shields.io/badge/platform-Windows-0078D4?style=flat-square&logo=windows&logoColor=white" alt="Windows">
</p>

---

<p align="center">
  <img src="stem_splitter/assets/Stem Splitter Screenshot.png?v=2" alt="Stem Splitter — Main Interface" width="800">
</p>

<p align="center">
  <img src="stem_splitter/assets/Stem Splitter Screenshot2.png?v=2" alt="Stem Splitter — Mixer Panel" width="800">
</p>

---

## Features

| | Feature | Description |
|:-:|---------|-------------|
| :scissors: | **Stem Separation** | Split audio into 4 or 6 stems using Meta's Demucs. Supports WAV, MP3, FLAC, OGG, M4A, WMA, AIFF, and AU. |
| :control_knobs: | **Real-Time Mixer** | Per-stem volume sliders, mute/solo toggles, and synchronized playback via Web Audio API. |
| :ocean: | **Waveform Display** | Normalized waveform visualization for every stem with a real-time playhead. |
| :musical_keyboard: | **MIDI Conversion** | Convert stems to MIDI using Spotify's basic-pitch. Notes visualized as a piano roll overlay. |
| :zap: | **GPU Acceleration** | Auto-detects NVIDIA GPUs and configures CUDA PyTorch for faster processing. |
| :bar_chart: | **EQ Spectrum** | Live 8-band frequency spectrum (60 Hz – 12 kHz) during playback. |
| :file_folder: | **Batch Processing** | Queue multiple songs and split them all in one run. |
| :floppy_disk: | **Mix Export** | Export your custom stem combination as a single WAV file. |
| :art: | **Themes** | Dark, light, and system themes with high-contrast accessibility mode. |

---

## Quick Start

```bash
# Clone
git clone https://github.com/Prime8Chris/Stem-Splitter.git
cd Stem-Splitter

# Set up environment
python -m venv venv
venv\Scripts\activate

# Install
pip install pywebview
pip install -r requirements.txt

# Launch
python -m stem_splitter
```

Or on Windows, double-click **`Stem Splitter.bat`**.

> [!NOTE]
> On first launch, a splash screen handles all setup automatically — installing Demucs, detecting your GPU, and configuring CUDA PyTorch if available. Subsequent launches are instant.

---

## How It Works

```
  Audio File (.mp3, .wav, .flac, ...)
          |
          v
  +---------------+
  |    Demucs      |   Meta's AI stem separation
  |   (PyTorch)    |   4-stem or 6-stem model
  +-------+-------+
          |
    +-----+-----+-----+-----+-----+
    v     v     v     v     v     v
 Vocals Drums  Bass Guitar Piano Other
    |     |     |     |     |     |
    +-----+-----+-----+-----+-----+
          |
          v
  +---------------+
  |  Stem Mixer    |   Play, mix, mute, solo
  |  + Waveforms   |   Volume control per stem
  |  + EQ Display  |   Real-time visualization
  +-------+-------+
          |
    +-----+-----+
    v           v
  Export      MIDI
  (.wav)     (.mid)
```

---

## Usage

| Step | Action |
|:----:|--------|
| **1** | Click the drop zone or **Browse** to add audio files |
| **2** | Choose a model — **4 stems** or **6 stems** (+ guitar, piano) |
| **3** | Set your output directory |
| **4** | Select **CPU** or **GPU** if available |
| **5** | Click **Split** — progress is displayed in real time |
| **6** | Expand a completed file to open the **mixer panel** |
| **7** | Adjust volume, mute/solo stems, convert to **MIDI** |
| **8** | Click **Export Mix** to save your combination |

---

## Output Structure

```
~/Music/Stem Splitter Output/
├── htdemucs/                    # 4-stem model
│   └── My Song/
│       ├── vocals.wav
│       ├── drums.wav
│       ├── bass.wav
│       └── other.wav
└── htdemucs_6s/                 # 6-stem model
    └── My Song/
        ├── vocals.wav
        ├── vocals.mid           # MIDI (when converted)
        ├── drums.wav
        ├── bass.wav
        ├── guitar.wav
        ├── piano.wav
        └── other.wav
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Desktop** | [pywebview](https://pywebview.flowrl.com/) — native window with embedded web UI |
| **Separation** | [Demucs](https://github.com/facebookresearch/demucs) — Meta's source separation model (PyTorch) |
| **MIDI** | [basic-pitch](https://github.com/spotify/basic-pitch) — Spotify's pitch detection (TensorFlow) |
| **Audio** | Web Audio API, soundfile, NumPy |
| **Frontend** | Vanilla JS, CSS glassmorphism, Canvas 2D |
| **Testing** | pytest (backend), Jest + jsdom (frontend) |

---

## Requirements

| Requirement | Details |
|-------------|---------|
| **Python** | 3.11 or higher |
| **pip** | For automatic dependency installation at first launch |
| **NVIDIA GPU** | Optional — enables CUDA acceleration for faster splits |
| **pywebview** | Installed separately ([platform-specific backend](https://pywebview.flowrl.com/guide/installation.html)) |

---

<details>
<summary><strong>Project Structure</strong></summary>

```
Stem Splitter/
├── Stem Splitter.bat              # Windows launcher
├── requirements.txt
├── stem_splitter/
│   ├── __init__.py
│   ├── __main__.py                # Entry point
│   ├── app.py                     # Splash screen, window lifecycle
│   ├── api.py                     # Python <-> JS bridge
│   ├── config.py                  # Constants
│   ├── processing.py              # Demucs + MIDI conversion
│   ├── server.py                  # Local audio server
│   ├── settings.py                # User preferences
│   ├── setup.py                   # First-run setup
│   ├── assets/                    # Logos
│   ├── static/
│   │   ├── index.html
│   │   ├── style.css
│   │   └── js/
│   │       ├── app.js             # State management
│   │       ├── mixer.js           # Audio playback
│   │       ├── waveform.js        # Waveform rendering
│   │       ├── eq.js              # EQ spectrum
│   │       ├── render.js          # DOM rendering
│   │       ├── settings.js        # Theme management
│   │       └── __tests__/
│   └── tests/
└── docs/
```

</details>

<details>
<summary><strong>Testing</strong></summary>

**Backend:**
```bash
python -m pytest stem_splitter/tests/ -v
```

**Frontend:**
```bash
cd stem_splitter/static/js
npm install
npm test
```

See [docs/TESTING.md](docs/TESTING.md) for details.

</details>

<details>
<summary><strong>Security</strong></summary>

Stem Splitter runs entirely offline — no cloud dependencies, API keys, or telemetry.

- Audio server binds to `127.0.0.1` only
- 3-layer file validation (directory allowlist, extension whitelist, magic bytes)
- All Python-to-JS arguments serialized via `json.dumps()`
- ML models run in isolated subprocesses
- Settings use schema validation with automatic backup

See [docs/SECURITY.md](docs/SECURITY.md) for the full security model.

</details>

<details>
<summary><strong>User Data</strong></summary>

Settings are stored in `~/.stem_splitter/`:

| File | Purpose |
|------|---------|
| `settings.json` | Theme and accessibility preferences |
| `settings.json.bak` | Automatic backup |
| `setup_state.json` | Cached dependency check results |
| `logs/stem_splitter.log` | Warnings and errors |

</details>

---

## Documentation

| Document | Description |
|----------|-------------|
| [Architecture](docs/ARCHITECTURE.md) | System design, data flow, threading model |
| [Setup Guide](docs/SETUP.md) | Installation, configuration, GPU setup |
| [User Guide](docs/USER_GUIDE.md) | Complete feature walkthrough |
| [API Reference](docs/API_REFERENCE.md) | Python API, JS modules, server endpoints |
| [Security](docs/SECURITY.md) | Security model and mitigations |
| [Testing](docs/TESTING.md) | Test architecture and coverage |
| [Contributing](docs/CONTRIBUTING.md) | Code conventions and workflow |

---

<p align="center">
  <sub>Built with <a href="https://github.com/facebookresearch/demucs">Demucs</a> by Meta and <a href="https://github.com/spotify/basic-pitch">basic-pitch</a> by Spotify</sub>
</p>
