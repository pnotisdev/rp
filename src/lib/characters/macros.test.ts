import { beforeEach, describe, expect, it } from 'vitest'
import { getInstructTemplate } from '@/lib/prompt/instructTemplates'
import { substituteMacros, type MacroContext } from './macros'
import { formatDate, humanDuration, resetMacroVariables, rollDice, seededRandom } from './macroSupport'

const NOW = new Date(2026, 9, 15, 21, 5, 9)

const ctx = (over: Partial<MacroContext> = {}): MacroContext => ({
  charName: 'Mira',
  userName: 'Kai',
  now: NOW,
  random: () => 0,
  variables: { local: {}, global: {} },
  ...over,
})

const sub = (text: string, over: Partial<MacroContext> = {}) => substituteMacros(text, ctx(over))

beforeEach(() => resetMacroVariables())

describe('the basics', () => {
  it('fills names, case-insensitively, and leaves plain text alone', () => {
    expect(sub('{{char}} greets {{USER}}.')).toBe('Mira greets Kai.')
    expect(sub('no macros here')).toBe('no macros here')
    expect(sub('')).toBe('')
  })

  it('keeps an unknown macro as written but resolves the ones inside it', () => {
    expect(sub('{{mystery}}')).toBe('{{mystery}}')
    expect(sub('{{mystery::{{char}}}}')).toBe('{{mystery::Mira}}')
    expect(sub('{{ not a macro }}')).toBe('{{ not a macro }}')
  })

  it('treats a third opening brace as text', () => {
    expect(sub('{{{char}}}')).toBe('{Mira}')
  })

  it('leaves an unclosed macro alone', () => {
    expect(sub('a {{char')).toBe('a {{char')
  })

  it('provides newline and space with counts, and noop', () => {
    expect(sub('a{{newline}}b{{newline::2}}c')).toBe('a\nb\n\nc')
    expect(sub('a{{space::3}}b{{noop}}c')).toBe('a   bc')
  })

  it('drops comments, including block comments', () => {
    expect(sub('a{{// note}}b')).toBe('ab')
    expect(sub('a{{//}}hidden\ntext{{///}}b')).toBe('ab')
  })

  it('reverses text', () => {
    expect(sub('{{reverse::Mira}}')).toBe('ariM')
    expect(sub('{{reverse}}abc{{/reverse}}')).toBe('cba')
  })
})

describe('card and persona values', () => {
  const card = { description: 'Tall.', personality: 'Blunt.', scenario: 'A lab.', mes_example: 'ex', creator_notes: 'notes', system_prompt: 'sys', post_history_instructions: 'post', first_mes: 'Hello.', alternate_greetings: ['Hi there.'], character_version: '1.2' }

  it('reads the card fields, with their long and short names', () => {
    const over = { card, persona: 'A student.' }
    expect(sub('{{description}}|{{charDescription}}|{{personality}}|{{scenario}}', over)).toBe('Tall.|Tall.|Blunt.|A lab.')
    expect(sub('{{persona}}|{{mesExamples}}|{{charPrompt}}|{{charInstruction}}|{{creatorNotes}}|{{charVersion}}', over)).toBe('A student.|ex|sys|post|notes|1.2')
  })

  it('picks a greeting by index', () => {
    expect(sub('{{greeting}}|{{greeting::0}}|{{greeting::1}}|{{charFirstMessage::2}}', { card })).toBe('Hello.|Hello.|Hi there.|')
  })

  it('gives empty text for fields it does not have', () => {
    expect(sub('[{{description}}][{{persona}}]')).toBe('[][]')
  })

  it('lists group members and everyone but the speaker', () => {
    const over = { participants: ['Oren', 'Pia'] }
    expect(sub('{{group}}|{{notChar}}', over)).toBe('Mira, Oren, Pia|Kai, Oren, Pia')
  })

  it('passes model, token limits and the system prompt through', () => {
    const over = { model: 'gemma-4', maxContext: 8192, maxResponse: 512, systemPrompt: 'Be kind.' }
    expect(sub('{{model}} {{maxContext}} {{maxResponse}} {{maxPrompt}} {{systemPrompt}}', over)).toBe('gemma-4 8192 512 7680 Be kind.')
  })
})

describe('chat values', () => {
  const history = [
    { role: 'char' as const, text: 'Welcome.' },
    { role: 'user' as const, text: 'Thanks.', at: NOW.getTime() - 7_500_000 },
    { role: 'char' as const, text: 'Anytime.' },
  ]

  it('reads the latest messages of each side', () => {
    expect(sub('{{lastMessage}}|{{lastUserMessage}}|{{lastCharMessage}}', { history })).toBe('Anytime.|Thanks.|Anytime.')
    expect(sub('{{lastMessageId}} {{allChatRange}} {{firstDisplayedMessageId}}', { history })).toBe('2 0-2 0')
  })

  it('is empty for an empty chat', () => {
    expect(sub('[{{lastMessage}}][{{lastMessageId}}][{{allChatRange}}]')).toBe('[][][]')
  })

  it('says how long it has been since the last user message', () => {
    expect(sub('{{idleDuration}}', { history })).toBe('2 hours, 5 minutes')
  })
})

describe('time values', () => {
  it('formats the clock and the calendar', () => {
    expect(sub('{{weekday}} {{isotime}} {{isodate}}')).toBe('Thursday 21:05 2026-10-15')
    expect(sub('{{datetimeformat::dddd, MMMM D YYYY [at] h:mm A}}')).toBe('Thursday, October 15 2026 at 9:05 PM')
  })

  it('shifts to a UTC offset', () => {
    const utc = new Date(NOW.getTime() + NOW.getTimezoneOffset() * 60000)
    const expected = new Date(utc.getTime() + 2 * 3600000).toLocaleTimeString()
    expect(sub('{{time::UTC+2}}')).toBe(expected)
    expect(sub('{{time_UTC+2}}')).toBe(expected)
  })

  it('subtracts two times', () => {
    expect(sub('{{timeDiff::2026-10-15T10:00:00::2026-10-15T08:30:00}}')).toBe('1 hour, 30 minutes')
    expect(sub('{{timeDiff::nope::2026-10-15}}')).toBe('')
  })

  it('formats and measures with the helpers it is built on', () => {
    expect(formatDate(NOW, 'YY/MM/DD HH:mm:ss')).toBe('26/10/15 21:05:09')
    expect(humanDuration(0)).toBe('0 seconds')
    expect(humanDuration(90_000)).toBe('1 minute, 30 seconds')
  })
})

describe('random, pick and roll', () => {
  it('picks from a list in every spelling', () => {
    expect(sub('{{random::a::b::c}}')).toBe('a')
    expect(sub('{{random:a,b,c}}')).toBe('a')
    expect(sub('{{random a,b,c}}')).toBe('a')
    expect(sub('{{random::a::b}}', { random: () => 0.99 })).toBe('b')
    expect(sub('{{random:a\\,x,b}}')).toBe('a,x')
  })

  it('keeps a pick the same for the same text, chat and position', () => {
    const text = 'a {{pick::red::green::blue::black::white::pink}} b {{pick::red::green::blue::black::white::pink}}'
    expect(sub(text, { chatId: 'c1' })).toBe(sub(text, { chatId: 'c1' }))
    const outcomes = new Set(Array.from({ length: 12 }, (_, i) => sub(text, { chatId: `chat-${i}` })))
    expect(outcomes.size).toBeGreaterThan(1)
  })

  it('rolls dice', () => {
    expect(sub('{{roll::1d6}}', { random: () => 0.999 })).toBe('6')
    expect(sub('{{roll:2d6+3}}', { random: () => 0 })).toBe('5')
    expect(sub('{{roll 20}}', { random: () => 0 })).toBe('1')
    expect(sub('{{roll::banana}}')).toBe('')
    expect(rollDice('1d0', () => 0)).toBeNull()
  })

  it('has a deterministic generator for picks', () => {
    const a = seededRandom(7)
    const b = seededRandom(7)
    expect([a(), a()]).toEqual([b(), b()])
  })
})

describe('trim', () => {
  it('removes the newlines around a bare trim', () => {
    expect(sub('a\n\n{{trim}}\n\nb')).toBe('ab')
  })

  it('trims a block', () => {
    expect(sub('[{{trim}}  hi  {{/trim}}]')).toBe('[hi]')
  })
})

describe('if and else', () => {
  it('shows a block only when the condition holds', () => {
    expect(sub('{{if description}}has{{/if}}', { card: { description: 'x' } })).toBe('has')
    expect(sub('{{if description}}has{{/if}}')).toBe('')
  })

  it('takes an else branch', () => {
    expect(sub('{{if description}}yes{{else}}no{{/if}}')).toBe('no')
    expect(sub('{{if description}}yes{{else}}no{{/if}}', { card: { description: 'x' } })).toBe('yes')
  })

  it('inverts with !', () => {
    expect(sub('{{if !personality}}none{{/if}}')).toBe('none')
    expect(sub('{{if !personality}}none{{/if}}', { card: { personality: 'p' } })).toBe('')
  })

  it('reads false, off, 0 and empty as false', () => {
    for (const v of ['false', 'off', '0', 'FALSE']) expect(sub(`{{if ${v}}}yes{{else}}no{{/if}}`)).toBe('no')
    expect(sub('{{if anything}}yes{{else}}no{{/if}}')).toBe('yes')
  })

  it('has an inline form', () => {
    expect(sub('{{if 1::shown}}')).toBe('shown')
    expect(sub('{{if 0::shown}}')).toBe('')
  })

  it('nests, and resolves only the branch it takes', () => {
    const text = '{{if a}}{{if 0}}x{{else}}inner{{/if}}{{else}}outer{{/if}}'
    expect(sub(text)).toBe('inner')
    expect(sub('{{if 0}}{{setvar::seen::yes}}{{/if}}{{getvar::seen}}')).toBe('')
  })

  it('keeps whitespace with the # flag and trims without it', () => {
    expect(sub('[{{if 1}}\n  a \n{{/if}}]')).toBe('[a]')
    expect(sub('[{{#if 1}}\n a \n{{/if}}]')).toBe('[\n a \n]')
  })

  it('reads variable shorthands as the condition', () => {
    expect(sub('{{setvar::flag::1}}{{if .flag}}on{{else}}off{{/if}}')).toBe('on')
    expect(sub('{{setglobalvar::g::0}}{{if $g}}on{{else}}off{{/if}}')).toBe('off')
  })

  it('reads another macro as the condition', () => {
    expect(sub('{{if lastMessage}}talked{{else}}quiet{{/if}}', { history: [{ role: 'user', text: 'hi' }] })).toBe('talked')
  })
})

describe('variables', () => {
  it('returns the new value from incvar and decvar', () => {
    expect(sub('{{setvar::n::3}}[{{incvar::n}}][{{incvar::n}}][{{decvar::n}}][{{getvar::n}}]')).toBe('[4][5][4][4]')
  })

  it('adds numbers and appends text', () => {
    expect(sub('{{setvar::n::3}}{{addvar::n::4}}{{getvar::n}}')).toBe('7')
    expect(sub('{{setvar::s::foo}}{{addvar::s::bar}}{{getvar::s}}')).toBe('foobar')
    expect(sub('{{addvar::fresh::2}}{{getvar::fresh}}')).toBe('2')
  })

  it('deletes', () => {
    expect(sub('{{setvar::x::1}}{{deletevar::x}}{{hasvar::x}}')).toBe('false')
    expect(sub('{{setvar::x::1}}{{flushvar::x}}[{{getvar::x}}]')).toBe('[]')
  })

  it('keeps local and global variables apart', () => {
    expect(sub('{{setvar::a::local}}{{setglobalvar::a::global}}{{getvar::a}} {{getglobalvar::a}}')).toBe('local global')
    expect(sub('{{incglobalvar::g}}{{incglobalvar::g}}{{globalvarexists::g}}')).toBe('12true')
  })

  it('sets a value from a block', () => {
    expect(sub('{{setvar::note}}  some text  {{/setvar}}[{{getvar::note}}]')).toBe('[some text]')
  })

  it('stores values in a JSON object by key or index', () => {
    expect(sub('{{setvarkey::o::color::red}}{{getvarkey::o::color}}')).toBe('red')
    expect(sub('{{setvarkey::list::0::a}}{{setvarkey::list::1::b}}{{getvarkey::list::1}}')).toBe('b')
    expect(sub('{{getvarkey::nothing::x}}')).toBe('')
  })

  it('persists across calls when it uses the shared store', () => {
    const shared = { charName: 'Mira', userName: 'Kai', now: NOW, chatId: 'chat-1' }
    substituteMacros('{{setvar::mood::cheerful}}{{setglobalvar::world::harbor}}', shared)
    expect(substituteMacros('{{getvar::mood}}', shared)).toBe('cheerful')
    expect(substituteMacros('{{getvar::mood}}', { ...shared, chatId: 'chat-2' })).toBe('')
    expect(substituteMacros('{{getglobalvar::world}}', { ...shared, chatId: 'chat-2' })).toBe('harbor')
  })
})

describe('variable shorthands', () => {
  it('reads and sets', () => {
    expect(sub('{{.x = 5}}{{.x}}')).toBe('5')
    expect(sub('{{$g = hi}}{{$g}}')).toBe('hi')
    expect(sub('{{.missing}}')).toBe('')
  })

  it('steps, adds and subtracts', () => {
    expect(sub('{{.n = 1}}{{.n++}}{{.n++}}|{{.n--}}|{{.n}}')).toBe('23|2|2')
    expect(sub('{{.n = 10}}{{.n += 5}}{{.n -= 3}}{{.n}}')).toBe('12')
    expect(sub('{{.s = a}}{{.s += b}}{{.s}}')).toBe('ab')
  })

  it('falls back with ?? and ||', () => {
    expect(sub('{{.a ?? dflt}}|{{.a = x}}{{.a ?? dflt}}')).toBe('dflt|x')
    expect(sub('{{.e = }}{{.e || dflt}}|{{.f = 0}}{{.f || dflt}}')).toBe('dflt|dflt')
  })

  it('assigns a default only when empty', () => {
    expect(sub('{{.a ??= one}}{{.a ??= two}}{{.a}}')).toBe('one')
    expect(sub('{{.b = 0}}{{.b ||= yes}}{{.b}}')).toBe('yes')
  })

  it('compares', () => {
    expect(sub('{{.n = 5}}{{.n == 5}} {{.n != 5}} {{.n > 3}} {{.n >= 6}} {{.n < 9}} {{.n <= 4}}')).toBe('true false true false true false')
  })

  it('resolves macros in the value', () => {
    expect(sub('{{.who = {{char}}}}{{.who}}')).toBe('Mira')
  })
})

describe('other values', () => {
  it('collects banned words and returns nothing', () => {
    const banned: string[] = []
    expect(sub('a{{banned::delve}}b{{banned::"tapestry"}}', { banned })).toBe('ab')
    expect(banned).toEqual(['delve', 'tapestry'])
  })

  it('returns a world info outlet', () => {
    expect(sub('{{outlet::notes}}|{{outlet::none}}', { outlets: { notes: 'N' } })).toBe('N|')
  })

  it('reports whether an extension is on', () => {
    expect(sub('{{hasExtension::x}}')).toBe('false')
    expect(sub('{{hasExtension::x}}', { hasExtension: (n) => n === 'x' })).toBe('true')
  })

  it('exposes the instruct template markers without the name placeholder', () => {
    const instruct = getInstructTemplate('chatml')
    expect(sub('{{instructUserPrefix}}|{{instructAssistantSuffix}}|{{instructStop}}', { instruct })).toBe('<|im_start|>user\n|<|im_end|>\n|<|im_end|>')
  })

  it('passes the current input, generation type and original through', () => {
    expect(sub('{{input}}|{{lastGenerationType}}|{{original}}', { input: 'typed', generationType: 'swipe', original: 'base' })).toBe('typed|swipe|base')
  })
})
