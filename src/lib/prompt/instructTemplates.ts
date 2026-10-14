export interface InstructTemplate {
  id: string
  name: string
  systemPrefix: string
  systemSuffix: string
  userPrefix: string
  userSuffix: string
  assistantPrefix: string
  assistantSuffix: string
  /** Replaces `assistantPrefix` only on the generation cue (the open turn the model continues), not on past turns — for a format whose own template ends the prompt differently from how finished turns read. */
  assistantCuePrefix?: string
  stopSequences: string[]
  /** Wraps names (e.g. "### {name}:") — {name} is substituted per-turn. */
  namesInPrompt: boolean
}

/** The turn-format families a KoboldCpp user realistically runs. */
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
    // Gemma has no system role — its fixed block rides in an opening user turn (builder.ts applies systemPrefix/systemSuffix).
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
    id: 'gemma4',
    name: 'Gemma 4',
    // Gemma 4: `<|turn>`/`<turn|>` tokens, a real system role, and an empty thought channel on the reply cue only.
    systemPrefix: '<|turn>system\n',
    systemSuffix: '<turn|>\n',
    userPrefix: '<|turn>user\n{name}: ',
    userSuffix: '<turn|>\n',
    assistantPrefix: '<|turn>model\n{name}: ',
    assistantSuffix: '<turn|>\n',
    assistantCuePrefix: '<|turn>model\n<|channel>thought\n<channel|>{name}: ',
    stopSequences: ['<turn|>', '<|turn>'],
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
    name: 'Mistral v1-v3',
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

  // The rest follow SillyTavern's own instruct presets (default/content/presets/instruct).
  {
    id: 'llama4',
    name: 'Llama 4',
    systemPrefix: '<|header_start|>system<|header_end|>\n\n',
    systemSuffix: '<|eot|>',
    userPrefix: '<|header_start|>user<|header_end|>\n\n{name}: ',
    userSuffix: '<|eot|>',
    assistantPrefix: '<|header_start|>assistant<|header_end|>\n\n{name}: ',
    assistantSuffix: '<|eot|>',
    stopSequences: ['<|eot|>', '<|header_start|>'],
    namesInPrompt: true,
  },
  {
    id: 'llama3-names',
    name: 'Llama 3 (names in the header)',
    systemPrefix: '<|start_header_id|>system<|end_header_id|>\n\n',
    systemSuffix: '<|eot_id|>',
    userPrefix: '<|start_header_id|>{name}<|end_header_id|>\n\n',
    userSuffix: '<|eot_id|>',
    assistantPrefix: '<|start_header_id|>{name}<|end_header_id|>\n\n',
    assistantSuffix: '<|eot_id|>',
    stopSequences: ['<|eot_id|>', '<|start_header_id|>', '<|end_of_text|>'],
    namesInPrompt: true,
  },
  {
    id: 'chatml-names',
    name: 'ChatML (names in the header)',
    systemPrefix: '<|im_start|>system\n',
    systemSuffix: '<|im_end|>\n',
    userPrefix: '<|im_start|>{name}\n',
    userSuffix: '<|im_end|>\n',
    assistantPrefix: '<|im_start|>{name}\n',
    assistantSuffix: '<|im_end|>\n',
    stopSequences: ['<|im_end|>', '<|im_start|>'],
    namesInPrompt: true,
  },
  {
    id: 'glm4',
    name: 'GLM-4',
    systemPrefix: '[gMASK]<sop><|system|>\n',
    systemSuffix: '',
    userPrefix: '<|user|>\n{name}: ',
    userSuffix: '',
    assistantPrefix: '<|assistant|>\n{name}: ',
    assistantSuffix: '',
    stopSequences: ['<|user|>', '<|observation|>', '<|endoftext|>'],
    namesInPrompt: true,
  },
  {
    id: 'harmony',
    name: 'OpenAI Harmony (gpt-oss)',
    // The reply is written straight into the `final` channel, so the model skips its reasoning.
    systemPrefix: '<|start|>system<|message|>',
    systemSuffix: '<|end|>',
    userPrefix: '<|start|>user<|message|>{name}: ',
    userSuffix: '<|end|>',
    assistantPrefix: '<|start|>assistant<|channel|>final<|message|>{name}: ',
    assistantSuffix: '<|end|>',
    stopSequences: ['<|end|>', '<|return|>', '<|start|>'],
    namesInPrompt: true,
  },
  {
    id: 'harmony-thinking',
    name: 'OpenAI Harmony (gpt-oss, thinking)',
    // The cue stops after `assistant`, so the model opens its own analysis channel; the app strips it from the reply.
    systemPrefix: '<|start|>system<|message|>',
    systemSuffix: '<|end|>',
    userPrefix: '<|start|>user<|message|>{name}: ',
    userSuffix: '<|end|>',
    assistantPrefix: '<|start|>assistant<|channel|>final<|message|>{name}: ',
    assistantSuffix: '<|end|>',
    assistantCuePrefix: '<|start|>assistant',
    stopSequences: ['<|return|>', '<|start|>user'],
    namesInPrompt: true,
  },
  {
    id: 'kimi-k2',
    name: 'Moonshot AI (Kimi K2)',
    systemPrefix: '<|im_system|>system<|im_middle|>',
    systemSuffix: '<|im_end|>',
    userPrefix: '<|im_user|>user<|im_middle|>{name}: ',
    userSuffix: '<|im_end|>',
    assistantPrefix: '<|im_assistant|>assistant<|im_middle|>{name}: ',
    assistantSuffix: '<|im_end|>',
    stopSequences: ['<|im_end|>', '<|im_user|>'],
    namesInPrompt: true,
  },
  {
    id: 'tulu',
    name: 'Tulu',
    systemPrefix: '<|system|>\n',
    systemSuffix: '\n',
    userPrefix: '<|user|>\n{name}: ',
    userSuffix: '\n',
    assistantPrefix: '<|assistant|>\n{name}: ',
    assistantSuffix: '<|end_of_text|>\n',
    stopSequences: ['<|end_of_text|>', '<|user|>'],
    namesInPrompt: true,
  },
  {
    id: 'dots1',
    name: 'dots.llm1',
    systemPrefix: '<|system|>\n',
    systemSuffix: '<|endofsystem|>\n',
    userPrefix: '<|userprompt|>\n{name}: ',
    userSuffix: '<|endofuserprompt|>\n',
    assistantPrefix: '<|response|>\n{name}: ',
    assistantSuffix: '<|endofresponse|>\n',
    stopSequences: ['<|endofresponse|>', '<|userprompt|>'],
    namesInPrompt: true,
  },
  {
    id: 'mistral-v3-tekken',
    name: 'Mistral v3 (Tekken, Nemo)',
    systemPrefix: '[INST]',
    systemSuffix: '\n\n',
    userPrefix: '[INST]{name}: ',
    userSuffix: '[/INST]',
    assistantPrefix: '{name}: ',
    assistantSuffix: '</s>',
    stopSequences: ['[INST]', '</s>'],
    namesInPrompt: true,
  },
  {
    id: 'mistral-v7-tekken',
    name: 'Mistral v7 (Tekken, no spaces)',
    systemPrefix: '[SYSTEM_PROMPT]',
    systemSuffix: '[/SYSTEM_PROMPT]',
    userPrefix: '[INST]{name}: ',
    userSuffix: '[/INST]',
    assistantPrefix: '{name}: ',
    assistantSuffix: '</s>',
    stopSequences: ['[INST]', '[SYSTEM_PROMPT]', '</s>'],
    namesInPrompt: true,
  },
  {
    id: 'llama2',
    name: 'Llama 2 Chat',
    systemPrefix: '[INST] <<SYS>>\n',
    systemSuffix: '\n<</SYS>> Understood. [/INST]',
    userPrefix: '[INST] {name}: ',
    userSuffix: ' [/INST]\n',
    assistantPrefix: '{name}: ',
    assistantSuffix: '\n',
    stopSequences: ['[INST]', '</s>'],
    namesInPrompt: true,
  },
  {
    id: 'koala',
    name: 'Koala',
    systemPrefix: 'BEGINNING OF CONVERSATION: ',
    systemSuffix: '\n',
    userPrefix: 'USER: {name}: ',
    userSuffix: ' ',
    assistantPrefix: 'GPT: {name}: ',
    assistantSuffix: '</s>',
    stopSequences: ['USER:', '</s>'],
    namesInPrompt: true,
  },
  {
    id: 'vicuna-1-0',
    name: 'Vicuna 1.0 (### Human)',
    systemPrefix: '',
    systemSuffix: '\n\n',
    userPrefix: '### Human:\n{name}: ',
    userSuffix: '\n',
    assistantPrefix: '### Assistant:\n{name}: ',
    assistantSuffix: '\n',
    stopSequences: ['### Human:', '### Assistant:'],
    namesInPrompt: true,
  },
  {
    id: 'wizardlm',
    name: 'WizardLM',
    systemPrefix: '',
    systemSuffix: '\n\n',
    userPrefix: '{name}: ',
    userSuffix: '\n\n',
    assistantPrefix: '### Response:\n{name}: ',
    assistantSuffix: '</s>',
    stopSequences: ['### Response:', '</s>'],
    namesInPrompt: true,
  },
  {
    id: 'synthia',
    name: 'Synthia',
    systemPrefix: 'SYSTEM: ',
    systemSuffix: '\n',
    userPrefix: 'USER: {name}: ',
    userSuffix: '\n',
    assistantPrefix: 'ASSISTANT: {name}: ',
    assistantSuffix: '\n',
    stopSequences: ['USER:', 'SYSTEM:'],
    namesInPrompt: true,
  },
  {
    id: 'openorca-openchat',
    name: 'OpenOrca / OpenChat',
    systemPrefix: '',
    systemSuffix: '<|end_of_turn>',
    userPrefix: '\nUser: {name}: ',
    userSuffix: '<|end_of_turn>',
    assistantPrefix: '\nAssistant: {name}: ',
    assistantSuffix: '<|end_of_turn>',
    stopSequences: ['<|end_of_turn>', '\nUser:'],
    namesInPrompt: true,
  },
  {
    id: 'lightning',
    name: 'Lightning 1.1',
    systemPrefix: 'Below is an instruction that describes a task. Write a response that appropriately completes the request.\n\n### Instruction:\n',
    systemSuffix: '\n\n',
    userPrefix: '### Instruction:\n{name}: ',
    userSuffix: '\n\n',
    assistantPrefix: '### Response:\n{name}: ',
    assistantSuffix: '\n\n',
    assistantCuePrefix: '### Response: (length = unlimited)\n{name}: ',
    stopSequences: ['### Instruction:'],
    namesInPrompt: true,
  },
  {
    id: 'libra',
    name: 'Libra-32B',
    systemPrefix: '### Instruction:\n',
    systemSuffix: '\n',
    userPrefix: '{name}: ',
    userSuffix: '\n',
    assistantPrefix: '{name}: ',
    assistantSuffix: '\n',
    assistantCuePrefix: '\n### Response:\n{name}: ',
    stopSequences: ['### Instruction:'],
    namesInPrompt: true,
  },
  {
    id: 'koboldcpp-adapter',
    name: 'KoboldCpp adapter tags',
    // KoboldCpp swaps these tags for the turn markers of the model's loaded adapter.
    systemPrefix: '{{[SYSTEM]}}',
    systemSuffix: '{{[SYSTEM_END]}}',
    userPrefix: '{{[INPUT]}}{name}: ',
    userSuffix: '{{[INPUT_END]}}',
    assistantPrefix: '{{[OUTPUT]}}{name}: ',
    assistantSuffix: '{{[OUTPUT_END]}}',
    stopSequences: [],
    namesInPrompt: true,
  },
]

export function getInstructTemplate(id: string): InstructTemplate {
  return BUILTIN_INSTRUCT_TEMPLATES.find((t) => t.id === id) ?? BUILTIN_INSTRUCT_TEMPLATES[0]
}

/** Wraps a flat, single-shot judge/assist prompt (relationship tracker, objective tracking, director pick, ...) in the active… */
export function wrapAssistPrompt(prompt: string, template: InstructTemplate): string {
  const openingCue = (template.assistantCuePrefix ?? template.assistantPrefix).replace('{name}: ', '').replace('{name}', 'assistant')
  return `${template.systemPrefix}${prompt}${template.systemSuffix}${openingCue}`
}

/** Same lookup as `getInstructTemplate` */
export function resolveInstructTemplate(id: string, customTemplates: InstructTemplate[] = []): InstructTemplate {
  return (
    customTemplates.find((t) => t.id === id) ??
    BUILTIN_INSTRUCT_TEMPLATES.find((t) => t.id === id) ??
    BUILTIN_INSTRUCT_TEMPLATES[0]
  )
}

/** Best-effort map from a model's own chat template (KoboldCpp `/props` → `chat_template`, the GGUF's embedded Jinja string) to one… */
export function detectInstructTemplateId(chatTemplate: string | null | undefined): string | null {
  if (!chatTemplate || typeof chatTemplate !== 'string') return null
  const t = chatTemplate
  // Gemma 4's `<|turn>` markers are checked first: its template doesn't contain Gemma's older `<start_of_turn>`.
  if ((t.includes('<|turn>') && t.includes('<turn|>')) || (/gemma[\s-]?4/i.test(t) && !t.includes('<start_of_turn>'))) return 'gemma4'
  if (t.includes('<|header_start|>')) return 'llama4'
  if (t.includes('<|start|>') && t.includes('<|message|>')) return 'harmony'
  if (t.includes('<|im_user|>')) return 'kimi-k2'
  if (t.includes('[gMASK]')) return 'glm4'
  if (t.includes('<|userprompt|>')) return 'dots1'
  if (t.includes('<start_of_turn>') || /\bgemma\b/i.test(t)) return 'gemma'
  if (t.includes('<|start_header_id|>') || /\bllama[-\s]?3\b/i.test(t)) return 'llama3'
  if (t.includes('<|im_start|>') || /\bchat\s?ml\b/i.test(t)) return 'chatml'
  if (t.includes('<|START_OF_TURN_TOKEN|>') || /\bcommand[-\s]?r\b/i.test(t)) return 'command-r'
  if (t.includes('｜Assistant｜') || /\bdeepseek\b/i.test(t)) return 'deepseek'
  if (t.includes('[SYSTEM_PROMPT]')) return 'mistral-v7'
  if (t.includes('<|end|>') && t.includes('<|user|>') && t.includes('<|assistant|>')) return 'phi'
  // Tulu shares Phi's `<|user|>` markers but has no `<|end|>`.
  if (t.includes('<|user|>') && t.includes('<|assistant|>') && !t.includes('<|model|>')) return 'tulu'
  if (t.includes('<|model|>') || /\bmetharme\b/i.test(t)) return 'metharme'
  if (t.includes('### Instruction:') || /\balpaca\b/i.test(t)) return 'alpaca'
  if (t.includes('<<SYS>>')) return 'llama2'
  // `[INST]` covers Mistral v1-v3 (Llama 2 is caught above).
  if (t.includes('[INST]')) return 'mistral'
  if (/\bASSISTANT:\s/.test(t) || /\bvicuna\b/i.test(t)) return 'vicuna'
  return null
}
