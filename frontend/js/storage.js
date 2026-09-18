/**
 * storage.js — File I/O abstraction layer
 *
 * Two access modes live side by side:
 *
 *   FILE mode   (legacy) — the user picks a single .ics. Fine for the
 *                calendar, but a picked file gives no way to reach its
 *                siblings, so review.json has to be picked separately.
 *
 *   FOLDER mode (preferred) — the user picks the Syncthing folder once.
 *                Everything inside it (calendar.ics, review.json,
 *                stedule-settings.json) is then readable and writable with a
 *                single, persistable grant. This is the only arrangement in
 *                which Android can still write review.json after a reboot:
 *                a SAF *document* grant cannot address sibling files, a
 *                *tree* grant can.
 *
 * Platform notes
 *   Tauri desktop — plain paths; a stored path works forever.
 *   Tauri Android — SAF content:// URIs. The Rust side must open the tree with
 *                   ACTION_OPEN_DOCUMENT_TREE and call
 *                   takePersistableUriPermission(READ|WRITE) or the grant dies
 *                   with the process.
 *                   https://developer.android.com/training/data-storage/shared/documents-files
 *   Chromium      — File System Access API. Handles persist in IndexedDB
 *                   (see settings.js); the permission needs one click to
 *                   re-grant per session.
 *   Firefox       — no File System Access API. Reads work via <input type=file>,
 *                   writes fall back to a download.
 */

import { clearHandle, loadHandle, saveHandle } from './settings.js';

// -- imports -------------------------------------------------

async function _getTauriFs() {
  return import('@tauri-apps/plugin-fs');
}

async function _getTauriDialog() {
  return import('@tauri-apps/plugin-dialog');
}

// -- detect platform -----------------------------------------

// Detect Tauri
const _isTauri = !!window.__TAURI__?.core;

// Detect capability (Distinguish between Chromium, Firefox)
const _isFirefox = CSS.supports('-moz-appearance', 'none');
const hasFileSystemAccess = !_isTauri && !_isFirefox && 'showOpenFilePicker' in window;

let _fileHandle = null; // Chromium: FileSystemFileHandle · Tauri: path/URI
let _fileName   = null; // Both: display name

// Folder mode state
let _folderHandle = null; // Chromium: FileSystemDirectoryHandle
let _folderPath   = null; // Tauri: directory path or SAF tree URI
let _folderName   = null; // display name

// Review file state (only used when there is no folder)
let _reviewHandle = null; // Chromium: FileSystemFileHandle
let _reviewPath   = null; // Tauri: path/URI

export const REVIEW_FILENAME = 'review.json';

const HANDLE_KEY_ICS    = 'icsFileHandle';
const HANDLE_KEY_FOLDER = 'dataFolderHandle';
const HANDLE_KEY_REVIEW = 'reviewFileHandle';

// -- Exported API --------------------------------------------

/** Returns the current file path (Tauri only). */
export function getFilePath() { return _fileHandle; }

/**
 * Opens a file picker and reads the selected .ics file.
 * On Chromium: stores the file handle for in-place writes later.
 * On Firefox:  reads the file once; writes will download a new file.
 *
 * @returns {Promise<string>} Raw text content of the file.
 * @throws  {DOMException}   name === 'AbortError' if the user cancels.
 */
export async function openFile() {

  if (_isTauri) {

    const { invoke } = window.__TAURI__.core;

    const path = await invoke("open_calendar");

    if (!path) {
      throw new DOMException('User cancelled', 'AbortError');
    }

    const { readTextFile }  = await _getTauriFs();

    _fileName = _basename(path);
    _fileHandle = path;

    return await readTextFile(path);
  }

  if (hasFileSystemAccess) {
    return _openChromium();
  } else if (_isFirefox){
    return _openFirefox();
  } else {
    throw new Error("Unsupported platform.")
  }
}
/**
 * Opens settings file
 */
export async function openSettingsFile() {
  const { open: tauriOpen, save: tauriSave } = await _getTauriDialog();

  const isAndroid = navigator.userAgent.includes('Android');

  if (isAndroid) {
    return await tauriSave({
      filters: [{name: 'JSON', extensions:['json']}],
      defaultPath: 'stedule-settings.json',
    });
  } else {
    return await tauriOpen({
      filters: [{name: 'JSON', extensions:['json']}],
      multiple: false,
    });
  }
}

/**
 * Opens a file directly by its saved path without the picker dialog.
 * Used on launch when a path was previously saved in local settings.
 * Throws if the file can't be read (moved, deleted, permission lost).
 *
 * @param {string} path
 * @returns {Promise<string>} raw .ics text
 */
export async function openFileByPath(path) {
  const { readTextFile } = await _getTauriFs();
  _fileHandle = path;
  _fileName   = _basename(path);
  return readTextFile(path);
}

/**
 * Re-opens the .ics from a handle saved in IndexedDB (browser only).
 * Requires a user gesture the first time in a session, because the browser
 * drops the permission grant between sessions by design.
 *
 * @param {boolean} interactive — may we prompt for permission?
 * @returns {Promise<string|null>} file text, or null if permission is pending
 */
export async function restoreFileFromHandle(interactive = false) {
  if (_isTauri || !hasFileSystemAccess) return null;

  const handle = await loadHandle(HANDLE_KEY_ICS);
  if (!handle) return null;

  const ok = await _ensurePermission(handle, 'readwrite', interactive);
  if (!ok) { _fileHandle = handle; _fileName = handle.name; return null; }

  _fileHandle = handle;
  _fileName   = handle.name;
  return _readFromHandle(handle);
}

/**
 * Re-reads the currently open file from disk.
 * Useful after Syncthing syncs new changes from another device.
 *
 * @returns {Promise<string>}
 * @throws {Error} if no file is currently open.
 */
export async function reloadFile() {
  if (!_fileHandle) throw new Error('No file is open. Call openFile() first.');

  if (_isTauri) {
    const { readTextFile } = await _getTauriFs();
    return readTextFile(_fileHandle);
  }

  if (hasFileSystemAccess && _fileHandle) {
    return _readFromHandle(_fileHandle);
  }

  // Firefox: signal to the caller that a re-open is needed
  return null;
}

/**
 * Writes updated calendar content.
 * On Chromium: overwrites the original file in-place.
 * On Firefox:  downloads a new file. The user must replace the file in
 *              their Syncthing folder manually.
 *
 * @param {string} content - Full .ics text to write.
 * @returns {Promise<void>}
 */
export async function writeFile(content) {
  if (!_fileName) throw new Error('No file is open. Call openFile() first.');

  if (_isTauri) {
    const { writeTextFile } = await _getTauriFs();

    if(!_fileHandle) {
      throw new Error("No file handle available");
    }

    await writeTextFile(_fileHandle, content);
    return;
  }

  if (hasFileSystemAccess) {
    return _writeChromium(content);
  } else if (_isFirefox){
    return _writeFirefox(content);
  } else {
    throw new Error("Unsupported platform.")
  }
}

/**
 * Returns the name of the currently open file (e.g. "my-calendar.ics"),
 * or null if no file is open.
 *
 * @returns {string|null}
 */
export function getFileName() {
  return _fileName ? _fileName : null;
}

/**
 * Returns true if a file is currently open.
 * @returns {boolean}
 */
export function hasFileOpen() {
  return _fileName !== null;
}

/**
 * Returns true if the browser prevents in-place file writing.
 * app.js uses this to show a notice to Firefox users about download saves.
 * @returns {boolean}
 */
export function isFirefox() {
  return _isFirefox;
}

/** True when this platform can write a file in place at all. */
export function canWriteInPlace() {
  return _isTauri || hasFileSystemAccess;
}

// ============================================================
// FOLDER MODE
// ============================================================

export function getFolderName() { return _folderName; }
export function getFolderPath() { return _folderPath; }
export function hasFolderOpen() { return !!(_folderHandle || _folderPath); }

/**
 * Asks the user for the folder that holds the calendar and review data.
 *
 * @returns {Promise<string|null>} an identifier to persist (path/URI on
 *          Tauri, the folder name on Chromium where the handle itself is
 *          kept in IndexedDB), or null if the user cancelled.
 */
export async function openFolder() {
  if (_isTauri) {
    const { invoke } = window.__TAURI__.core;

    let uri = null;
    try {
      // Preferred: a Rust command that uses ACTION_OPEN_DOCUMENT_TREE and
      // takes a persistable read/write grant. See the notes at the top.
      uri = await invoke('open_data_folder');
    } catch {
      // Desktop fallback — plugin-dialog can pick a directory there.
      const { open: tauriOpen } = await _getTauriDialog();
      uri = await tauriOpen({ directory: true, multiple: false });
    }

    if (!uri) return null;

    _folderPath = uri;
    _folderName = _basename(uri);
    return uri;
  }

  if (!('showDirectoryPicker' in window)) {
    throw new Error('This browser cannot open folders. Pick the files individually instead.');
  }

  const handle = await window.showDirectoryPicker({
    id: 'stedule-data',
    mode: 'readwrite',
    startIn: 'documents',
  });

  _folderHandle = handle;
  _folderName   = handle.name;
  await saveHandle(HANDLE_KEY_FOLDER, handle);
  return handle.name;
}

/**
 * Re-attaches a previously chosen folder on launch.
 *
 * @param {string|null} savedPath — the value openFolder() returned last time
 * @param {boolean} interactive   — may we prompt for permission? (browser)
 * @returns {Promise<'ready'|'needs-permission'|'none'>}
 */
export async function restoreFolder(savedPath, interactive = false) {
  if (_isTauri) {
    if (!savedPath) return 'none';
    _folderPath = savedPath;
    _folderName = _basename(savedPath);
    return 'ready';
  }

  const handle = await loadHandle(HANDLE_KEY_FOLDER);
  if (!handle) return 'none';

  _folderHandle = handle;
  _folderName   = handle.name;

  return (await _ensurePermission(handle, 'readwrite', interactive))
    ? 'ready'
    : 'needs-permission';
}

export async function forgetFolder() {
  _folderHandle = null;
  _folderPath   = null;
  _folderName   = null;
  await clearHandle(HANDLE_KEY_FOLDER);
}

/**
 * Reads a file from the open folder.
 * @returns {Promise<string|null>} text, or null if the file does not exist
 */
export async function readInFolder(name) {
  if (_isTauri && _folderPath) {
    const { invoke } = window.__TAURI__.core;
    try {
      return await invoke('read_in_folder', { folder: _folderPath, name });
    } catch (err) {
      if (_isContentUri(_folderPath)) return null; // no join possible on SAF
      try {
        const { readTextFile } = await _getTauriFs();
        return await readTextFile(_joinPath(_folderPath, name));
      } catch { return null; }
    }
  }

  if (_folderHandle) {
    try {
      const fh = await _folderHandle.getFileHandle(name, { create: false });
      return (await fh.getFile()).text();
    } catch (err) {
      if (err?.name === 'NotFoundError') return null;
      throw err;
    }
  }

  return null;
}

/** Writes (creating if needed) a file inside the open folder. */
export async function writeInFolder(name, content) {
  if (_isTauri && _folderPath) {
    const { invoke } = window.__TAURI__.core;
    try {
      await invoke('write_in_folder', { folder: _folderPath, name, contents: content });
      return;
    } catch (err) {
      if (_isContentUri(_folderPath)) throw err;
      const { writeTextFile } = await _getTauriFs();
      await writeTextFile(_joinPath(_folderPath, name), content);
      return;
    }
  }

  if (_folderHandle) {
    const fh = await _folderHandle.getFileHandle(name, { create: true });
    const w  = await fh.createWritable();
    await w.write(String(content));
    await w.close();
    return;
  }

  throw new Error('No data folder is open.');
}

/**
 * Picks the .ics from inside the already-open folder, so the calendar and the
 * review file share one grant.
 * @returns {Promise<{name: string, text: string}|null>}
 */
export async function pickIcsInFolder(name) {
  const text = await readInFolder(name);
  if (text === null) return null;
  _fileName   = name;
  _fileHandle = _isTauri ? (_isContentUri(_folderPath) ? _folderPath : _joinPath(_folderPath, name)) : null;
  return { name, text };
}

/** Lists .ics files in the open folder (best effort; [] if unsupported). */
export async function listIcsInFolder() {
  if (_isTauri && _folderPath) {
    const { invoke } = window.__TAURI__.core;
    try { return await invoke('list_folder', { folder: _folderPath, ext: 'ics' }); }
    catch { return []; }
  }

  if (_folderHandle) {
    const out = [];
    for await (const [name, entry] of _folderHandle.entries()) {
      if (entry.kind === 'file' && name.toLowerCase().endsWith('.ics')) out.push(name);
    }
    return out.sort();
  }

  return [];
}

// ============================================================
// REVIEW FILE
// ============================================================

export function hasReviewFile() {
  return hasFolderOpen() || !!_reviewHandle || !!_reviewPath;
}

export function getReviewLocation() {
  if (hasFolderOpen()) return `${_folderName}/${REVIEW_FILENAME}`;
  if (_reviewPath)   return _reviewPath;
  if (_reviewHandle) return _reviewHandle.name;
  return null;
}

/**
 * Reads review.json.
 * Resolution order: open folder -> explicit review path/handle -> sibling of
 * the open .ics (only possible where real paths exist).
 *
 * @returns {Promise<string|null>} file text, or null when there is no file yet
 */
export async function readReview() {
  if (hasFolderOpen()) return readInFolder(REVIEW_FILENAME);

  if (_isTauri && _reviewPath) {
    const { readTextFile } = await _getTauriFs();
    try { return await readTextFile(_reviewPath); } catch { return null; }
  }

  if (_reviewHandle) {
    try { return (await _reviewHandle.getFile()).text(); } catch { return null; }
  }

  // Last resort: a sibling of the .ics. Works on desktop paths only.
  const sibling = _siblingOfIcs();
  if (sibling && _isTauri) {
    const { readTextFile } = await _getTauriFs();
    try { _reviewPath = sibling; return await readTextFile(sibling); } catch { return null; }
  }

  return null;
}

/** Writes review.json to whichever location readReview() resolved. */
export async function writeReview(content) {
  if (hasFolderOpen()) return writeInFolder(REVIEW_FILENAME, content);

  if (_isTauri) {
    const target = _reviewPath ?? _siblingOfIcs();
    if (!target) throw new Error('No review file location. Choose a data folder in Settings.');
    const { writeTextFile } = await _getTauriFs();
    _reviewPath = target;
    await writeTextFile(target, content);
    return;
  }

  if (_reviewHandle) {
    const ok = await _ensurePermission(_reviewHandle, 'readwrite', true);
    if (!ok) throw new Error('Write permission for review.json was denied.');
    const w = await _reviewHandle.createWritable();
    await w.write(String(content));
    await w.close();
    return;
  }

  if (_isFirefox) {
    _downloadFile(REVIEW_FILENAME, content, 'application/json');
    return;
  }

  throw new Error('No review file is open.');
}

/**
 * Explicitly picks (or creates) review.json — the folder-less fallback.
 * @returns {Promise<string|null>} an identifier to persist, or null if cancelled
 */
export async function openReviewFile() {
  if (_isTauri) {
    const { open: tauriOpen, save: tauriSave } = await _getTauriDialog();
    const isAndroid = navigator.userAgent.includes('Android');

    // save() lets the user create the file if it does not exist yet, which is
    // the common case on a fresh install.
    const picked = isAndroid
      ? await tauriSave({ filters: [{ name: 'JSON', extensions: ['json'] }], defaultPath: REVIEW_FILENAME })
      : await tauriOpen({ filters: [{ name: 'JSON', extensions: ['json'] }], multiple: false })
        ?? await tauriSave({ filters: [{ name: 'JSON', extensions: ['json'] }], defaultPath: REVIEW_FILENAME });

    if (!picked) return null;
    _reviewPath = picked;
    return picked;
  }

  if (hasFileSystemAccess) {
    const handle = await window.showSaveFilePicker({
      id: 'stedule-review',
      suggestedName: REVIEW_FILENAME,
      types: [{ description: 'Review data', accept: { 'application/json': ['.json'] } }],
    });
    _reviewHandle = handle;
    await saveHandle(HANDLE_KEY_REVIEW, handle);
    return handle.name;
  }

  throw new Error('This browser cannot keep a review file. Reviews will not persist.');
}

/**
 * Re-attaches a previously chosen review.json on launch.
 * @returns {Promise<'ready'|'needs-permission'|'none'>}
 */
export async function restoreReviewFile(savedPath, interactive = false) {
  if (_isTauri) {
    if (!savedPath) return 'none';
    _reviewPath = savedPath;
    return 'ready';
  }

  const handle = await loadHandle(HANDLE_KEY_REVIEW);
  if (!handle) return 'none';
  _reviewHandle = handle;
  return (await _ensurePermission(handle, 'readwrite', interactive))
    ? 'ready'
    : 'needs-permission';
}

// -- Chromium implementation --------------------------------------------

/**
 * Prompts the user to pick a .ics file and reads its text content.
 * Stores the file handle so subsequent saves don't re-prompt.
 *
 * @returns {Promise<string>} The raw text content of the file.
 * @throws {DOMException} with name 'AbortError' if the user cancels.
 */
async function _openChromium() {
  // showOpenFilePicker() is the browser dialog for picking a file.
  [_fileHandle] = await window.showOpenFilePicker({
    types: [{
      description: '.ics file',
      accept: { 'text/calendar': ['.ics'] },
    }],
    multiple: false,
    excludeAcceptAllOption: false,
  });
  _fileName = _fileHandle.name;
  await saveHandle(HANDLE_KEY_ICS, _fileHandle);
  return _readFromHandle(_fileHandle);
}

/**
 * Writes content to the currently open file.
 *
 * @param {string} content - The full text to write (replaces file contents).
 * @returns {Promise<void>}
 */
async function _writeChromium(content) {
  // Verify permission
  const permission = await _fileHandle.requestPermission({ mode: 'readwrite' });
  if (permission !== 'granted') {
    throw new Error('Write permission was denied by the browser.');
  }

  const writable = await _fileHandle.createWritable();
  await writable.write(String(content));
  await writable.close();
}

/**
 * queryPermission() first: it never prompts, so a silent launch stays silent.
 * requestPermission() only runs when we are allowed to be interactive, since
 * it throws outside a user gesture.
 */
async function _ensurePermission(handle, mode, interactive) {
  if (!handle?.queryPermission) return true;
  if (await handle.queryPermission({ mode }) === 'granted') return true;
  if (!interactive) return false;
  try {
    return await handle.requestPermission({ mode }) === 'granted';
  } catch {
    return false;
  }
}

// -- Firefox implementation ---------------------------------------------

function _openFirefox() {
  return new Promise((resolve, reject) => {
    const input    = document.createElement('input');
    input.type     = 'file';
    input.accept   = '.ics,text/calendar';
    input.style    = 'display:none';

    input.onchange = () => {
      // JS QUIRK — optional chaining (?.):
      // input.files?.[] won't throw if input.files is null/undefined.
      const file = input.files?.[0];

      if (!file) {
        reject(new DOMException('User cancelled', 'AbortError'));
        input.remove();
        return;
      }

      _fileName = file.name;
      file.text().then(resolve).catch(reject);
      input.remove();
    };

    // 'cancel' fires when the user dismisses the picker without selecting.
    // Supported Firefox 113+, Chrome 113+.
    input.oncancel = () => {
      reject(new DOMException('User cancelled', 'AbortError'));
      input.remove();
    };

    document.body.appendChild(input);
    input.click();
  });
}

function _writeFirefox(content) {
  _downloadFile(_fileName, content, 'text/calendar');
  return Promise.resolve();
}

/**
 * Blob is an in-memory file. We create one from the text content, attach it to
 * a temporary URL, then programmatically click a hidden <a download> link —
 * the only way to trigger a download from JS.
 */
function _downloadFile(name, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url  = URL.createObjectURL(blob);

  const a    = document.createElement('a');
  a.href     = url;
  a.download = name;
  a.style    = 'display:none';
  document.body.appendChild(a);
  a.click();
  a.remove();

  // createObjectURL creates a memory reference that must be manually freed.
  // We delay slightly to ensure the download starts before we revoke.
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// ============================================================
// PRIVATE HELPERS (not exported — callers outside this module
// cannot call these at all)
// ============================================================

async function _readFromHandle(handle) {
  // getFile() returns a File object (a snapshot of the file at this moment).
  // file.text() reads the whole thing as a UTF-8 string.
  const file = await handle.getFile();
  return file.text();
}

function _isContentUri(p) {
  return typeof p === 'string' && p.startsWith('content://');
}

/** Last path segment of a plain path or an encoded SAF URI. */
function _basename(p) {
  if (typeof p !== 'string') return null;
  const decoded = p.includes('%2F') ? p.split('%2F').pop() : p;
  return decoded.split('/').pop();
}

function _joinPath(dir, name) {
  return dir.endsWith('/') ? dir + name : `${dir}/${name}`;
}

/**
 * review.json next to the open .ics. Returns null for SAF content URIs,
 * where sibling addressing is impossible by design — that is exactly why
 * folder mode exists.
 */
function _siblingOfIcs() {
  if (typeof _fileHandle !== 'string') return null;
  if (_isContentUri(_fileHandle)) return null;
  const idx = _fileHandle.lastIndexOf('/');
  if (idx < 0) return null;
  return _fileHandle.slice(0, idx + 1) + REVIEW_FILENAME;
}