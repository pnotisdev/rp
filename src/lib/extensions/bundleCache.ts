// Shares one bundle fetch per extension revision between panels, the Studio and script runtimes.

import { useEffect, useState } from 'react'
import { extensionsApi } from '@/lib/api/client'
import type { BundleFile, ExtensionBundle, ExtensionRecord } from './manifest'

const cache = new Map<string, Promise<ExtensionBundle>>()

export function loadBundle(ext: Pick<ExtensionRecord, 'id' | 'rev'>): Promise<ExtensionBundle> {
  const key = `${ext.id}@${ext.rev}`
  let promise = cache.get(key)
  if (!promise) {
    for (const old of cache.keys()) if (old.startsWith(`${ext.id}@`)) cache.delete(old)
    promise = extensionsApi.bundle(ext.id)
    cache.set(key, promise)
    promise.catch(() => cache.delete(key))
  }
  return promise
}

/** The extension's files, or `override` when the Studio previews unsaved edits. Undefined while loading. */
export function useExtensionFiles(ext: Pick<ExtensionRecord, 'id' | 'rev'>, override?: Record<string, BundleFile>): Record<string, BundleFile> | undefined {
  const [files, setFiles] = useState<Record<string, BundleFile> | undefined>(override)
  useEffect(() => {
    if (override) {
      setFiles(override)
      return
    }
    let cancelled = false
    loadBundle(ext)
      .then((bundle) => {
        if (!cancelled) setFiles(bundle.files)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [ext.id, ext.rev, override])
  return files
}
