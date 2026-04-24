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

const hasFileSystemAccess = 'showOpenFilePicker' in window;

let _fileHandle = null; // Chromium: FileSystemFileHandle
let _fileName   = null; // Both: display name

// -- Chromium implementation --------------------------------------------

/**
 * Prompts the user to pick a .ics file and reads its text content.
 * Stores the file handle so subsequent saves don't re-prompt.
 *
 * @returns {Promise<string>} The raw text content of the file.
 * @throws {DOMException} with name 'AbortError' if the user cancels.
 */
export async function openChromium() {
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
 * Writes content to the currently open file.
 *
 * @param {string} content - The full text to write (replaces file contents).
 * @returns {Promise<void>}
 */
export async function writeFile(content) {
  if (!_fileHandle) throw new Error('No file is open. Call openFile() first.');

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

/**
 * Returns the name of the currently open file (e.g. "my-calendar.ics"),
 * or null if no file is open.
 *
 * @returns {string|null}
 */
export function getFileName() {
  return _fileHandle ? _fileHandle.name : null;
}

/**
 * Returns true if a file is currently open.
 * @returns {boolean}
 */
export function hasFileOpen() {
  return _fileHandle !== null;
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
