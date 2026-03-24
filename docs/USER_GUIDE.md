# User Guide

## Interface Overview

Stem Splitter's interface is organized into several sections:

```
┌─────────────────────────────────────────┐
│  [Logo]                    [⚙ Settings] │
├─────────────────────────────────────────┤
│                                         │
│      ♫ Drop files here or Browse        │
│                                         │
├─────────────────────────────────────────┤
│  Model: [4 stems ▼]                    │
│  Output: [~/Music/Stem Splitter...]  📁│
│  Device: [CPU ▼]                       │
│  [Split]  [Cancel]                      │
│  [████████████░░░░░░░░] 65% Separating  │
├─────────────────────────────────────────┤
│  Queue:                                 │
│    song1.mp3  [SPLIT] [✕]              │
│    song2.flac [SPLIT] [✕]              │
│                                         │
│  Previous Splits:                       │
│    MySong (4 stems) [✕]   ▶ expand     │
│    Another (6 stems) [✕]  ▶ expand     │
└─────────────────────────────────────────┘
```

## Adding Files

Click the drop zone area or the "Browse" button to open a file dialog. Select one or more audio files. Supported formats: WAV, MP3, FLAC, OGG, M4A, WMA, AIFF, AU.

Selected files appear in the **Queue** section. Each file shows its name, a "SPLIT" button (for individual splitting), and a remove button.

## Choosing a Model

Use the **Model** dropdown to select:

| Model | Stems Produced | Use Case |
|-------|---------------|----------|
| **4 stems** (htdemucs) | vocals, drums, bass, other | General-purpose separation; faster |
| **6 stems** (htdemucs_6s) | vocals, drums, bass, guitar, piano, other | More detailed separation for complex arrangements |

The "other" stem contains everything not captured by the named stems.

## Setting the Output Directory

The default output directory is `~/Music/Stem Splitter Output/`. Click the folder icon next to the output path to choose a different location. The output structure is:

```
output_dir/
└── model_name/
    └── song_name/
        ├── vocals.wav
        ├── drums.wav
        ├── bass.wav
        └── other.wav  (or additional stems for 6-stem model)
```

## Selecting a Device

If an NVIDIA GPU was detected during setup, the **Device** dropdown offers:
- **CPU** — Uses processor; slower but always available
- **GPU (GPU Name)** — Uses CUDA acceleration; significantly faster

Without a detected GPU, only CPU is shown.

## Splitting Audio

### Single file
Click the "SPLIT" button next to a specific file in the queue.

### Batch processing
Click the main "Split" button to process all queued files sequentially. Progress is displayed as:
- An overall progress bar with percentage
- A status message showing which file is being processed (e.g., "Separating 2/5: song.mp3")

### Cancelling
Click "Cancel" during a split to stop the current Demucs process. Already-completed files retain their output.

## Playing Stems

After splitting, expand a file to reveal its **mixer panel**. Each stem has:

- **Play/Pause button** — Click the play button on any stem row to start playback. All stems play simultaneously in sync.
- **Waveform display** — Shows the audio waveform for the stem. A playhead indicator moves across during playback.
- **Volume slider** — Adjust the stem's volume from 0% to 100%.
- **Mute button** — Silence the stem without changing its volume setting.
- **Solo button** — When any stem is soloed, only soloed stems are audible. Multiple stems can be soloed at once.

### Playback Behavior

- Clicking play starts all stems from the beginning (or from the last position)
- All stems are synchronized — they start and stop together
- Volume, mute, and solo changes take effect immediately during playback
- The EQ spectrum visualization (8 frequency bands from 60 Hz to 12 kHz) animates during playback

## MIDI Conversion

Eligible stems (vocals, drums, bass, guitar, piano) show a **MIDI** button. Clicking it:

1. Installs `basic-pitch` if not already present (first-time only; requires internet)
2. Runs pitch detection on the stem's WAV file
3. Writes a `.mid` file alongside the WAV file
4. Displays extracted MIDI notes overlaid on the stem's waveform

The MIDI file is saved in the same directory as the stem (e.g., `vocals.mid` next to `vocals.wav`).

### MIDI Note Visualization

After conversion, colored rectangles appear on the waveform canvas representing detected notes:
- Horizontal position = time
- Vertical position = pitch
- Width = note duration

## Exporting a Mix

The **Export Mix** button at the bottom of a mixer panel saves a custom combination of stems to a single WAV file. The export respects:

- **Volume levels** — Each stem's volume slider value is applied
- **Mute state** — Muted stems are excluded
- **Solo state** — If any stems are soloed, only those are included
- **Peak normalization** — The output is normalized to prevent clipping

A file save dialog lets you choose the output location and filename.

## Song Library

The **Previous Splits** section automatically lists songs that were previously separated and still exist in the output directory. These are loaded by scanning the output directory structure on startup and after each split operation.

Each library entry shows:
- Song name
- Model used (4 stems or 6 stems)
- Remove button (removes from the list, does not delete files)
- Expandable mixer panel with the same playback controls as newly split files

If a stem has an existing `.mid` file, its MIDI notes are loaded automatically.

## Settings

Click the gear icon in the header to open the settings panel:

### Theme

| Option | Description |
|--------|-------------|
| **Dark** | Dark background with light text (default) |
| **Light** | Light background with dark text |
| **System** | Follows the operating system's dark/light preference |

### High Contrast

Toggle high-contrast mode for improved readability. When enabled, UI elements have stronger borders and increased color contrast.

Settings are saved immediately and persist across sessions in `~/.stem_splitter/settings.json`.

## Keyboard and Mouse Interactions

- **File browsing** — Click the drop zone or Browse button
- **Expand/collapse mixer** — Click on a file entry in the list
- **Settings panel** — Click the gear icon; click outside or the close button to dismiss
- **Open output folder** — Click the folder open button after a split completes
