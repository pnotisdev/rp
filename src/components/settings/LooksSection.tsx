// The Looks gallery: whole-interface designs, each shown as a miniature drawn with its own palette, fonts and shape.

import type { CSSProperties } from 'react'
import { Check } from 'lucide-react'
import { shallow } from 'zustand/shallow'
import { FONT_STACKS } from '@/lib/store/fonts'
import { LOOKS, matchingLookId, type Backdrop, type Look } from '@/lib/store/looks'
import { DEFAULT_THEME_TOKENS, DEFAULT_THEME_TOKENS_DARK, useSettingsStore } from '@/lib/store/useSettingsStore'
import { Section } from '@/components/ui/Section'

const AVATAR_RADIUS: Record<Look['avatarShape'], string> = { circle: '9999px', rounded: '30%', square: '2px', rectangle: '2px' }

/** The atmosphere layer of a preview, using the preview's own colour variables. */
function backdropStyle(backdrop: Backdrop): CSSProperties {
  switch (backdrop) {
    case 'aurora':
      return { backgroundImage: 'radial-gradient(70% 90% at 0% 0%, rgb(var(--c-accent) / 0.28), transparent 70%), radial-gradient(60% 80% at 100% 30%, rgb(var(--c-romance) / 0.2), transparent 70%)' }
    case 'grid':
      return { backgroundImage: 'linear-gradient(rgb(var(--c-accent) / 0.16) 1px, transparent 1px), linear-gradient(90deg, rgb(var(--c-accent) / 0.16) 1px, transparent 1px)', backgroundSize: '12px 12px' }
    case 'scanlines':
      return { backgroundImage: 'repeating-linear-gradient(to bottom, transparent 0, transparent 2px, rgb(0 0 0 / 0.22) 3px)' }
    case 'grain':
      return { backgroundImage: 'radial-gradient(rgb(var(--c-text) / 0.12) 0.6px, transparent 0.7px)', backgroundSize: '4px 4px' }
    default:
      return {}
  }
}

export function LookPreview({ look }: { look: Look }) {
  const base = look.mode === 'light' ? DEFAULT_THEME_TOKENS : DEFAULT_THEME_TOKENS_DARK
  const style = {
    ...base,
    ...(look.mode === 'light' ? look.light : look.dark),
    '--radius': `${look.radiusPx}px`,
    '--font-display': FONT_STACKS[look.displayFont],
    fontFamily: FONT_STACKS[look.uiFont],
  } as CSSProperties
  const panel = look.glass ? 'bg-bg-elevated/55' : 'bg-bg-elevated'
  const bubbles = look.chatStyle === 'bubbles'
  return (
    <div style={style} className="relative flex h-28 overflow-hidden rounded-lg border border-border bg-bg text-text">
      <div className="pointer-events-none absolute inset-0" style={backdropStyle(look.backdrop)} />
      <div className={`relative flex w-9 shrink-0 flex-col gap-1.5 border-r border-border p-1.5 ${panel}`}>
        <span className="h-2.5 w-2.5 rounded-sm bg-accent" />
        <span className="h-1 w-full rounded-full bg-text-muted/50" />
        <span className="h-1 w-3/4 rounded-full bg-text-muted/30" />
        <span className="h-1 w-full rounded-full bg-text-muted/30" />
      </div>
      <div className="relative flex min-w-0 flex-1 flex-col justify-center gap-1.5 p-2.5">
        <div className="flex items-center gap-1.5">
          <span className="h-4 w-4 shrink-0 bg-accent" style={{ borderRadius: AVATAR_RADIUS[look.avatarShape] }} />
          <span className="font-display text-[10px] leading-none">Sumire</span>
        </div>
        <div
          className={`px-2 py-1 text-[9px] leading-snug ${bubbles ? `rounded-xl border border-border ${panel}` : look.chatStyle === 'document' ? 'border-l-2 border-accent pl-2' : `rounded-md ${panel}`}`}
          style={{ fontFamily: FONT_STACKS[look.readFont] }}
        >
          The library is quiet tonight.
        </div>
        <div className={`ml-auto w-3/5 bg-msg-user px-2 py-1 text-[9px] leading-snug text-accent-text ${bubbles ? 'rounded-xl' : 'rounded-md'}`} style={{ fontFamily: FONT_STACKS[look.readFont] }}>
          Mind if I sit?
        </div>
      </div>
    </div>
  )
}

export function LooksSection() {
  const state = useSettingsStore(
    (s) => ({
      themeTokensLight: s.themeTokensLight,
      themeTokensDark: s.themeTokensDark,
      uiFont: s.uiFont,
      readFont: s.readFont,
      displayFont: s.displayFont,
      radiusPx: s.radiusPx,
      backdrop: s.backdrop,
      glass: s.glass,
      chatStyle: s.chatStyle,
      avatarShape: s.avatarShape,
    }),
    shallow,
  )
  const applyLook = useSettingsStore((s) => s.applyLook)
  const active = matchingLookId(state, { light: DEFAULT_THEME_TOKENS, dark: DEFAULT_THEME_TOKENS_DARK })

  return (
    <Section
      title="Looks"
      description="Whole-interface designs: colours, type, shape, atmosphere and chat style in one click. Everything below stays adjustable afterwards."
      surface="bare"
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {LOOKS.map((look) => {
          const isActive = active === look.id
          return (
            <button
              key={look.id}
              onClick={() => applyLook(look)}
              aria-pressed={isActive}
              title={`Switch to ${look.name}`}
              className={`group rounded-lg border p-2 text-left transition-colors ${isActive ? 'border-accent bg-accent/5' : 'border-border bg-bg-elevated hover:border-accent/60'}`}
            >
              <LookPreview look={look} />
              <div className="mt-2 flex items-center justify-between gap-2 px-0.5">
                <span className="text-[13px] font-semibold text-text">{look.name}</span>
                {isActive && (
                  <span className="flex items-center gap-1 text-[11px] text-accent">
                    <Check size={12} strokeWidth={2.2} /> Active
                  </span>
                )}
              </div>
              <p className="px-0.5 text-xs leading-snug text-text-muted">{look.blurb}</p>
            </button>
          )
        })}
      </div>
    </Section>
  )
}
