/**
 * File storage — public API.
 *
 * Driver selection (`STORAGE_DRIVER` env var):
 *
 *   - unset / `auto` (DEFAULT) → the durable disk driver when the storage
 *     directory can be created and written to, otherwise the in-memory
 *     driver. The fallback is SAFE: the memory driver is not durable and
 *     hands out `memory://` URLs, so the UI can tell the user that the
 *     original file was not kept instead of pretending it was.
 *   - `fs` → the durable disk driver. If it cannot be initialised we log a
 *     warning and fall back to memory rather than failing the request.
 *   - `memory` → the in-memory driver (explicitly non-durable).
 *
 * Add new backends by:
 *   1. Implementing `FileStorage` (e.g. `VercelBlobStorage`).
 *   2. Registering the driver in the switch below.
 *   3. Setting `STORAGE_DRIVER=<driver>` in the target environment.
 */

import { resolve } from 'node:path'
import { FileSystemStorage } from './file-system-storage'
import { MemoryStorage } from './memory-storage'
import type { FileStorage, StoredObject } from './file-storage'

export type { FileStorage, StoredObject }
export { MemoryStorage }
export { FileSystemStorage }

/** Default directory that holds the stored objects. */
export const DEFAULT_STORAGE_DIR = '.storage'

/** Default public base URL the stored objects are served from. */
export const DEFAULT_STORAGE_BASE_URL = '/api/cv'

let _instance: FileStorage | null = null

/** Absolute path of the storage root. */
export function storageRoot(): string {
  return resolve(process.env.STORAGE_DIR ?? process.env.STORAGE_ROOT ?? DEFAULT_STORAGE_DIR)
}

/** Public base URL the stored objects are served from. */
export function storageBaseUrl(): string {
  return (process.env.STORAGE_BASE_URL ?? DEFAULT_STORAGE_BASE_URL).replace(/\/+$/, '')
}

function createFileStorage(): FileStorage {
  const driver = (process.env.STORAGE_DRIVER ?? 'auto').toLowerCase()

  if (driver === 'memory') {
    return new MemoryStorage()
  }

  const disk = new FileSystemStorage({ root: storageRoot(), baseUrl: storageBaseUrl() })
  if (disk.isWritable()) {
    return disk
  }

  console.warn(
    `[storage] STORAGE_DRIVER=${driver} could not initialise the durable driver at ` +
      `${storageRoot()} — falling back to the NON-durable in-memory driver. ` +
      'Original upload bytes will not survive a restart.',
  )
  return new MemoryStorage()
}

export function getFileStorage(): FileStorage {
  if (!_instance) {
    _instance = createFileStorage()
  }
  return _instance
}

/** Test helper. Resets the cached instance. */
export function _resetFileStorage() {
  _instance = null
}
