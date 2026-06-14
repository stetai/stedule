/**
 * settings.js 
 * 
 * local settings:  Uses Tauri plugin-store to store a path in app data dir
 * synced settings: User-facing settings in stedule-settings.json
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

async function _getStore() {
  if (!_isTauri) throw new Error('Local store is only available in Tauri.');
  const { load } = await _getTauriStore();
  // 'local.json' is placed in the platform app data dir by Tauri.
  // Linux:   ~/.local/share/com.stedule.app/
  // Android: /data/data/com.stedule.app/files/
  if (!_store) _store = await load('local.json', { autoSave: true });
  return _store;
}

export async function getLocalSetting(key) {
    return (await _getStore()).get(key) ?? null;
}

export async function saveLocalSetting(key, value) {
    await (await _getStore()).set(key, value);
}

// -- synced settings -----------------------------------------

const DEFAULTS = {
  theme: 'auto',               // 'light' | 'dark' | 'auto'
  defaultView: 'week',
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
    await saveSyncedSettings(settingsPath);
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
 * The future override feature only needs to populate _localOverrides, not change this function.
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