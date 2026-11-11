/**
 * Durable, disk-backed file storage.
 *
 * The original CV bytes are written under a stable key so they survive a
 * process restart, and the returned URL points at the app's own
 * `/api/cv/<key>` route — i.e. the URL persisted on `CVFile.storageUrl`
 * is actually resolvable by the browser.
 *
 * Layout on disk:
 *   <root>/<key>            — the raw bytes
 *   <root>/<key>.meta.json  — the content type (so downloads keep their MIME)
 *
 * Notes:
 *   - Keys are untrusted-ish (they contain a requisition id and a file
 *     name). Every key is normalised and rejected when it escapes the
 *     storage root, so a crafted file name cannot write outside the root.
 *   - The driver is intentionally free of any database dependency: the
 *     bytes are files, the metadata is a `CVFile` row.
 */

import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'
import type { FileStorage, StoredObject } from './file-storage'

export interface FileSystemStorageOptions {
  /** Absolute or relative directory that holds the stored objects. */
  root: string
  /** Public base URL the stored objects are served from (no trailing slash). */
  baseUrl: string
}

export class FileSystemStorage implements FileStorage {
  public readonly driver = 'fs'
  public readonly durable = true

  private readonly root: string
  private readonly baseUrl: string

  constructor(options: FileSystemStorageOptions) {
    this.root = resolve(options.root)
    this.baseUrl = options.baseUrl.replace(/\/+$/, '')
  }

  /**
   * Resolves a storage key to an absolute path inside the storage root.
   * Throws when the key would escape the root.
   */
  private pathFor(key: string): string {
    const cleaned = key.replace(/\\/g, '/').replace(/^\/+/, '')
    if (!cleaned || cleaned.split('/').some(part => part === '..' || part === '')) {
      throw new Error(`[storage] unsafe storage key rejected: ${key}`)
    }
    const target = resolve(this.root, cleaned)
    if (target !== this.root && !target.startsWith(this.root + sep)) {
      throw new Error(`[storage] unsafe storage key rejected: ${key}`)
    }
    return target
  }

  private metaPathFor(path: string): string {
    return `${path}.meta.json`
  }

  /** True when the storage root exists (or can be created) and is writable. */
  isWritable(): boolean {
    try {
      mkdirSync(this.root, { recursive: true })
      const probe = resolve(this.root, '.write-probe')
      writeFileSync(probe, 'ok')
      rmSync(probe, { force: true })
      return true
    } catch {
      return false
    }
  }

  async put(
    key: string,
    body: Buffer,
    contentType?: string
  ): Promise<{ key: string; url: string }> {
    const path = this.pathFor(key)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, body)
    if (contentType) {
      await writeFile(this.metaPathFor(path), JSON.stringify({ contentType }), 'utf8')
    }
    return { key, url: `${this.baseUrl}/${key}` }
  }

  async get(key: string): Promise<StoredObject | null> {
    const path = this.pathFor(key)
    try {
      const body = await readFile(path)
      let contentType: string | undefined
      try {
        const meta = JSON.parse(await readFile(this.metaPathFor(path), 'utf8')) as {
          contentType?: string
        }
        contentType = meta.contentType
      } catch {
        contentType = undefined
      }
      return { key, body, contentType, size: body.length }
    } catch {
      return null
    }
  }

  async delete(key: string): Promise<void> {
    const path = this.pathFor(key)
    await rm(path, { force: true })
    await rm(this.metaPathFor(path), { force: true })
  }

  async getDownloadUrl(key: string): Promise<string | null> {
    try {
      const path = this.pathFor(key)
      const info = await stat(path)
      if (!info.isFile()) return null
      return `${this.baseUrl}/${key}`
    } catch {
      return null
    }
  }
}

