/**
 * settings.js
 *
 * local settings:  small key/value store that survives a force-restart.
 *                  Tauri   -> plugin-store (app data dir)
 *                  Browser -> localStorage
 * handle vault:    browser-only. FileSystemHandles are structured-cloneable
 *                  but not JSON-serialisable, so they live in IndexedDB.
 * synced settings: user-facing settings in stedule-settings.json
 */

// -- imports -------------------------------------------------

let _tauriFsModule    = null;
let _tauriStoreModule = null;

async function _getTauriFs() {
  if (!_tauriFsModule) _tauriFsModule = await import('@tauri-apps/plugin-fs');
  return _tauriFsModule;
}

async function _getTauriStore() {
  if (!_tauriStoreModule) _tauriStoreModule = await import('@tauri-apps/plugin-store');
  return _tauriStoreModule;
}

// -- local store ---------------------------------------------

let _store = null;

const _isTauri = !!window.__TAURI__?.core;

const LS_PREFIX = 'stedule:';

async function _getStore() {
  if (!_isTauri) return null;
  const { load } = await _getTauriStore();
  // 'local.json' is placed in the platform app data dir by Tauri.
  // Linux:   ~/.local/share/com.stedule.app/
  // Android: /data/data/com.stedule.app/files/
  if (!_store) _store = await load('local.json', { autoSave: true });
  return _store;
}

/**
 * Reads a device-local setting.
 * Works on every platform now — the browser build used to throw here, which
 * meant nothing could be remembered between reloads outside the Tauri app.
 */
export async function getLocalSetting(key) {
  if (_isTauri) return (await _getStore()).get(key) ?? null;

  try {
    const raw = localStorage.getItem(LS_PREFIX + key);
    return raw === null ? null : JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function saveLocalSetting(key, value) {
  if (_isTauri) {
    await (await _getStore()).set(key, value);
    return;
  }
  try {
    localStorage.setItem(LS_PREFIX + key, JSON.stringify(value));
  } catch (err) {
    console.warn('localStorage unavailable:', err);
  }
}

// -- handle vault (browser only) -----------------------------
//
// A FileSystemFileHandle / FileSystemDirectoryHandle survives a reload, a
// browser restart and a reboot *if* it is persisted in IndexedDB. The
// permission grant attached to it does not: on the next launch the handle
// still resolves, but queryPermission() reports 'prompt' and one user gesture
// is needed to call requestPermission(). That is a deliberate browser
// security boundary, not something the app can opt out of.
// See: https://developer.mozilla.org/en-US/docs/Web/API/File_System_API

const IDB_NAME  = 'stedule';
const IDB_STORE = 'handles';

function _openIDB() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) return reject(new Error('IndexedDB unavailable'));
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

function _idbTx(mode, fn) {
  return _openIDB().then(db => new Promise((resolve, reject) => {
    const tx  = db.transaction(IDB_STORE, mode);
    const req = fn(tx.objectStore(IDB_STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  }));
}

/** Persists a FileSystemHandle under `key`. No-op in Tauri. */
export async function saveHandle(key, handle) {
  if (_isTauri) return;
  try { await _idbTx('readwrite', s => s.put(handle, key)); }
  catch (err) { console.warn('Could not persist handle:', err); }
}

/** Returns a previously saved FileSystemHandle, or null. */
export async function loadHandle(key) {
  if (_isTauri) return null;
  try { return (await _idbTx('readonly', s => s.get(key))) ?? null; }
  catch { return null; }
}

export async function clearHandle(key) {
  if (_isTauri) return;
  try { await _idbTx('readwrite', s => s.delete(key)); } catch { /* ignore */ }
}

// -- synced settings -----------------------------------------

const DEFAULTS = {
  theme: 'light',               // 'light' | 'dark'
  defaultView: 'week',
  icsPath: null,
  dataFolder: null,             // folder holding the .ics, review.json, settings
  reviewPath: null,             // explicit review.json path (folder-less fallback)
  review: {
    promptOnLaunch: true,       // ask for yesterday's review on startup
  },
  notifications: {
    enabled: false,
    minutesBefore: 10,
  },
};

let _syncedSettings = { ...DEFAULTS };
let _localOverrides = {}; // TODO: implement logic later

/**
 * Loads synced settings from the given path.
 * Creates the file with defaults if it doesn't exist yet.
 *
 * @param {string} settingsPath — absolute path or content URI
 */
export async function loadSyncedSettings(settingsPath) {
  const { readTextFile } = await _getTauriFs();
  try {
    const raw = await readTextFile(settingsPath);
    _syncedSettings = { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    _syncedSettings = { ...DEFAULTS };
    try {
      await saveSyncedSettings(settingsPath);
    } catch (writeErr) {
      console.warn('Could not write default settings:', writeErr);
    }
  }

  // TODO: load overrides from local store here:
  // _localOverrides = (await getLocalSetting('overrides')) ?? {};
}

/**
 * Writes the current synced settings to disk.
 * @param {string} settingsPath
 */
export async function saveSyncedSettings(settingsPath) {
  const { writeTextFile } = await _getTauriFs();
  await writeTextFile(
    settingsPath,
    JSON.stringify(_syncedSettings, null, 2)
  );
}

/**
 * Reads a setting, with local overrides taking precedence.
 * This is the single merge point.
 * The future override feature only needs to populate _localOverrides,
 * not change this function.
 *
 * @param {string} key
 */
export function getSetting(key) {
  if (key in _localOverrides) return _localOverrides[key];
  return _syncedSettings[key] ?? DEFAULTS[key];
}

/**
 * Updates a synced setting in memory.
 * Caller must follow up with saveSyncedSettings() to persist.
 */
export function setSetting(key, value) {
  _syncedSettings[key] = value;
}

/**
 * For settings that must outlive a force-restart even when no synced settings
 * file has been chosen: writes to the synced object *and* the device-local
 * store. getPersistentSetting() prefers the synced value.
 */
export async function setPersistentSetting(key, value) {
  setSetting(key, value);
  await saveLocalSetting(key, value);
}

export async function getPersistentSetting(key) {
  return getSetting(key) ?? await getLocalSetting(key);
}