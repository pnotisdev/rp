import { urlToDataUrl } from '@/lib/characters/pack'
import type { Character } from '@/lib/characters/cardSpec'
import type { Chat, Persona, StoredMessage } from '@/lib/types'

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function avatarHtml(dataUrl: string | undefined, initials: string): string {
  if (dataUrl) return `<img class="avatar" src="${escapeHtml(dataUrl)}" alt="">`
  return `<div class="avatar avatar-fallback">${escapeHtml(initials.slice(0, 2).toUpperCase())}</div>`
}

/**
 * Renders a chat as a standalone, self-contained HTML transcript — a "visual novel log" readable
 * in any browser with no server running, so it's a real portable export rather than a snapshot
 * that only works while the app is up. Avatars are inlined as data URLs for the same reason;
 * `StoredMessage.images` already are full data URLs (see useChatSession.ts's sendUserMessage), so
 * those need no conversion.
 */
export async function buildChatTranscriptHtml(opts: {
  chat: Chat
  character?: Character
  persona?: Persona
  messages: StoredMessage[]
}): Promise<string> {
  const { chat, character, persona, messages } = opts
  const characterName = character?.card.name ?? 'Character'
  const personaName = persona?.name ?? 'You'
  const [characterAvatar, personaAvatar] = await Promise.all([
    urlToDataUrl(character?.avatarDataUrl),
    urlToDataUrl(persona?.avatarDataUrl),
  ])

  const rows = messages
    .map((m) => {
      const isUser = m.role === 'user'
      const name = isUser ? personaName : characterName
      const avatar = avatarHtml(isUser ? personaAvatar : characterAvatar, name)
      const images = (m.images ?? [])
        .map((src) => `<img class="attachment" src="${escapeHtml(src)}" alt="attachment">`)
        .join('')
      const imagesBlock = images ? `<div class="attachments">${images}</div>` : ''
      const time = new Date(m.createdAt).toLocaleString()
      return `<div class="row ${isUser ? 'row-user' : 'row-char'}">
        ${avatar}
        <div class="bubble">
          <div class="meta"><span class="name">${escapeHtml(name)}</span><span class="time">${escapeHtml(time)}</span></div>
          ${imagesBlock}
          <div class="text">${escapeHtml(m.text)}</div>
        </div>
      </div>`
    })
    .join('\n')

  const title = `${escapeHtml(chat.title || 'Chat')} — ${escapeHtml(characterName)}`

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${title}</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 2.5rem 1.5rem; background: #16171b; color: #e8e8ea;
    font: 15px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }
  .transcript { max-width: 720px; margin: 0 auto; }
  header { margin-bottom: 2rem; padding-bottom: 1rem; border-bottom: 1px solid #2a2b31; }
  header h1 { margin: 0 0 0.25rem; font-size: 1.15rem; font-weight: 600; }
  header p { margin: 0; color: #8b8d98; font-size: 0.8rem; }
  .row { display: flex; gap: 0.75rem; margin-bottom: 1.25rem; }
  .row-user { flex-direction: row-reverse; }
  .avatar { width: 34px; height: 34px; border-radius: 10px; object-fit: cover; flex-shrink: 0; }
  .avatar-fallback {
    display: flex; align-items: center; justify-content: center;
    background: #2a2b31; color: #8b8d98; font-size: 0.7rem; font-weight: 600;
  }
  .bubble { max-width: 78%; }
  .row-user .bubble { text-align: right; }
  .meta { display: flex; gap: 0.6rem; margin-bottom: 0.2rem; font-size: 0.7rem; color: #8b8d98; }
  .row-user .meta { flex-direction: row-reverse; }
  .name { font-weight: 600; color: #c8c9d1; }
  .text { white-space: pre-wrap; word-break: break-word; }
  .attachments { margin-bottom: 0.4rem; }
  .attachment { max-width: 160px; max-height: 160px; border-radius: 8px; margin: 0 4px 4px 0; object-fit: cover; }
  footer { margin-top: 2rem; padding-top: 1rem; border-top: 1px solid #2a2b31; color: #8b8d98; font-size: 0.7rem; }
</style>
</head>
<body>
  <div class="transcript">
    <header>
      <h1>${title}</h1>
      <p>${messages.length} message${messages.length === 1 ? '' : 's'} · exported ${escapeHtml(new Date().toLocaleString())}</p>
    </header>
    ${rows}
    <footer>Exported from rp.</footer>
  </div>
</body>
</html>
`
}

export function chatTranscriptFilename(chatTitle: string): string {
  const safe = (chatTitle || 'chat').replace(/[^a-z0-9-_ ]/gi, '').trim() || 'chat'
  return `${safe}.html`
}

export function downloadChatTranscript(html: string, filename: string): void {
  const blob = new Blob([html], { type: 'text/html' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
