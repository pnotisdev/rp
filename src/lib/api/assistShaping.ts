// Resolves the prompt shaping (instruct template + reasoning headroom) that background AI calls need on strict-template models.

import { instructTemplatesApi } from '@/lib/api/client'
import type { AssistShaping } from '@/lib/api/generateWithTimeout'
import { getInstructTemplate, resolveInstructTemplate } from '@/lib/prompt/instructTemplates'
import { useSettingsStore } from '@/lib/store/useSettingsStore'

export async function resolveAssistShaping(timeoutMs?: number): Promise<AssistShaping> {
  const s = useSettingsStore.getState()
  const template =
    s.chatBackend === 'openai-compatible' ? getInstructTemplate('plain-chat') : resolveInstructTemplate(s.instructTemplateId, await instructTemplatesApi.list())
  return { reasoningReserve: s.reasoningTokenReserve, template, timeoutMs }
}
