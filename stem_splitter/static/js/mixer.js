/**
 * Stem Splitter — Audio playback and mixer controls.
 * Depends on App namespace from app.js.
 */

/** Resume the AudioContext if it was suspended by the browser's autoplay policy. */
function resumeAudioCtx() {
  const ctx = App.audioCtx;
  if (ctx && ctx.state === 'suspended') ctx.resume();
}

/**
 * Create (or return cached) Audio elements and Web Audio nodes for a file's stems.
 * @param {string} src - 'queue' or 'lib'
 * @param {number} idx - File index
 * @returns {Object[]|null} Array of {audio, gain, analyser} per stem
 */
function ensureAudioEls(src, idx) {
  const f = App.getFileObj(src, idx);
  if (!f || !f.stems) return null;
  if (f._audioEls) return f._audioEls;

  const ctx = App.getAudioCtx();
  const els = [];
  f.stems.forEach(stem => {
    const audio = new Audio(App.audioUrl(stem.path));
    audio.preload = 'metadata';
    audio.crossOrigin = 'anonymous';
    const mediaNode = ctx.createMediaElementSource(audio);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.7;
    const gain = ctx.createGain();
    mediaNode.connect(analyser);
    analyser.connect(gain);
    gain.connect(ctx.destination);
    els.push({ audio, gain, analyser });
  });
  f._audioEls = els;

  els[0].audio.addEventListener('ended', () => {
    if (App.activePlayer && App.activePlayer.src === src && App.activePlayer.idx === idx) {
      App.activePlayer.playing = false;
      cancelAnimationFrame(App.animFrameId);
      renderFiles();
    }
  });

  return els;
}

/**
 * Start or pause playback for a file.
 * @param {string} src - 'queue' or 'lib'
 * @param {number} idx - File index
 */
function togglePlay(src, idx) {
  App.getAudioCtx();
  resumeAudioCtx();

  const key = App.playerKey(src, idx);

  if (App.activePlayer && App.activePlayer.key === key && App.activePlayer.playing) {
    pausePlayback();
    return;
  }

  if (App.activePlayer && App.activePlayer.key !== key) {
    stopPlaybackInternal();
  }

  const els = ensureAudioEls(src, idx);
  App.activePlayer = { key, src, idx, playing: true };

  applyMixState(src, idx);
  els.forEach(e => e.audio.play());

  startTimeUpdate();
  renderFiles();
}

/** Pause the currently playing file without resetting position. */
function pausePlayback() {
  if (!App.activePlayer || !App.activePlayer.playing) return;
  const f = App.getFileObj(App.activePlayer.src, App.activePlayer.idx);
  if (f && f._audioEls) f._audioEls.forEach(e => e.audio.pause());
  stopMidiOscillators(f);
  App.activePlayer.playing = false;
  cancelAnimationFrame(App.animFrameId);
  renderFiles();
}

/** Stop playback and reset to the beginning. */
function stopPlayback() {
  stopPlaybackInternal();
  renderFiles();
}

/** Internal stop — pauses audio, resets time, clears activePlayer. Does not re-render. */
function stopPlaybackInternal() {
  if (!App.activePlayer) return;
  const f = App.getFileObj(App.activePlayer.src, App.activePlayer.idx);
  if (f && f._audioEls) {
    f._audioEls.forEach(e => { e.audio.pause(); e.audio.currentTime = 0; });
  }
  stopMidiOscillators(f);
  App.activePlayer.playing = false;
  App.activePlayer = null;
  cancelAnimationFrame(App.animFrameId);
}

/**
 * Seek all stems to a position.
 * @param {string} src - 'queue' or 'lib'
 * @param {number} idx - File index
 * @param {number} val - Seek position 0–1000 (mapped to duration)
 */
function seekTo(src, idx, val) {
  resumeAudioCtx();
  const f = App.getFileObj(src, idx);
  if (!f || !f._audioEls) return;
  const audio0 = f._audioEls[0].audio;
  const dur = audio0.duration;
  if (!dur || !isFinite(dur)) return;
  const t = (val / 1000) * dur;
  f._audioEls.forEach(e => { e.audio.currentTime = t; });
  resetMidiForSeek(f, t);
}

/**
 * Seek to a position by clicking on a waveform canvas.
 * @param {MouseEvent} event
 * @param {string} src - 'queue' or 'lib'
 * @param {number} idx - File index
 */
function seekFromWaveform(event, src, idx) {
  const rect = event.currentTarget.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const ratio = x / rect.width;
  seekTo(src, idx, ratio * 1000);
}

/**
 * Apply current volume/mute/solo state to all audio stems and MIDI gain nodes.
 * @param {string} src - 'queue' or 'lib'
 * @param {number} idx - File index
 */
function applyMixState(src, idx) {
  const f = App.getFileObj(src, idx);
  if (!f) return;
  const ctx = App.getAudioCtx();
  // Unified solo: if ANY audio stem or MIDI track is soloed, only soloed sources play
  const anySoloed = f.stems.some(s => s._soloed || s._midiSoloed);

  // Audio stems
  if (f._audioEls) {
    f.stems.forEach((stem, si) => {
      const el = f._audioEls[si];
      if (!el) return;
      let vol = (stem._volume !== undefined ? stem._volume : 100) / 100;
      if (stem._muted) vol = 0;
      else if (anySoloed && !stem._soloed) vol = 0;
      el.gain.gain.setValueAtTime(vol, ctx.currentTime);
    });
  }

  // MIDI gain nodes
  f.stems.forEach(stem => {
    if (!stem._midiGainNode) return;
    let vol = 1;
    if (stem._midiMuted !== false) vol = 0;
    else if (anySoloed && !stem._midiSoloed) vol = 0;
    stem._midiGainNode.gain.setValueAtTime(vol, ctx.currentTime);
  });
}

/**
 * @param {string} src - 'queue' or 'lib'
 * @param {number} fi - File index
 * @param {number} si - Stem index
 * @param {string|number} val - Volume 0–100
 */
function setStemVolume(src, fi, si, val) {
  const stem = App.getStem(src, fi, si);
  if (!stem) return;
  stem._volume = parseInt(val);
  applyMixState(src, fi);
}

/**
 * @param {string} src - 'queue' or 'lib'
 * @param {number} fi - File index
 * @param {number} si - Stem index
 */
function toggleSolo(src, fi, si) {
  const stem = App.getStem(src, fi, si);
  if (!stem) return;
  if (!stem._soloed) {
    // Activating solo: save current state, clear mute
    stem._mutedBeforeSolo = stem._muted;
    stem._soloed = true;
    stem._muted = false;
  } else {
    // Deactivating solo: restore previous mute state
    stem._soloed = false;
    stem._muted = !!stem._mutedBeforeSolo;
  }
  applyMixState(src, fi);
  renderFiles();
}

/**
 * @param {string} src - 'queue' or 'lib'
 * @param {number} fi - File index
 * @param {number} si - Stem index
 */
function toggleMute(src, fi, si) {
  const stem = App.getStem(src, fi, si);
  if (!stem) return;
  if (!stem._muted) {
    // Activating mute: save current state, clear solo
    stem._soloedBeforeMute = stem._soloed;
    stem._muted = true;
    stem._soloed = false;
  } else {
    // Deactivating mute: restore previous solo state
    stem._muted = false;
    stem._soloed = !!stem._soloedBeforeMute;
  }
  applyMixState(src, fi);
  renderFiles();
}

/**
 * Copy a stem's file path to the clipboard.
 * @param {string} src - 'queue' or 'lib'
 * @param {number} fi - File index
 * @param {number} si - Stem index
 */
function copyStem(src, fi, si) {
  const stem = App.getStem(src, fi, si);
  if (!stem) return;
  pywebview.api.copy_to_clipboard(stem.path);
  App.showToast('Path copied to clipboard', 'success');
}

/**
 * Copy a stem's MIDI file path to the clipboard.
 * @param {string} src - 'queue' or 'lib'
 * @param {number} fi - File index
 * @param {number} si - Stem index
 */
function copyMidiPath(src, fi, si) {
  const stem = App.getStem(src, fi, si);
  if (!stem) return;
  if (stem._midiPath) {
    pywebview.api.copy_to_clipboard(stem._midiPath);
    App.showToast('MIDI path copied to clipboard', 'success');
  }
}

/**
 * Open the folder containing a stem's MIDI file in the OS file manager.
 * @param {string} src - 'queue' or 'lib'
 * @param {number} fi - File index
 * @param {number} si - Stem index
 */
function openMidiFolder(src, fi, si) {
  const stem = App.getStem(src, fi, si);
  if (!stem) return;
  if (stem._midiPath) {
    pywebview.api.open_file_location(stem._midiPath);
  }
}

/** @param {string} src @param {number} fi @param {number} si */
function toggleMidiMute(src, fi, si) {
  const stem = App.getStem(src, fi, si);
  if (!stem) return;
  if (!stem._midiMuted) {
    // Activating mute: save current state, clear solo
    stem._midiSoloedBeforeMute = stem._midiSoloed;
    stem._midiMuted = true;
    stem._midiSoloed = false;
  } else {
    // Deactivating mute: restore previous solo state
    stem._midiMuted = false;
    stem._midiSoloed = !!stem._midiSoloedBeforeMute;
  }
  applyMixState(src, fi);
  renderFiles();
}

/** @param {string} src @param {number} fi @param {number} si */
function toggleMidiSolo(src, fi, si) {
  const stem = App.getStem(src, fi, si);
  if (!stem) return;
  if (!stem._midiSoloed) {
    // Activating solo: save current state, clear mute
    stem._midiMutedBeforeSolo = stem._midiMuted;
    stem._midiSoloed = true;
    stem._midiMuted = false;
  } else {
    // Deactivating solo: restore previous mute state
    stem._midiSoloed = false;
    stem._midiMuted = !!stem._midiMutedBeforeSolo;
  }
  applyMixState(src, fi);
  renderFiles();
}

/**
 * Lazily load MIDI note data for all stems that have completed conversion.
 * @param {string} src - 'queue' or 'lib'
 * @param {number} idx - File index
 */
function loadMidiNotesIfNeeded(src, idx) {
  const f = App.getFileObj(src, idx);
  if (!f || !f.stems) return;
  f.stems.forEach(stem => {
    if (stem._midiState === 'done' && stem._midiPath &&
        (!stem._midiNotes || stem._midiNotes.length === 0) &&
        !stem._midiNotesLoading) {
      stem._midiNotesLoading = true;
      pywebview.api.load_midi_notes(stem._midiPath).then(result => {
        stem._midiNotesLoading = false;
        if (result) {
          try {
            const notes = typeof result === 'string' ? JSON.parse(result) : result;
            if (notes.length > 0) {
              stem._midiNotes = notes;
              renderFiles();
            }
          } catch (e) { /* parse error */ }
        }
      });
    }
  });
}

/**
 * Start MIDI conversion for a stem via the backend.
 * @param {string} src - 'queue' or 'lib'
 * @param {number} fi - File index
 * @param {number} si - Stem index
 */
function convertToMidi(src, fi, si) {
  const stem = App.getStem(src, fi, si);
  if (!stem) return;
  if (stem._midiState === 'converting') return;
  stem._midiState = 'converting';
  updateProgress(5, 'Converting ' + stem.name + ' to MIDI...');
  renderFiles();
  pywebview.api.convert_to_midi(stem.path, stem.name);
  App.showToast('Converting ' + stem.name + ' to MIDI...', 'success');
}

/**
 * @param {string} stemPath - Path of the stem being converted
 * @param {string} status - Progress status text
 */
function midiConvertProgress(stemPath, status) {
  // Find the stem across all files and library items and update state
  const stem = App.findStemByPath(stemPath);
  if (stem) {
    stem._midiState = 'converting';
  }
}

/**
 * @param {string} stemPath - Path of the source stem
 * @param {boolean} success - Whether conversion succeeded
 * @param {string} resultPath - MIDI file path on success, error message on failure
 * @param {Array<number[]>} [notes] - Note events [[start, end, pitch], ...]
 */
function midiConvertDone(stemPath, success, resultPath, notes) {
  const stem = App.findStemByPath(stemPath);
  if (stem) {
    if (success) {
      stem._midiState = 'done';
      stem._midiPath = resultPath;
      stem._midiNotes = notes || [];
      stem._midiMuted = true;
      stem._midiSoloed = false;
      updateProgress(100, 'MIDI conversion complete');
      App.showToast('MIDI saved: ' + resultPath.split(/[\\/]/).pop(), 'success');
    } else {
      stem._midiState = 'error';
      updateProgress(0, 'MIDI conversion failed');
      App.showToast('MIDI conversion failed: ' + resultPath, 'error');
    }
    // Auto-reset progress bar after a short delay
    setTimeout(() => {
      if (!App.splitting) updateProgress(0, 'Ready');
    }, 3000);
    renderFiles();
  }
}

/** Start the animation loop that syncs UI (waveforms, EQ, time, MIDI) with playback. */
function startTimeUpdate() {
  const f = App.getFileObj(App.activePlayer.src, App.activePlayer.idx);

  if (f && f._audioEls) {
    f.stems.forEach((stem, si) => {
      if (!stem._waveform && !stem._waveformLoading) {
        generateWaveform(App.activePlayer.src, App.activePlayer.idx, si);
      }
    });
    // Reset MIDI scheduling to current playback position
    const mediaTime = f._audioEls[0].audio.currentTime || 0;
    resetMidiForSeek(f, mediaTime);
  }

  function update() {
    if (!App.activePlayer) return;
    const f = App.getFileObj(App.activePlayer.src, App.activePlayer.idx);
    if (!f || !f._audioEls) return;
    const audio = f._audioEls[0].audio;
    const elapsed = audio.currentTime || 0;
    const dur = audio.duration || 0;
    const uid = App.activePlayer.src + '-' + App.activePlayer.idx;
    const progress = dur ? elapsed / dur : 0;

    // Drift correction: only hard-reset if a stem drifts significantly.
    // Avoid playbackRate nudging — it causes audible phasing/flanging.
    const HARD_THRESHOLD = 0.05;  // >50ms: snap back immediately
    for (let i = 1; i < f._audioEls.length; i++) {
      const other = f._audioEls[i].audio;
      const drift = Math.abs(other.currentTime - elapsed);
      if (drift > HARD_THRESHOLD) {
        other.currentTime = elapsed;
      }
    }

    const timeEl = document.getElementById('time-' + uid);
    const seekEl = document.getElementById('seek-' + uid);
    if (timeEl && dur) timeEl.textContent = App.formatTime(elapsed) + ' / ' + App.formatTime(dur);
    if (seekEl && dur && !seekEl.matches(':active')) seekEl.value = progress * 1000;

    f.stems.forEach((stem, si) => {
      const color = App.STEM_COLORS[stem.name] || '#888';
      const waveCanvasId = 'wave-' + uid + '-' + si;
      const eqCanvasId = 'eq-' + uid + '-' + si;
      const phId = 'ph-wave-' + uid + '-' + si;

      drawWaveform(waveCanvasId, stem._waveform || null, color, progress);

      const ph = document.getElementById(phId);
      if (ph) ph.style.left = (progress * 100) + '%';

      if (f._audioEls[si]) {
        drawEQ(eqCanvasId, f._audioEls[si].analyser, color);
      }

      // Update MIDI note visualization if available
      if (stem._midiNotes && stem._midiNotes.length > 0) {
        const midiCanvasId = 'midi-' + uid + '-' + si;
        const midiPhId = 'ph-midi-' + uid + '-' + si;
        drawMidiNotes(midiCanvasId, stem._midiNotes, color, progress, dur);
        const midiPh = document.getElementById(midiPhId);
        if (midiPh) midiPh.style.left = (progress * 100) + '%';
      }
    });

    // Schedule MIDI note playback
    if (App.activePlayer.playing) {
      scheduleMidiPlayback(f, elapsed);
    }

    if (App.activePlayer.playing) App.animFrameId = requestAnimationFrame(update);
  }
  cancelAnimationFrame(App.animFrameId);
  App.animFrameId = requestAnimationFrame(update);
}

// --- MIDI Synthesis Engine ---

/**
 * Per-instrument voice configuration for MIDI synthesis.
 * Each entry defines oscillator type, amplitude, attack/release ratios,
 * and optional detune for a richer sound.
 * @type {Object<string, {type: OscillatorType, gain: number, atk: number, rel: number, detune: number}>}
 */
const MIDI_VOICES = {
  bass:    { type: 'sine',     gain: 0.20, atk: 0.005, rel: 0.06, detune: 0 },
  vocals:  { type: 'triangle', gain: 0.14, atk: 0.02,  rel: 0.08, detune: 3 },
  guitar:  { type: 'sawtooth', gain: 0.10, atk: 0.005, rel: 0.05, detune: 5 },
  piano:   { type: 'square',   gain: 0.08, atk: 0.002, rel: 0.10, detune: 0 },
  drums:   { type: 'triangle', gain: 0.18, atk: 0.001, rel: 0.03, detune: 0 },
  _default:{ type: 'triangle', gain: 0.12, atk: 0.01,  rel: 0.04, detune: 0 },
};

/**
 * Convert a MIDI pitch number to frequency in Hz.
 * @param {number} pitch - MIDI note number (0–127)
 * @returns {number} Frequency in Hz
 */
function midiToFreq(pitch) {
  return 440 * Math.pow(2, (pitch - 69) / 12);
}

/** @param {StemObj} stem - Create a gain node for MIDI synthesis if not already present */
function ensureMidiGain(stem) {
  if (stem._midiGainNode) return;
  const ctx = App.getAudioCtx();
  stem._midiGainNode = ctx.createGain();
  // Default muted
  stem._midiGainNode.gain.value = (stem._midiMuted !== false) ? 0 : 1;
  stem._midiGainNode.connect(ctx.destination);
}

/**
 * Schedule upcoming MIDI notes as oscillators within a lookahead window.
 * Uses per-instrument voice profiles for more realistic timbres.
 * @param {FileObj} f - File with stems containing MIDI notes
 * @param {number} mediaTime - Current playback position in seconds
 */
function scheduleMidiPlayback(f, mediaTime) {
  const ctx = App.getAudioCtx();
  f.stems.forEach(stem => {
    if (!stem._midiNotes || stem._midiNotes.length === 0) return;
    ensureMidiGain(stem);
    if (stem._midiNextNoteIdx === undefined) stem._midiNextNoteIdx = 0;
    if (!stem._midiActiveOscs) stem._midiActiveOscs = [];

    const voice = MIDI_VOICES[stem.name] || MIDI_VOICES._default;

    // Clean up expired oscillators
    stem._midiActiveOscs = stem._midiActiveOscs.filter(o => o.end > ctx.currentTime);

    // Schedule notes within lookahead window
    const notes = stem._midiNotes;
    const lookahead = 0.15;
    while (stem._midiNextNoteIdx < notes.length) {
      const n = notes[stem._midiNextNoteIdx];
      if (n[0] > mediaTime + lookahead) break;
      if (n[0] < mediaTime - 0.05) { stem._midiNextNoteIdx++; continue; }

      if (stem._midiActiveOscs.length < 32) {
        const delay = Math.max(0, n[0] - mediaTime);
        const t0 = ctx.currentTime + delay;
        const dur = Math.max(0.05, n[1] - n[0]);

        const osc = ctx.createOscillator();
        const env = ctx.createGain();
        osc.type = voice.type;
        osc.frequency.value = midiToFreq(n[2]);
        if (voice.detune) osc.detune.value = voice.detune;

        const atk = Math.min(voice.atk, dur * 0.2);
        const rel = Math.min(voice.rel, dur * 0.4);
        const sustain = voice.gain * 0.85;
        env.gain.setValueAtTime(0, t0);
        env.gain.linearRampToValueAtTime(voice.gain, t0 + atk);
        if (dur > atk + rel) {
          env.gain.setValueAtTime(sustain, t0 + atk + (dur - atk - rel) * 0.3);
          env.gain.setValueAtTime(sustain, t0 + dur - rel);
        }
        env.gain.linearRampToValueAtTime(0, t0 + dur);

        osc.connect(env);
        env.connect(stem._midiGainNode);
        osc.start(t0);
        osc.stop(t0 + dur + 0.01);
        stem._midiActiveOscs.push({ osc, end: t0 + dur + 0.01 });
      }
      stem._midiNextNoteIdx++;
    }
  });
}

/** @param {FileObj|null} f - Stop and disconnect all active MIDI oscillators */
function stopMidiOscillators(f) {
  if (!f || !f.stems) return;
  f.stems.forEach(stem => {
    if (stem._midiActiveOscs) {
      for (let i = 0; i < stem._midiActiveOscs.length; i++) {
        try { stem._midiActiveOscs[i].osc.stop(); } catch(e) { /* already stopped */ }
        try { stem._midiActiveOscs[i].osc.disconnect(); } catch(e) { /* already disconnected */ }
      }
      stem._midiActiveOscs = [];
    }
    stem._midiNextNoteIdx = 0;
  });
}

/**
 * Reset MIDI playback state when the user seeks to a new position.
 * @param {FileObj|null} f
 * @param {number} mediaTime - New playback position in seconds
 */
function resetMidiForSeek(f, mediaTime) {
  if (!f || !f.stems) return;
  f.stems.forEach(stem => {
    if (!stem._midiNotes) return;
    // Stop all active oscillators
    if (stem._midiActiveOscs) {
      for (let i = 0; i < stem._midiActiveOscs.length; i++) {
        try { stem._midiActiveOscs[i].osc.stop(); } catch(e) { /* already stopped */ }
        try { stem._midiActiveOscs[i].osc.disconnect(); } catch(e) { /* already disconnected */ }
      }
      stem._midiActiveOscs = [];
    }
    // Binary search for note index at new position
    const notes = stem._midiNotes;
    let lo = 0, hi = notes.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (notes[mid][0] < mediaTime) lo = mid + 1;
      else hi = mid;
    }
    stem._midiNextNoteIdx = lo;
  });
}

