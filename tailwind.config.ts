import type { Config } from 'tailwindcss'

export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          'Inter Variable',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'Helvetica',
          'Arial',
          'sans-serif',
        ],
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
      },
      borderRadius: {
        DEFAULT: 'var(--radius)',
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
