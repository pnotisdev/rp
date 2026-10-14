import type { ReactNode } from 'react'

/** A button-styled `<label>` wrapping a hidden file input */
export function FileButton({
  onPick,
  accept,
  multiple,
  title,
  children,
}: {
  onPick: (files: FileList) => void
  accept?: string
  multiple?: boolean
  title?: string
  children: ReactNode
}) {
  return (
    <label
      title={title}
      className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border px-3 py-1 text-[13px] font-medium text-text transition-colors hover:bg-bg-sunken"
    >
      {children}
      <input
        type="file"
        accept={accept}
        multiple={multiple}
        className="hidden"
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) onPick(e.target.files)
          e.target.value = ''
        }}
      />
    </label>
  )
}
