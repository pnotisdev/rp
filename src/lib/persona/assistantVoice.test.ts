import { describe, expect, it } from 'vitest'
import { detectAssistantVoice, detectSelfHarmJoke } from './assistantVoice'

describe('detectAssistantVoice', () => {
  it('flags customer-service phrasing', () => {
    expect(detectAssistantVoice("Sure! I'd be happy to help with that.")).toBe("I'd be happy to help")
    expect(detectAssistantVoice('Certainly! Here is the email.')).toBe('Certainly!')
    expect(detectAssistantVoice("You're absolutely right, I made a mistake.")).toBe("You're absolutely right")
    expect(detectAssistantVoice('Is there anything else I can do?')).toBe('Is there anything else')
  })

  it('catches self-harm idioms used as jokes', () => {
    expect(detectSelfHarmJoke('Did you put enough honey in that tea or are you trying to kill yourself?')).toBe('trying to kill yourself')
    expect(detectSelfHarmJoke('"Skill issue. Kill your darlings, not your tea."')).toBeUndefined()
  })

  it('leaves in-character lines alone', () => {
    expect(detectAssistantVoice('"Ugh. Fine. Assistant mode, but I\'m wearing it ironically."')).toBeUndefined()
    expect(detectAssistantVoice('"I\'m an AI on your graphics card, obviously."')).toBeUndefined()
    expect(detectAssistantVoice('"Absolutely not."')).toBeUndefined()
  })
})
