import type { InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react'

export function TextField({
  label,
  hint,
  className = '',
  ...props
}: { label: string; hint?: string; className?: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className={`mb-3 block ${className}`}>
      <span className="mb-1 block text-xs font-medium text-text-muted">{label}</span>
      <input
        {...props}
        className="w-full rounded-xl bg-bg-sunken px-3 py-2 text-sm text-text outline-none ring-1 ring-transparent transition-shadow focus:ring-accent/40"
      />
      {hint && <span className="mt-1 block text-[11px] text-text-muted">{hint}</span>}
    </label>
  )
}

export function TextAreaField({
  label,
  hint,
  actions,
  className = '',
  ...props
}: {
  label: string
  hint?: string
  actions?: ReactNode
  className?: string
} & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <label className={`mb-3 block ${className}`}>
      <span className="mb-1 flex items-center justify-between">
        <span className="text-xs font-medium text-text-muted">{label}</span>
        {actions}
      </span>
      <textarea
        {...props}
        className="w-full resize-y rounded-xl bg-bg-sunken px-3 py-2 text-sm text-text outline-none ring-1 ring-transparent transition-shadow focus:ring-accent/40"
      />
      {hint && <span className="mt-1 block text-[11px] text-text-muted">{hint}</span>}
    </label>
  )
}
