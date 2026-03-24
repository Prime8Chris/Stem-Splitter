/**
 * Stem Splitter — EQ spectrum visualization.
 * Depends on App namespace from app.js.
 */

/** Reusable buffer for EQ frequency data (avoids per-frame allocation). */
let _eqDataBuf = null;

/**
 * Draw an 8-band EQ frequency spectrum visualization.
 * @param {string} canvasId - DOM id of the target canvas
 * @param {AnalyserNode|null} analyser - Web Audio analyser node for frequency data
 * @param {string} color - CSS color for the bars
 */
function drawEQ(canvasId, analyser, color) {
  const canvas = document.getElementById(canvasId);
  if (!canvas || !analyser) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.offsetWidth;
  const h = canvas.offsetHeight;
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  ctx.clearRect(0, 0, w, h);

  const bufLen = analyser.frequencyBinCount;
  if (!_eqDataBuf || _eqDataBuf.length !== bufLen) _eqDataBuf = new Uint8Array(bufLen);
  analyser.getByteFrequencyData(_eqDataBuf);
  const data = _eqDataBuf;

  const sampleRate = App.getAudioCtx().sampleRate;
  const binHz = sampleRate / analyser.fftSize;
  const bandEdges = [0, 60, 150, 400, 1000, 2500, 6000, 12000, sampleRate / 2];
  const bands = bandEdges.length - 1;
  const barW = w / bands - 1;

  for (let i = 0; i < bands; i++) {
    const startBin = Math.max(0, Math.floor(bandEdges[i] / binHz));
    const endBin = Math.min(bufLen - 1, Math.floor(bandEdges[i + 1] / binHz));
    let sum = 0;
    let count = 0;
    for (let j = startBin; j <= endBin; j++) {
      sum += data[j];
      count++;
    }
    const avg = count > 0 ? (sum / count / 255) : 0;
    const barH = Math.max(1, avg * h);

    const gradient = ctx.createLinearGradient(0, h, 0, h - barH);
    gradient.addColorStop(0, color);
    gradient.addColorStop(1, color + '33');
    ctx.fillStyle = gradient;
    ctx.fillRect(i * (barW + 1) + 0.5, h - barH, barW, barH);
  }
}
