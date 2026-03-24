/**
 * Shared test setup — mocks for browser APIs and pywebview bridge.
 * Call setupTestEnv() in beforeEach to get a clean environment.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const JS_DIR = path.resolve(__dirname, '..');

// Read source files once
const SRC = {
  app: fs.readFileSync(path.join(JS_DIR, 'app.js'), 'utf-8'),
  render: fs.readFileSync(path.join(JS_DIR, 'render.js'), 'utf-8'),
  mixer: fs.readFileSync(path.join(JS_DIR, 'mixer.js'), 'utf-8'),
  waveform: fs.readFileSync(path.join(JS_DIR, 'waveform.js'), 'utf-8'),
  settings: fs.readFileSync(path.join(JS_DIR, 'settings.js'), 'utf-8'),
  eq: fs.readFileSync(path.join(JS_DIR, 'eq.js'), 'utf-8'),
};

/**
 * Create a mock 2D canvas context with all common methods.
 */
function createMockCanvasCtx() {
  return {
    clearRect: jest.fn(),
    fillRect: jest.fn(),
    fillText: jest.fn(),
    beginPath: jest.fn(),
    moveTo: jest.fn(),
    lineTo: jest.fn(),
    stroke: jest.fn(),
    fill: jest.fn(),
    arc: jest.fn(),
    closePath: jest.fn(),
    save: jest.fn(),
    restore: jest.fn(),
    setTransform: jest.fn(),
    createLinearGradient: jest.fn(() => ({
      addColorStop: jest.fn(),
    })),
    fillStyle: '',
    strokeStyle: '',
    globalAlpha: 1,
    lineWidth: 1,
    font: '',
    textAlign: '',
    textBaseline: '',
    canvas: { width: 200, height: 50 },
  };
}

/**
 * Create a mock Audio element.
 */
function createMockAudio() {
  const audio = {
    play: jest.fn(() => Promise.resolve()),
    pause: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    currentTime: 0,
    duration: 120,
    src: '',
    preload: '',
    crossOrigin: '',
    volume: 1,
    paused: true,
  };
  return audio;
}

/**
 * Create a mock GainNode.
 */
function createMockGain() {
  return {
    gain: {
      value: 1,
      setValueAtTime: jest.fn(),
      linearRampToValueAtTime: jest.fn(),
    },
    connect: jest.fn(),
    disconnect: jest.fn(),
  };
}

/**
 * Create a mock AnalyserNode.
 */
function createMockAnalyser() {
  return {
    fftSize: 256,
    smoothingTimeConstant: 0.7,
    frequencyBinCount: 128,
    getByteFrequencyData: jest.fn((arr) => {
      // Fill with some dummy data
      for (let i = 0; i < arr.length; i++) arr[i] = Math.floor(Math.random() * 256);
    }),
    connect: jest.fn(),
    disconnect: jest.fn(),
  };
}

/**
 * Create a mock AudioContext.
 */
function createMockAudioContext() {
  return {
    state: 'running',
    currentTime: 0,
    sampleRate: 44100,
    destination: {},
    resume: jest.fn(() => Promise.resolve()),
    suspend: jest.fn(() => Promise.resolve()),
    close: jest.fn(() => Promise.resolve()),
    createMediaElementSource: jest.fn(() => ({
      connect: jest.fn(),
      disconnect: jest.fn(),
    })),
    createAnalyser: jest.fn(() => createMockAnalyser()),
    createGain: jest.fn(() => createMockGain()),
    createOscillator: jest.fn(() => ({
      type: 'sine',
      frequency: { value: 440 },
      connect: jest.fn(),
      disconnect: jest.fn(),
      start: jest.fn(),
      stop: jest.fn(),
    })),
    decodeAudioData: jest.fn(() => Promise.resolve({
      duration: 120,
      numberOfChannels: 1,
      sampleRate: 44100,
      length: 44100 * 120,
      getChannelData: jest.fn(() => {
        // Return a Float32Array with some waveform-like data
        const data = new Float32Array(44100 * 2); // 2 seconds worth
        for (let i = 0; i < data.length; i++) {
          data[i] = Math.sin(i / 100) * 0.5;
        }
        return data;
      }),
    })),
  };
}

/**
 * Set up the minimal DOM elements expected by the app.
 */
function setupDOM() {
  document.body.innerHTML = `
    <div id="dropZone" class="drop-zone glass empty"></div>
    <div id="toast" class="toast"></div>
    <div id="progressFill" style="width:0%"></div>
    <div id="statusText">Ready</div>
    <div id="progressPct"></div>
    <button id="splitBtn">Split Stems</button>
    <button id="cancelBtn">Cancel</button>
    <button id="browseBtn">Browse</button>
    <span id="outputPath">/default/output</span>
    <select id="modelSelect">
      <option value="htdemucs">htdemucs</option>
      <option value="htdemucs_6s">htdemucs_6s</option>
    </select>
    <select id="deviceSelect">
      <option value="cpu">CPU</option>
      <option value="cuda">GPU</option>
    </select>
    <div id="settingsPanel" class="settings-panel"></div>
    <img id="logo" src="" />
    <div id="onboarding" style="display:none"></div>
    <div id="torchCudaWarning" class="torch-cuda-warning">
      <span id="torchWarningText"></span>
      <button id="installCudaBtn">Install</button>
    </div>
  `;
}

/**
 * Set up all global mocks and load source files into the test environment.
 * @param {string[]} modules - Which modules to load, e.g. ['app', 'render']
 */
function setupTestEnv(modules) {
  // Reset DOM
  setupDOM();

  // Mock pywebview
  window.pywebview = {
    api: {
      pick_files: jest.fn(() => Promise.resolve(null)),
      scan_library: jest.fn(() => Promise.resolve(null)),
      start_split: jest.fn(),
      cancel_split: jest.fn(),
      open_output_folder: jest.fn(),
      pick_output: jest.fn(() => Promise.resolve(null)),
      get_default_output: jest.fn(() => Promise.resolve('/default/output')),
      export_mix: jest.fn(),
      update_setting: jest.fn(),
      get_settings: jest.fn(() => Promise.resolve('{}')),
      copy_to_clipboard: jest.fn(),
      open_file_location: jest.fn(),
      convert_to_midi: jest.fn(),
      load_midi_notes: jest.fn(() => Promise.resolve(null)),
      install_torch_cuda: jest.fn(),
    },
  };

  // Mock AudioContext
  const mockAudioCtx = createMockAudioContext();
  window.AudioContext = jest.fn(() => mockAudioCtx);
  window.webkitAudioContext = window.AudioContext;

  // Mock Audio constructor
  window.Audio = jest.fn((src) => {
    const audio = createMockAudio();
    if (src) audio.src = src;
    return audio;
  });

  // Mock canvas getContext
  const mockCtx = createMockCanvasCtx();
  HTMLCanvasElement.prototype.getContext = jest.fn(() => mockCtx);
  // Give canvases nonzero dimensions
  Object.defineProperty(HTMLCanvasElement.prototype, 'offsetWidth', { get: () => 200, configurable: true });
  Object.defineProperty(HTMLCanvasElement.prototype, 'offsetHeight', { get: () => 50, configurable: true });

  // Mock requestAnimationFrame / cancelAnimationFrame
  window.requestAnimationFrame = jest.fn((cb) => {
    return setTimeout(cb, 0);
  });
  window.cancelAnimationFrame = jest.fn((id) => clearTimeout(id));

  // Mock fetch for waveform generation
  window.fetch = jest.fn(() => Promise.resolve({
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(1024)),
  }));

  // Mock IntersectionObserver (not available in jsdom)
  window.IntersectionObserver = jest.fn(() => ({
    observe: jest.fn(),
    unobserve: jest.fn(),
    disconnect: jest.fn(),
  }));

  // Mock matchMedia
  window.matchMedia = jest.fn((query) => ({
    matches: false,
    media: query,
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    addListener: jest.fn(),
    removeListener: jest.fn(),
  }));

  // Replace the __AUDIO_PORT__ placeholder before eval
  const appSrc = SRC.app.replace('__AUDIO_PORT__', '18123');

  // INITIAL_SETTINGS and SETUP_RESULT may be referenced
  window.INITIAL_SETTINGS = undefined;
  window.SETUP_RESULT = undefined;

  // Load requested modules in order
  const loadOrder = {
    app: appSrc,
    render: SRC.render,
    mixer: SRC.mixer,
    waveform: SRC.waveform,
    settings: SRC.settings,
    eq: SRC.eq,
  };

  for (const mod of modules) {
    if (!loadOrder[mod]) throw new Error(`Unknown module: ${mod}`);
    let code = loadOrder[mod];
    // Replace top-level const/let with var to make them globally accessible via eval
    code = code.replace(/^(const|let)\s+/gm, 'var ');
    // Convert function declarations to global assignments so they persist
    // across eval boundaries. Match: `function name(` and `async function name(` at start of line
    code = code.replace(/^(async\s+)?function\s+(\w+)\s*\(/gm, (match, asyncKw, name) => {
      const prefix = asyncKw || '';
      return `global.${name} = ${prefix}function ${name}(`;
    });
    // Also assign top-level `var name =` to global
    code = code.replace(/^var\s+(\w+)\s*=/gm, (match, name) => {
      return `var ${name} = global.${name} =`;
    });
    // Execute in the current scope
    eval(code);
  }

  return { mockAudioCtx, mockCtx };
}

module.exports = {
  setupTestEnv,
  createMockAudio,
  createMockGain,
  createMockAnalyser,
  createMockAudioContext,
  createMockCanvasCtx,
  SRC,
};
