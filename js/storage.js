/**
 * storage.js — File I/O abstraction layer
 *
 * WHY THIS FILE EXISTS:
 * This is the ONLY file that will change when you migrate from browser
 * to Tauri. Every other file calls readFile() / writeFile() without
 * knowing or caring how those actually work under the hood.
 * This pattern is called "dependency inversion" and it's one of the
 * most important architectural habits you can build.
 *
 * BROWSER IMPLEMENTATION:
 * Uses the File System Access API — a modern browser API that lets JS
 * request permission to read/write a specific local file the user picks.
 * The user explicitly grants access each session; no silent disk access.
 *
 * TAURI MIGRATION (future):
 * Replace the bodies of readFile() and writeFile() with:
 *   import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';
 * The rest of the app stays identical.
 */

// ============================================================
// MODULE-LEVEL STATE
// ============================================================
//
// JS QUIRK — Module scope:
// Variables declared at the top level of an ES module are NOT global.
// They exist only inside this file. Other files cannot access _fileHandle
// directly — they must call the exported functions. This is good: it
// enforces that file access always goes through this module's interface.
//
// The underscore prefix on _fileHandle is a convention (not enforced by
// the language) meaning "this is private, don't use it from outside".

let _fileHandle = null;

// ============================================================
// EXPORTED FUNCTIONS
// ============================================================
//
// JS QUIRK — async/await:
// JavaScript is single-threaded. There is no Thread.sleep() or blocking
// wait. Instead, operations that take time (disk, network) are async:
// they return a Promise — an object representing a future value.
//
// async/await is syntax sugar for working with Promises:
//   const data = await someAsyncFunction();
// This pauses THIS function until the promise resolves, but the browser
// remains responsive — other events (clicks, animations) still fire.
//
// A function marked async ALWAYS returns a Promise, even if you return
// a plain value inside it. Callers must await it or .then() it.

/**
 * Prompts the user to pick a .ics file and reads its text content.
 * Stores the file handle so subsequent saves don't re-prompt.
 *
 * @returns {Promise<string>} The raw text content of the file.
 * @throws {DOMException} with name 'AbortError' if the user cancels.
 */
export async function openFile() {
  // showOpenFilePicker() is the browser dialog for picking a file.
  // It returns an ARRAY of handles (even when multiple:false),
  // so we destructure the first item with [_fileHandle].
  //
  // JS QUIRK — destructuring assignment:
  // const [a, b] = [1, 2];  // a=1, b=2
  // This is how we unpack arrays inline. We're also assigning directly
  // to our module-level variable (not declaring a new one with let/const).
  [_fileHandle] = await window.showOpenFilePicker({
    types: [{
      description: 'iCalendar file',
      accept: { 'text/calendar': ['.ics'] },
    }],
    multiple: false,
    excludeAcceptAllOption: false,
  });

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
  return _readFromHandle(_fileHandle);
}

/**
 * Writes content to the currently open file.
 *
 * @param {string} content - The full text to write (replaces file contents).
 * @returns {Promise<void>}
 */
export async function writeFile(content) {
  if (!_fileHandle) throw new Error('No file is open. Call openFile() first.');

  // Before writing, verify we still have permission.
  // The user could have revoked it, or the browser may have cleared
  // permissions between sessions.
  const permission = await _fileHandle.requestPermission({ mode: 'readwrite' });
  if (permission !== 'granted') {
    throw new Error('Write permission was denied by the browser.');
  }

  // createWritable() opens a write stream.
  // We MUST call close() — it's analogous to closing a file in Python.
  // Until close() is called, the actual file on disk is NOT modified
  // (the browser writes to a temp file first, then atomically swaps).
  const writable = await _fileHandle.createWritable();
  await writable.write(content);
  await writable.close();
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
