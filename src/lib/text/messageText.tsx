import type { ReactNode } from 'react'
import { splitMessageSegments } from '@/lib/text/messageSegments'

/** JSX version of `splitMessageSegments` for the live chat UI — actions render as `<em>`, matching `.prose-rp em`/`.rp-quote` in globals.css. */
export function renderMessageText(text: string): ReactNode {
  return splitMessageSegments(text).map((seg, i) => {
    if (seg.type === 'action') return <em key={i}>{seg.content}</em>
    if (seg.type === 'quote') return (
      <span key={i} className="rp-quote">
        {seg.content}
      </span>
    )
    return seg.content
  })
}
