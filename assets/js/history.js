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
 * Generate slug from label
 * Rules: lowercase, spaces to hyphens, remove non-alphanumeric, collapse repeated hyphens
 * @param {string} label
 * @returns {string}
 */
function labelToSlug(label) {
  return label
    .toLowerCase()
    .replace(/\s+/g, '-')           // spaces to hyphens
    .replace(/[^a-z0-9-]/g, '')     // remove non-alphanumeric except hyphens
    .replace(/-+/g, '-')            // collapse repeated hyphens
    .replace(/^-|-$/g, '');         // trim leading/trailing hyphens
}

/**
 * Create a new history entry
 *
 * @param {string} label - Display label (stored exactly as entered)
 * @param {string} baseHex - Base hex color
 * @param {number} temperature - Temperature value
 * @param {number} steps - Number of steps (9 or 11)
 * @param {string} mode - 'conservative' or 'painterly'
 * @param {string[]} rampHexes - Generated ramp hex values (stored, not regenerated)
 * @returns {Object} HistoryEntry
 */
export function createEntry(label, baseHex, temperature, steps, mode, rampHexes) {
  return {
    id: generateId(),
    label: label,
    slugLabel: labelToSlug(label),
    baseHex: baseHex,
    temperature: temperature,
    steps: steps,
    mode: mode,
    rampHexes: rampHexes,
    createdAt: Date.now()
  };
}

/**
 * Generate a stable key from entry settings (label + baseHex + temperature + steps + mode)
 * Used for de-duplication and starred equivalence checks
 * @param {Object} entry
 * @returns {string}
 */
function entryKey(entry) {
  return `${entry.label}|${entry.baseHex}|${entry.temperature}|${entry.steps}|${entry.mode}`;
}

/**
 * Check if two entries are duplicates (same label + baseHex + temperature + steps + mode)
 * @param {Object} a
 * @param {Object} b
 * @returns {boolean}
 */
function isDuplicate(a, b) {
  return entryKey(a) === entryKey(b);
}

/**
 * Persist current state to storage
 */
function persist() {
  storage.save({ recent, starred });
}

/**
 * Add entry to recent list (a "generation" commit)
 *
 * - Clears undo buffer (new generation clears undo)
 * - Removes any duplicate entry (same label+baseHex+temperature+steps+mode)
 * - Adds new entry at the front (newest first)
 * - Enforces max 10 entries
 * - Persists to storage
 *
 * @param {Object} entry - HistoryEntry to add
 */
export function addToRecent(entry) {
  // Clear undo buffer on new generation
  undoBuffer = null;

  // Remove duplicates
  recent = recent.filter(existing => !isDuplicate(existing, entry));

  // Add to front
  recent.unshift(entry);

  // Enforce max
  if (recent.length > MAX_RECENT) {
    recent = recent.slice(0, MAX_RECENT);
  }

  persist();
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
 * Uses key equivalence (label+baseHex+temperature+steps+mode), not ID
 * @param {string|Object} idOrEntry - Entry ID or entry object
 * @returns {boolean}
 */
export function isStarred(idOrEntry) {
  const entry = typeof idOrEntry === 'string' ? findEntry(idOrEntry) : idOrEntry;
  if (!entry) return false;
  return starred.some(s => isDuplicate(s, entry));
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
