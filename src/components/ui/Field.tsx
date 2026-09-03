import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'

const CONTROL_CLASS =
  'w-full rounded-xl bg-bg-sunken px-3 py-2 text-sm text-text outline-none ring-1 ring-transparent transition-shadow focus:ring-accent/40 placeholder:text-text-muted/55'

/** A label + optional hint wrapper shared by every field control here, so spacing/typography stay identical. */
function FieldFrame({
  label,
  hint,
  actions,
  className = '',
  children,
}: {
  label?: string
  hint?: ReactNode
  actions?: ReactNode
  className?: string
  children: ReactNode
}) {
  return (
    <label className={`mb-3 block ${className}`}>
      {(label || actions) && (
        <span className="mb-1 flex items-center justify-between gap-2">
          {label && <span className="text-xs font-medium text-text-muted">{label}</span>}
          {actions}
        </span>
      )}
      {children}
      {hint && <span className="mt-1 block text-[11px] text-text-muted">{hint}</span>}
    </label>
  )
}

export function TextField({
  label,
  hint,
  className = '',
  ...props
}: { label: string; hint?: ReactNode; className?: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <FieldFrame label={label} hint={hint} className={className}>
      <input {...props} className={CONTROL_CLASS} />
    </FieldFrame>
  )
}

export function NumberField({
  label,
  hint,
  className = '',
  suffix,
  ...props
}: { label: string; hint?: ReactNode; className?: string; suffix?: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <FieldFrame label={label} hint={hint} className={className}>
      <span className="relative block">
        <input {...props} type="number" inputMode="numeric" className={CONTROL_CLASS} />
        {suffix && (
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-text-muted">
            {suffix}
          </span>
        )}
      </span>
    </FieldFrame>
  )
}

export function SelectField({
  label,
  hint,
  className = '',
  children,
  ...props
}: {
  label: string
  hint?: ReactNode
  className?: string
  children: ReactNode
} & SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <FieldFrame label={label} hint={hint} className={className}>
      <select {...props} className={`${CONTROL_CLASS} cursor-pointer`}>
        {children}
      </select>
    </FieldFrame>
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
  hint?: ReactNode
  actions?: ReactNode
  className?: string
} & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <FieldFrame label={label} hint={hint} actions={actions} className={className}>
      <textarea {...props} className={`${CONTROL_CLASS} resize-y leading-relaxed`} />
    </FieldFrame>
  )
}
