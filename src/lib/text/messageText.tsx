import type { ReactNode } from 'react'
import { splitMessageSegments } from '@/lib/text/messageSegments'
import { applyRegexScripts } from '@/lib/text/regexScripts'
import type { RegexScript } from '@/lib/types'

/**
 * JSX version of `splitMessageSegments` for the live chat UI — actions render as `<em>`, matching
 * `.prose-rp em`/`.rp-quote` in globals.css. User-defined `regexScripts` (display target) run
 * first, so a rule can restyle or trim what's shown without touching the stored message.
 */
export function renderMessageText(text: string, regexScripts?: RegexScript[]): ReactNode {
  const shown = applyRegexScripts(text, regexScripts, 'display')
  return splitMessageSegments(shown).map((seg, i) => {
    if (seg.type === 'action') return <em key={i}>{seg.content}</em>
    if (seg.type === 'quote') return (
      <span key={i} className="rp-quote">
        {seg.content}
      </span>
    )
    return seg.content
  })
}
