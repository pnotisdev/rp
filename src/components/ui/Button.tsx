import { forwardRef, type ButtonHTMLAttributes } from 'react'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'

const variantClasses: Record<Variant, string> = {
  primary: 'border border-transparent bg-accent text-accent-text hover:bg-accent/90',
  secondary: 'border border-border text-text hover:bg-bg-sunken',
  ghost: 'border border-transparent text-text-muted hover:text-text hover:bg-bg-sunken',
  danger: 'border border-danger/50 text-danger hover:bg-danger/10',
}

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }>(
  function Button({ variant = 'secondary', className = '', ...props }, ref) {
    return (
      <button
        ref={ref}
        // `py-2.5 sm:py-1.5`: a ~40px tap target on touch screens, back to the denser 32px on desktop.
        className={`rounded-md px-3 py-2 text-[13px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 sm:py-1 ${variantClasses[variant]} ${className}`}
        {...props}
      />
    )
  },
)
