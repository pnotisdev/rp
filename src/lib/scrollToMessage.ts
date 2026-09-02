/** Anchor id used by MessageBubble's root element — shared with search/pinned-message "jump to" actions. */
export function messageAnchorId(messageId: string): string {
  return `msg-${messageId}`
}

export function scrollToMessage(container: HTMLElement | null | undefined, messageId: string): void {
  const el = container?.querySelector<HTMLElement>(`#${CSS.escape(messageAnchorId(messageId))}`)
  el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
}
