/**
 * Stem Splitter — Settings panel and theme management.
 * Depends on App namespace from app.js.
 */

App.settings = {};
App.settingsOpen = false;

/** Toggle the settings slide-in panel open/closed. */
function toggleSettings() {
  App.settingsOpen = !App.settingsOpen;
  renderSettingsPanel();
}

/** Close the settings panel. */
function closeSettings() {
  App.settingsOpen = false;
  renderSettingsPanel();
}

/** Render the settings panel content (theme selector, high contrast toggle). */
function renderSettingsPanel() {
  let panel = document.getElementById('settingsPanel');
  if (!App.settingsOpen) {
    if (panel) panel.classList.remove('open');
    return;
  }
  if (!panel) return;
  panel.classList.add('open');

  const s = App.settings;
  const themeVal = s.theme || 'dark';
  const hcChecked = s.high_contrast ? 'checked' : '';

  panel.innerHTML = `
    <div class="settings-header">
      <h2>Settings</h2>
      <button class="settings-close" onclick="closeSettings()" aria-label="Close settings">&times;</button>
    </div>
    <div class="settings-body">
      <div class="settings-group">
        <div class="settings-label">Theme</div>
        <div class="settings-option">
          <select id="themeSelect" onchange="changeSetting('theme', this.value)" aria-label="Theme">
            <option value="dark" ${themeVal === 'dark' ? 'selected' : ''}>Dark</option>
            <option value="light" ${themeVal === 'light' ? 'selected' : ''}>Light</option>
            <option value="system" ${themeVal === 'system' ? 'selected' : ''}>System</option>
          </select>
        </div>
      </div>
      <div class="settings-group">
        <div class="settings-label">High Contrast</div>
        <div class="settings-option">
          <label class="toggle-switch">
            <input type="checkbox" id="hcToggle" ${hcChecked} onchange="changeSetting('high_contrast', this.checked)" aria-label="High contrast mode">
            <span class="toggle-slider"></span>
          </label>
        </div>
      </div>
    </div>
  `;
}

/**
 * Update a setting, apply theme changes, and persist to backend.
 * @param {string} key - Setting key
 * @param {*} value - New value
 */
function changeSetting(key, value) {
  App.settings[key] = value;
  applyTheme();
  pywebview.api.update_setting(key, value);
}

/** Apply the current theme and high-contrast settings to the document. */
function applyTheme() {
  const s = App.settings;
  let theme = s.theme || 'dark';

  if (theme === 'system') {
    theme = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }

  document.documentElement.setAttribute('data-theme', theme);

  const logo = document.getElementById('logo');
  if (logo) {
    const port = App.AUDIO_PORT;
    logo.src = 'http://127.0.0.1:' + port + (theme === 'light' ? '/logo-light.png' : '/logo.png');
  }

  if (s.high_contrast) {
    document.documentElement.setAttribute('data-high-contrast', 'true');
  } else {
    document.documentElement.removeAttribute('data-high-contrast');
  }
}

/** Fetch settings from the backend and apply them. */
function loadSettings() {
  pywebview.api.get_settings().then(result => {
    if (!result) return;
    App.settings = JSON.parse(result);
    applyTheme();
  });
}

// Apply theme immediately from injected settings (no flash of wrong theme)
if (typeof INITIAL_SETTINGS !== 'undefined' && INITIAL_SETTINGS) {
  App.settings = INITIAL_SETTINGS;
  applyTheme();
}

// Close settings when clicking outside the panel
document.addEventListener('click', (e) => {
  if (!App.settingsOpen) return;
  const panel = document.getElementById('settingsPanel');
  if (panel && !panel.contains(e.target) && !e.target.closest('.btn-settings')) {
    closeSettings();
  }
});

// Listen for system theme changes when in "system" mode
window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
  if (App.settings.theme === 'system') applyTheme();
});
