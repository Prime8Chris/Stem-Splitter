/**
 * Stem Splitter — Waveform generation and rendering.
 * Depends on App namespace from app.js.
 */

/**
 * Draw cached waveforms (or trigger generation) for all stems when a mixer panel opens.
 * @param {string} src - 'queue' or 'lib'
 * @param {number} idx - File index
 * @param {FileObj} f - File object with stems
 */
function drawStaticWaveforms(src, idx, f) {
  if (!f || !f.stems) return;
  const uid = src + '-' + idx;
  const audio0 = f._audioEls ? f._audioEls[0].audio : null;
  const dur = audio0 ? audio0.duration : 0;
  const elapsed = audio0 ? audio0.currentTime : 0;
  const progress = dur ? elapsed / dur : 0;

  f.stems.forEach((stem, si) => {
    const color = App.STEM_COLORS[stem.name] || '#888';
    const waveCanvasId = 'wave-' + uid + '-' + si;
    const phId = 'ph-wave-' + uid + '-' + si;

    if (stem._waveform) {
      drawWaveform(waveCanvasId, stem._waveform, color, progress);
      const ph = document.getElementById(phId);
      if (ph) ph.style.left = (progress * 100) + '%';
    } else if (!stem._waveformLoading) {
      generateWaveform(src, idx, si).then(wf => {
        if (wf) drawWaveform(waveCanvasId, wf, color, progress);
      });
    }

    // Draw MIDI notes if available
    if (stem._midiNotes && stem._midiNotes.length > 0) {
      const midiCanvasId = 'midi-' + uid + '-' + si;
      const midiPhId = 'ph-midi-' + uid + '-' + si;
      drawMidiNotes(midiCanvasId, stem._midiNotes, color, progress, dur);
      const midiPh = document.getElementById(midiPhId);
      if (midiPh) midiPh.style.left = (progress * 100) + '%';
    }
  });
}

/**
 * Fetch audio data and compute normalized peak amplitudes for waveform display.
 * Prevents duplicate concurrent loads via loading flags.
 * @param {string} src - 'queue' or 'lib'
 * @param {number} idx - File index
 * @param {number} si - Stem index
 * @returns {Promise<number[]|null>} Normalized peaks array (0–1) or null on error
 */
async function generateWaveform(src, idx, si) {
  const f = App.getFileObj(src, idx);
  if (!f || !f.stems || !f.stems[si]) return null;

  // Prevent duplicate concurrent loads
  if (f.stems[si]._waveform) return f.stems[si]._waveform;
  if (f.stems[si]._waveformLoading) return f.stems[si]._waveformPromise;

  f.stems[si]._waveformLoading = true;

  const promise = (async () => {
    try {
      const url = App.audioUrl(f.stems[si].path);
      const resp = await fetch(url);
      const buf = await resp.arrayBuffer();
      const ctx = App.getAudioCtx();
      const decoded = await ctx.decodeAudioData(buf);
      const raw = decoded.getChannelData(0);
      const samples = 200;
      const blockSize = Math.floor(raw.length / samples);
      const peaks = [];
      for (let i = 0; i < samples; i++) {
        let sum = 0;
        for (let j = 0; j < blockSize; j++) {
          sum += Math.abs(raw[i * blockSize + j]);
        }
        peaks.push(sum / blockSize);
      }
      const max = Math.max(...peaks, 0.01);
      const normalized = peaks.map(p => p / max);
      f.stems[si]._waveform = normalized;
      return normalized;
    } catch (e) {
      return null;
    } finally {
      f.stems[si]._waveformLoading = false;
      f.stems[si]._waveformPromise = null;
    }
  })();

  f.stems[si]._waveformPromise = promise;
  return promise;
}

/**
 * Render a waveform bar chart onto a canvas element.
 * @param {string} canvasId - DOM id of the target canvas
 * @param {number[]|null} waveform - Normalized peak amplitudes
 * @param {string} color - CSS color for the bars
 * @param {number} progress - Playback progress 0–1
 */
function drawWaveform(canvasId, waveform, color, progress) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.offsetWidth;
  const h = canvas.offsetHeight;
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  ctx.clearRect(0, 0, w, h);

  if (!waveform || waveform.length === 0) return;

  const barW = Math.max(1, w / waveform.length - 0.5);
  const playedIdx = Math.floor(progress * waveform.length);

  for (let i = 0; i < waveform.length; i++) {
    const barH = Math.max(1, waveform[i] * h * 0.9);
    const x = (i / waveform.length) * w;
    const y = (h - barH) / 2;

    ctx.fillStyle = color;
    ctx.globalAlpha = i <= playedIdx ? 0.8 : 0.2;
    ctx.fillRect(x, y, barW, barH);
  }
  ctx.globalAlpha = 1;
}

/**
 * Render MIDI notes as a piano-roll visualization on a canvas.
 * @param {string} canvasId - DOM id of the target canvas
 * @param {Array<number[]>} notes - Note events [[start, end, pitch], ...]
 * @param {string} color - CSS color for the note rectangles
 * @param {number} progress - Playback progress 0–1
 * @param {number} duration - Total audio duration in seconds
 */
function drawMidiNotes(canvasId, notes, color, progress, duration) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.offsetWidth;
  const h = canvas.offsetHeight;
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  ctx.clearRect(0, 0, w, h);

  if (!notes || notes.length === 0) return;

  // Use audio duration if available, otherwise derive from notes
  if (!duration || !isFinite(duration) || duration <= 0) {
    duration = 0;
    for (let i = 0; i < notes.length; i++) {
      if (notes[i][1] > duration) duration = notes[i][1];
    }
  }
  if (duration <= 0) return;

  // Find pitch range for vertical mapping
  let minPitch = 127, maxPitch = 0;
  for (let i = 0; i < notes.length; i++) {
    const p = notes[i][2];
    if (p < minPitch) minPitch = p;
    if (p > maxPitch) maxPitch = p;
  }
  const pitchRange = Math.max(maxPitch - minPitch, 1);
  const playedTime = progress * duration;

  // Note height: scale to fill the canvas, min 1px, max 4px
  const noteH = Math.max(1, Math.min(4, (h - 2) / pitchRange));
  const vPad = 1;

  for (let i = 0; i < notes.length; i++) {
    const startT = notes[i][0];
    const endT = notes[i][1];
    const pitch = notes[i][2];

    const x = (startT / duration) * w;
    const noteW = Math.max(1, ((endT - startT) / duration) * w);
    // Map pitch: high pitches at top, low at bottom
    const y = vPad + ((maxPitch - pitch) / pitchRange) * (h - noteH - vPad * 2);

    ctx.fillStyle = color;
    ctx.globalAlpha = endT <= playedTime ? 0.85 : (startT <= playedTime ? 0.65 : 0.2);
    ctx.fillRect(x, y, noteW, noteH);
  }
  ctx.globalAlpha = 1;
}
