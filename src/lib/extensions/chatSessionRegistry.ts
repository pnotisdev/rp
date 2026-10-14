// Lets extensions reach the live chat session (to send a message) while a chat window is mounted.

export interface ChatSessionHandle {
  chatId: string
  sendUserMessage: (text: string) => Promise<void>
  isGenerating: () => boolean
}

let current: ChatSessionHandle | null = null

export function setChatSession(handle: ChatSessionHandle | null): void {
  current = handle
}

export function getChatSession(): ChatSessionHandle | null {
  return current
}
