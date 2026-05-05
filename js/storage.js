/**
 * storage.js — File I/O abstraction layer
 * 
 * BROWSER IMPLEMENTATION:
 * Uses the File System Access API — a modern browser API that lets JS
 * request permission to read/write a specific local file the user picks.
 * The user explicitly grants access each session; no silent disk access.
 * Chromium and Firefox-based browsers are handled differently based on
 * their design philosophies.
 *
 * TAURI MIGRATION (todo):
 * Replace the bodies of openFile() and writeFile() with:
 *   import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';
 * The rest of the app stays identical.
 */

// Detect Tauri
const isTauri = !!window.__TAURI__?.core;
//const isTauri = '__TAURI__' in window;
//const isTauri = window.__TAURI__ !== undefined;

// Detect capability (Distinguish between Chromium, Firefox)
const hasFileSystemAccess = !isTauri && 'showOpenFilePicker' in window;

let _fileHandle = null; // Chromium: FileSystemFileHandle
let _fileName   = null; // Both: display name

// -- Exported API -------------------------------------------------------

/**
 * Opens a file picker and reads the selected .ics file.
 * On Chromium: stores the file handle for in-place writes later.
 * On Firefox:  reads the file once; writes will download a new file.
 *
 * @returns {Promise<string>} Raw text content of the file.
 * @throws  {DOMException}   name === 'AbortError' if the user cancels.
 */
export async function openFile() {

  if (isTauri) {
    
    const { invoke } = window.__TAURI__.core;

    const path = await invoke("open_calendar");

    if (!path) {
      throw new DOMException('User cancelled', 'AbortError');
    }

    const { readTextFile } = window.__TAURI__.fs;

    _fileName = path.split("/").pop();
    _fileHandle = path;

    return await readTextFile(path);
  }

  if (hasFileSystemAccess) {
    return _openChromium();
  } else {
    return _openFirefox();
  }
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

  if (isTauri) {
    const { invoke } = window.__TAURI__.core;
    await invoke("save_calendar", {
      path: _fileHandle,
      content
    });
    return;
  }
 
  if (hasFileSystemAccess) {
    return _writeChromium(content);
  } else {
    return _writeFirefox(content);
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
 * Returns true if the browser supports in-place file writing.
 * app.js uses this to show a notice to Firefox users about download saves.
 * @returns {boolean}
 */
export function canWriteInPlace() {
  return hasFileSystemAccess;
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

  // createWritable() opens a write stream.
  const writable = await _fileHandle.createWritable();
  await writable.write(content);
  await writable.close(); // save write changes
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
  // Blob is an in-memory file. We create one from the text content,
  // attach it to a temporary URL, then programmatically click a hidden
  // <a download> link — the only way to trigger a download from JS.
  const blob = new Blob([content], { type: 'text/calendar' });
  const url  = URL.createObjectURL(blob);
 
  const a    = document.createElement('a');
  a.href     = url;
  a.download = _fileName;
  a.style    = 'display:none';
  document.body.appendChild(a);
  a.click();
  a.remove();
 
  // createObjectURL creates a memory reference that must be manually freed.
  // We delay slightly to ensure the download starts before we revoke.
  setTimeout(() => URL.revokeObjectURL(url), 5000);
 
  return Promise.resolve();
}

// ============================================================
// PRIVATE HELPER (not exported — callers outside this module
// cannot call this function at all)
// ============================================================

async function _readFromHandle(handle) {
  // getFile() returns a File object (a snapshot of the file at this moment).
  // file.text() reads the whole thing as a UTF-8 string.
  const file = await handle.getFile();
  return file.text();
}
