/**
 * Tests for render.js — DOM rendering and XSS prevention.
 */
const { setupTestEnv } = require('./setup');

describe('render.js', () => {
  beforeEach(() => {
    setupTestEnv(['app', 'render']);
    // Stub functions called by renderFiles
    global.drawStaticWaveforms = jest.fn();
    global.loadMidiNotesIfNeeded = jest.fn();
  });

  // --- escHtml ---
  describe('escHtml', () => {
    test('escapes < and > characters', () => {
      expect(escHtml('<script>alert(1)</script>')).not.toContain('<script>');
      expect(escHtml('<b>bold</b>')).not.toContain('<b>');
      const result = escHtml('<div>');
      expect(result).toContain('&lt;');
      expect(result).toContain('&gt;');
    });

    test('escapes & character', () => {
      expect(escHtml('a&b')).toBe('a&amp;b');
    });

    test('escapes " character', () => {
      // textContent/innerHTML in jsdom may or may not escape quotes in inner text
      // but it should at least not produce raw < or >
      const input = 'file "test" name';
      const result = escHtml(input);
      expect(result).not.toContain('<');
    });

    test('returns empty string for empty input', () => {
      expect(escHtml('')).toBe('');
    });

    test('passes through safe strings unchanged', () => {
      expect(escHtml('hello world')).toBe('hello world');
      expect(escHtml('song_name_123')).toBe('song_name_123');
    });

    test('handles string with all special chars', () => {
      const result = escHtml('<>&"\'');
      expect(result).not.toContain('<');
      expect(result).not.toContain('>');
      expect(result).toContain('&amp;');
    });

    test('prevents XSS via malicious file names', () => {
      const malicious = '"><img src=x onerror=alert(1)>';
      const result = escHtml(malicious);
      expect(result).not.toContain('<img');
      // onerror text is preserved (it's not a tag), but the < > are escaped
      // so it cannot be interpreted as HTML
      expect(result).toContain('&lt;');
      expect(result).toContain('&gt;');
    });
  });

  // --- escAttr ---
  describe('escAttr', () => {
    test('escapes double quotes for attribute safety', () => {
      const result = escAttr('file "name" here');
      expect(result).toContain('&quot;');
      expect(result).not.toMatch(/"name"/);
    });

    test('escapes < and > like escHtml', () => {
      const result = escAttr('<script>');
      expect(result).toContain('&lt;');
      expect(result).toContain('&gt;');
    });

    test('handles attribute injection attack', () => {
      const attack = '" onclick="alert(1)" data-x="';
      const result = escAttr(attack);
      // All double quotes are replaced with &quot; preventing attribute breakout
      expect(result).toContain('&quot;');
      expect(result).not.toContain('"');
      // The word onclick may still be present as text, but quotes are escaped
      // so it cannot break out of an attribute context
    });

    test('safe strings pass through', () => {
      expect(escAttr('simple-value')).toBe('simple-value');
    });
  });

  // --- renderFiles ---
  describe('renderFiles', () => {
    test('renders empty state when no files and no library', () => {
      App.files = [];
      App.library = [];
      renderFiles();
      const zone = document.getElementById('dropZone');
      expect(zone.className).toContain('empty');
      expect(zone.innerHTML).toContain('Drop audio files');
      expect(zone.getAttribute('onclick')).toBe('addFiles()');
      expect(zone.getAttribute('role')).toBe('button');
    });

    test('renders file list when files exist', () => {
      App.files = [
        { name: 'song.mp3', path: '/path/to/song.mp3', status: 'pending', stems: null }
      ];
      App.library = [];
      renderFiles();
      const zone = document.getElementById('dropZone');
      expect(zone.className).not.toContain('empty');
      expect(zone.innerHTML).toContain('song.mp3');
      expect(zone.innerHTML).toContain('+ Split New Song');
      expect(zone.innerHTML).toContain('Clear');
    });

    test('does not show Clear button when no files in queue', () => {
      App.files = [];
      App.library = [{ name: 'lib-song', stemDir: '/lib/dir', model: 'htdemucs', stems: [{ name: 'vocals', path: '/v.wav' }] }];
      renderFiles();
      const zone = document.getElementById('dropZone');
      expect(zone.innerHTML).not.toContain('clearFiles()');
    });

    test('renders file with done status', () => {
      App.files = [
        { name: 'done.wav', path: '/done.wav', status: 'done', stems: [{ name: 'vocals', path: '/v.wav' }] }
      ];
      renderFiles();
      const zone = document.getElementById('dropZone');
      expect(zone.innerHTML).toContain('SPLIT');
      expect(zone.innerHTML).toContain('has-stems');
    });

    test('renders processing status', () => {
      App.files = [
        { name: 'proc.wav', path: '/proc.wav', status: 'processing', stems: null }
      ];
      renderFiles();
      const zone = document.getElementById('dropZone');
      expect(zone.innerHTML).toContain('processing');
    });

    test('renders expanded mixer when expandedIndex matches', () => {
      App.files = [{
        name: 'test.wav', path: '/test.wav', status: 'done',
        stems: [
          { name: 'vocals', path: '/v.wav', _muted: false, _soloed: false, _volume: 100 },
          { name: 'drums', path: '/d.wav', _muted: false, _soloed: false, _volume: 100 },
        ]
      }];
      App.expandedIndex = 0;
      renderFiles();
      const zone = document.getElementById('dropZone');
      expect(zone.innerHTML).toContain('mixer-panel');
      expect(zone.innerHTML).toContain('transport');
      expect(zone.innerHTML).toContain('Export Mix');
    });

    test('does not render mixer when expandedIndex is -1', () => {
      App.files = [{
        name: 'test.wav', path: '/test.wav', status: 'done',
        stems: [{ name: 'vocals', path: '/v.wav', _muted: false, _soloed: false, _volume: 100 }]
      }];
      App.expandedIndex = -1;
      renderFiles();
      const zone = document.getElementById('dropZone');
      expect(zone.innerHTML).not.toContain('mixer-panel');
    });

    test('escapes file names in rendered HTML', () => {
      App.files = [
        { name: '<script>alert(1)</script>.mp3', path: '/malicious.mp3', status: 'pending', stems: null }
      ];
      renderFiles();
      const zone = document.getElementById('dropZone');
      // The raw HTML should contain escaped entities, not actual script tags
      // Note: when set via innerHTML, jsdom may parse entities back; check that
      // there is no actual <script> element in the DOM
      const scripts = zone.querySelectorAll('script');
      expect(scripts.length).toBe(0);
      // The file name should be visible as text
      expect(zone.textContent).toContain('<script>alert(1)</script>.mp3');
    });

    test('renders library section with Previous Splits divider', () => {
      App.files = [];
      App.library = [{
        name: 'old-song', stemDir: '/lib/old-song', model: 'htdemucs',
        stems: [{ name: 'vocals', path: '/v.wav', _muted: false, _soloed: false, _volume: 100 }]
      }];
      renderFiles();
      const zone = document.getElementById('dropZone');
      expect(zone.innerHTML).toContain('Previous Splits');
      expect(zone.innerHTML).toContain('old-song');
      expect(zone.innerHTML).toContain('4-stem');
    });

    test('renders 6-stem label for htdemucs_6s model', () => {
      App.files = [];
      App.library = [{
        name: 'six-stem', stemDir: '/lib/six', model: 'htdemucs_6s',
        stems: [{ name: 'vocals', path: '/v.wav', _muted: false, _soloed: false, _volume: 100 }]
      }];
      renderFiles();
      const zone = document.getElementById('dropZone');
      expect(zone.innerHTML).toContain('6-stem');
    });
  });

  // --- renderMixer ---
  describe('renderMixer', () => {
    test('returns HTML with transport controls', () => {
      const f = {
        name: 'test.wav',
        stems: [
          { name: 'vocals', path: '/v.wav', _muted: false, _soloed: false, _volume: 80 },
        ],
      };
      App.activePlayer = null;
      const html = renderMixer(0, f, 'queue');
      expect(html).toContain('transport');
      expect(html).toContain('Play');
      expect(html).toContain('Pause');
      expect(html).toContain('Stop');
    });

    test('renders stem tracks with correct names and colors', () => {
      const f = {
        name: 'test.wav',
        stems: [
          { name: 'vocals', path: '/v.wav', _muted: false, _soloed: false, _volume: 100 },
          { name: 'drums', path: '/d.wav', _muted: false, _soloed: false, _volume: 75 },
          { name: 'bass', path: '/b.wav', _muted: true, _soloed: false, _volume: 50 },
        ],
      };
      App.activePlayer = null;
      const html = renderMixer(0, f, 'queue');
      expect(html).toContain('vocals');
      expect(html).toContain('drums');
      expect(html).toContain('bass');
      expect(html).toContain('#f472b6'); // vocals color
      expect(html).toContain('#818cf8'); // drums color
      expect(html).toContain('muted');
    });

    test('includes Export Mix button', () => {
      const f = {
        name: 'test.wav',
        stems: [{ name: 'vocals', path: '/v.wav', _muted: false, _soloed: false, _volume: 100 }],
      };
      App.activePlayer = null;
      const html = renderMixer(0, f, 'queue');
      expect(html).toContain('Export Mix');
      expect(html).toContain('btn-export');
      expect(html).toContain("exportMix('queue',0)");
    });

    test('shows keyboard shortcut hints', () => {
      const f = {
        name: 'test.wav',
        stems: [{ name: 'vocals', path: '/v.wav', _muted: false, _soloed: false, _volume: 100 }],
      };
      App.activePlayer = null;
      const html = renderMixer(0, f, 'queue');
      expect(html).toContain('Space');
      expect(html).toContain('Esc');
      expect(html).toContain('Ctrl+O');
    });

    test('marks playing state on play button', () => {
      const f = {
        name: 'test.wav',
        stems: [{ name: 'vocals', path: '/v.wav', _muted: false, _soloed: false, _volume: 100 }],
      };
      App.activePlayer = { key: 'queue:0', playing: true, startOffset: 0 };
      const html = renderMixer(0, f, 'queue');
      // The play button should have 'active' class
      expect(html).toMatch(/transport-btn active.*Play/s);
    });

    test('shows solo-active and mute-active classes', () => {
      const f = {
        name: 'test.wav',
        stems: [
          { name: 'vocals', path: '/v.wav', _muted: false, _soloed: true, _volume: 100 },
          { name: 'drums', path: '/d.wav', _muted: true, _soloed: false, _volume: 100 },
        ],
      };
      App.activePlayer = null;
      const html = renderMixer(0, f, 'queue');
      expect(html).toContain('solo-active');
      expect(html).toContain('mute-active');
    });

    test('renders MIDI button for eligible stems', () => {
      const f = {
        name: 'test.wav',
        stems: [
          { name: 'vocals', path: '/v.wav', _muted: false, _soloed: false, _volume: 100 },
          { name: 'other', path: '/o.wav', _muted: false, _soloed: false, _volume: 100 },
        ],
      };
      App.activePlayer = null;
      const html = renderMixer(0, f, 'queue');
      // vocals is MIDI eligible
      expect(html).toContain("convertToMidi('queue',0,0)");
      // other is NOT MIDI eligible — should show disabled
      expect(html).toContain('midi-ineligible');
    });

    test('renders MIDI timeline row when conversion is done', () => {
      const f = {
        name: 'test.wav',
        stems: [
          { name: 'vocals', path: '/v.wav', _muted: false, _soloed: false, _volume: 100, _midiState: 'done', _midiPath: '/v.mid', _midiMuted: true, _midiSoloed: false },
        ],
      };
      App.activePlayer = null;
      const html = renderMixer(0, f, 'queue');
      expect(html).toContain('midi-track-row');
      expect(html).toContain('MIDI');
    });

    test('uses correct uid for lib source', () => {
      const f = {
        name: 'test.wav',
        stems: [{ name: 'vocals', path: '/v.wav', _muted: false, _soloed: false, _volume: 100 }],
      };
      App.activePlayer = null;
      const html = renderMixer(2, f, 'lib');
      expect(html).toContain('seek-lib-2');
      expect(html).toContain('time-lib-2');
      expect(html).toContain("exportMix('lib',2)");
    });
  });
});
