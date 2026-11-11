/**
 * File storage abstraction.
 *
 * A `FileStorage` driver is responsible for two things:
 *   1. keeping the ORIGINAL uploaded bytes (the CV file), and
 *   2. returning a URL the browser can actually resolve back to them.
 *
 * Drivers:
 *   - `fs`      — `FileSystemStorage`. Durable: the bytes survive a process
 *                 restart and are served back through the app's own
 *                 `/api/cv/...` route. This is the DEFAULT driver.
 *   - `memory`  — `MemoryStorage`. NOT durable: the bytes live in the
 *                 process heap and are lost on restart/recycle. It is only
 *                 used when the durable driver cannot initialise (read-only
 *                 filesystem, serverless without a volume). It reports
 *                 `durable === false` and hands out `memory://` URLs so the
 *                 loss is a VISIBLE signal rather than a silent one.
 *
 * Persisted metadata (filename, size, mime type, parsed text) always lives
 * in `CVFile` rows in Postgres, whichever driver is active.
 */

export interface StoredObject {
  /** Stable key (e.g. `cvs/{hrId}/{fileName}`). */
  key: string
  /** Bytes. */
  body: Buffer
  /** Original MIME type if known. */
  contentType?: string
  /** Byte length. */
  size: number
}

export interface FileStorage {
  /** Stable name of this implementation (e.g. "fs", "memory"). */
  readonly driver: string

  /**
   * True when the bytes survive a process restart. A non-durable driver
   * MUST return a non-resolvable URL (e.g. `memory://…`) so callers can
   * tell the user that the original file was not kept.
   */
  readonly durable: boolean

  /**
   * Stores the object and returns a storage key/URL. The URL is what
   * should be persisted on `CVFile.storageUrl`.
   */
  put(key: string, body: Buffer, contentType?: string): Promise<{ key: string; url: string }>

  /**
   * Reads bytes back. Returns `null` if the key isn't present.
   */
  get(key: string): Promise<StoredObject | null>

  /**
   * Removes the object. No-op if the key isn't present.
   */
  delete(key: string): Promise<void>

  /**
   * Returns a URL the client can use to download the object directly
   * (durable drivers) — `null` when the object is not available.
   */
  getDownloadUrl(key: string): Promise<string | null>
}
