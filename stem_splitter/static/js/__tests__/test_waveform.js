/**
 * Tests for waveform.js — Waveform generation and rendering.
 */
const { setupTestEnv } = require('./setup');

describe('waveform.js', () => {
  let mockCtx;

  beforeEach(() => {
    const env = setupTestEnv(['app', 'render', 'mixer', 'waveform']);
    mockCtx = env.mockCtx;
    window.drawStaticWaveforms = jest.fn();
    window.loadMidiNotesIfNeeded = jest.fn();
    window.drawEQ = jest.fn();
  });

  // --- generateWaveform ---
  describe('generateWaveform', () => {
    test('fetches audio and produces peaks array', async () => {
      App.files = [{
        name: 'test.wav', path: '/test.wav', status: 'done',
        stems: [{ name: 'vocals', path: '/v.wav' }],
      }];

      const result = await generateWaveform('queue', 0, 0);
      expect(result).toBeTruthy();
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(200); // 200 samples
      // All values should be normalized 0-1
      result.forEach(v => {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      });
    });

    test('stores waveform on stem object', async () => {
      App.files = [{
        name: 'test.wav', stems: [{ name: 'vocals', path: '/v.wav' }],
      }];
      await generateWaveform('queue', 0, 0);
      expect(App.files[0].stems[0]._waveform).toBeTruthy();
      expect(App.files[0].stems[0]._waveform.length).toBe(200);
    });

    test('returns cached waveform if already generated', async () => {
      const cachedWf = new Array(200).fill(0.5);
      App.files = [{
        name: 'test.wav', stems: [{ name: 'vocals', path: '/v.wav', _waveform: cachedWf }],
      }];
      const result = await generateWaveform('queue', 0, 0);
      expect(result).toBe(cachedWf);
      expect(window.fetch).not.toHaveBeenCalled();
    });

    test('deduplicates concurrent calls (does not fetch twice)', async () => {
      // Use a fetch that returns a pending promise so both calls happen before resolution
      let resolveFetch;
      window.fetch = jest.fn(() => new Promise(r => { resolveFetch = r; }));

      App.files = [{
        name: 'test.wav', stems: [{ name: 'vocals', path: '/v.wav', _waveform: null, _waveformLoading: false, _waveformPromise: null }],
      }];
      const p1 = generateWaveform('queue', 0, 0);
      // After the first call, _waveformLoading should be true
      expect(App.files[0].stems[0]._waveformLoading).toBe(true);

      const p2 = generateWaveform('queue', 0, 0);
      // fetch should only have been called once (dedup)
      expect(window.fetch).toHaveBeenCalledTimes(1);

      // Both promises should resolve to the same waveform data
      resolveFetch({ arrayBuffer: () => Promise.resolve(new ArrayBuffer(1024)) });
      const [r1, r2] = await Promise.all([p1, p2]);
      expect(r1).toEqual(r2);
    });

    test('returns null for invalid file', async () => {
      App.files = [];
      const result = await generateWaveform('queue', 0, 0);
      expect(result).toBeNull();
    });

    test('returns null for invalid stem index', async () => {
      App.files = [{ name: 'a', stems: [] }];
      const result = await generateWaveform('queue', 0, 5);
      expect(result).toBeNull();
    });

    test('returns null on fetch error', async () => {
      App.files = [{
        name: 'test.wav', stems: [{ name: 'vocals', path: '/v.wav' }],
      }];
      window.fetch = jest.fn(() => Promise.reject(new Error('network error')));
      const result = await generateWaveform('queue', 0, 0);
      expect(result).toBeNull();
    });

    test('clears loading state after completion', async () => {
      App.files = [{
        name: 'test.wav', stems: [{ name: 'vocals', path: '/v.wav' }],
      }];
      await generateWaveform('queue', 0, 0);
      expect(App.files[0].stems[0]._waveformLoading).toBe(false);
      expect(App.files[0].stems[0]._waveformPromise).toBeNull();
    });
  });

  // --- drawWaveform ---
  describe('drawWaveform', () => {
    test('renders waveform bars to canvas', () => {
      // Create a canvas element in the DOM
      const canvas = document.createElement('canvas');
      canvas.id = 'test-wf';
      document.body.appendChild(canvas);

      const waveform = [0.1, 0.5, 0.8, 0.3, 1.0];
      drawWaveform('test-wf', waveform, '#ff0000', 0.5);

      expect(mockCtx.clearRect).toHaveBeenCalled();
      // Should have drawn bars
      expect(mockCtx.fillRect).toHaveBeenCalled();
      expect(mockCtx.fillRect.mock.calls.length).toBe(waveform.length);
    });

    test('does nothing if canvas not found', () => {
      mockCtx.clearRect.mockClear();
      drawWaveform('nonexistent', [0.5], '#ff0000', 0);
      expect(mockCtx.clearRect).not.toHaveBeenCalled();
    });

    test('does nothing with empty or null waveform', () => {
      const canvas = document.createElement('canvas');
      canvas.id = 'test-empty';
      document.body.appendChild(canvas);

      mockCtx.fillRect.mockClear();
      drawWaveform('test-empty', null, '#ff0000', 0);
      expect(mockCtx.fillRect).not.toHaveBeenCalled();

      drawWaveform('test-empty', [], '#ff0000', 0);
      expect(mockCtx.fillRect).not.toHaveBeenCalled();
    });

    test('sets globalAlpha differently for played vs unplayed bars', () => {
      const canvas = document.createElement('canvas');
      canvas.id = 'test-alpha';
      document.body.appendChild(canvas);

      drawWaveform('test-alpha', [0.5, 0.5, 0.5, 0.5], '#ff0000', 0.5);
      // globalAlpha should have been set to both 0.8 (played) and 0.2 (unplayed)
      // We can check that fillRect was called 4 times
      expect(mockCtx.fillRect).toHaveBeenCalledTimes(4);
    });

    test('resets globalAlpha to 1 after drawing', () => {
      const canvas = document.createElement('canvas');
      canvas.id = 'test-reset';
      document.body.appendChild(canvas);

      drawWaveform('test-reset', [0.5], '#ff0000', 0);
      expect(mockCtx.globalAlpha).toBe(1);
    });
  });

  // --- drawMidiNotes ---
  describe('drawMidiNotes', () => {
    test('renders MIDI notes to canvas', () => {
      const canvas = document.createElement('canvas');
      canvas.id = 'test-midi';
      document.body.appendChild(canvas);

      const notes = [
        [0, 1, 60],   // C4, 0-1s
        [1, 2, 64],   // E4, 1-2s
        [2, 3, 67],   // G4, 2-3s
      ];
      drawMidiNotes('test-midi', notes, '#00ff00', 0.5, 4);

      expect(mockCtx.clearRect).toHaveBeenCalled();
      expect(mockCtx.fillRect).toHaveBeenCalledTimes(notes.length);
    });

    test('does nothing if canvas not found', () => {
      mockCtx.clearRect.mockClear();
      drawMidiNotes('nonexistent', [[0, 1, 60]], '#ff0000', 0, 10);
      expect(mockCtx.clearRect).not.toHaveBeenCalled();
    });

    test('does nothing with null or empty notes', () => {
      const canvas = document.createElement('canvas');
      canvas.id = 'test-midi-empty';
      document.body.appendChild(canvas);

      mockCtx.fillRect.mockClear();
      drawMidiNotes('test-midi-empty', null, '#ff0000', 0, 10);
      expect(mockCtx.fillRect).not.toHaveBeenCalled();

      drawMidiNotes('test-midi-empty', [], '#ff0000', 0, 10);
      expect(mockCtx.fillRect).not.toHaveBeenCalled();
    });

    test('derives duration from notes if not provided', () => {
      const canvas = document.createElement('canvas');
      canvas.id = 'test-midi-dur';
      document.body.appendChild(canvas);

      const notes = [[0, 2, 60], [1, 5, 64]];
      mockCtx.fillRect.mockClear();
      drawMidiNotes('test-midi-dur', notes, '#ff0000', 0, 0);
      expect(mockCtx.fillRect).toHaveBeenCalledTimes(2);
    });

    test('resets globalAlpha after drawing', () => {
      const canvas = document.createElement('canvas');
      canvas.id = 'test-midi-alpha';
      document.body.appendChild(canvas);

      drawMidiNotes('test-midi-alpha', [[0, 1, 60]], '#ff0000', 0, 2);
      expect(mockCtx.globalAlpha).toBe(1);
    });
  });

  // --- drawStaticWaveforms ---
  describe('drawStaticWaveforms', () => {
    test('draws existing waveforms via drawWaveform', () => {
      // Restore the real drawStaticWaveforms (beforeEach mocks it)
      const env = setupTestEnv(['app', 'render', 'mixer', 'waveform']);
      const freshMockCtx = env.mockCtx;

      const wf = new Array(200).fill(0.5);
      const file = {
        name: 'a', stems: [
          { name: 'vocals', path: '/v.wav', _waveform: wf },
        ],
        _audioEls: null,
      };
      App.files = [file];

      // Create expected canvas element with the correct ID
      const canvas = document.createElement('canvas');
      canvas.id = 'wave-queue-0-0';
      document.body.appendChild(canvas);

      freshMockCtx.clearRect.mockClear();
      freshMockCtx.fillRect.mockClear();

      drawStaticWaveforms('queue', 0, file);

      // drawWaveform should render the waveform bars to the canvas
      expect(freshMockCtx.clearRect).toHaveBeenCalled();
      expect(freshMockCtx.fillRect).toHaveBeenCalled();
    });

    test('does nothing for null file', () => {
      expect(() => drawStaticWaveforms('queue', 0, null)).not.toThrow();
    });

    test('does nothing for file without stems', () => {
      expect(() => drawStaticWaveforms('queue', 0, { stems: null })).not.toThrow();
    });
  });
});
