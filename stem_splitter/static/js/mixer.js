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
  const midiMode = !!f._midiMode;

  // Separate solo checks: in MIDI mode only MIDI solos matter, in audio mode both matter
  const anyAudioSoloed = f.stems.some(s => s._soloed);
  const anyMidiSoloed = f.stems.some(s => s._midiSoloed);
  const anySoloed = anyAudioSoloed || anyMidiSoloed;

  // Audio stems
  if (f._audioEls) {
    f.stems.forEach((stem, si) => {
      const el = f._audioEls[si];
      if (!el) return;
      let vol = (stem._volume !== undefined ? stem._volume : 100) / 100;
      if (midiMode) vol = 0;                         // MIDI mode: silence all audio
      else if (stem._muted) vol = 0;
      else if (anySoloed && !stem._soloed) vol = 0;
      el.gain.gain.setValueAtTime(vol, ctx.currentTime);
    });
  }

  // MIDI gain nodes
  f.stems.forEach(stem => {
    if (!stem._midiGainNode) return;
    let vol = 1;
    if (midiMode) {                                   // MIDI mode: play all MIDI
      if (anyMidiSoloed && !stem._midiSoloed) vol = 0; // only respect MIDI solos
    } else {
      if (stem._midiMuted !== false) vol = 0;
      else if (anySoloed && !stem._midiSoloed) vol = 0;
    }
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

/**
 * Toggle all MIDI playback for a file.
 * If any MIDI track is unmuted, mute them all; otherwise unmute them all.
 * @param {string} src - 'queue' or 'lib'
 * @param {number} fi - File index
 */
function toggleMidiPlayback(src, fi) {
  const f = App.getFileObj(src, fi);
  if (!f || !f.stems) return;
  const midiStems = f.stems.filter(s => s._midiState === 'done' && s._midiPath);
  if (midiStems.length === 0) return;
  // Toggle between MIDI mode and audio mode
  f._midiMode = !f._midiMode;
  applyMixState(src, fi);
  renderFiles();
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
 * Per-instrument synthesis functions.
 * Each returns an array of {node, end} objects to track active voices.
 * Instruments are designed to match their real-world counterparts:
 *   drums  — 707-style kit (noise snare/hats, sine kick, triangle toms)
 *   bass   — low square wave with noise pluck transient
 *   guitar — detuned sawtooth + square through bandpass filter
 *   piano  — detuned triangle + square with fast hammer-like decay
 *   vocals — filtered sawtooth with slow attack (strings/vocal synth)
 *   other  — multi-voice detuned sawtooths (supersaw)
 */

/**
 * Create a white-noise buffer source for percussive sounds.
 * @param {AudioContext} ctx
 * @returns {AudioBufferSourceNode}
 */
function _createNoise(ctx) {
  const buf = ctx.createBuffer(1, ctx.sampleRate * 0.15, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  return src;
}

/**
 * 707-style drum kit.  Maps MIDI pitch regions to kick, snare, closed hat,
 * open hat, and toms.  Uses noise for snare/hats, sine with pitch sweep
 * for kick, triangle for toms.
 */
function _synthDrums(ctx, pitch, t0, dur, dest) {
  const nodes = [];
  // basic-pitch outputs arbitrary pitches from drum audio, so we map by
  // frequency range: low = kick, low-mid = snare/tom, mid = tom, high = hats
  const freq = midiToFreq(pitch);

  if (freq < 150) {
    // --- Kick: sine with pitch envelope ---
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(160, t0);
    osc.frequency.exponentialRampToValueAtTime(40, t0 + 0.12);
    env.gain.setValueAtTime(0.40, t0);
    env.gain.exponentialRampToValueAtTime(0.001, t0 + 0.30);
    osc.connect(env); env.connect(dest);
    osc.start(t0); osc.stop(t0 + 0.31);
    nodes.push({ osc, end: t0 + 0.31 });
  } else if (freq < 400) {
    // --- Snare: noise burst + sine body ---
    const noise = _createNoise(ctx);
    const nEnv = ctx.createGain();
    const hpf = ctx.createBiquadFilter();
    hpf.type = 'highpass'; hpf.frequency.value = 2000;
    nEnv.gain.setValueAtTime(0.28, t0);
    nEnv.gain.exponentialRampToValueAtTime(0.001, t0 + 0.15);
    noise.connect(hpf); hpf.connect(nEnv); nEnv.connect(dest);
    noise.start(t0); noise.stop(t0 + 0.16);
    // body
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = 'sine'; osc.frequency.value = 180;
    env.gain.setValueAtTime(0.22, t0);
    env.gain.exponentialRampToValueAtTime(0.001, t0 + 0.10);
    osc.connect(env); env.connect(dest);
    osc.start(t0); osc.stop(t0 + 0.11);
    nodes.push({ osc: noise, end: t0 + 0.16 }, { osc, end: t0 + 0.11 });
  } else if (freq < 1200) {
    // --- Toms: triangle with pitch sweep ---
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq * 1.3, t0);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.7, t0 + 0.04);
    env.gain.setValueAtTime(0.25, t0);
    env.gain.exponentialRampToValueAtTime(0.001, t0 + 0.20);
    osc.connect(env); env.connect(dest);
    osc.start(t0); osc.stop(t0 + 0.21);
    nodes.push({ osc, end: t0 + 0.21 });
  } else if (dur < 0.08) {
    // --- Closed hi-hat: short filtered noise ---
    const noise = _createNoise(ctx);
    const env = ctx.createGain();
    const bpf = ctx.createBiquadFilter();
    bpf.type = 'bandpass'; bpf.frequency.value = 8000; bpf.Q.value = 1.5;
    env.gain.setValueAtTime(0.18, t0);
    env.gain.exponentialRampToValueAtTime(0.001, t0 + 0.06);
    noise.connect(bpf); bpf.connect(env); env.connect(dest);
    noise.start(t0); noise.stop(t0 + 0.07);
    nodes.push({ osc: noise, end: t0 + 0.07 });
  } else {
    // --- Open hi-hat: longer filtered noise ---
    const noise = _createNoise(ctx);
    const env = ctx.createGain();
    const bpf = ctx.createBiquadFilter();
    bpf.type = 'bandpass'; bpf.frequency.value = 8000; bpf.Q.value = 1.0;
    env.gain.setValueAtTime(0.18, t0);
    env.gain.exponentialRampToValueAtTime(0.001, t0 + 0.25);
    noise.connect(bpf); bpf.connect(env); env.connect(dest);
    noise.start(t0); noise.stop(t0 + 0.26);
    nodes.push({ osc: noise, end: t0 + 0.26 });
  }
  return nodes;
}

/**
 * Bass: low square wave with a noise pluck transient layered on top.
 */
function _synthBass(ctx, pitch, t0, dur, dest) {
  const freq = midiToFreq(pitch);
  const nodes = [];

  // Main square voice
  const osc = ctx.createOscillator();
  const env = ctx.createGain();
  const lpf = ctx.createBiquadFilter();
  lpf.type = 'lowpass';
  lpf.frequency.setValueAtTime(800, t0);
  lpf.frequency.exponentialRampToValueAtTime(300, t0 + Math.min(0.15, dur * 0.5));
  osc.type = 'square';
  osc.frequency.value = freq;
  const atk = Math.min(0.005, dur * 0.1);
  env.gain.setValueAtTime(0, t0);
  env.gain.linearRampToValueAtTime(0.22, t0 + atk);
  env.gain.setValueAtTime(0.18, t0 + atk);
  env.gain.linearRampToValueAtTime(0, t0 + dur);
  osc.connect(lpf); lpf.connect(env); env.connect(dest);
  osc.start(t0); osc.stop(t0 + dur + 0.01);
  nodes.push({ osc, end: t0 + dur + 0.01 });

  // Noise pluck transient
  const noise = _createNoise(ctx);
  const nEnv = ctx.createGain();
  const bpf = ctx.createBiquadFilter();
  bpf.type = 'bandpass'; bpf.frequency.value = freq * 3; bpf.Q.value = 2;
  nEnv.gain.setValueAtTime(0.08, t0);
  nEnv.gain.exponentialRampToValueAtTime(0.001, t0 + 0.04);
  noise.connect(bpf); bpf.connect(nEnv); nEnv.connect(dest);
  noise.start(t0); noise.stop(t0 + 0.05);
  nodes.push({ osc: noise, end: t0 + 0.05 });

  return nodes;
}

/**
 * Guitar synth: detuned sawtooth + square through bandpass filter for body.
 */
function _synthGuitar(ctx, pitch, t0, dur, dest) {
  const freq = midiToFreq(pitch);
  const nodes = [];

  const bpf = ctx.createBiquadFilter();
  bpf.type = 'bandpass'; bpf.frequency.value = freq * 2.5; bpf.Q.value = 0.8;
  bpf.connect(dest);

  // Sawtooth voice
  const osc1 = ctx.createOscillator();
  const env1 = ctx.createGain();
  osc1.type = 'sawtooth'; osc1.frequency.value = freq; osc1.detune.value = 7;
  const atk = Math.min(0.005, dur * 0.1);
  const rel = Math.min(0.08, dur * 0.3);
  env1.gain.setValueAtTime(0, t0);
  env1.gain.linearRampToValueAtTime(0.10, t0 + atk);
  env1.gain.setValueAtTime(0.08, t0 + atk);
  env1.gain.linearRampToValueAtTime(0, t0 + dur);
  osc1.connect(env1); env1.connect(bpf);
  osc1.start(t0); osc1.stop(t0 + dur + 0.01);
  nodes.push({ osc: osc1, end: t0 + dur + 0.01 });

  // Square voice (detuned down)
  const osc2 = ctx.createOscillator();
  const env2 = ctx.createGain();
  osc2.type = 'square'; osc2.frequency.value = freq; osc2.detune.value = -7;
  env2.gain.setValueAtTime(0, t0);
  env2.gain.linearRampToValueAtTime(0.06, t0 + atk);
  env2.gain.setValueAtTime(0.05, t0 + atk);
  env2.gain.linearRampToValueAtTime(0, t0 + dur);
  osc2.connect(env2); env2.connect(bpf);
  osc2.start(t0); osc2.stop(t0 + dur + 0.01);
  nodes.push({ osc: osc2, end: t0 + dur + 0.01 });

  return nodes;
}

/**
 * Piano synth: detuned triangle + square with fast hammer attack and natural decay.
 */
function _synthPiano(ctx, pitch, t0, dur, dest) {
  const freq = midiToFreq(pitch);
  const nodes = [];
  const effDur = Math.max(0.08, dur);

  // Triangle voice (fundamental)
  const osc1 = ctx.createOscillator();
  const env1 = ctx.createGain();
  osc1.type = 'triangle'; osc1.frequency.value = freq;
  env1.gain.setValueAtTime(0, t0);
  env1.gain.linearRampToValueAtTime(0.12, t0 + 0.002); // hammer strike
  env1.gain.exponentialRampToValueAtTime(0.06, t0 + Math.min(0.15, effDur * 0.4));
  env1.gain.linearRampToValueAtTime(0, t0 + effDur);
  osc1.connect(env1); env1.connect(dest);
  osc1.start(t0); osc1.stop(t0 + effDur + 0.01);
  nodes.push({ osc: osc1, end: t0 + effDur + 0.01 });

  // Square voice (slight detune for warmth)
  const osc2 = ctx.createOscillator();
  const env2 = ctx.createGain();
  osc2.type = 'square'; osc2.frequency.value = freq; osc2.detune.value = 4;
  env2.gain.setValueAtTime(0, t0);
  env2.gain.linearRampToValueAtTime(0.05, t0 + 0.002);
  env2.gain.exponentialRampToValueAtTime(0.02, t0 + Math.min(0.12, effDur * 0.3));
  env2.gain.linearRampToValueAtTime(0, t0 + effDur);
  osc2.connect(env2); env2.connect(dest);
  osc2.start(t0); osc2.stop(t0 + effDur + 0.01);
  nodes.push({ osc: osc2, end: t0 + effDur + 0.01 });

  return nodes;
}

/**
 * Vocals/strings: filtered sawtooth with slow attack for a pad-like vocal synth.
 */
function _synthVocals(ctx, pitch, t0, dur, dest) {
  const freq = midiToFreq(pitch);
  const nodes = [];
  const effDur = Math.max(0.1, dur);

  const lpf = ctx.createBiquadFilter();
  lpf.type = 'lowpass'; lpf.frequency.value = freq * 3; lpf.Q.value = 0.7;
  lpf.connect(dest);

  // Sawtooth voice 1 (main)
  const osc1 = ctx.createOscillator();
  const env1 = ctx.createGain();
  osc1.type = 'sawtooth'; osc1.frequency.value = freq; osc1.detune.value = 3;
  const atk = Math.min(0.04, effDur * 0.25);
  const rel = Math.min(0.10, effDur * 0.3);
  env1.gain.setValueAtTime(0, t0);
  env1.gain.linearRampToValueAtTime(0.10, t0 + atk);
  if (effDur > atk + rel) {
    env1.gain.setValueAtTime(0.08, t0 + atk);
    env1.gain.linearRampToValueAtTime(0, t0 + effDur);
  } else {
    env1.gain.linearRampToValueAtTime(0, t0 + effDur);
  }
  osc1.connect(env1); env1.connect(lpf);
  osc1.start(t0); osc1.stop(t0 + effDur + 0.01);
  nodes.push({ osc: osc1, end: t0 + effDur + 0.01 });

  // Triangle voice 2 (octave up, softer — shimmer)
  const osc2 = ctx.createOscillator();
  const env2 = ctx.createGain();
  osc2.type = 'triangle'; osc2.frequency.value = freq * 2; osc2.detune.value = -5;
  env2.gain.setValueAtTime(0, t0);
  env2.gain.linearRampToValueAtTime(0.04, t0 + atk * 1.5);
  env2.gain.linearRampToValueAtTime(0, t0 + effDur);
  osc2.connect(env2); env2.connect(lpf);
  osc2.start(t0); osc2.stop(t0 + effDur + 0.01);
  nodes.push({ osc: osc2, end: t0 + effDur + 0.01 });

  return nodes;
}

/**
 * Other/default: multi-voice detuned sawtooths (supersaw).
 */
function _synthOther(ctx, pitch, t0, dur, dest) {
  const freq = midiToFreq(pitch);
  const nodes = [];
  const effDur = Math.max(0.06, dur);
  const detunes = [-12, -5, 0, 5, 12]; // 5 voices
  const perVoiceGain = 0.04;
  const atk = Math.min(0.01, effDur * 0.15);

  detunes.forEach(d => {
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = 'sawtooth'; osc.frequency.value = freq; osc.detune.value = d;
    env.gain.setValueAtTime(0, t0);
    env.gain.linearRampToValueAtTime(perVoiceGain, t0 + atk);
    env.gain.setValueAtTime(perVoiceGain * 0.85, t0 + atk);
    env.gain.linearRampToValueAtTime(0, t0 + effDur);
    osc.connect(env); env.connect(dest);
    osc.start(t0); osc.stop(t0 + effDur + 0.01);
    nodes.push({ osc, end: t0 + effDur + 0.01 });
  });

  return nodes;
}

/** Map stem names to their synthesis functions */
const MIDI_SYNTHS = {
  drums:   _synthDrums,
  bass:    _synthBass,
  guitar:  _synthGuitar,
  piano:   _synthPiano,
  vocals:  _synthVocals,
  other:   _synthOther,
  _default: _synthOther,
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
    const justCreated = !stem._midiGainNode;
    ensureMidiGain(stem);
    // Sync gain after creation so it matches MIDI mode / mute state
    if (justCreated) {
      const anyMidiSoloed = f.stems.some(s => s._midiSoloed);
      const anySoloed = f.stems.some(s => s._soloed || s._midiSoloed);
      let vol = 1;
      if (f._midiMode) {
        if (anyMidiSoloed && !stem._midiSoloed) vol = 0;
      } else {
        if (stem._midiMuted !== false) vol = 0;
        else if (anySoloed && !stem._midiSoloed) vol = 0;
      }
      stem._midiGainNode.gain.setValueAtTime(vol, ctx.currentTime);
    }
    if (stem._midiNextNoteIdx === undefined) stem._midiNextNoteIdx = 0;
    if (!stem._midiActiveOscs) stem._midiActiveOscs = [];

    const synthFn = MIDI_SYNTHS[stem.name] || MIDI_SYNTHS._default;

    // Clean up expired oscillators
    stem._midiActiveOscs = stem._midiActiveOscs.filter(o => o.end > ctx.currentTime);

    // Schedule notes within lookahead window
    const notes = stem._midiNotes;
    const lookahead = 0.15;
    while (stem._midiNextNoteIdx < notes.length) {
      const n = notes[stem._midiNextNoteIdx];
      if (n[0] > mediaTime + lookahead) break;
      if (n[0] < mediaTime - 0.05) { stem._midiNextNoteIdx++; continue; }

      if (stem._midiActiveOscs.length < 48) {
        const delay = Math.max(0, n[0] - mediaTime);
        const t0 = ctx.currentTime + delay;
        const dur = Math.max(0.05, n[1] - n[0]);

        const newNodes = synthFn(ctx, n[2], t0, dur, stem._midiGainNode);
        stem._midiActiveOscs.push(...newNodes);
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

