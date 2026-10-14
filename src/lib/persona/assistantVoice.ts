// Catches a persona sliding into generic assistant voice or sycophancy, so the reply can be rerolled once.

const ASSISTANT_PATTERNS: { label: string; re: RegExp }[] = [
  { label: "I'd be happy to help", re: /\bI('d| would) be (happy|glad|delighted) to (help|assist)\b/i },
  { label: 'Certainly!', re: /(^|[.!?]\s+|["*]\s*)(Certainly|Absolutely|Of course)[!,]/ },
  { label: 'Great question', re: /\b(great|good|excellent|fantastic) question\b/i },
  { label: "You're absolutely right", re: /\byou'?re (absolutely|completely|totally) right\b/i },
  { label: 'I apologize for the confusion', re: /\bI apologi[sz]e for (the|any) (confusion|misunderstanding|inconvenience)\b/i },
  { label: 'Is there anything else', re: /\b(is there )?anything else (I can|you'?d like (me )?to)\b/i },
  { label: 'I hope this helps', re: /\bI hope (this|that) helps\b/i },
  { label: 'feel free to', re: /\bfeel free to (ask|reach out|let me know)\b/i },
  { label: 'As an AI language model', re: /\bas an AI (language )?model\b/i },
  { label: 'I understand how you feel', re: /\bI (completely |totally )?understand (how you feel|your (frustration|concern))\b/i },
  { label: 'How can I assist', re: /\bhow (can|may) I (help|assist) you\b/i },
]

/** The first assistant-voice tell in `text`, if any. */
export function detectAssistantVoice(text: string): string | undefined {
  return ASSISTANT_PATTERNS.find((p) => p.re.test(text))?.label
}

const SELF_HARM_JOKE_RE = /\b(kill (yo)?ur ?self|kys|unalive (yo)?ur ?self|go die|trying to (kill|off) (yo)?ur ?self)\b/i

/** A throwaway suicide/self-harm line aimed at the player, which a comedic persona must never use. */
export function detectSelfHarmJoke(text: string): string | undefined {
  return text.match(SELF_HARM_JOKE_RE)?.[0]
}

export function selfHarmJokeCorrection(charName: string, phrase: string): string {
  return `${charName}'s last attempt used "${phrase}" as a joke. Rewrite it with no reference to suicide, self-harm or dying; keep the same energy with a different jab.`
}

export function assistantVoiceCorrection(charName: string, label: string): string {
  return `${charName}'s last attempt slipped into generic assistant voice ("${label}"). Rewrite it fully in ${charName}'s own voice: no customer-service phrasing, no agreeing just to please, no offers of further help.`
}
