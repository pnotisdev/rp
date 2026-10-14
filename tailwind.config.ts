import type { Config } from 'tailwindcss'

export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-ui)'],
      },
      colors: {
        bg: 'rgb(var(--c-bg) / <alpha-value>)',
        'bg-elevated': 'rgb(var(--c-bg-elevated) / <alpha-value>)',
        'bg-sunken': 'rgb(var(--c-bg-sunken) / <alpha-value>)',
        border: 'rgb(var(--c-border) / <alpha-value>)',
        text: 'rgb(var(--c-text) / <alpha-value>)',
        'text-muted': 'rgb(var(--c-text-muted) / <alpha-value>)',
        accent: 'rgb(var(--c-accent) / <alpha-value>)',
        'accent-text': 'rgb(var(--c-accent-text) / <alpha-value>)',
        'msg-user': 'rgb(var(--c-msg-user) / <alpha-value>)',
        'msg-char': 'rgb(var(--c-msg-char) / <alpha-value>)',
        danger: 'rgb(var(--c-danger) / <alpha-value>)',
        success: 'rgb(var(--c-success) / <alpha-value>)',
        warning: 'rgb(var(--c-warning) / <alpha-value>)',
        romance: 'rgb(var(--c-romance) / <alpha-value>)',
        'romance-text': 'rgb(var(--c-romance-text) / <alpha-value>)',
      },
      // Every rounded-* scales from the user's roundness setting (6px by default; pills/avatars use rounded-full).
      borderRadius: {
        sm: 'calc(var(--radius) * 0.5)',
        DEFAULT: 'var(--radius)',
        md: 'calc(var(--radius) * 0.8)',
        lg: 'var(--radius)',
        xl: 'calc(var(--radius) * 1.35)',
        '2xl': 'calc(var(--radius) * 1.7)',
        '3xl': 'calc(var(--radius) * 2)',
      },
      boxShadow: {
        sm: 'none',
        DEFAULT: 'none',
        md: 'none',
        lg: 'none',
        xl: 'none',
        '2xl': 'none',
      },
      fontSize: {
        base: 'calc(1rem * var(--font-scale, 1))',
      },
      maxWidth: {
        chat: 'var(--chat-width, 48rem)',
      },
      backdropBlur: {
        chat: 'var(--chat-blur, 0px)',
      },
      transitionDuration: {
        DEFAULT: 'var(--motion-duration, 150ms)',
      },
    },
  },
  plugins: [],
} satisfies Config
