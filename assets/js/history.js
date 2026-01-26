/**
 * Tone Ladder History Module
 *
 * Manages recent list, starred list, and undo functionality.
 *
 * PERSISTED (via storage.js):
 *   - recent: array of HistoryEntry objects (max 10, newest first)
 *   - starred: array of starred HistoryEntry objects (no max)
 *
 * NOT PERSISTED (in-memory only):
 *   - undo buffer: stores last removed entry + original index
 *
 * RECENT LIST RULES:
 *   - Max 10 entries
 *   - Newest entries appear first
 *   - De-duplication by: label + baseHex + temperature + steps + mode
 *   - "X" remove button stores entry in undo buffer before removal
 *
 * STARRED LIST RULES:
 *   - No maximum
 *   - Starring COPIES an entry to starred (recent unchanged)
 *   - Unstarring removes from starred only
 *   - No "X" remove button (star/unstar only)
 *
 * UNDO RULES:
 *   - Single-level buffer (only one undo possible)
 *   - Applies only to "X" removals from Recent list
 *   - Restores entry to its previous index
 *   - Buffer cleared on: new generation, undo action, clear all, page reload
 */

import * as storage from './storage.js';

const MAX_RECENT = 10;

// In-memory state
let recent = [];
let starred = [];
let undoBuffer = null; // { entry: HistoryEntry, index: number } | null

/**
 * Initialize history from storage
 * Call this on app startup
 */
export function init() {
  const data = storage.load();
  recent = data.recent;
  starred = data.starred;
  undoBuffer = null; // Always starts null (in-memory only)
}

/**
 * Get current recent list
 * @returns {Object[]} Recent entries (newest first)
 */
export function getRecent() {
  return recent;
}

/**
 * Get current starred list
 * @returns {Object[]} Starred entries
 */
export function getStarred() {
  return starred;
}

/**
 * Check if undo is available
 * @returns {boolean}
 */
export function canUndo() {
  return undoBuffer !== null;
}

/**
 * Get undo buffer info (for display purposes)
 * @returns {{ entry: Object, index: number } | null}
 */
export function getUndoInfo() {
  return undoBuffer;
}

/**
 * Generate a unique ID for a history entry
 * @returns {string}
 */
function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 9);
}

/**
 * Generate CSS-safe token from label
 * Rules: lowercase, spaces to hyphens, remove non-alphanumeric, collapse repeated hyphens
 * @param {string} label
 * @returns {string}
 */
function labelToToken(label) {
  return label
    .toLowerCase()
    .replace(/\s+/g, '-')           // spaces to hyphens
    .replace(/[^a-z0-9-]/g, '')     // remove non-alphanumeric except hyphens
    .replace(/-+/g, '-')            // collapse repeated hyphens
    .replace(/^-|-$/g, '');         // trim leading/trailing hyphens
}

/**
 * Generate a deterministic token prefix for CSS export
 * If customLabel provided: use CSS-safe version of label
 * If empty: generate from factual settings (tl-{hex}-{temp}-{mode}-{steps})
 *
 * @param {string} customLabel - User-provided label (may be empty)
 * @param {string} baseHex - Base hex color
 * @param {number} temperature - Temperature value
 * @param {string} mode - 'conservative' or 'painterly'
 * @param {number} steps - Step count
 * @returns {string}
 */
export function generateTokenPrefix(customLabel, baseHex, temperature, mode, steps) {
  // If label provided, use CSS-safe version
  if (customLabel && customLabel.trim()) {
    return labelToToken(customLabel.trim());
  }

  // Generate deterministic fallback from settings
  // Format: tl-{hex}-{temp}-{mode}-{steps}
  const hex = baseHex.replace('#', '').toLowerCase();
  const tempSign = temperature >= 0 ? 'w' : 'c'; // w=warm, c=cool
  const tempVal = Math.abs(temperature).toFixed(2).replace('.', '');
  const modeShort = mode === 'conservative' ? 'cons' : 'paint';

  return `tl-${hex}-${tempSign}${tempVal}-${modeShort}-${steps}`;
}

/**
 * Generate a factual label from entry settings
 * Format: #HEX · ±temp · Mode · steps
 * @param {Object} entry
 * @returns {string}
 */
export function generateFactualLabel(entry) {
  const tempStr = entry.temperature >= 0 ? `+${entry.temperature.toFixed(2)}` : entry.temperature.toFixed(2);
  const modeStr = entry.mode.charAt(0).toUpperCase() + entry.mode.slice(1);
  return `${entry.baseHex} · ${tempStr} · ${modeStr} · ${entry.steps}`;
}

/**
 * Get display label for an entry
 * Returns custom label if provided, otherwise factual label
 * @param {Object} entry
 * @returns {string}
 */
export function getDisplayLabel(entry) {
  if (entry.customLabel && entry.customLabel.trim()) {
    return entry.customLabel;
  }
  // Legacy support: check old 'label' field
  if (entry.label && entry.label.trim()) {
    return entry.label;
  }
  return generateFactualLabel(entry);
}

/**
 * Create a new history entry
 *
 * @param {string} customLabel - User-provided label (can be empty string)
 * @param {string} baseHex - Base hex color
 * @param {number} temperature - Temperature value
 * @param {number} steps - Number of steps (9 or 11)
 * @param {string} mode - 'conservative' or 'painterly'
 * @param {string[]} rampHexes - Generated ladder hex values (stored, not regenerated)
 * @returns {Object} HistoryEntry
 */
export function createEntry(customLabel, baseHex, temperature, steps, mode, rampHexes) {
  const entry = {
    id: generateId(),
    customLabel: customLabel || null,
    baseHex: baseHex,
    temperature: temperature,
    steps: steps,
    mode: mode,
    rampHexes: rampHexes,
    createdAt: Date.now()
  };
  // Add tokenPrefix for CSS export
  entry.tokenPrefix = generateTokenPrefix(customLabel, baseHex, temperature, mode, steps);
  return entry;
}

/**
 * Generate a stable key from entry settings (baseHex + temperature + steps + mode)
 * Used for starred equivalence checks
 * @param {Object} entry
 * @returns {string}
 */
function entryKey(entry) {
  return `${entry.baseHex}|${entry.temperature}|${entry.steps}|${entry.mode}`;
}

/**
 * Check if two entries have equivalent settings (for starred comparison)
 * @param {Object} a
 * @param {Object} b
 * @returns {boolean}
 */
function hasEquivalentSettings(a, b) {
  return entryKey(a) === entryKey(b);
}

/**
 * Check if two entries are exact duplicates (same settings AND same output)
 * Used for immediate duplicate prevention
 * @param {Object} a
 * @param {Object} b
 * @returns {boolean}
 */
function isExactDuplicate(a, b) {
  if (!a || !b) return false;

  // Compare settings
  if (a.baseHex !== b.baseHex) return false;
  if (a.temperature !== b.temperature) return false;
  if (a.steps !== b.steps) return false;
  if (a.mode !== b.mode) return false;

  // Compare output (exact array match)
  if (!a.rampHexes || !b.rampHexes) return false;
  if (a.rampHexes.length !== b.rampHexes.length) return false;
  for (let i = 0; i < a.rampHexes.length; i++) {
    if (a.rampHexes[i] !== b.rampHexes[i]) return false;
  }

  return true;
}

/**
 * Persist current state to storage
 */
function persist() {
  storage.save({ recent, starred });
}

/**
 * Add entry to recent list (a snapshot commit)
 *
 * - Checks if exact duplicate of most recent entry (no-op if so)
 * - Clears undo buffer
 * - Adds new entry at the front (newest first)
 * - Enforces max 10 entries
 * - Persists to storage
 *
 * @param {Object} entry - HistoryEntry to add
 * @returns {boolean} True if entry was added, false if duplicate (no-op)
 */
export function addToRecent(entry) {
  // Check for exact duplicate of most recent entry only
  const mostRecent = recent[0];
  if (isExactDuplicate(entry, mostRecent)) {
    // No-op: don't add duplicate, don't show error
    return false;
  }

  // Clear undo buffer on new snapshot
  undoBuffer = null;

  // Add to front
  recent.unshift(entry);

  // Enforce max
  if (recent.length > MAX_RECENT) {
    recent = recent.slice(0, MAX_RECENT);
  }

  persist();
  return true;
}

/**
 * Remove entry from recent list by ID
 *
 * - Stores removed entry in undo buffer with original index
 * - Removes from recent
 * - Persists to storage
 *
 * @param {string} id - Entry ID to remove
 * @returns {boolean} True if entry was found and removed
 */
export function removeFromRecent(id) {
  const index = recent.findIndex(entry => entry.id === id);

  if (index === -1) {
    return false;
  }

  const entry = recent[index];

  // Store in undo buffer before removal
  undoBuffer = { entry, index };

  // Remove from recent
  recent.splice(index, 1);

  persist();
  return true;
}

/**
 * Undo last removal from recent
 *
 * - Restores entry to original index
 * - Clears undo buffer
 * - Persists to storage
 *
 * @returns {boolean} True if undo was performed
 */
export function undo() {
  if (!undoBuffer) {
    return false;
  }

  const { entry, index } = undoBuffer;

  // Restore to original index (or end if list is shorter now)
  const insertIndex = Math.min(index, recent.length);
  recent.splice(insertIndex, 0, entry);

  // Clear undo buffer
  undoBuffer = null;

  persist();
  return true;
}

/**
 * Clear the undo buffer
 * Call this when a new generation is committed (handled by addToRecent)
 * or when needed externally
 */
export function clearUndoBuffer() {
  undoBuffer = null;
}

/**
 * Check if an entry (or entry with given ID) is starred
 * Uses settings equivalence (baseHex+temperature+steps+mode), not ID
 * @param {string|Object} idOrEntry - Entry ID or entry object
 * @returns {boolean}
 */
export function isStarred(idOrEntry) {
  const entry = typeof idOrEntry === 'string' ? findEntry(idOrEntry) : idOrEntry;
  if (!entry) return false;
  return starred.some(s => hasEquivalentSettings(s, entry));
}

/**
 * Star an entry (copy from recent to starred)
 *
 * - COPIES entry to starred list (recent unchanged)
 * - Does nothing if entry not found in recent
 * - Does nothing if equivalent entry already starred (by key, not ID)
 * - Persists to storage
 *
 * @param {string} id - Entry ID to star
 * @returns {boolean} True if entry was starred
 */
export function star(id) {
  // Find in recent
  const entry = recent.find(e => e.id === id);

  if (!entry) {
    return false;
  }

  // Check if equivalent entry already starred (by key, not ID)
  if (isStarred(entry)) {
    return false;
  }

  // Copy to starred
  starred.push({ ...entry });

  persist();
  return true;
}

/**
 * Unstar an entry (remove from starred)
 *
 * - Removes entry from starred list only
 * - Recent list remains unchanged
 * - Persists to storage
 *
 * @param {string} id - Entry ID to unstar
 * @returns {boolean} True if entry was unstarred
 */
export function unstar(id) {
  const index = starred.findIndex(entry => entry.id === id);

  if (index === -1) {
    return false;
  }

  starred.splice(index, 1);

  persist();
  return true;
}

/**
 * Find an entry by ID in either recent or starred
 * @param {string} id - Entry ID
 * @returns {Object | null} Entry or null if not found
 */
export function findEntry(id) {
  return recent.find(e => e.id === id) || starred.find(e => e.id === id) || null;
}

/**
 * Clear all history (recent, starred, and undo buffer)
 *
 * Note: Caller should prompt for confirmation before calling this.
 * Persists empty state to storage.
 */
export function clearAll() {
  recent = [];
  starred = [];
  undoBuffer = null;

  persist();
}
