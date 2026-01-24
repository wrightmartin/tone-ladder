/**
 * Tone Ladder - Application
 *
 * Orchestrates UI, state, and event wiring.
 * Uses history.js and storage.js as source of truth for persisted lists.
 */

import { generateRamp } from './colorModels/index.js';
import { hexToOklch } from './colorModels/convert.js';
import * as history from './history.js';

// ==========================================================================
// State
// ==========================================================================

const state = {
  input: {
    baseHex: '#2F6FED',
    label: 'Ocean Blue',
    temperature: 0.25,
    steps: 9,
    mode: 'painterly'
  },
  preview: {
    rampHexes: null,
    slugLabel: null
  }
};

// ==========================================================================
// DOM References
// ==========================================================================

const dom = {
  // Inputs
  inputHex: document.getElementById('input-hex'),
  inputColorPicker: document.getElementById('input-color-picker'),
  inputLabel: document.getElementById('input-label'),
  inputTemperature: document.getElementById('input-temperature'),
  temperatureDisplay: document.getElementById('temperature-display'),
  btnSteps: document.querySelectorAll('[data-steps]'),
  btnModes: document.querySelectorAll('[data-mode]'),
  btnGenerate: document.getElementById('btn-generate'),

  // Preview
  previewRamp: document.getElementById('preview-ramp'),

  // History
  recentList: document.getElementById('recent-list'),
  recentEmpty: document.getElementById('recent-empty'),
  starredList: document.getElementById('starred-list'),
  starredEmpty: document.getElementById('starred-empty'),
  btnUndo: document.getElementById('btn-undo'),
  btnClearAll: document.getElementById('btn-clear-all'),

  // Export
  exportPanel: document.getElementById('export-panel'),
  exportFormatSelect: document.getElementById('export-format-select'),
  exportCode: document.getElementById('export-code'),
  btnCopy: document.getElementById('btn-copy'),
  copyFeedback: document.getElementById('copy-feedback')
};

// ==========================================================================
// Utilities
// ==========================================================================

/**
 * Generate slug from label
 * Rules: lowercase, spaces to hyphens, remove non-alphanumeric, collapse repeated hyphens
 */
function labelToSlug(label) {
  return label
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Normalise hex input (ensure # prefix, uppercase)
 */
function normaliseHex(hex) {
  let cleaned = String(hex).trim();
  if (!cleaned.startsWith('#')) {
    cleaned = '#' + cleaned;
  }
  return cleaned.toUpperCase();
}

/**
 * Validate hex format
 */
function isValidHex(hex) {
  return /^#[0-9A-Fa-f]{6}$/.test(hex);
}

/**
 * Format temperature for display
 */
function formatTemperature(value) {
  const num = parseFloat(value);
  if (num > 0) return '+' + num.toFixed(2);
  if (num < 0) return num.toFixed(2);
  return '0.00';
}

/**
 * Sort hex array by OKLCH lightness (darkest to lightest)
 * Ensures monotonic perceived lightness after conversion artifacts
 */
function sortByLightness(hexArray) {
  return [...hexArray].sort((a, b) => {
    const aL = hexToOklch(a).L;
    const bL = hexToOklch(b).L;
    return aL - bL;
  });
}

// ==========================================================================
// Rendering
// ==========================================================================

/**
 * Render preview ramp swatches
 */
function renderPreview() {
  const { rampHexes } = state.preview;

  if (!rampHexes || rampHexes.length === 0) {
    dom.previewRamp.innerHTML = '<p class="history-empty">Adjust settings and generate a ramp</p>';
    dom.exportPanel.hidden = true;
    return;
  }

  dom.previewRamp.innerHTML = rampHexes.map((hex, i) => `
    <div class="swatch" style="background-color: ${hex}">
      <span class="swatch__hex">${hex}</span>
    </div>
  `).join('');

  dom.exportPanel.hidden = false;
  renderExport();
}

/**
 * Render export code
 */
function renderExport() {
  const { rampHexes, slugLabel } = state.preview;
  if (!rampHexes || !slugLabel) return;

  const format = dom.exportFormatSelect.value;
  const prefix = format === 'long' ? '--color-' : '--';

  const lines = rampHexes.map((hex, i) => `${prefix}${slugLabel}-${i}: ${hex};`);
  dom.exportCode.textContent = lines.join('\n');
}

/**
 * Render a mini swatch strip for history entries
 */
function renderSwatchStrip(rampHexes) {
  return `
    <div class="swatch-strip">
      ${rampHexes.map(hex => `<div class="swatch-mini" style="background-color: ${hex}"></div>`).join('')}
    </div>
  `;
}

/**
 * Render recent list
 */
function renderRecent() {
  const recent = history.getRecent();

  if (recent.length === 0) {
    dom.recentList.innerHTML = '';
    dom.recentEmpty.hidden = false;
    return;
  }

  dom.recentEmpty.hidden = true;
  dom.recentList.innerHTML = recent.map(entry => {
    const isStarred = history.isStarred(entry);
    return `
      <li class="history-entry" data-id="${entry.id}">
        <div class="history-entry__header">
          <div class="history-entry__info">
            <div class="history-entry__label">${escapeHtml(entry.label)}</div>
            <div class="history-entry__hex">${entry.baseHex}</div>
          </div>
          <div class="history-entry__actions">
            <button type="button" class="btn-icon btn-icon--star ${isStarred ? 'is-starred' : ''}"
                    data-action="star" data-id="${entry.id}"
                    title="${isStarred ? 'Unstar' : 'Star'}">
              ${isStarred ? '\u2605' : '\u2606'}
            </button>
            <button type="button" class="btn-icon btn-icon--remove"
                    data-action="remove" data-id="${entry.id}"
                    title="Remove">
              \u00D7
            </button>
          </div>
        </div>
        ${renderSwatchStrip(entry.rampHexes)}
      </li>
    `;
  }).join('');
}

/**
 * Render starred list
 */
function renderStarred() {
  const starred = history.getStarred();

  if (starred.length === 0) {
    dom.starredList.innerHTML = '';
    dom.starredEmpty.hidden = false;
    return;
  }

  dom.starredEmpty.hidden = true;
  dom.starredList.innerHTML = starred.map(entry => `
    <li class="history-entry" data-id="${entry.id}" data-source="starred">
      <div class="history-entry__header">
        <div class="history-entry__info">
          <div class="history-entry__label">${escapeHtml(entry.label)}</div>
          <div class="history-entry__hex">${entry.baseHex}</div>
        </div>
        <div class="history-entry__actions">
          <button type="button" class="btn-icon btn-icon--star is-starred"
                  data-action="unstar" data-id="${entry.id}"
                  title="Unstar">
            \u2605
          </button>
        </div>
      </div>
      ${renderSwatchStrip(entry.rampHexes)}
    </li>
  `).join('');
}

/**
 * Render undo button visibility
 */
function renderUndo() {
  dom.btnUndo.hidden = !history.canUndo();
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Render all history-related UI
 */
function renderHistory() {
  renderRecent();
  renderStarred();
  renderUndo();
}

// ==========================================================================
// State Updates
// ==========================================================================

/**
 * Update preview from current input state
 */
function updatePreview() {
  const { baseHex, label, temperature, steps, mode } = state.input;

  // Validate hex
  if (!isValidHex(baseHex)) {
    dom.inputHex.classList.add('is-invalid');
    return;
  }
  dom.inputHex.classList.remove('is-invalid');

  // Generate ramp for preview
  // Temperature mapping is handled internally by the color model
  // Ramp is generated in correct order (darkest → lightest) by construction
  try {
    const rawRamp = generateRamp(baseHex, temperature, steps, mode);
    state.preview.rampHexes = rawRamp;
    state.preview.slugLabel = labelToSlug(label || 'untitled');
    renderPreview();
  } catch (e) {
    console.error('Failed to generate ramp:', e);
  }
}

/**
 * Load an entry into the input/preview state (does not generate)
 */
function loadEntry(entry) {
  // Update state
  state.input.baseHex = entry.baseHex;
  state.input.label = entry.label;
  state.input.temperature = entry.temperature;
  state.input.steps = entry.steps;
  state.input.mode = entry.mode;

  // Load the stored ramp directly (do not regenerate)
  state.preview.rampHexes = entry.rampHexes;
  state.preview.slugLabel = entry.slugLabel;

  // Update UI inputs
  dom.inputHex.value = entry.baseHex;
  dom.inputColorPicker.value = entry.baseHex;
  dom.inputLabel.value = entry.label;
  dom.inputTemperature.value = entry.temperature;
  dom.temperatureDisplay.textContent = formatTemperature(entry.temperature);

  // Update toggle buttons
  dom.btnSteps.forEach(btn => {
    btn.setAttribute('aria-pressed', btn.dataset.steps === String(entry.steps));
  });
  dom.btnModes.forEach(btn => {
    btn.setAttribute('aria-pressed', btn.dataset.mode === entry.mode);
  });

  renderPreview();
}

// ==========================================================================
// Event Handlers
// ==========================================================================

/**
 * Handle hex input change
 */
function handleHexInput(e) {
  let value = e.target.value.trim();
  if (value && !value.startsWith('#')) {
    value = '#' + value;
  }
  state.input.baseHex = value.toUpperCase();

  // Sync colour picker if valid
  if (isValidHex(state.input.baseHex)) {
    dom.inputColorPicker.value = state.input.baseHex;
  }

  updatePreview();
}

/**
 * Handle colour picker change
 */
function handleColorPicker(e) {
  state.input.baseHex = e.target.value.toUpperCase();
  dom.inputHex.value = state.input.baseHex;
  updatePreview();
}

/**
 * Handle label input change
 */
function handleLabelInput(e) {
  state.input.label = e.target.value;
  state.preview.slugLabel = labelToSlug(e.target.value || 'untitled');
  renderExport();
}

/**
 * Handle temperature slider change
 */
function handleTemperatureChange(e) {
  state.input.temperature = parseFloat(e.target.value);
  dom.temperatureDisplay.textContent = formatTemperature(state.input.temperature);
  updatePreview();
}

/**
 * Handle steps toggle
 */
function handleStepsToggle(e) {
  const btn = e.target.closest('[data-steps]');
  if (!btn) return;

  const steps = parseInt(btn.dataset.steps, 10);
  state.input.steps = steps;

  dom.btnSteps.forEach(b => {
    b.setAttribute('aria-pressed', b.dataset.steps === String(steps));
  });

  updatePreview();
}

/**
 * Handle mode toggle
 */
function handleModeToggle(e) {
  const btn = e.target.closest('[data-mode]');
  if (!btn) return;

  const mode = btn.dataset.mode;
  state.input.mode = mode;

  dom.btnModes.forEach(b => {
    b.setAttribute('aria-pressed', b.dataset.mode === mode);
  });

  updatePreview();
}

/**
 * Handle Generate button - commits to Recent (a "generation")
 */
function handleGenerate() {
  const { baseHex, label, temperature, steps, mode } = state.input;

  // Validate
  if (!isValidHex(baseHex)) {
    dom.inputHex.focus();
    return;
  }

  if (!label.trim()) {
    dom.inputLabel.focus();
    return;
  }

  // Generate fresh ramp
  // Temperature mapping is handled internally by the color model
  // Ramp is generated in correct order (darkest → lightest) by construction
  const rawRamp = generateRamp(baseHex, temperature, steps, mode);
  const rampHexes = rawRamp;

  // Create entry and add to history
  const entry = history.createEntry(label.trim(), baseHex, temperature, steps, mode, rampHexes);
  history.addToRecent(entry);

  // Update preview with the committed ramp
  state.preview.rampHexes = rampHexes;
  state.preview.slugLabel = entry.slugLabel;

  renderPreview();
  renderHistory();
}

/**
 * Handle clicking on a history entry (load into preview)
 */
function handleHistoryClick(e) {
  // Don't load if clicking an action button
  if (e.target.closest('[data-action]')) return;

  const entryEl = e.target.closest('.history-entry');
  if (!entryEl) return;

  const id = entryEl.dataset.id;
  const entry = history.findEntry(id);

  if (entry) {
    loadEntry(entry);
  }
}

/**
 * Handle history action buttons (star, unstar, remove)
 */
function handleHistoryAction(e) {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;

  e.stopPropagation();

  const action = btn.dataset.action;
  const id = btn.dataset.id;

  switch (action) {
    case 'star':
      if (history.isStarred(history.findEntry(id))) {
        history.unstar(id);
      } else {
        history.star(id);
      }
      break;
    case 'unstar':
      history.unstar(id);
      break;
    case 'remove':
      history.removeFromRecent(id);
      break;
  }

  renderHistory();
}

/**
 * Handle undo button
 */
function handleUndo() {
  history.undo();
  renderHistory();
}

/**
 * Handle clear all button
 */
function handleClearAll() {
  if (confirm('Are you sure? This will clear all recent and starred ramps.')) {
    history.clearAll();
    renderHistory();
  }
}

/**
 * Handle export format change
 */
function handleExportFormatChange() {
  renderExport();
}

/**
 * Handle copy to clipboard
 */
async function handleCopy() {
  const code = dom.exportCode.textContent;

  try {
    await navigator.clipboard.writeText(code);
    dom.copyFeedback.hidden = false;
    setTimeout(() => {
      dom.copyFeedback.hidden = true;
    }, 2000);
  } catch (e) {
    console.error('Failed to copy:', e);
    // Fallback for older browsers
    const textarea = document.createElement('textarea');
    textarea.value = code;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
    dom.copyFeedback.hidden = false;
    setTimeout(() => {
      dom.copyFeedback.hidden = true;
    }, 2000);
  }
}

// ==========================================================================
// Initialisation
// ==========================================================================

function init() {
  // Load history from storage
  history.init();

  // Set initial input values
  dom.inputHex.value = state.input.baseHex;
  dom.inputColorPicker.value = state.input.baseHex;
  dom.inputLabel.value = state.input.label;
  dom.inputTemperature.value = state.input.temperature;
  dom.temperatureDisplay.textContent = formatTemperature(state.input.temperature);

  // Generate initial preview
  updatePreview();

  // Render history
  renderHistory();

  // Bind events - Inputs
  dom.inputHex.addEventListener('input', handleHexInput);
  dom.inputColorPicker.addEventListener('input', handleColorPicker);
  dom.inputLabel.addEventListener('input', handleLabelInput);
  dom.inputTemperature.addEventListener('input', handleTemperatureChange);

  dom.btnSteps.forEach(btn => {
    btn.addEventListener('click', handleStepsToggle);
  });

  dom.btnModes.forEach(btn => {
    btn.addEventListener('click', handleModeToggle);
  });

  dom.btnGenerate.addEventListener('click', handleGenerate);

  // Bind events - History
  dom.recentList.addEventListener('click', handleHistoryClick);
  dom.recentList.addEventListener('click', handleHistoryAction);
  dom.starredList.addEventListener('click', handleHistoryClick);
  dom.starredList.addEventListener('click', handleHistoryAction);
  dom.btnUndo.addEventListener('click', handleUndo);
  dom.btnClearAll.addEventListener('click', handleClearAll);

  // Bind events - Export
  dom.exportFormatSelect.addEventListener('change', handleExportFormatChange);
  dom.btnCopy.addEventListener('click', handleCopy);
}

// Start app
init();
