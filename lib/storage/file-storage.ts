/**
 * File storage abstraction.
 *
 * Vercel serverless has no persistent disk. The MVP ships `MemoryStorage`
 * which keeps bytes only in-process and never writes to disk. Persisted
 * metadata (filename, size, type, parsed text) lives in `CVFile`.
 *
 * Future storage backends (Vercel Blob, S3, Cloudflare R2) implement the
 * same interface and are selected via env (`STORAGE_DRIVER`).
 */

export interface StoredObject {
  /** Stable key (e.g. `cvs/{cvFileId}/{filename}`). */
  key: string
  /** Bytes. */
  body: Buffer
  /** Original MIME type if known. */
  contentType?: string
  /** Byte length. */
  size: number
}

export interface FileStorage {
  /** Stable name of this implementation (e.g. "memory", "vercel-blob"). */
  readonly driver: string

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
   * without going through the server. For the MVP this is a synthetic
   * `memory://` URL because the bytes never leave the process.
   */
  getDownloadUrl(key: string): Promise<string | null>
}
