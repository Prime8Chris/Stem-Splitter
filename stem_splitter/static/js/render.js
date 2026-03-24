/**
 * Stem Splitter — DOM rendering.
 * Depends on App namespace from app.js.
 */

/**
 * HTML-escape user strings to prevent XSS via file names/paths.
 * @param {string} str
 * @returns {string} Safe HTML string
 */
function escHtml(str) {
  const el = document.createElement('span');
  el.textContent = str;
  return el.innerHTML;
}

/**
 * Escape for use inside double-quoted HTML attribute values.
 * @param {string} str
 * @returns {string} Attribute-safe string
 */
function escAttr(str) {
  return escHtml(str).replace(/"/g, '&quot;');
}

// SVG icons (replacing emoji for cross-platform consistency)
const ICONS = {
  musicNote: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>',
  headphones: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/></svg>',
  file: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
  dropMusic: '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.5"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>',
  play: '&#9654;',
  pause: '&#10074;&#10074;',
  stop: '&#9632;',
  chevron: '&#9654;',
  close: '&times;'
};

/** Render the entire file list (queue + library) into the drop zone. */
function renderFiles() {
  const zone = document.getElementById('dropZone');
  if (App.files.length === 0 && App.library.length === 0) {
    zone.className = 'drop-zone glass empty';
    zone.setAttribute('onclick', 'addFiles()');
    zone.setAttribute('role', 'button');
    zone.setAttribute('aria-label', 'Drop audio files here or click to browse');
    zone.innerHTML = '<div class="drop-icon">' + ICONS.dropMusic + '</div><div class="drop-text">Drop audio files here or <span>browse</span></div>';
    return;
  }

  zone.className = 'drop-zone glass';
  zone.removeAttribute('onclick');
  zone.removeAttribute('role');
  let html = `
    <div class="file-header">
      <div class="file-actions">
        <button class="btn-small btn-new-song" onclick="addFiles()" aria-label="Add new files to split">+ New Song</button>
        ${App.files.length > 0 ? '<button class="btn-small" onclick="clearFiles()" aria-label="Clear all files from queue">Clear</button>' : ''}
      </div>
    </div>
    <div class="file-list" role="list">`;

  // Current queue
  App.files.forEach((f, i) => {
    const hasSt = !!f.stems;
    const isExp = App.expandedIndex === i;
    html += `<div class="file-item-wrap" role="listitem">`;
    html += `<div class="file-item ${hasSt ? 'has-stems' : ''} ${isExp ? 'expanded' : ''}" ${hasSt ? 'onclick="toggleMixer(\'queue\',' + i + ')"' : ''} ${hasSt ? 'aria-expanded="' + isExp + '"' : ''}>`;
    html += `<div class="file-icon">${hasSt ? ICONS.headphones : ICONS.file}</div>`;
    html += `<div class="file-name" title="${escAttr(f.path)}">${escHtml(f.name)}</div>`;
    if (f.status === 'done') html += `<div class="file-status done">SPLIT</div>`;
    else if (f.status === 'processing') html += `<div class="file-status processing">...</div>`;
    if (hasSt) html += `<div class="file-chevron">${ICONS.chevron}</div>`;
    html += `<div class="file-remove" onclick="removeFile(${i}, event)" role="button" aria-label="Remove ${escAttr(f.name)}">${ICONS.close}</div>`;
    html += `</div>`;

    if (isExp && f.stems) {
      html += renderMixer(i, f, 'queue');
    }
    html += `</div>`;
  });

  html += '</div>';

  // Library section — separate scrollable container
  if (App.library.length > 0) {
    html += `<div class="library-divider">Previous Splits</div>`;
    html += `<div class="library-list${App.expandedLibIndex >= 0 ? ' expanded' : ''}" role="list">`;
    const LAZY_BATCH = App._libRendered || 20;
    App.library.forEach((f, i) => {
      if (i >= LAZY_BATCH && App.expandedLibIndex !== i) {
        // Render a placeholder for lazy loading
        html += `<div class="file-item-wrap lazy-placeholder" data-lib-index="${i}" role="listitem"></div>`;
        return;
      }
      const isExp = App.expandedLibIndex === i;
      html += `<div class="file-item-wrap" role="listitem">`;
      html += `<div class="file-item has-stems ${isExp ? 'expanded' : ''}" onclick="toggleMixer('lib',${i})" aria-expanded="${isExp}">`;
      html += `<div class="file-icon">${ICONS.headphones}</div>`;
      html += `<div class="file-name" title="${escAttr(f.stemDir)}">${escHtml(f.name)}</div>`;
      html += `<span class="library-model">${escHtml(f.model === 'htdemucs_6s' ? '6-stem' : '4-stem')}</span>`;
      html += `<div class="file-chevron">${ICONS.chevron}</div>`;
      html += `<div class="file-remove" onclick="removeLibItem(${i}, event)" role="button" aria-label="Remove ${escAttr(f.name)}">${ICONS.close}</div>`;
      html += `</div>`;
      if (isExp) {
        html += renderMixer(i, f, 'lib');
      }
      html += `</div>`;
    });
    html += `</div>`;
  }

  zone.innerHTML = html;

  // Set up lazy loading observer for library items
  setupLibraryLazyLoad();

  // Draw waveforms for expanded mixers and load MIDI notes if needed
  if (App.expandedIndex >= 0 && App.files[App.expandedIndex] && App.files[App.expandedIndex].stems) {
    drawStaticWaveforms('queue', App.expandedIndex, App.files[App.expandedIndex]);
    loadMidiNotesIfNeeded('queue', App.expandedIndex);
  }
  if (App.expandedLibIndex >= 0 && App.library[App.expandedLibIndex]) {
    drawStaticWaveforms('lib', App.expandedLibIndex, App.library[App.expandedLibIndex]);
    loadMidiNotesIfNeeded('lib', App.expandedLibIndex);
  }
}

/**
 * Build the HTML for a mixer panel (transport, stem tracks, MIDI rows, export).
 * @param {number} fileIndex - Index of the file in its source array
 * @param {FileObj} f - File object with stems
 * @param {string} src - 'queue' or 'lib'
 * @returns {string} HTML string
 */
function renderMixer(fileIndex, f, src) {
  const key = App.playerKey(src, fileIndex);
  const isPlaying = App.activePlayer && App.activePlayer.key === key && App.activePlayer.playing;
  const isPaused = App.activePlayer && App.activePlayer.key === key && !App.activePlayer.playing;
  const uid = src + '-' + fileIndex;

  let html = `<div class="mixer-panel" onclick="event.stopPropagation()">`;

  // Transport
  html += `<div class="transport">`;
  html += `<div class="transport-left">`;
  html += `<button class="transport-btn ${isPlaying ? 'active' : ''}" onclick="event.stopPropagation(); togglePlay('${src}',${fileIndex})" aria-label="Play">${ICONS.play}</button>`;
  html += `<button class="transport-btn ${isPaused ? 'active' : ''}" onclick="event.stopPropagation(); pausePlayback()" aria-label="Pause">${ICONS.pause}</button>`;
  html += `<button class="transport-btn" onclick="event.stopPropagation(); stopPlayback()" aria-label="Stop">${ICONS.stop}</button>`;
  html += `</div>`;
  html += `<input type="range" class="transport-seek" id="seek-${uid}" min="0" max="1000" value="0" oninput="seekTo('${src}',${fileIndex}, this.value)" aria-label="Seek position">`;
  html += `<span class="transport-time" id="time-${uid}">0:00 / 0:00</span>`;
  html += `</div>`;

  // Stem tracks
  f.stems.forEach((stem, si) => {
    const isMuted = stem._muted || false;
    const isSoloed = stem._soloed || false;
    const vol = stem._volume !== undefined ? stem._volume : 100;
    const color = App.STEM_COLORS[stem.name] || '#888';
    const waveId = 'wave-' + uid + '-' + si;
    const eqId = 'eq-' + uid + '-' + si;

    html += `<div class="stem-track ${isMuted ? 'muted' : ''} ${isSoloed ? 'soloed' : ''}" onclick="event.stopPropagation()">`;
    html += `<div class="stem-color" style="background:${color}"></div>`;
    html += `<div class="stem-name" style="color:${color}">${stem.name}</div>`;
    html += `<input type="range" class="stem-volume" min="0" max="100" value="${vol}" oninput="setStemVolume('${src}',${fileIndex},${si},this.value)" aria-label="${stem.name} volume" title="Volume: ${vol}%">`;
    html += `<div class="stem-waveform" id="wf-${waveId}" onclick="seekFromWaveform(event,'${src}',${fileIndex})"><canvas id="${waveId}" role="img" aria-label="${stem.name} waveform visualization"></canvas><div class="stem-playhead" id="ph-${waveId}"></div></div>`;
    html += `<div class="stem-controls-wrap">`;
    html += `<div class="stem-eq"><canvas id="${eqId}" role="img" aria-label="${stem.name} equalizer spectrum"></canvas></div>`;
    html += `<div class="stem-controls">`;
    html += `<button class="stem-btn ${isSoloed ? 'solo-active' : ''}" onclick="toggleSolo('${src}',${fileIndex},${si})" aria-label="Solo ${stem.name}" title="Solo">S</button>`;
    html += `<button class="stem-btn ${isMuted ? 'mute-active' : ''}" onclick="toggleMute('${src}',${fileIndex},${si})" aria-label="Mute ${stem.name}" title="Mute">M</button>`;
    html += `<button class="stem-btn copy-btn" onclick="copyStem('${src}',${fileIndex},${si})" aria-label="Copy ${stem.name} file path" title="Copy path">C</button>`;
    if (App.MIDI_ELIGIBLE_STEMS.has(stem.name)) {
      const midiState = stem._midiState || 'idle'; // idle | converting | done | error
      const midiClass = midiState === 'converting' ? 'midi-converting' : midiState === 'done' ? 'midi-done' : midiState === 'error' ? 'midi-error' : '';
      const midiLabel = midiState === 'converting' ? '...' : midiState === 'done' ? 'OK' : 'MIDI';
      const midiDisabled = midiState === 'converting' ? 'disabled' : '';
      html += `<button class="stem-btn midi-btn ${midiClass}" onclick="convertToMidi('${src}',${fileIndex},${si})" aria-label="Convert ${stem.name} to MIDI" title="Convert to MIDI" ${midiDisabled}>${midiLabel}</button>`;
    } else {
      html += `<button class="stem-btn midi-btn midi-ineligible" disabled title="MIDI not available for ${stem.name}">MIDI</button>`;
    }
    html += `</div></div></div>`;

    // MIDI timeline row: shown when conversion is done
    if (stem._midiState === 'done' && stem._midiPath) {
      const midiWaveId = 'midi-' + uid + '-' + si;
      const midiMuted = stem._midiMuted !== false;  // default true
      const midiSoloed = stem._midiSoloed || false;
      html += `<div class="stem-track midi-track-row ${midiMuted ? 'muted' : ''} ${midiSoloed ? 'soloed' : ''}" onclick="event.stopPropagation()">`;
      html += `<div class="stem-color" style="background:${color}; opacity:0.5"></div>`;
      html += `<div class="stem-name midi-label" style="color:${color}">${ICONS.musicNote} MIDI</div>`;
      html += `<div class="stem-volume-spacer"></div>`;
      html += `<div class="stem-waveform midi-waveform" id="wf-${midiWaveId}" onclick="seekFromWaveform(event,'${src}',${fileIndex})"><canvas id="${midiWaveId}" role="img" aria-label="${stem.name} MIDI piano roll visualization"></canvas><div class="stem-playhead" id="ph-${midiWaveId}"></div></div>`;
      html += `<div class="stem-controls-wrap">`;
      html += `<div class="stem-controls">`;
      html += `<button class="stem-btn ${midiSoloed ? 'solo-active' : ''}" onclick="toggleMidiSolo('${src}',${fileIndex},${si})" title="Solo MIDI">S</button>`;
      html += `<button class="stem-btn ${midiMuted ? 'mute-active' : ''}" onclick="toggleMidiMute('${src}',${fileIndex},${si})" title="Mute MIDI">M</button>`;
      html += `<button class="stem-btn copy-btn" onclick="copyMidiPath('${src}',${fileIndex},${si})" title="Copy MIDI path">C</button>`;
      html += `<button class="stem-btn open-btn" onclick="openMidiFolder('${src}',${fileIndex},${si})" title="Open location">&#128193;</button>`;
      html += `</div></div>`;
      html += `</div>`;
    }
  });

  // Export button
  html += `<div class="mixer-export">`;
  html += `<button class="btn-export" onclick="event.stopPropagation(); exportMix('${src}',${fileIndex})" aria-label="Export mix to WAV">Export Mix</button>`;
  html += `</div>`;

  // Shortcut hints
  html += `<div class="shortcut-hint"><kbd>Space</kbd> Play/Pause &nbsp; <kbd>Esc</kbd> Stop &nbsp; <kbd>Ctrl+O</kbd> Add Files</div>`;
  html += `</div>`;
  return html;
}

/** Render a single library item's full HTML (for lazy loading). */
function renderLibItem(i) {
  const f = App.library[i];
  if (!f) return '';
  const isExp = App.expandedLibIndex === i;
  let html = '';
  html += `<div class="file-item has-stems ${isExp ? 'expanded' : ''}" onclick="toggleMixer('lib',${i})" aria-expanded="${isExp}">`;
  html += `<div class="file-icon">${ICONS.headphones}</div>`;
  html += `<div class="file-name" title="${escAttr(f.stemDir)}">${escHtml(f.name)}</div>`;
  html += `<span class="library-model">${escHtml(f.model === 'htdemucs_6s' ? '6-stem' : '4-stem')}</span>`;
  html += `<div class="file-chevron">${ICONS.chevron}</div>`;
  html += `<div class="file-remove" onclick="removeLibItem(${i}, event)" role="button" aria-label="Remove ${escAttr(f.name)}">${ICONS.close}</div>`;
  html += `</div>`;
  if (isExp) {
    html += renderMixer(i, f, 'lib');
  }
  return html;
}

/** Set up IntersectionObserver to lazy-load library placeholders as they scroll into view. */
function setupLibraryLazyLoad() {
  const container = document.querySelector('.library-list');
  if (!container) return;
  if (App._libObserver) App._libObserver.disconnect();

  App._libObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      const el = entry.target;
      if (!el.classList.contains('lazy-placeholder')) return;
      const idx = parseInt(el.dataset.libIndex, 10);
      if (isNaN(idx) || !App.library[idx]) return;
      el.classList.remove('lazy-placeholder');
      el.innerHTML = renderLibItem(idx);
      App._libObserver.unobserve(el);
    });
  }, { root: container, rootMargin: '100px' });

  container.querySelectorAll('.lazy-placeholder').forEach(el => {
    App._libObserver.observe(el);
  });
}
