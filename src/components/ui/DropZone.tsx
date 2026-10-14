import { useState, type DragEvent, type ReactNode } from 'react'
import { Upload } from 'lucide-react'

/** Wraps a page so files dropped anywhere on it are passed to `onFiles`. */
export function DropZone({ onFiles, label, children }: { onFiles: (files: File[]) => void; label: string; children: ReactNode }) {
  const [over, setOver] = useState(false)
  const hasFiles = (e: DragEvent) => e.dataTransfer.types.includes('Files')
  return (
    <div
      className="relative flex min-w-0 flex-1"
      onDragOver={(e) => {
        if (!hasFiles(e)) return
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node)) return
        setOver(false)
      }}
      onDrop={(e) => {
        if (!hasFiles(e)) return
        e.preventDefault()
        setOver(false)
        onFiles(Array.from(e.dataTransfer.files))
      }}
    >
      {children}
      {over && (
        <div className="pointer-events-none absolute inset-3 z-20 flex items-center justify-center gap-2 rounded-xl border border-dashed border-accent bg-bg/85 text-sm text-accent">
          <Upload size={16} strokeWidth={1.75} />
          {label}
        </div>
      )}
    </div>
  )
}
