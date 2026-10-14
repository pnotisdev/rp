// Connection profiles: a named bundle of the backend, model, instruct template and sampler, to switch between in one click.

import type { ChatBackendId } from '@/lib/api/chatBackend'
import type { ChatCompletionSamplerParams, GenerationParams } from '@/lib/api/types'

/** Everything a profile carries. API keys are included, stored in this browser like the live ones. */
export interface ProfileFields {
  baseUrl: string
  chatBackend: ChatBackendId
  chatBackendBaseUrl: string
  chatBackendApiKey: string
  chatBackendModel: string
  instructTemplateId: string
  sampler: GenerationParams
  chatCompletionSampler: ChatCompletionSamplerParams
  reasoningTokenReserve: number
  reasoningPrefix: string
  reasoningSuffix: string
}

export interface ConnectionProfile extends ProfileFields {
  id: string
  name: string
}

export const PROFILE_KEYS: (keyof ProfileFields)[] = [
  'baseUrl',
  'chatBackend',
  'chatBackendBaseUrl',
  'chatBackendApiKey',
  'chatBackendModel',
  'instructTemplateId',
  'sampler',
  'chatCompletionSampler',
  'reasoningTokenReserve',
  'reasoningPrefix',
  'reasoningSuffix',
]

/** The profile fields out of the full settings. Nested objects are copied so a later edit does not change a saved profile. */
export function profileFieldsOf(state: ProfileFields): ProfileFields {
  return JSON.parse(JSON.stringify(Object.fromEntries(PROFILE_KEYS.map((k) => [k, state[k]])))) as ProfileFields
}

/** True when the live settings are exactly this profile. */
export function profileMatches(profile: ConnectionProfile, state: ProfileFields): boolean {
  return PROFILE_KEYS.every((k) => JSON.stringify(profile[k]) === JSON.stringify(state[k]))
}

/** Adds a profile, or replaces the one with the same name (case-insensitive) and keeps its id. */
export function upsertProfile(list: ConnectionProfile[], name: string, state: ProfileFields, newId: () => string): ConnectionProfile[] {
  const trimmed = name.trim()
  if (!trimmed) return list
  const existing = list.find((p) => p.name.toLowerCase() === trimmed.toLowerCase())
  const next: ConnectionProfile = { ...profileFieldsOf(state), id: existing?.id ?? newId(), name: trimmed }
  return existing ? list.map((p) => (p === existing ? next : p)) : [...list, next]
}
