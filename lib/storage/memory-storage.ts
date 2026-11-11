/**
 * In-memory file storage — NOT durable.
 *
 * The bytes live only in the process heap and are discarded when the
 * process is recycled or restarted. This driver exists as a safe fallback
 * for environments where the durable driver cannot be initialised (for
 * example a read-only serverless filesystem).
 *
 * Because the bytes cannot be read back later, the URLs it hands out are
 * synthetic (`memory://…`). They are deliberately NOT resolvable: a caller
 * that sees one knows the original file was not retained and can say so
 * to the user instead of offering a dead download link.
 *
 * Persisted text + structured data still live in `CVFile` rows in Postgres,
 * which is the only durable surface area for the parsed content.
 */

import type { FileStorage, StoredObject } from './file-storage'

export class MemoryStorage implements FileStorage {
  public readonly driver = 'memory'
  public readonly durable = false
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
