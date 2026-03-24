/**
 * Tests for app.js — Core application state and logic.
 */
const { setupTestEnv } = require('./setup');

describe('app.js', () => {
  beforeEach(() => {
    // Load app + render (render is needed for renderFiles calls)
    setupTestEnv(['app', 'render']);
    // Stub functions that might be called as side effects
    window.drawStaticWaveforms = jest.fn();
    window.loadMidiNotesIfNeeded = jest.fn();
    window.stopPlayback = jest.fn();
    window.cleanupAudioEls = window.cleanupAudioEls || jest.fn();
  });

  // --- App namespace ---
  describe('App namespace initialization', () => {
    test('has correct default state', () => {
      expect(App.files).toEqual([]);
      expect(App.library).toEqual([]);
      expect(App.expandedIndex).toBe(-1);
      expect(App.expandedLibIndex).toBe(-1);
      expect(App.audioCtx).toBeNull();
      expect(App.activePlayer).toBeNull();
      expect(App.animFrameId).toBeNull();
      expect(App.outputReady).toBe(false);
      expect(App.splitting).toBe(false);
    });

    test('has AUDIO_PORT set', () => {
      expect(App.AUDIO_PORT).toBe(18123);
    });

    test('has STEM_COLORS map', () => {
      expect(App.STEM_COLORS.vocals).toBe('#f472b6');
      expect(App.STEM_COLORS.drums).toBe('#818cf8');
      expect(App.STEM_COLORS.bass).toBe('#34d399');
      expect(App.STEM_COLORS.other).toBe('#fbbf24');
      expect(App.STEM_COLORS.guitar).toBe('#fb923c');
      expect(App.STEM_COLORS.piano).toBe('#22d3ee');
    });

    test('MIDI_ELIGIBLE_STEMS contains correct stems', () => {
      expect(App.MIDI_ELIGIBLE_STEMS.has('vocals')).toBe(true);
      expect(App.MIDI_ELIGIBLE_STEMS.has('bass')).toBe(true);
      expect(App.MIDI_ELIGIBLE_STEMS.has('guitar')).toBe(true);
      expect(App.MIDI_ELIGIBLE_STEMS.has('piano')).toBe(true);
      expect(App.MIDI_ELIGIBLE_STEMS.has('drums')).toBe(true);
      expect(App.MIDI_ELIGIBLE_STEMS.has('other')).toBe(false);
    });
  });

  // --- getFileObj ---
  describe('getFileObj', () => {
    test('returns file from queue when src is "queue"', () => {
      App.files = [{ name: 'a' }, { name: 'b' }];
      expect(App.getFileObj('queue', 0)).toEqual({ name: 'a' });
      expect(App.getFileObj('queue', 1)).toEqual({ name: 'b' });
    });

    test('returns file from library when src is "lib"', () => {
      App.library = [{ name: 'x' }, { name: 'y' }];
      expect(App.getFileObj('lib', 0)).toEqual({ name: 'x' });
      expect(App.getFileObj('lib', 1)).toEqual({ name: 'y' });
    });

    test('returns null for out-of-range index', () => {
      App.files = [];
      expect(App.getFileObj('queue', 5)).toBeNull();
    });
  });

  // --- playerKey ---
  describe('playerKey', () => {
    test('generates correct key', () => {
      expect(App.playerKey('queue', 0)).toBe('queue:0');
      expect(App.playerKey('lib', 3)).toBe('lib:3');
    });
  });

  // --- formatTime ---
  describe('formatTime', () => {
    test('formats 0 seconds', () => {
      expect(App.formatTime(0)).toBe('0:00');
    });

    test('formats seconds with padding', () => {
      expect(App.formatTime(5)).toBe('0:05');
      expect(App.formatTime(9)).toBe('0:09');
    });

    test('formats minutes and seconds', () => {
      expect(App.formatTime(60)).toBe('1:00');
      expect(App.formatTime(90)).toBe('1:30');
      expect(App.formatTime(125)).toBe('2:05');
    });

    test('handles fractional seconds by flooring', () => {
      expect(App.formatTime(90.7)).toBe('1:30');
      expect(App.formatTime(59.9)).toBe('0:59');
    });

    test('handles large values', () => {
      expect(App.formatTime(600)).toBe('10:00');
      expect(App.formatTime(3661)).toBe('61:01');
    });
  });

  // --- audioUrl ---
  describe('audioUrl', () => {
    test('generates correct URL with encoded path', () => {
      const url = App.audioUrl('/path/to/file.wav');
      expect(url).toBe('http://127.0.0.1:18123/audio?path=%2Fpath%2Fto%2Ffile.wav');
    });

    test('encodes special characters', () => {
      const url = App.audioUrl('/path/song (remix).wav');
      // Spaces should be percent-encoded
      expect(url).toContain('%20');
      expect(url).toContain('18123');
      expect(url).toContain('audio?path=');
    });
  });

  // --- getAudioCtx ---
  describe('getAudioCtx', () => {
    test('creates AudioContext on first call', () => {
      App.audioCtx = null;
      const ctx = App.getAudioCtx();
      expect(ctx).toBeDefined();
      expect(ctx.state).toBe('running');
    });

    test('reuses existing AudioContext', () => {
      const ctx1 = App.getAudioCtx();
      const ctx2 = App.getAudioCtx();
      expect(ctx1).toBe(ctx2);
    });
  });

  // --- showToast ---
  describe('showToast', () => {
    test('sets text and class on toast element', () => {
      App.showToast('Test message', 'success');
      const toast = document.getElementById('toast');
      expect(toast.textContent).toBe('Test message');
      expect(toast.className).toContain('success');
    });

    test('handles error type', () => {
      App.showToast('Error occurred', 'error');
      const toast = document.getElementById('toast');
      expect(toast.textContent).toBe('Error occurred');
      expect(toast.className).toContain('error');
    });
  });

  // --- addFiles ---
  describe('addFiles', () => {
    test('calls pywebview.api.pick_files', () => {
      addFiles();
      expect(pywebview.api.pick_files).toHaveBeenCalled();
    });

    test('adds new files from pick_files result', async () => {
      const newFiles = [{ name: 'song.mp3', path: '/song.mp3' }];
      pywebview.api.pick_files.mockResolvedValue(JSON.stringify(newFiles));
      addFiles();
      await new Promise(r => setTimeout(r, 10));
      expect(App.files.length).toBe(1);
      expect(App.files[0].name).toBe('song.mp3');
      expect(App.files[0].status).toBe('pending');
      expect(App.files[0].stems).toBeNull();
    });

    test('does not add duplicate files', async () => {
      App.files = [{ name: 'song.mp3', path: '/song.mp3', status: 'pending', stems: null }];
      pywebview.api.pick_files.mockResolvedValue(JSON.stringify([{ name: 'song.mp3', path: '/song.mp3' }]));
      addFiles();
      await new Promise(r => setTimeout(r, 10));
      expect(App.files.length).toBe(1);
    });

    test('handles null result from pick_files', async () => {
      pywebview.api.pick_files.mockResolvedValue(null);
      addFiles();
      await new Promise(r => setTimeout(r, 10));
      expect(App.files.length).toBe(0);
    });
  });

  // --- removeFile ---
  describe('removeFile', () => {
    test('removes file at given index', () => {
      App.files = [
        { name: 'a', path: '/a' },
        { name: 'b', path: '/b' },
        { name: 'c', path: '/c' },
      ];
      const mockEvent = { stopPropagation: jest.fn() };
      removeFile(1, mockEvent);
      expect(App.files.length).toBe(2);
      expect(App.files.map(f => f.name)).toEqual(['a', 'c']);
      expect(mockEvent.stopPropagation).toHaveBeenCalled();
    });

    test('resets expandedIndex when removing expanded file', () => {
      App.files = [{ name: 'a', path: '/a' }, { name: 'b', path: '/b' }];
      App.expandedIndex = 0;
      removeFile(0, { stopPropagation: jest.fn() });
      expect(App.expandedIndex).toBe(-1);
    });

    test('decrements expandedIndex when removing file before expanded', () => {
      App.files = [{ name: 'a', path: '/a' }, { name: 'b', path: '/b' }, { name: 'c', path: '/c' }];
      App.expandedIndex = 2;
      removeFile(0, { stopPropagation: jest.fn() });
      expect(App.expandedIndex).toBe(1);
    });

    test('cleans up audio elements if present', () => {
      const mockGain = { disconnect: jest.fn() };
      const mockAnalyser = { disconnect: jest.fn() };
      App.files = [{
        name: 'a', path: '/a',
        _audioEls: [{ audio: { pause: jest.fn(), src: '' }, gain: mockGain, analyser: mockAnalyser }],
        stems: [],
      }];
      removeFile(0, { stopPropagation: jest.fn() });
      expect(App.files.length).toBe(0);
    });
  });

  // --- clearFiles ---
  describe('clearFiles', () => {
    test('empties files array and resets expandedIndex', () => {
      App.files = [{ name: 'a' }, { name: 'b' }];
      App.expandedIndex = 1;
      clearFiles();
      expect(App.files).toEqual([]);
      expect(App.expandedIndex).toBe(-1);
    });
  });

  // --- startSplit ---
  describe('startSplit', () => {
    test('shows error toast when no files', () => {
      App.files = [];
      const spy = jest.spyOn(App, 'showToast');
      startSplit();
      expect(spy).toHaveBeenCalledWith('Add audio files first', 'error');
      expect(pywebview.api.start_split).not.toHaveBeenCalled();
    });

    test('calls pywebview.api.start_split with correct arguments', () => {
      App.files = [{ name: 'song.mp3', path: '/song.mp3' }];
      document.getElementById('modelSelect').value = 'htdemucs';
      document.getElementById('outputPath').textContent = '/output';
      startSplit();
      expect(pywebview.api.start_split).toHaveBeenCalledWith(
        JSON.stringify(['/song.mp3']),
        'htdemucs',
        '/output',
        'cpu'
      );
      expect(App.splitting).toBe(true);
    });

    test('disables split button and shows cancel', () => {
      App.files = [{ name: 'song.mp3', path: '/song.mp3' }];
      startSplit();
      const btn = document.getElementById('splitBtn');
      const cancelBtn = document.getElementById('cancelBtn');
      expect(btn.disabled).toBe(true);
      expect(btn.textContent).toBe('Splitting...');
      expect(cancelBtn.classList.contains('visible')).toBe(true);
    });

    test('stores split model and output on each file', () => {
      App.files = [{ name: 'a.mp3', path: '/a.mp3' }, { name: 'b.mp3', path: '/b.mp3' }];
      document.getElementById('modelSelect').value = 'htdemucs_6s';
      document.getElementById('outputPath').textContent = '/out';
      startSplit();
      expect(App.files[0]._splitModel).toBe('htdemucs_6s');
      expect(App.files[0]._splitOutput).toBe('/out');
      expect(App.files[1]._splitModel).toBe('htdemucs_6s');
    });
  });

  // --- cancelSplit ---
  describe('cancelSplit', () => {
    test('calls pywebview.api.cancel_split', () => {
      cancelSplit();
      expect(pywebview.api.cancel_split).toHaveBeenCalled();
    });
  });

  // --- updateProgress ---
  describe('updateProgress', () => {
    test('sets progress bar width and status text', () => {
      updateProgress(50, 'Halfway there');
      expect(document.getElementById('progressFill').style.width).toBe('50%');
      expect(document.getElementById('statusText').textContent).toBe('Halfway there');
      expect(document.getElementById('progressPct').textContent).toBe('50%');
    });

    test('hides percentage at 0', () => {
      updateProgress(0, 'Ready');
      expect(document.getElementById('progressPct').textContent).toBe('');
    });

    test('handles no status parameter', () => {
      document.getElementById('statusText').textContent = 'old';
      updateProgress(25);
      expect(document.getElementById('progressFill').style.width).toBe('25%');
      expect(document.getElementById('statusText').textContent).toBe('old');
    });
  });

  // --- markFileProcessing / markFileDone ---
  describe('markFileProcessing', () => {
    test('sets file status to processing', () => {
      App.files = [{ name: 'a', status: 'pending' }];
      markFileProcessing(0);
      expect(App.files[0].status).toBe('processing');
    });

    test('does nothing for invalid index', () => {
      App.files = [];
      expect(() => markFileProcessing(5)).not.toThrow();
    });
  });

  describe('markFileDone', () => {
    test('sets status to done and parses stems', () => {
      App.files = [{ name: 'a', status: 'processing' }];
      const stemsData = JSON.stringify([{ name: 'vocals', path: '/v.wav' }, { name: 'drums', path: '/d.wav' }]);
      markFileDone(0, stemsData);
      expect(App.files[0].status).toBe('done');
      expect(App.files[0].stems.length).toBe(2);
      expect(App.files[0].stems[0]._muted).toBe(false);
      expect(App.files[0].stems[0]._soloed).toBe(false);
      expect(App.files[0].stems[0]._volume).toBe(100);
    });

    test('accepts stems as object (not just string)', () => {
      App.files = [{ name: 'a', status: 'processing' }];
      markFileDone(0, [{ name: 'vocals', path: '/v.wav' }]);
      expect(App.files[0].stems.length).toBe(1);
    });

    test('does nothing for invalid index', () => {
      App.files = [];
      expect(() => markFileDone(5, '[]')).not.toThrow();
    });
  });

  // --- splitDone ---
  describe('splitDone', () => {
    beforeEach(() => {
      window.loadLibrary = jest.fn();
    });

    test('resets button state on success', () => {
      App.splitting = true;
      splitDone(true, 'All done!');
      const btn = document.getElementById('splitBtn');
      expect(btn.disabled).toBe(false);
      expect(btn.textContent).toBe('Split Stems');
      expect(App.splitting).toBe(false);
    });

    test('shows success toast and sets progress to 100%', () => {
      const spy = jest.spyOn(App, 'showToast');
      splitDone(true, 'Completed');
      expect(spy).toHaveBeenCalledWith('Completed', 'success');
      expect(document.getElementById('progressFill').style.width).toBe('100%');
      expect(document.getElementById('progressPct').textContent).toBe('100%');
    });

    test('shows error toast on failure', () => {
      const spy = jest.spyOn(App, 'showToast');
      splitDone(false, 'Failed!');
      expect(spy).toHaveBeenCalledWith('Failed!', 'error');
    });

    test('hides cancel button', () => {
      document.getElementById('cancelBtn').classList.add('visible');
      splitDone(true, 'Done');
      expect(document.getElementById('cancelBtn').classList.contains('visible')).toBe(false);
    });
  });

  // --- exportMix ---
  describe('exportMix', () => {
    test('calls pywebview.api.export_mix with correct stem data', () => {
      App.files = [{
        name: 'song.wav', path: '/song.wav', status: 'done',
        stems: [
          { name: 'vocals', path: '/v.wav', _muted: false, _soloed: true, _volume: 80 },
          { name: 'drums', path: '/d.wav', _muted: true, _soloed: false, _volume: 60 },
        ],
      }];
      document.getElementById('outputPath').textContent = '/output';
      exportMix('queue', 0);

      expect(pywebview.api.export_mix).toHaveBeenCalled();
      const call = pywebview.api.export_mix.mock.calls[0];
      const stems = JSON.parse(call[0]);
      expect(stems).toEqual([
        { path: '/v.wav', volume: 80, muted: false, soloed: true },
        { path: '/d.wav', volume: 60, muted: true, soloed: false },
      ]);
      expect(call[1]).toBe('/output/song_mix.wav');
    });

    test('shows error when no stems', () => {
      App.files = [{ name: 'a', stems: null }];
      const spy = jest.spyOn(App, 'showToast');
      exportMix('queue', 0);
      expect(spy).toHaveBeenCalledWith('No stems to export', 'error');
      expect(pywebview.api.export_mix).not.toHaveBeenCalled();
    });

    test('uses default volume of 100 when _volume not set', () => {
      App.files = [{
        name: 'song.wav', stems: [{ name: 'vocals', path: '/v.wav', _muted: false, _soloed: false }],
      }];
      document.getElementById('outputPath').textContent = '/out';
      exportMix('queue', 0);
      const stems = JSON.parse(pywebview.api.export_mix.mock.calls[0][0]);
      expect(stems[0].volume).toBe(100);
    });
  });

  // --- exportMixDone ---
  describe('exportMixDone', () => {
    test('shows success toast with filename on success', () => {
      const spy = jest.spyOn(App, 'showToast');
      exportMixDone(true, '/output/song_mix.wav');
      expect(spy).toHaveBeenCalledWith('Exported: song_mix.wav', 'success');
    });

    test('shows error toast on failure', () => {
      const spy = jest.spyOn(App, 'showToast');
      exportMixDone(false, 'Encoding error');
      expect(spy).toHaveBeenCalledWith('Encoding error', 'error');
    });

    test('updates progress to 100 on success', () => {
      exportMixDone(true, '/output/mix.wav');
      expect(document.getElementById('progressFill').style.width).toBe('100%');
    });

    test('resets progress to 0 on failure', () => {
      exportMixDone(false, 'fail');
      expect(document.getElementById('progressFill').style.width).toBe('0%');
    });
  });

  // --- exportMixProgress ---
  describe('exportMixProgress', () => {
    test('delegates to updateProgress', () => {
      exportMixProgress(42, 'Encoding...');
      expect(document.getElementById('progressFill').style.width).toBe('42%');
      expect(document.getElementById('statusText').textContent).toBe('Encoding...');
    });
  });

  // --- Keyboard shortcuts ---
  describe('Keyboard shortcuts', () => {
    function fireKey(code, opts = {}) {
      const event = new KeyboardEvent('keydown', {
        code,
        bubbles: true,
        cancelable: true,
        ...opts,
      });
      document.dispatchEvent(event);
    }

    test('Space calls pausePlayback when playing', () => {
      // Need mixer loaded for pausePlayback
      setupTestEnv(['app', 'render', 'mixer']);
      window.drawStaticWaveforms = jest.fn();
      window.loadMidiNotesIfNeeded = jest.fn();
      window.generateWaveform = jest.fn();
      window.drawWaveform = jest.fn();
      window.drawEQ = jest.fn();
      window.drawMidiNotes = jest.fn();

      App.activePlayer = { key: 'queue:0', src: 'queue', idx: 0, playing: true };
      App.files = [{
        name: 'a', stems: [{ name: 'vocals', path: '/v.wav' }],
        _audioEls: [{ audio: { pause: jest.fn(), currentTime: 0 }, gain: { disconnect: jest.fn() }, analyser: { disconnect: jest.fn() } }],
      }];

      fireKey('Space');

      // After space, activePlayer.playing should be false
      expect(App.activePlayer.playing).toBe(false);
    });

    test('Escape stops playback', () => {
      setupTestEnv(['app', 'render', 'mixer']);
      window.drawStaticWaveforms = jest.fn();
      window.loadMidiNotesIfNeeded = jest.fn();
      window.generateWaveform = jest.fn();
      window.drawWaveform = jest.fn();
      window.drawEQ = jest.fn();
      window.drawMidiNotes = jest.fn();

      App.activePlayer = { key: 'queue:0', src: 'queue', idx: 0, playing: true };
      App.files = [{
        name: 'a', stems: [{ name: 'vocals', path: '/v.wav' }],
        _audioEls: [{ audio: { pause: jest.fn(), currentTime: 0 }, gain: { disconnect: jest.fn() }, analyser: { disconnect: jest.fn() } }],
      }];

      fireKey('Escape');
      expect(App.activePlayer).toBeNull();
    });

    test('Ctrl+O calls addFiles', () => {
      const spy = jest.spyOn(window, 'addFiles').mockImplementation(() => {});
      fireKey('KeyO', { ctrlKey: true });
      expect(spy).toHaveBeenCalled();
      spy.mockRestore();
    });

    test('does not trigger shortcuts when in INPUT', () => {
      const input = document.createElement('input');
      document.body.appendChild(input);
      input.focus();
      const event = new KeyboardEvent('keydown', {
        code: 'Space',
        bubbles: true,
        cancelable: true,
      });
      Object.defineProperty(event, 'target', { value: input });
      document.dispatchEvent(event);
      // No error should occur; nothing should happen
    });
  });

  // --- toggleMixer ---
  describe('toggleMixer', () => {
    beforeEach(() => {
      setupTestEnv(['app', 'render', 'mixer']);
      window.drawStaticWaveforms = jest.fn();
      window.loadMidiNotesIfNeeded = jest.fn();
      window.generateWaveform = jest.fn();
      window.drawWaveform = jest.fn();
      window.drawEQ = jest.fn();
      window.drawMidiNotes = jest.fn();
    });

    test('expands mixer for queue file', () => {
      App.files = [{ name: 'a', stems: [{ name: 'vocals', path: '/v.wav', _muted: false, _soloed: false, _volume: 100 }] }];
      App.expandedIndex = -1;
      toggleMixer('queue', 0);
      expect(App.expandedIndex).toBe(0);
    });

    test('collapses mixer when already expanded', () => {
      App.files = [{ name: 'a', stems: [{ name: 'vocals', path: '/v.wav', _muted: false, _soloed: false, _volume: 100 }] }];
      App.expandedIndex = 0;
      toggleMixer('queue', 0);
      expect(App.expandedIndex).toBe(-1);
    });

    test('does nothing for file without stems', () => {
      App.files = [{ name: 'a', stems: null }];
      App.expandedIndex = -1;
      toggleMixer('queue', 0);
      expect(App.expandedIndex).toBe(-1);
    });
  });

  // --- setOutputReady ---
  describe('setOutputReady', () => {
    test('sets outputReady flag and updates button', () => {
      setOutputReady('/some/dir');
      expect(App.outputReady).toBe(true);
      const btn = document.getElementById('browseBtn');
      expect(btn.textContent).toBe('Open');
      expect(btn.classList.contains('has-output')).toBe(true);
    });
  });
});
