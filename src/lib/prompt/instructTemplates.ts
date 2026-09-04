export interface InstructTemplate {
  id: string
  name: string
  systemPrefix: string
  systemSuffix: string
  userPrefix: string
  userSuffix: string
  assistantPrefix: string
  assistantSuffix: string
  stopSequences: string[]
  /** Wraps names (e.g. "### {name}:") — {name} is substituted per-turn. */
  namesInPrompt: boolean
}

/**
 * The turn-format families a KoboldCpp user realistically runs. Sequences taken from SillyTavern's
 * own instruct presets so they match what the model was actually trained on — the single most
 * common cause of a model that rambles, breaks character, leaks instructions, or never stops is
 * feeding it the wrong ones (see `detectInstructTemplateId` and the Settings → Connection nudge).
 *
 * Every structured format carries a `{name}: ` speaker prefix and `namesInPrompt: true`, matching
 * SillyTavern's default `names_behavior: "force"` — a roleplay model tracks who is speaking far
 * better with the names in the turn than without, and `cleanModelOutput` strips the echo if the
 * model repeats its own name back. The long tail of rarer formats (WizardLM, Koala, Mistral-Tekken
 * variants, …) is handled by importing a SillyTavern preset file rather than shipped here.
 */
export const BUILTIN_INSTRUCT_TEMPLATES: InstructTemplate[] = [
  {
    id: 'plain-chat',
    name: 'Plain Chat (name-prefixed)',
    systemPrefix: '',
    systemSuffix: '\n',
    userPrefix: '{name}: ',
    userSuffix: '\n',
    assistantPrefix: '{name}: ',
    assistantSuffix: '\n',
    stopSequences: [],
    namesInPrompt: true,
  },
  {
    id: 'chatml',
    name: 'ChatML',
    systemPrefix: '<|im_start|>system\n',
    systemSuffix: '<|im_end|>\n',
    userPrefix: '<|im_start|>user\n{name}: ',
    userSuffix: '<|im_end|>\n',
    assistantPrefix: '<|im_start|>assistant\n{name}: ',
    assistantSuffix: '<|im_end|>\n',
    stopSequences: ['<|im_end|>', '<|im_start|>'],
    namesInPrompt: true,
  },
  {
    id: 'gemma',
    name: 'Gemma',
    // Gemma has no system role — its fixed block rides in an opening user turn (builder.ts applies
    // systemPrefix/systemSuffix). Two user turns back to back is what SillyTavern's Gemma preset does.
    systemPrefix: '<start_of_turn>user\n',
    systemSuffix: '<end_of_turn>\n',
    userPrefix: '<start_of_turn>user\n{name}: ',
    userSuffix: '<end_of_turn>\n',
    assistantPrefix: '<start_of_turn>model\n{name}: ',
    assistantSuffix: '<end_of_turn>\n',
    stopSequences: ['<end_of_turn>', '<start_of_turn>'],
    namesInPrompt: true,
  },
  {
    id: 'llama3',
    name: 'Llama 3',
    systemPrefix: '<|start_header_id|>system<|end_header_id|>\n\n',
    systemSuffix: '<|eot_id|>',
    userPrefix: '<|start_header_id|>user<|end_header_id|>\n\n{name}: ',
    userSuffix: '<|eot_id|>',
    assistantPrefix: '<|start_header_id|>assistant<|end_header_id|>\n\n{name}: ',
    assistantSuffix: '<|eot_id|>',
    stopSequences: ['<|eot_id|>', '<|start_header_id|>', '<|end_of_text|>'],
    namesInPrompt: true,
  },
  {
    id: 'mistral',
    name: 'Mistral v1–v3',
    systemPrefix: '[INST] ',
    systemSuffix: '\n\n',
    userPrefix: '[INST] {name}: ',
    userSuffix: ' [/INST]',
    assistantPrefix: ' {name}: ',
    assistantSuffix: '</s>',
    stopSequences: ['[INST]', '</s>'],
    namesInPrompt: true,
  },
  {
    id: 'mistral-v7',
    name: 'Mistral v7 (Tekken)',
    systemPrefix: '[SYSTEM_PROMPT] ',
    systemSuffix: '[/SYSTEM_PROMPT]',
    userPrefix: '[INST] {name}: ',
    userSuffix: '[/INST]',
    assistantPrefix: ' {name}: ',
    assistantSuffix: '</s>',
    stopSequences: ['[INST]', '[SYSTEM_PROMPT]', '</s>'],
    namesInPrompt: true,
  },
  {
    id: 'command-r',
    name: 'Command R',
    systemPrefix: '<|START_OF_TURN_TOKEN|><|SYSTEM_TOKEN|>',
    systemSuffix: '<|END_OF_TURN_TOKEN|>',
    userPrefix: '<|START_OF_TURN_TOKEN|><|USER_TOKEN|>{name}: ',
    userSuffix: '<|END_OF_TURN_TOKEN|>',
    assistantPrefix: '<|START_OF_TURN_TOKEN|><|CHATBOT_TOKEN|>{name}: ',
    assistantSuffix: '<|END_OF_TURN_TOKEN|>',
    stopSequences: ['<|END_OF_TURN_TOKEN|>', '<|START_OF_TURN_TOKEN|>'],
    namesInPrompt: true,
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    systemPrefix: '',
    systemSuffix: '\n\n',
    userPrefix: '<｜User｜>{name}: ',
    userSuffix: '',
    assistantPrefix: '<｜Assistant｜>{name}: ',
    assistantSuffix: '<｜end▁of▁sentence｜>',
    stopSequences: ['<｜User｜>', '<｜end▁of▁sentence｜>'],
    namesInPrompt: true,
  },
  {
    id: 'metharme',
    name: 'Metharme / Pygmalion',
    systemPrefix: '<|system|>',
    systemSuffix: '',
    userPrefix: '<|user|>{name}: ',
    userSuffix: '',
    assistantPrefix: '<|model|>{name}: ',
    assistantSuffix: '',
    stopSequences: ['<|user|>', '<|system|>', '</s>'],
    namesInPrompt: true,
  },
  {
    id: 'phi',
    name: 'Phi',
    systemPrefix: '<|system|>\n',
    systemSuffix: '<|end|>\n',
    userPrefix: '<|user|>\n{name}: ',
    userSuffix: '<|end|>\n',
    assistantPrefix: '<|assistant|>\n{name}: ',
    assistantSuffix: '<|end|>\n',
    stopSequences: ['<|end|>', '<|user|>'],
    namesInPrompt: true,
  },
  {
    id: 'alpaca',
    name: 'Alpaca',
    systemPrefix: '',
    systemSuffix: '\n\n',
    userPrefix: '### Instruction:\n{name}: ',
    userSuffix: '\n\n',
    assistantPrefix: '### Response:\n{name}: ',
    assistantSuffix: '\n\n',
    stopSequences: ['### Instruction:'],
    namesInPrompt: true,
  },
  {
    id: 'vicuna',
    name: 'Vicuna',
    systemPrefix: '',
    systemSuffix: '\n\n',
    userPrefix: 'USER: {name}: ',
    userSuffix: '\n',
    assistantPrefix: 'ASSISTANT: {name}: ',
    assistantSuffix: '\n',
    stopSequences: ['USER:', 'ASSISTANT:'],
    namesInPrompt: true,
  },
]

export function getInstructTemplate(id: string): InstructTemplate {
  return BUILTIN_INSTRUCT_TEMPLATES.find((t) => t.id === id) ?? BUILTIN_INSTRUCT_TEMPLATES[0]
}

/**
 * Same lookup as `getInstructTemplate`, but checks a user's saved custom templates first — so a
 * duplicated-and-edited template (Settings -> Generation, or a per-character override) resolves
 * correctly instead of always falling back to a builtin. `customTemplates` accepts
 * `CustomInstructTemplate[]` (types.ts) too, since it's a strict superset of this shape.
 */
export function resolveInstructTemplate(id: string, customTemplates: InstructTemplate[] = []): InstructTemplate {
  return (
    customTemplates.find((t) => t.id === id) ??
    BUILTIN_INSTRUCT_TEMPLATES.find((t) => t.id === id) ??
    BUILTIN_INSTRUCT_TEMPLATES[0]
  )
}

/**
 * Best-effort map from a model's own chat template (KoboldCpp `/props` → `chat_template`, the
 * GGUF's embedded Jinja string) to one of the builtin ids above. Used to warn when the active
 * template doesn't match the loaded model — the single most common cause of a model that rambles,
 * ignores its character, leaks instructions, or never stops (each format has different turn
 * markers, and feeding a model the wrong ones drops it out of its trained conversational mode).
 *
 * Deliberately conservative: returns null rather than guess when nothing recognisable matches, so
 * a "your template may be wrong" nudge only ever fires when we're fairly sure.
 */
export function detectInstructTemplateId(chatTemplate: string | null | undefined): string | null {
  if (!chatTemplate || typeof chatTemplate !== 'string') return null
  const t = chatTemplate
  if (t.includes('<start_of_turn>') || /\bgemma\b/i.test(t)) return 'gemma'
  if (t.includes('<|start_header_id|>') || /\bllama[-\s]?3\b/i.test(t)) return 'llama3'
  if (t.includes('<|im_start|>') || /\bchat\s?ml\b/i.test(t)) return 'chatml'
  if (t.includes('<|START_OF_TURN_TOKEN|>') || /\bcommand[-\s]?r\b/i.test(t)) return 'command-r'
  if (t.includes('｜Assistant｜') || /\bdeepseek\b/i.test(t)) return 'deepseek'
  if (t.includes('[SYSTEM_PROMPT]')) return 'mistral-v7'
  if (t.includes('<|end|>') && t.includes('<|user|>') && t.includes('<|assistant|>')) return 'phi'
  if (t.includes('<|model|>') || /\bmetharme\b/i.test(t)) return 'metharme'
  if (t.includes('### Instruction:') || /\balpaca\b/i.test(t)) return 'alpaca'
  // `[INST]` covers Mistral v1-v3 and Llama-2-chat.
  if (t.includes('[INST]')) return 'mistral'
  if (/\bASSISTANT:\s/.test(t) || /\bvicuna\b/i.test(t)) return 'vicuna'
  return null
}
