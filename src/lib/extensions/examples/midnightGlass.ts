// Example: a pure theme extension. Restyles the whole app with CSS through the stable data-rp-part hooks.

import type { ExtensionBundle } from '../manifest'

const CSS = `/* Midnight Glass: frosted panels and a soft aurora behind the app. */
body {
  background-image:
    radial-gradient(ellipse 900px 600px at 12% -8%, rgb(var(--c-accent) / 0.16), transparent 60%),
    radial-gradient(ellipse 700px 500px at 100% 100%, rgb(var(--c-romance) / 0.10), transparent 60%);
}
[data-rp-part='modal'] {
  background: rgb(var(--c-bg-elevated) / 0.72) !important;
  backdrop-filter: blur(22px) saturate(1.3);
  -webkit-backdrop-filter: blur(22px) saturate(1.3);
  border-color: rgb(var(--c-border) / 0.5) !important;
}
[data-rp-part='sidebar'] {
  background: rgb(var(--c-bg-elevated) / 0.55) !important;
  backdrop-filter: blur(14px);
}
[data-rp-part='chat-header'] {
  background: rgb(var(--c-bg-elevated) / 0.6) !important;
  backdrop-filter: blur(14px);
}
[data-rp-part='composer'] {
  backdrop-filter: blur(16px);
}
[data-rp-part='message'] {
  transition: transform 0.2s ease;
}
[data-rp-part='message']:hover {
  transform: translateY(-1px);
}
::-webkit-scrollbar { width: 10px; height: 10px; }
::-webkit-scrollbar-thumb { background: rgb(var(--c-text-muted) / 0.28); border-radius: 999px; border: 3px solid transparent; background-clip: content-box; }
::-webkit-scrollbar-thumb:hover { background: rgb(var(--c-accent) / 0.5); background-clip: content-box; border: 3px solid transparent; }
`

export const midnightGlass: ExtensionBundle = {
  format: 'rp-extension',
  version: 1,
  manifest: {
    id: 'midnight-glass',
    name: 'Midnight Glass',
    version: '1.0.0',
    description: 'Frosted-glass panels, a faint aurora and softer scrollbars. Keeps your own colors.',
    author: 'rp',
    glyph: '◈',
    api: 1,
    permissions: ['ui.theme'],
    panels: [],
    hooks: [],
    tools: [],
    theme: { css: 'theme.css' },
    settings: [],
  },
  files: { 'theme.css': CSS },
}
