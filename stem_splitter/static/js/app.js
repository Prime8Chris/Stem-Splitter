/**
 * Stem Splitter — Main application state and initialization.
 * All modules share state via the App namespace.
 *
 * @typedef {Object} StemObj
 * @property {string} name - Stem name (e.g. 'vocals', 'drums')
 * @property {string} path - Absolute file path to the stem WAV
 * @property {boolean} _muted - Whether this stem is muted
 * @property {boolean} _soloed - Whether this stem is soloed
 * @property {number} _volume - Volume 0–100
 * @property {Float32Array[]|null} _waveform - Cached waveform peaks
 * @property {string|undefined} _midiState - 'idle'|'converting'|'done'|'error'
 * @property {string|undefined} _midiPath - Path to converted MIDI file
 * @property {Array<number[]>|undefined} _midiNotes - MIDI note events [[start, end, pitch], ...]
 *
 * @typedef {Object} FileObj
 * @property {string} name - Display file name
 * @property {string} path - Absolute file path
 * @property {string} status - 'pending'|'processing'|'done'
 * @property {StemObj[]|null} stems - Array of stem objects after splitting
 * @property {string|undefined} stemDir - Directory containing stems
 * @property {Object[]|null} _audioEls - Audio element wrappers
 *
 * @typedef {Object} ActivePlayer
 * @property {string} key - Player key (src:idx)
 * @property {string} src - 'queue' or 'lib'
 * @property {number} idx - File index
 * @property {boolean} playing - Whether currently playing
 */

const App = {
  /** @type {number} */
  AUDIO_PORT: __AUDIO_PORT__,
  /** @type {Object<string, string>} */
  STEM_COLORS: {
    vocals: '#f472b6', drums: '#818cf8', bass: '#34d399',
    other: '#fbbf24', guitar: '#fb923c', piano: '#22d3ee'
  },
  /** @type {Set<string>} */
  MIDI_ELIGIBLE_STEMS: new Set(['vocals', 'bass', 'guitar', 'piano', 'drums']),

  // State
  /** @type {FileObj[]} */
  files: [],
  /** @type {FileObj[]} */
  library: [],
  /** @type {number} */
  expandedIndex: -1,
  /** @type {number} */
  expandedLibIndex: -1,
  /** @type {AudioContext|null} */
  audioCtx: null,
  /** @type {ActivePlayer|null} */
  activePlayer: null,
  /** @type {number|null} */
  animFrameId: null,
  /** @type {boolean} */
  outputReady: false,
  /** @type {boolean} */
  splitting: false,

  /** @returns {AudioContext} */
  getAudioCtx() {
    if (!this.audioCtx) this.audioCtx = new AudioContext();
    return this.audioCtx;
  },

  /**
   * @param {string} filePath - Absolute path to an audio file
   * @returns {string} URL to fetch the file from the local audio server
   */
  audioUrl(filePath) {
    return 'http://127.0.0.1:' + this.AUDIO_PORT + '/audio?path=' + encodeURIComponent(filePath);
  },

  /**
   * @param {string} src - 'queue' or 'lib'
   * @param {number} idx - Index into the files or library array
   * @returns {FileObj|null}
   */
  getFileObj(src, idx) {
    const arr = src === 'lib' ? this.library : this.files;
    return (idx >= 0 && idx < arr.length) ? arr[idx] : null;
  },

  /**
   * @param {string} src - 'queue' or 'lib'
   * @param {number} idx - File index
   * @returns {string} Unique key for identifying active players
   */
  playerKey(src, idx) {
    return src + ':' + idx;
  },

  /**
   * @param {number} s - Time in seconds
   * @returns {string} Formatted as "m:ss"
   */
  formatTime(s) {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return m + ':' + (sec < 10 ? '0' : '') + sec;
  },

  /**
   * @param {string} msg - Message to display
   * @param {string} type - 'success' or 'error'
   */
  /**
   * Get a specific stem object, or null if not found.
   * @param {string} src - 'queue' or 'lib'
   * @param {number} fi - File index
   * @param {number} si - Stem index
   * @returns {StemObj|null}
   */
  getStem(src, fi, si) {
    const f = this.getFileObj(src, fi);
    return (f && f.stems && f.stems[si]) ? f.stems[si] : null;
  },

  /**
   * Initialize default state on a stem object.
   * @param {StemObj} s
   */
  initStemState(s) {
    s._muted = false;
    s._soloed = false;
    s._volume = 100;
  },

  /**
   * Search all files and library items for a stem matching the given path.
   * @param {string} stemPath
   * @returns {StemObj|null}
   */
  findStemByPath(stemPath) {
    for (const f of this.files) {
      if (f.stems) {
        const s = f.stems.find(st => st.path === stemPath);
        if (s) return s;
      }
    }
    for (const f of this.library) {
      if (f.stems) {
        const s = f.stems.find(st => st.path === stemPath);
        if (s) return s;
      }
    }
    return null;
  },

  showToast(msg, type) {
    const toast = document.getElementById('toast');
    toast.textContent = msg;
    toast.className = 'toast ' + type;
    setTimeout(() => toast.classList.add('show'), 10);
    setTimeout(() => toast.classList.remove('show'), 4000);
  }
};

// --- File Management ---

/** Opens a file picker and adds selected audio files to the queue. */
function addFiles() {
  pywebview.api.pick_files().then(result => {
    if (!result) return;
    const newFiles = JSON.parse(result);
    // Move completed splits to library before adding new songs
    const done = App.files.filter(f => f.status === 'done' && f.stems);
    if (done.length > 0) {
      done.forEach(f => {
        cleanupAudioEls(f);
        // Convert to library format
        const libItem = {
          name: f.name.replace(/\.[^.]+$/, ''),
          model: f._splitModel || document.getElementById('modelSelect').value,
          stemDir: f.stemDir || '',
          stems: f.stems,
          timestamp: Date.now() / 1000,
          _buffers: null
        };
        // Avoid duplicates in library
        if (!App.library.find(l => l.stemDir === libItem.stemDir)) {
          App.library.push(libItem);
        }
      });
      App.files = App.files.filter(f => f.status !== 'done');
      App.library.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
      if (App.expandedIndex >= 0) App.expandedIndex = -1;
      stopPlayback();
    }
    newFiles.forEach(f => {
      if (!App.files.find(x => x.path === f.path)) {
        App.files.push({ ...f, status: 'pending', stems: null, stemDir: null });
      }
    });
    renderFiles();
  });
}

/**
 * @param {number} index - File index to remove
 * @param {Event} e - Click event (propagation stopped)
 */
function removeFile(index, e) {
  e.stopPropagation();
  // Clean up audio elements before removing
  const f = App.files[index];
  if (f && f._audioEls) {
    cleanupAudioEls(f);
  }
  stopPlayback();
  if (App.expandedIndex === index) App.expandedIndex = -1;
  else if (App.expandedIndex > index) App.expandedIndex--;
  App.files.splice(index, 1);
  renderFiles();
}

/**
 * Remove a library item from Previous Splits.
 * @param {number} index - Library index to remove
 * @param {Event} e - Click event (propagation stopped)
 */
function removeLibItem(index, e) {
  e.stopPropagation();
  const f = App.library[index];
  if (!f) return;
  if (f._audioEls) cleanupAudioEls(f);
  if (App.expandedLibIndex === index) {
    stopPlayback();
    App.expandedLibIndex = -1;
  } else if (App.expandedLibIndex > index) {
    App.expandedLibIndex--;
  }
  // Delete from disk so it doesn't reappear on restart
  if (f.stemDir) {
    pywebview.api.delete_library_item(f.stemDir).then(result => {
      const res = JSON.parse(result);
      if (!res.ok) App.showToast('Failed to delete: ' + res.error, 'error');
    });
  }
  App.library.splice(index, 1);
  renderFiles();
}

/** Removes all files from the queue, cleaning up audio resources. */
function clearFiles() {
  // Clean up all audio elements
  App.files.forEach(f => {
    if (f._audioEls) cleanupAudioEls(f);
  });
  stopPlayback();
  App.files = [];
  App.expandedIndex = -1;
  renderFiles();
}

/** @param {FileObj} f - File whose audio elements and MIDI nodes to release */
function cleanupAudioEls(f) {
  if (!f._audioEls) return;
  f._audioEls.forEach(el => {
    try {
      el.audio.pause();
      el.audio.src = '';
      el.gain.disconnect();
      el.analyser.disconnect();
    } catch (e) { /* already disconnected */ }
  });
  f._audioEls = null;
  // Clean up MIDI gain nodes
  if (f.stems) {
    f.stems.forEach(stem => {
      if (stem._midiActiveOscs) {
        stem._midiActiveOscs.forEach(o => { try { o.osc.stop(); } catch(e) {} });
        stem._midiActiveOscs = [];
      }
      if (stem._midiGainNode) {
        try { stem._midiGainNode.disconnect(); } catch(e) {}
        stem._midiGainNode = null;
      }
    });
  }
}

/**
 * Expand or collapse the mixer panel for a file.
 * @param {string} src - 'queue' or 'lib'
 * @param {number} index - File index
 */
function toggleMixer(src, index) {
  const arr = src === 'lib' ? App.library : App.files;
  if (!arr[index] || !arr[index].stems) return;
  stopPlayback();

  if (src === 'lib') {
    App.expandedLibIndex = App.expandedLibIndex === index ? -1 : index;
    App.expandedIndex = -1;
    if (App.expandedLibIndex >= 0) {
      const item = App.library[App.expandedLibIndex];
      document.getElementById('modelSelect').value = item.model;
      const parts = item.stemDir.split(/[\\/]/);
      if (parts.length >= 3) {
        const sep = item.stemDir.includes('\\') ? '\\' : '/';
        const baseOutput = parts.slice(0, -2).join(sep);
        document.getElementById('outputPath').textContent = baseOutput;
        document.getElementById('outputPath').title = baseOutput;
      }
    }
  } else {
    App.expandedIndex = App.expandedIndex === index ? -1 : index;
    App.expandedLibIndex = -1;
    if (App.expandedIndex >= 0 && App.files[App.expandedIndex]) {
      const f = App.files[App.expandedIndex];
      if (f._splitModel) document.getElementById('modelSelect').value = f._splitModel;
      if (f._splitOutput) {
        document.getElementById('outputPath').textContent = f._splitOutput;
        document.getElementById('outputPath').title = f._splitOutput;
      }
    }
  }
  renderFiles();
}

// --- Output ---

/** Opens the output folder or shows a folder picker if no output yet. */
function openOutput() {
  if (App.outputReady) {
    pywebview.api.open_output_folder();
  } else {
    pywebview.api.pick_output().then(result => {
      if (result) {
        document.getElementById('outputPath').textContent = result;
        document.getElementById('outputPath').title = result;
      }
    });
  }
}

/** @param {string} stemDir - Path to the stems output directory */
function setOutputReady(stemDir) {
  App.outputReady = true;
  const btn = document.getElementById('browseBtn');
  btn.classList.add('has-output');
  btn.textContent = 'Open';
}

// --- Splitting ---

/** Starts stem separation for all queued files. */
function startSplit() {
  if (App.splitting) return; // prevent duplicate calls
  if (App.files.length === 0) { App.showToast('Add audio files first', 'error'); return; }
  const btn = document.getElementById('splitBtn');
  const cancelBtn = document.getElementById('cancelBtn');
  btn.disabled = true;
  btn.classList.add('running');
  btn.textContent = 'Splitting...';
  cancelBtn.classList.add('visible');
  App.splitting = true;

  const model = document.getElementById('modelSelect').value;
  const output = document.getElementById('outputPath').textContent;
  const device = document.getElementById('deviceSelect') ? document.getElementById('deviceSelect').value : 'cpu';
  const paths = App.files.map(f => f.path);
  App.files.forEach(f => { f._splitModel = model; f._splitOutput = output; });
  pywebview.api.start_split(JSON.stringify(paths), model, output, device);
}

/** Cancels the in-progress split operation. */
function cancelSplit() {
  pywebview.api.cancel_split();
}

/**
 * @param {number} pct - Progress percentage 0–100
 * @param {string} [status] - Status text to display
 */
function updateProgress(pct, status) {
  document.getElementById('progressFill').style.width = pct + '%';
  if (status) document.getElementById('statusText').textContent = status;
  document.getElementById('progressPct').textContent = pct > 0 ? Math.round(pct) + '%' : '';
}

/** @param {number} index - File index to mark as processing */
function markFileProcessing(index) {
  if (App.files[index]) { App.files[index].status = 'processing'; renderFiles(); }
}

/**
 * @param {number} index - File index
 * @param {string|StemObj[]} stemsData - JSON string or array of stem objects
 */
function markFileDone(index, stemsData) {
  if (!App.files[index]) return;
  const stems = typeof stemsData === 'string' ? JSON.parse(stemsData) : stemsData;
  stems.forEach(s => App.initStemState(s));
  App.files[index].status = 'done';
  App.files[index].stems = stems;
  App.files[index]._buffers = null;
  // Derive stemDir from the first stem path
  if (stems.length > 0 && stems[0].path) {
    const parts = stems[0].path.replace(/\\/g, '/').split('/');
    parts.pop(); // remove filename
    App.files[index].stemDir = parts.join('/');
  }
  renderFiles();
}

/**
 * @param {boolean} success - Whether the split completed successfully
 * @param {string} message - Status message to display
 */
function splitDone(success, message) {
  const btn = document.getElementById('splitBtn');
  const cancelBtn = document.getElementById('cancelBtn');
  btn.disabled = false;
  btn.classList.remove('running');
  btn.textContent = 'Split Stems';
  cancelBtn.classList.remove('visible');
  App.splitting = false;
  App.showToast(message, success ? 'success' : 'error');
  if (success) {
    document.getElementById('progressFill').style.width = '100%';
    document.getElementById('statusText').textContent = 'Done';
    document.getElementById('progressPct').textContent = '100%';
    loadLibrary();
  }
}

/** Scans the output directory for previously split songs and populates App.library. */
function loadLibrary() {
  pywebview.api.scan_library().then(result => {
    if (!result) return;
    const items = JSON.parse(result);
    App.library = items.map(item => {
      item.stems.forEach(s => {
        App.initStemState(s);
        if (s.midiPath) {
          s._midiState = 'done';
          s._midiPath = s.midiPath;
          s._midiMuted = true;
          s._midiSoloed = false;
        }
      });
      item._buffers = null;
      return item;
    });
    const queueNames = new Set(App.files.filter(f => f.stems).map(f => f.name.replace(/\.[^.]+$/, '')));
    App.library = App.library.filter(l => !queueNames.has(l.name));
    App.library.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    renderFiles();
  });
}

// --- GPU Install ---

/** Triggers CUDA PyTorch installation from the UI. */
function installTorchCuda() {
  const btn = document.getElementById('installCudaBtn');
  btn.disabled = true;
  btn.textContent = 'Installing...';
  pywebview.api.install_torch_cuda();
}

/**
 * @param {string} status - 'installing'|'success'|'error'
 * @param {string} message - Human-readable status message
 */
function torchInstallStatus(status, message) {
  const warn = document.getElementById('torchCudaWarning');
  const text = document.getElementById('torchWarningText');
  const btn = document.getElementById('installCudaBtn');
  if (!warn) return;

  text.textContent = message;
  warn.className = 'torch-cuda-warning ' + status;

  if (status === 'success') {
    btn.style.display = 'none';
    // Re-check GPU info after successful install
    setTimeout(() => {
      warn.style.display = 'none';
      App.showToast('GPU acceleration ready! Restart app for best results.', 'success');
    }, 3000);
  } else if (status === 'error') {
    btn.disabled = false;
    btn.textContent = 'Retry Install';
  } else if (status === 'installing') {
    btn.disabled = true;
    btn.textContent = 'Installing...';
  }
}

// --- Export Mix ---

/**
 * Export the current mix (respecting volume/mute/solo) to a WAV file.
 * @param {string} src - 'queue' or 'lib'
 * @param {number} fileIndex - File index
 */
function exportMix(src, fileIndex) {
  if (App._exporting) return; // prevent duplicate calls
  const f = App.getFileObj(src, fileIndex);
  if (!f || !f.stems) { App.showToast('No stems to export', 'error'); return; }
  App._exporting = true;

  const stems = f.stems.map(s => ({
    path: s.path,
    volume: s._volume !== undefined ? s._volume : 100,
    muted: !!s._muted,
    soloed: !!s._soloed
  }));

  // Build default filename
  const baseName = f.name.replace(/\.[^.]+$/, '') + '_mix.wav';
  const outputDir = document.getElementById('outputPath').textContent;
  if (!outputDir) { App.showToast('Set an output folder first', 'error'); return; }
  const sep = outputDir.includes('\\') ? '\\' : '/';
  const outputPath = outputDir + sep + baseName;

  App.showToast('Exporting mix...', 'success');
  pywebview.api.export_mix(JSON.stringify(stems), outputPath);
}

/**
 * @param {number} pct - Export progress 0–100
 * @param {string} status - Status text
 */
function exportMixProgress(pct, status) {
  updateProgress(pct, status);
}

/**
 * @param {boolean} success - Whether the export succeeded
 * @param {string} message - Output path on success, error message on failure
 */
function exportMixDone(success, message) {
  App._exporting = false;
  if (success) {
    updateProgress(100, 'Export complete!');
    const filename = message.split(/[\\/]/).pop();
    App.showToast('Exported: ' + filename, 'success');
  } else {
    updateProgress(0, 'Export failed');
    App.showToast(message, 'error');
  }
  setTimeout(() => {
    if (!App.splitting) updateProgress(0, 'Ready');
  }, 3000);
}

// --- Keyboard Shortcuts ---

document.addEventListener('keydown', (e) => {
  // Don't trigger shortcuts when typing in inputs
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;

  if (e.code === 'Space') {
    e.preventDefault();
    if (App.activePlayer && App.activePlayer.playing) {
      pausePlayback();
    } else if (App.expandedIndex >= 0 && App.files[App.expandedIndex]?.stems) {
      togglePlay('queue', App.expandedIndex);
    } else if (App.expandedLibIndex >= 0 && App.library[App.expandedLibIndex]?.stems) {
      togglePlay('lib', App.expandedLibIndex);
    }
  } else if (e.code === 'Escape') {
    stopPlayback();
  } else if (e.ctrlKey && e.code === 'KeyO') {
    e.preventDefault();
    addFiles();
  }
});

// --- Initialization ---

window.addEventListener('pywebviewready', () => {
  pywebview.api.get_default_output().then(p => {
    document.getElementById('outputPath').textContent = p;
    document.getElementById('outputPath').title = p;
    loadLibrary();
  });

  // Apply pre-loaded setup results (dependencies already installed at launch)
  const setup = typeof SETUP_RESULT !== 'undefined' ? SETUP_RESULT : null;

  if (setup && !setup.demucs_ok) {
    document.getElementById('onboarding').style.display = 'flex';
  }

  const deviceSelect = document.getElementById('deviceSelect');
  if (deviceSelect && setup) {
    const gpuOption = deviceSelect.querySelector('option[value="cuda"]');
    if (setup.gpu_ready) {
      // GPU fully ready — default to it
      gpuOption.textContent = 'GPU (' + (setup.gpu_name || 'CUDA') + ')';
      deviceSelect.value = 'cuda';
    } else if (setup.gpu_name) {
      // GPU exists but setup failed — allow CPU, show GPU as unavailable
      gpuOption.textContent = 'GPU (' + setup.gpu_name + ' — setup failed)';
      gpuOption.disabled = true;
      deviceSelect.value = 'cpu';
    } else {
      // No GPU
      gpuOption.style.display = 'none';
      deviceSelect.value = 'cpu';
    }
  }
});
