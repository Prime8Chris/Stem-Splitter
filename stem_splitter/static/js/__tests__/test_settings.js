/**
 * Tests for settings.js — Theme and accessibility settings.
 */
const { setupTestEnv } = require('./setup');

describe('settings.js', () => {
  beforeEach(() => {
    setupTestEnv(['app', 'render', 'settings']);
    window.drawStaticWaveforms = jest.fn();
    window.loadMidiNotesIfNeeded = jest.fn();
  });

  // --- toggleSettings ---
  describe('toggleSettings', () => {
    test('toggles settingsOpen from false to true', () => {
      App.settingsOpen = false;
      toggleSettings();
      expect(App.settingsOpen).toBe(true);
    });

    test('toggles settingsOpen from true to false', () => {
      App.settingsOpen = true;
      toggleSettings();
      expect(App.settingsOpen).toBe(false);
    });

    test('opens settings panel when toggled on', () => {
      App.settingsOpen = false;
      toggleSettings();
      const panel = document.getElementById('settingsPanel');
      expect(panel.classList.contains('open')).toBe(true);
    });

    test('closes settings panel when toggled off', () => {
      App.settingsOpen = true;
      toggleSettings();
      const panel = document.getElementById('settingsPanel');
      expect(panel.classList.contains('open')).toBe(false);
    });
  });

  // --- closeSettings ---
  describe('closeSettings', () => {
    test('sets settingsOpen to false', () => {
      App.settingsOpen = true;
      closeSettings();
      expect(App.settingsOpen).toBe(false);
    });

    test('removes open class from panel', () => {
      const panel = document.getElementById('settingsPanel');
      panel.classList.add('open');
      App.settingsOpen = true;
      closeSettings();
      expect(panel.classList.contains('open')).toBe(false);
    });
  });

  // --- renderSettingsPanel ---
  describe('renderSettingsPanel', () => {
    test('renders theme dropdown when open', () => {
      App.settingsOpen = true;
      App.settings = { theme: 'dark' };
      renderSettingsPanel();
      const panel = document.getElementById('settingsPanel');
      expect(panel.innerHTML).toContain('Theme');
      expect(panel.innerHTML).toContain('themeSelect');
      expect(panel.innerHTML).toContain('Dark');
      expect(panel.innerHTML).toContain('Light');
      expect(panel.innerHTML).toContain('System');
    });

    test('renders high contrast toggle', () => {
      App.settingsOpen = true;
      App.settings = { theme: 'dark', high_contrast: false };
      renderSettingsPanel();
      const panel = document.getElementById('settingsPanel');
      expect(panel.innerHTML).toContain('High Contrast');
      expect(panel.innerHTML).toContain('hcToggle');
    });

    test('checks high contrast when enabled', () => {
      App.settingsOpen = true;
      App.settings = { theme: 'dark', high_contrast: true };
      renderSettingsPanel();
      const panel = document.getElementById('settingsPanel');
      expect(panel.innerHTML).toContain('checked');
    });

    test('selects current theme in dropdown', () => {
      App.settingsOpen = true;
      App.settings = { theme: 'light' };
      renderSettingsPanel();
      const panel = document.getElementById('settingsPanel');
      // The light option should be selected
      expect(panel.innerHTML).toMatch(/value="light"\s+selected/);
    });

    test('does nothing when closed', () => {
      App.settingsOpen = false;
      const panel = document.getElementById('settingsPanel');
      panel.innerHTML = 'old content';
      renderSettingsPanel();
      expect(panel.innerHTML).toBe('old content');
    });
  });

  // --- applyTheme ---
  describe('applyTheme', () => {
    test('sets data-theme attribute to dark', () => {
      App.settings = { theme: 'dark' };
      applyTheme();
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    });

    test('sets data-theme attribute to light', () => {
      App.settings = { theme: 'light' };
      applyTheme();
      expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    });

    test('resolves system theme using matchMedia', () => {
      // Default matchMedia mock returns matches: false (dark preference)
      App.settings = { theme: 'system' };
      applyTheme();
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    });

    test('resolves system theme to light when matchMedia matches', () => {
      window.matchMedia = jest.fn(() => ({
        matches: true,
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
        addListener: jest.fn(),
        removeListener: jest.fn(),
      }));
      App.settings = { theme: 'system' };
      applyTheme();
      expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    });

    test('defaults to dark when no theme set', () => {
      App.settings = {};
      applyTheme();
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    });

    test('sets high contrast attribute when enabled', () => {
      App.settings = { theme: 'dark', high_contrast: true };
      applyTheme();
      expect(document.documentElement.getAttribute('data-high-contrast')).toBe('true');
    });

    test('removes high contrast attribute when disabled', () => {
      document.documentElement.setAttribute('data-high-contrast', 'true');
      App.settings = { theme: 'dark', high_contrast: false };
      applyTheme();
      expect(document.documentElement.hasAttribute('data-high-contrast')).toBe(false);
    });

    test('updates logo src for light theme', () => {
      App.settings = { theme: 'light' };
      applyTheme();
      const logo = document.getElementById('logo');
      expect(logo.src).toContain('logo-light.png');
    });

    test('updates logo src for dark theme', () => {
      App.settings = { theme: 'dark' };
      applyTheme();
      const logo = document.getElementById('logo');
      expect(logo.src).toContain('/logo.png');
      expect(logo.src).not.toContain('logo-light');
    });
  });

  // --- changeSetting ---
  describe('changeSetting', () => {
    test('updates App.settings and calls pywebview.api.update_setting', () => {
      App.settings = { theme: 'dark' };
      changeSetting('theme', 'light');
      expect(App.settings.theme).toBe('light');
      expect(pywebview.api.update_setting).toHaveBeenCalledWith('theme', 'light');
    });

    test('applies theme after changing setting', () => {
      App.settings = { theme: 'dark' };
      changeSetting('theme', 'light');
      expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    });

    test('handles boolean settings like high_contrast', () => {
      App.settings = {};
      changeSetting('high_contrast', true);
      expect(App.settings.high_contrast).toBe(true);
      expect(pywebview.api.update_setting).toHaveBeenCalledWith('high_contrast', true);
      expect(document.documentElement.getAttribute('data-high-contrast')).toBe('true');
    });
  });

  // --- loadSettings ---
  describe('loadSettings', () => {
    test('calls pywebview.api.get_settings and applies result', async () => {
      pywebview.api.get_settings.mockResolvedValue('{"theme":"light","high_contrast":true}');
      loadSettings();
      await new Promise(r => setTimeout(r, 10));
      expect(App.settings.theme).toBe('light');
      expect(App.settings.high_contrast).toBe(true);
      expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    });

    test('handles null result gracefully', async () => {
      pywebview.api.get_settings.mockResolvedValue(null);
      loadSettings();
      await new Promise(r => setTimeout(r, 10));
      // Should not throw
    });
  });

  // --- System theme change listener ---
  describe('system theme change', () => {
    test('matchMedia addEventListener is called for prefers-color-scheme', () => {
      // The setup already loaded settings.js which registers the listener
      expect(window.matchMedia).toHaveBeenCalledWith('(prefers-color-scheme: light)');
    });
  });
});
