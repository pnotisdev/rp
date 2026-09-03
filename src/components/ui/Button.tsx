import { forwardRef, type ButtonHTMLAttributes } from 'react'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'

const variantClasses: Record<Variant, string> = {
  primary: 'bg-gradient-to-b from-accent to-accent/85 text-accent-text hover:to-accent/95',
  secondary: 'bg-bg-sunken text-text hover:opacity-80',
  ghost: 'text-text-muted hover:text-text hover:bg-bg-sunken',
  danger: 'bg-gradient-to-b from-danger to-danger/85 text-white hover:to-danger/95',
}

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }>(
  function Button({ variant = 'secondary', className = '', ...props }, ref) {
    return (
      <button
        ref={ref}
        className={`rounded-xl px-3.5 py-1.5 text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${variantClasses[variant]} ${className}`}
        {...props}
      />
    )
  },
)
