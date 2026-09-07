/**
 * In-memory file storage.
 *
 * The MVP backend. Bytes live only in the Lambda's memory and are
 * discarded when the function is recycled.
 *
 * Persisted text + structured data live in `CVFile` rows in Postgres,
 * which is the only durable surface area.
 *
 * This storage returns `memory://...` synthetic URLs that the UI knows
 * to interpret as "not directly downloadable; the server has the bytes
 * during the request".
 */

import type { FileStorage, StoredObject } from './file-storage'

export class MemoryStorage implements FileStorage {
  public readonly driver = 'memory'
  private readonly store = new Map<string, StoredObject>()

  async put(
    key: string,
    body: Buffer,
    contentType?: string
  ): Promise<{ key: string; url: string }> {
    const obj: StoredObject = {
      key,
      body,
      contentType,
      size: body.length,
    }
    this.store.set(key, obj)
    return { key, url: `memory://${key}` }
  }

  async get(key: string): Promise<StoredObject | null> {
    return this.store.get(key) ?? null
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key)
  }

  async getDownloadUrl(key: string): Promise<string | null> {
    if (!this.store.has(key)) return null
    return `memory://${key}`
  }
}
