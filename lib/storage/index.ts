/**
 * File storage — public API.
 *
 * Selects a storage backend via the `STORAGE_DRIVER` env var
 * (defaults to `memory`).
 *
 * Add new backends by:
 *   1. Implementing `FileStorage` (e.g. `VercelBlobStorage`).
 *   2. Registering the driver in the switch below.
 *   3. Setting `STORAGE_DRIVER=vercel-blob` in the target environment.
 */

import { MemoryStorage } from './memory-storage'
import type { FileStorage, StoredObject } from './file-storage'

export type { FileStorage, StoredObject }
export { MemoryStorage }

let _instance: FileStorage | null = null

export function getFileStorage(): FileStorage {
  if (_instance) return _instance

  const driver = (process.env.STORAGE_DRIVER ?? 'memory').toLowerCase()
  switch (driver) {
    case 'memory':
      _instance = new MemoryStorage()
      break
    default:
      // Unknown driver -> safe default.
      _instance = new MemoryStorage()
      break
  }
  return _instance
}

/** Test helper. Resets the cached instance. */
export function _resetFileStorage() {
  _instance = null
}
