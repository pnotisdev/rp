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
    id: 'alpaca',
    name: 'Alpaca',
    systemPrefix: '',
    systemSuffix: '\n\n',
    userPrefix: '### Instruction:\n',
    userSuffix: '\n\n',
    assistantPrefix: '### Response:\n',
    assistantSuffix: '\n\n',
    stopSequences: ['### Instruction:'],
    namesInPrompt: false,
  },
  {
    id: 'vicuna',
    name: 'Vicuna',
    systemPrefix: '',
    systemSuffix: '\n\n',
    userPrefix: 'USER: ',
    userSuffix: '\n',
    assistantPrefix: 'ASSISTANT: ',
    assistantSuffix: '\n',
    stopSequences: ['USER:'],
    namesInPrompt: false,
  },
  {
    id: 'chatml',
    name: 'ChatML',
    systemPrefix: '<|im_start|>system\n',
    systemSuffix: '<|im_end|>\n',
    userPrefix: '<|im_start|>user\n',
    userSuffix: '<|im_end|>\n',
    assistantPrefix: '<|im_start|>assistant\n',
    assistantSuffix: '<|im_end|>\n',
    stopSequences: ['<|im_end|>', '<|im_start|>'],
    namesInPrompt: false,
  },
  {
    id: 'mistral',
    name: 'Mistral / Llama-Instruct',
    systemPrefix: '[INST] ',
    systemSuffix: ' [/INST]\n',
    userPrefix: '[INST] ',
    userSuffix: ' [/INST]',
    assistantPrefix: ' ',
    assistantSuffix: '</s>',
    stopSequences: ['[INST]', '</s>'],
    namesInPrompt: false,
  },
]

export function getInstructTemplate(id: string): InstructTemplate {
  return BUILTIN_INSTRUCT_TEMPLATES.find((t) => t.id === id) ?? BUILTIN_INSTRUCT_TEMPLATES[0]
}
