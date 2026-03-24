/**
 * Tests for mixer.js — Audio playback and mixer controls.
 */
const { setupTestEnv, createMockAudio, createMockGain, createMockAnalyser } = require('./setup');

describe('mixer.js', () => {
  let mockAudioCtx;

  beforeEach(() => {
    const env = setupTestEnv(['app', 'render', 'mixer']);
    mockAudioCtx = env.mockAudioCtx;
    // Stub rendering and waveform functions
    window.drawStaticWaveforms = jest.fn();
    window.loadMidiNotesIfNeeded = jest.fn();
    window.generateWaveform = jest.fn(() => Promise.resolve(null));
    window.drawWaveform = jest.fn();
    window.drawEQ = jest.fn();
    window.drawMidiNotes = jest.fn();
  });

  // Helper to set up a file with stems and audio elements
  function setupFileWithAudio(src = 'queue', idx = 0) {
    const audioEls = [
      { audio: createMockAudio(), gain: createMockGain(), analyser: createMockAnalyser() },
      { audio: createMockAudio(), gain: createMockGain(), analyser: createMockAnalyser() },
    ];
    const file = {
      name: 'test.wav', path: '/test.wav', status: 'done',
      stems: [
        { name: 'vocals', path: '/v.wav', _muted: false, _soloed: false, _volume: 100 },
        { name: 'drums', path: '/d.wav', _muted: false, _soloed: false, _volume: 80 },
      ],
      _audioEls: audioEls,
      _buffers: null,
    };
    if (src === 'lib') {
      App.library[idx] = file;
    } else {
      App.files[idx] = file;
    }
    return { file, audioEls };
  }

  // --- ensureAudioEls ---
  describe('ensureAudioEls', () => {
    test('creates audio elements for stems', () => {
      App.files = [{
        name: 'test.wav', path: '/test.wav', status: 'done',
        stems: [
          { name: 'vocals', path: '/v.wav', _muted: false, _soloed: false, _volume: 100 },
          { name: 'drums', path: '/d.wav', _muted: false, _soloed: false, _volume: 100 },
        ],
        _audioEls: null,
      }];
      const els = ensureAudioEls('queue', 0);
      expect(els.length).toBe(2);
      expect(els[0].audio).toBeDefined();
      expect(els[0].gain).toBeDefined();
      expect(els[0].analyser).toBeDefined();
    });

    test('returns existing audio elements if already created', () => {
      const { file, audioEls } = setupFileWithAudio();
      const result = ensureAudioEls('queue', 0);
      expect(result).toBe(audioEls);
    });
  });

  // --- togglePlay ---
  describe('togglePlay', () => {
    test('starts playback and sets activePlayer', () => {
      const { file, audioEls } = setupFileWithAudio();
      App.expandedIndex = 0;
      togglePlay('queue', 0);
      expect(App.activePlayer).toBeTruthy();
      expect(App.activePlayer.key).toBe('queue:0');
      expect(App.activePlayer.playing).toBe(true);
      expect(audioEls[0].audio.play).toHaveBeenCalled();
      expect(audioEls[1].audio.play).toHaveBeenCalled();
    });

    test('pauses when already playing the same key', () => {
      const { audioEls } = setupFileWithAudio();
      App.activePlayer = { key: 'queue:0', src: 'queue', idx: 0, playing: true };
      togglePlay('queue', 0);
      expect(App.activePlayer.playing).toBe(false);
      expect(audioEls[0].audio.pause).toHaveBeenCalled();
    });

    test('stops previous player when switching to different file', () => {
      const { audioEls: els1 } = setupFileWithAudio('queue', 0);
      const { audioEls: els2 } = setupFileWithAudio('queue', 1);
      App.activePlayer = { key: 'queue:0', src: 'queue', idx: 0, playing: true };
      togglePlay('queue', 1);
      // Old player should be stopped
      expect(els1[0].audio.pause).toHaveBeenCalled();
      // New player should be playing
      expect(App.activePlayer.key).toBe('queue:1');
      expect(App.activePlayer.playing).toBe(true);
    });

    test('resumes suspended AudioContext', () => {
      mockAudioCtx.state = 'suspended';
      setupFileWithAudio();
      togglePlay('queue', 0);
      expect(mockAudioCtx.resume).toHaveBeenCalled();
    });
  });

  // --- pausePlayback ---
  describe('pausePlayback', () => {
    test('pauses all audio elements', () => {
      const { audioEls } = setupFileWithAudio();
      App.activePlayer = { key: 'queue:0', src: 'queue', idx: 0, playing: true };
      pausePlayback();
      expect(audioEls[0].audio.pause).toHaveBeenCalled();
      expect(audioEls[1].audio.pause).toHaveBeenCalled();
      expect(App.activePlayer.playing).toBe(false);
    });

    test('does nothing when not playing', () => {
      App.activePlayer = null;
      expect(() => pausePlayback()).not.toThrow();
    });

    test('does nothing when already paused', () => {
      const { audioEls } = setupFileWithAudio();
      App.activePlayer = { key: 'queue:0', src: 'queue', idx: 0, playing: false };
      pausePlayback();
      expect(audioEls[0].audio.pause).not.toHaveBeenCalled();
    });
  });

  // --- stopPlayback ---
  describe('stopPlayback', () => {
    test('stops and resets currentTime to 0', () => {
      const { audioEls } = setupFileWithAudio();
      App.activePlayer = { key: 'queue:0', src: 'queue', idx: 0, playing: true };
      stopPlayback();
      expect(audioEls[0].audio.pause).toHaveBeenCalled();
      expect(audioEls[0].audio.currentTime).toBe(0);
      expect(audioEls[1].audio.currentTime).toBe(0);
      expect(App.activePlayer).toBeNull();
    });

    test('cancels animation frame', () => {
      setupFileWithAudio();
      App.activePlayer = { key: 'queue:0', src: 'queue', idx: 0, playing: true };
      App.animFrameId = 42;
      stopPlayback();
      expect(window.cancelAnimationFrame).toHaveBeenCalledWith(42);
    });
  });

  // --- applyMixState ---
  describe('applyMixState', () => {
    test('applies volume to gain nodes', () => {
      const { file, audioEls } = setupFileWithAudio();
      file.stems[0]._volume = 50;
      file.stems[1]._volume = 75;
      applyMixState('queue', 0);
      expect(audioEls[0].gain.gain.setValueAtTime).toHaveBeenCalledWith(0.5, expect.any(Number));
      expect(audioEls[1].gain.gain.setValueAtTime).toHaveBeenCalledWith(0.75, expect.any(Number));
    });

    test('mutes muted stems', () => {
      const { file, audioEls } = setupFileWithAudio();
      file.stems[0]._muted = true;
      applyMixState('queue', 0);
      expect(audioEls[0].gain.gain.setValueAtTime).toHaveBeenCalledWith(0, expect.any(Number));
    });

    test('solo logic: only soloed stems audible', () => {
      const { file, audioEls } = setupFileWithAudio();
      file.stems[0]._soloed = true;  // vocals soloed
      file.stems[1]._soloed = false; // drums not soloed
      applyMixState('queue', 0);
      // vocals should play at full volume
      expect(audioEls[0].gain.gain.setValueAtTime).toHaveBeenCalledWith(1, expect.any(Number));
      // drums should be silent (not soloed, but something is)
      expect(audioEls[1].gain.gain.setValueAtTime).toHaveBeenCalledWith(0, expect.any(Number));
    });

    test('when nothing soloed, all unmuted stems play', () => {
      const { file, audioEls } = setupFileWithAudio();
      file.stems[0]._soloed = false;
      file.stems[1]._soloed = false;
      file.stems[0]._muted = false;
      file.stems[1]._muted = false;
      applyMixState('queue', 0);
      expect(audioEls[0].gain.gain.setValueAtTime).toHaveBeenCalledWith(1, expect.any(Number));
      expect(audioEls[1].gain.gain.setValueAtTime).toHaveBeenCalledWith(0.8, expect.any(Number));
    });

    test('handles missing file gracefully', () => {
      expect(() => applyMixState('queue', 99)).not.toThrow();
    });
  });

  // --- setStemVolume ---
  describe('setStemVolume', () => {
    test('updates stem volume and applies mix state', () => {
      setupFileWithAudio();
      setStemVolume('queue', 0, 0, '42');
      expect(App.files[0].stems[0]._volume).toBe(42);
    });

    test('parses value as integer', () => {
      setupFileWithAudio();
      setStemVolume('queue', 0, 1, '66.7');
      expect(App.files[0].stems[1]._volume).toBe(66);
    });
  });

  // --- toggleSolo ---
  describe('toggleSolo', () => {
    test('solos a stem and unmutes it', () => {
      setupFileWithAudio();
      App.files[0].stems[0]._muted = true;
      toggleSolo('queue', 0, 0);
      expect(App.files[0].stems[0]._soloed).toBe(true);
      expect(App.files[0].stems[0]._muted).toBe(false);
    });

    test('unsoloing restores previous mute state', () => {
      setupFileWithAudio();
      App.files[0].stems[0]._muted = true;
      toggleSolo('queue', 0, 0); // solo on — saves muted=true, clears mute
      expect(App.files[0].stems[0]._muted).toBe(false);
      toggleSolo('queue', 0, 0); // solo off — restores muted=true
      expect(App.files[0].stems[0]._soloed).toBe(false);
      expect(App.files[0].stems[0]._muted).toBe(true);
    });

    test('double-solo from clean state restores clean state', () => {
      setupFileWithAudio();
      App.files[0].stems[0]._muted = false;
      App.files[0].stems[0]._soloed = false;
      toggleSolo('queue', 0, 0);
      toggleSolo('queue', 0, 0);
      expect(App.files[0].stems[0]._soloed).toBe(false);
      expect(App.files[0].stems[0]._muted).toBe(false);
    });
  });

  // --- toggleMute ---
  describe('toggleMute', () => {
    test('toggles mute state', () => {
      setupFileWithAudio();
      expect(App.files[0].stems[0]._muted).toBe(false);
      toggleMute('queue', 0, 0);
      expect(App.files[0].stems[0]._muted).toBe(true);
      toggleMute('queue', 0, 0);
      expect(App.files[0].stems[0]._muted).toBe(false);
    });

    test('mute clears solo, unmuting restores previous solo state', () => {
      setupFileWithAudio();
      App.files[0].stems[0]._soloed = true;
      App.files[0].stems[0]._muted = false;
      toggleMute('queue', 0, 0); // mute on — saves soloed=true, clears solo
      expect(App.files[0].stems[0]._muted).toBe(true);
      expect(App.files[0].stems[0]._soloed).toBe(false);
      toggleMute('queue', 0, 0); // mute off — restores soloed=true
      expect(App.files[0].stems[0]._muted).toBe(false);
      expect(App.files[0].stems[0]._soloed).toBe(true);
    });

    test('double-mute from clean state restores clean state', () => {
      setupFileWithAudio();
      App.files[0].stems[0]._muted = false;
      App.files[0].stems[0]._soloed = false;
      toggleMute('queue', 0, 0);
      toggleMute('queue', 0, 0);
      expect(App.files[0].stems[0]._muted).toBe(false);
      expect(App.files[0].stems[0]._soloed).toBe(false);
    });
  });

  // --- seekTo ---
  describe('seekTo', () => {
    test('sets currentTime on all audio elements', () => {
      const { audioEls } = setupFileWithAudio();
      audioEls[0].audio.duration = 100;
      seekTo('queue', 0, 500); // 500/1000 * 100 = 50
      expect(audioEls[0].audio.currentTime).toBe(50);
      expect(audioEls[1].audio.currentTime).toBe(50);
    });

    test('does nothing when no audio elements', () => {
      App.files = [{ name: 'a', _audioEls: null }];
      expect(() => seekTo('queue', 0, 500)).not.toThrow();
    });

    test('does nothing when duration is 0', () => {
      const { audioEls } = setupFileWithAudio();
      audioEls[0].audio.duration = 0;
      seekTo('queue', 0, 500);
      // currentTime should remain 0 since duration is falsy
    });
  });

  // --- midiToFreq ---
  describe('midiToFreq', () => {
    test('A4 (MIDI 69) = 440 Hz', () => {
      expect(midiToFreq(69)).toBeCloseTo(440, 5);
    });

    test('A3 (MIDI 57) = 220 Hz', () => {
      expect(midiToFreq(57)).toBeCloseTo(220, 2);
    });

    test('A5 (MIDI 81) = 880 Hz', () => {
      expect(midiToFreq(81)).toBeCloseTo(880, 2);
    });

    test('C4 (MIDI 60) ~= 261.63 Hz', () => {
      expect(midiToFreq(60)).toBeCloseTo(261.626, 1);
    });

    test('MIDI 0 gives a very low frequency', () => {
      expect(midiToFreq(0)).toBeCloseTo(8.176, 1);
    });

    test('MIDI 127 gives a very high frequency', () => {
      expect(midiToFreq(127)).toBeCloseTo(12543.85, 0);
    });
  });

  // --- toggleMidiMute / toggleMidiSolo ---
  describe('toggleMidiMute', () => {
    test('toggles MIDI mute state', () => {
      setupFileWithAudio();
      App.files[0].stems[0]._midiMuted = true;
      toggleMidiMute('queue', 0, 0);
      expect(App.files[0].stems[0]._midiMuted).toBe(false);
      toggleMidiMute('queue', 0, 0);
      expect(App.files[0].stems[0]._midiMuted).toBe(true);
    });

    test('mute clears MIDI solo, unmuting restores it', () => {
      setupFileWithAudio();
      App.files[0].stems[0]._midiSoloed = true;
      App.files[0].stems[0]._midiMuted = false;
      toggleMidiMute('queue', 0, 0);
      expect(App.files[0].stems[0]._midiMuted).toBe(true);
      expect(App.files[0].stems[0]._midiSoloed).toBe(false);
      toggleMidiMute('queue', 0, 0);
      expect(App.files[0].stems[0]._midiMuted).toBe(false);
      expect(App.files[0].stems[0]._midiSoloed).toBe(true);
    });
  });

  describe('toggleMidiSolo', () => {
    test('solos MIDI and unmutes it', () => {
      setupFileWithAudio();
      App.files[0].stems[0]._midiMuted = true;
      toggleMidiSolo('queue', 0, 0);
      expect(App.files[0].stems[0]._midiSoloed).toBe(true);
      expect(App.files[0].stems[0]._midiMuted).toBe(false);
    });

    test('unsoloing restores previous mute state', () => {
      setupFileWithAudio();
      App.files[0].stems[0]._midiMuted = true;
      toggleMidiSolo('queue', 0, 0); // solo on
      expect(App.files[0].stems[0]._midiMuted).toBe(false);
      toggleMidiSolo('queue', 0, 0); // solo off
      expect(App.files[0].stems[0]._midiMuted).toBe(true);
    });

    test('double-solo from clean state restores clean state', () => {
      setupFileWithAudio();
      App.files[0].stems[0]._midiMuted = false;
      App.files[0].stems[0]._midiSoloed = false;
      toggleMidiSolo('queue', 0, 0);
      toggleMidiSolo('queue', 0, 0);
      expect(App.files[0].stems[0]._midiSoloed).toBe(false);
      expect(App.files[0].stems[0]._midiMuted).toBe(false);
    });
  });

  // --- copyStem ---
  describe('copyStem', () => {
    test('copies stem path to clipboard', () => {
      setupFileWithAudio();
      copyStem('queue', 0, 0);
      expect(pywebview.api.copy_to_clipboard).toHaveBeenCalledWith('/v.wav');
    });
  });

  // --- App.findStemByPath ---
  describe('App.findStemByPath', () => {
    test('finds stem in files array', () => {
      App.files = [{
        name: 'a', stems: [{ name: 'vocals', path: '/v.wav' }],
      }];
      const result = App.findStemByPath('/v.wav');
      expect(result).toBeTruthy();
      expect(result.name).toBe('vocals');
    });

    test('finds stem in library array', () => {
      App.files = [];
      App.library = [{
        name: 'b', stems: [{ name: 'drums', path: '/d.wav' }],
      }];
      const result = App.findStemByPath('/d.wav');
      expect(result).toBeTruthy();
      expect(result.name).toBe('drums');
    });

    test('returns null when not found', () => {
      App.files = [];
      App.library = [];
      expect(App.findStemByPath('/nonexistent.wav')).toBeNull();
    });
  });

  // --- convertToMidi ---
  describe('convertToMidi', () => {
    test('sets state to converting and calls API', () => {
      setupFileWithAudio();
      convertToMidi('queue', 0, 0);
      expect(App.files[0].stems[0]._midiState).toBe('converting');
      expect(pywebview.api.convert_to_midi).toHaveBeenCalledWith('/v.wav', 'vocals');
    });

    test('does nothing if already converting', () => {
      setupFileWithAudio();
      App.files[0].stems[0]._midiState = 'converting';
      convertToMidi('queue', 0, 0);
      expect(pywebview.api.convert_to_midi).not.toHaveBeenCalled();
    });
  });

  // --- midiConvertDone ---
  describe('midiConvertDone', () => {
    test('sets stem MIDI state on success', () => {
      App.files = [{
        name: 'a', stems: [{ name: 'vocals', path: '/v.wav', _midiState: 'converting' }],
      }];
      midiConvertDone('/v.wav', true, '/v.mid', [[0, 1, 60]]);
      const stem = App.files[0].stems[0];
      expect(stem._midiState).toBe('done');
      expect(stem._midiPath).toBe('/v.mid');
      expect(stem._midiNotes).toEqual([[0, 1, 60]]);
      expect(stem._midiMuted).toBe(true);
    });

    test('sets error state on failure', () => {
      App.files = [{
        name: 'a', stems: [{ name: 'vocals', path: '/v.wav', _midiState: 'converting' }],
      }];
      midiConvertDone('/v.wav', false, 'conversion failed', null);
      expect(App.files[0].stems[0]._midiState).toBe('error');
    });
  });
});
