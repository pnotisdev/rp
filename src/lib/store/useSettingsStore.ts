/** Zustand store for all persisted user settings */
import { configureReasoning } from '@/lib/text/slop'
import { newId } from '@/lib/id'
import { profileFieldsOf, upsertProfile, type ConnectionProfile } from '@/lib/connectionProfiles'
import { create } from 'zustand'
import { isOpenMayhem } from '@/lib/api/openMayhem'
import { persist } from 'zustand/middleware'
import type { ChatCompletionSamplerParams, GenerationParams } from '@/lib/api/types'
import { DEFAULT_CHAT_COMPLETION_SAMPLER } from '@/lib/api/types'
import type { TtsProviderId } from '@/lib/voice/ttsProviders'
import type { ChatBackendId } from '@/lib/api/chatBackend'
import type { ImageBackendId } from '@/lib/api/imageBackend'
import { DEFAULT_COMFY_CONFIG, type ComfyConfig } from '@/lib/api/comfyWorkflow'
import type { RelationshipDifficulty } from '@/lib/dating/relationshipAssist'
import type { QuickReply, RegexScript } from '@/lib/types'
import type { ThemePreset } from '@/lib/store/themePresets'
import type { PromptSectionId } from '@/lib/prompt/builder'
import { DEFAULT_PROMPT_SECTIONS } from '@/lib/prompt/builder'
import { LEGACY_DARK_PALETTES, LEGACY_LIGHT_PALETTES, mergePalette } from './palette'
import type { FontId } from './fonts'
import type { Backdrop, Look } from './looks'

/** Seeded on first run only; a returning user's own edits/deletions are never overwritten. */
const DEFAULT_QUICK_REPLIES: QuickReply[] = [
  { id: 'qr-surroundings', label: 'Look around', message: '*takes a moment to look around and take in the surroundings*' },
  { id: 'qr-time-skip', label: 'Let time pass', message: '*lets some time pass*' },
  { id: 'qr-change-subject', label: 'Change the subject', message: 'Anyway. So, what else is new with you?' },
]

export interface PromptPreset {
  id: string
  name: string
  systemPrompt: string
  postHistoryInstructions: string
}

export type ChatStyle = 'flat' | 'bubbles' | 'document'
export type AvatarShape = 'circle' | 'square' | 'rounded' | 'rectangle'
export type ColorMode = 'light' | 'dark'
/** How explicit intimate scenes get written once the story leads there; 'default' sends no instruction (old behavior). */
export type IntimacyDetailLevel = 'default' | 'fade_to_black' | 'suggestive' | 'explicit'

export const DEFAULT_THEME_TOKENS: Record<string, string> = {
  '--c-bg': '247 247 244',
  '--c-bg-elevated': '252 252 250',
  '--c-bg-sunken': '238 237 232',
  '--c-border': '226 224 217',
  '--c-text': '38 37 30',
  '--c-text-muted': '117 114 104',
  '--c-accent': '214 62 0',
  '--c-accent-text': '255 255 255',
  '--c-msg-user': '214 62 0',
  '--c-msg-char': '252 252 250',
  '--c-danger': '192 57 43',
  '--c-success': '38 125 82',
  '--c-warning': '168 108 20',
  '--c-romance': '190 76 128',
  '--c-romance-text': '255 255 255',
}

export const DEFAULT_THEME_TOKENS_DARK: Record<string, string> = {
  '--c-bg': '20 19 15',
  '--c-bg-elevated': '27 26 22',
  '--c-bg-sunken': '36 34 29',
  '--c-border': '47 45 38',
  '--c-text': '237 236 230',
  '--c-text-muted': '150 147 138',
  '--c-accent': '245 96 31',
  '--c-accent-text': '20 19 15',
  '--c-msg-user': '245 96 31',
  '--c-msg-char': '27 26 22',
  '--c-danger': '232 112 100',
  '--c-success': '122 192 150',
  '--c-warning': '222 180 100',
  '--c-romance': '222 132 172',
  '--c-romance-text': '20 14 17',
}

// Kept in sync with the "Balanced" built-in preset (builtinPresets.ts) so a fresh install shows it selected.
export const DEFAULT_SAMPLER: GenerationParams = {
  // A modern floor, not a real limit: `contextLengthAuto` (on by default) raises this to the connected model's actual context as soon as one reports it.
  max_context_length: 32768,
  max_length: 512,
  temperature: 0.9,
  top_p: 1,
  top_k: 0,
  min_p: 0.05,
  typical: 1,
  tfs: 1,
  rep_pen: 1.08,
  rep_pen_range: 2048,
  rep_pen_slope: 0.7,
  presence_penalty: 0,
  dry_multiplier: 0,
  dry_base: 1.75,
  dry_allowed_length: 2,
  dry_sequence_breakers: ['"\\n"', '":"', '"*"'],
  mirostat: 0,
  mirostat_tau: 5,
  mirostat_eta: 0.1,
  stop_sequence: [],
  trim_stop: true,
}

interface SettingsState {
  // connection
  baseUrl: string
  setBaseUrl: (url: string) => void

  // identity
  activeCharacterId: string | null
  activePersonaId: string | null
  activeChatId: string | null
  setActiveCharacterId: (id: string | null) => void
  setActivePersonaId: (id: string | null) => void
  setActiveChatId: (id: string | null) => void

  // theming
  colorMode: ColorMode
  themeTokensLight: Record<string, string>
  themeTokensDark: Record<string, string>
  setColorMode: (m: ColorMode) => void
  setThemeToken: (key: string, value: string, mode: ColorMode) => void
  /** Applies a complete palette (defaults + preset overrides) so presets never accumulate stray tokens. */
  applyThemePreset: (light: Record<string, string>, dark: Record<string, string>) => void
  resetTheme: () => void
  /** User-saved colour palettes shown in the Presets row; snapshots the current light+dark token maps. */
  customThemePresets: ThemePreset[]
  addCustomThemePreset: (name: string) => void
  removeCustomThemePreset: (id: string) => void

  // layout / toggles
  chatStyle: ChatStyle
  avatarShape: AvatarShape
  chatWidthRem: number
  fontScale: number
  blurPx: number
  /** VN mode's per-character typewriter delay, in ms — 0 is instant (no typewriter at all). */
  vnTextSpeedMs: number
  reducedMotion: boolean
  reducedAudio: boolean
  /** Style standalone comic sound words ("BOOM!", "knock knock") as manga-style bursts in messages. */
  sfxBursts: boolean
  /** Extra sound-effect words applied to every character, comma/newline separated. */
  sfxWords: string
  setSfxWords: (v: string) => void
  /** Background-music volume, 0..1; 0 (default) = off. */
  bgmVolume: number
  setBgmVolume: (v: number) => void
  showTimestamps: boolean
  showTokenCounts: boolean
  showGenerationHud: boolean
  /** Texting-format replies are read aloud bubble by bubble as they appear. */
  autoVoiceTexting: boolean
  tagsAsFolders: boolean
  clickToEdit: boolean
  /** `'auto'` (only via `setVisualNovelMode`, not `toggleFlag` — it's a tri-state) turns VN mode on
   *  only once `isVnReady` says there's actually art for it; never a blank void. */
  visualNovelMode: boolean | 'auto'
  setVisualNovelMode: (v: boolean | 'auto') => void
  /** Docked pill row (today's default) vs. a full-screen, scene-dimmed, stacked choice screen —
   *  VN mode only; the ordinary chat layout's choices/quick-replies are unaffected either way. */
  vnChoiceStyle: 'docked' | 'centered'
  setVnChoiceStyle: (v: 'docked' | 'centered') => void
  /** Where the player writes in VN mode. */
  vnInputMode: 'inline' | 'docked'
  setVnInputMode: (v: 'inline' | 'docked') => void
  /** With a vision-capable model loaded, runs a post-reply pass to correct the model's `<<scene:>>` tag. Off by default. */
  visionSceneDetection: boolean
  setChatStyle: (s: ChatStyle) => void
  setAvatarShape: (s: AvatarShape) => void

  // look: type, shape and atmosphere (colours are the theme tokens above)
  uiFont: FontId
  readFont: FontId
  displayFont: FontId
  /** Corner roundness in px; every rounded-* size scales from it. */
  radiusPx: number
  /** Message text size multiplier. */
  readScale: number
  backdrop: Backdrop
  /** Translucent panels over the backdrop. */
  glass: boolean
  setLook: (patch: Partial<Pick<SettingsState, 'uiFont' | 'readFont' | 'displayFont' | 'radiusPx' | 'readScale' | 'backdrop' | 'glass'>>) => void
  /** Applies a whole look: its palette, type, shape, atmosphere and chat style, and its light/dark mode. */
  applyLook: (look: Look) => void
  setLayout: (patch: Partial<{
    chatWidthRem: number
    fontScale: number
    blurPx: number
    vnTextSpeedMs: number
  }>) => void
  toggleFlag: (
    key:
      | 'reducedMotion'
      | 'reducedAudio'
      | 'sfxBursts'
      | 'showTimestamps'
      | 'showTokenCounts'
      | 'showGenerationHud'
      | 'autoVoiceTexting'
      | 'tagsAsFolders'
      | 'clickToEdit'
      | 'visionSceneDetection',
  ) => void

  // generation
  advancedSamplerMode: boolean
  sampler: GenerationParams
  /** When true, `sampler.max_context_length` tracks the connected model's real limit (see `useAutoContextLength`). Any manual edit to that field turns it off. */
  contextLengthAuto: boolean
  /** Extra `max_length` headroom for a thinking/reasoning model's hidden reasoning phase (see `replyMaxTokens`). Backend-agnostic, so kept outside `sampler` (KoboldCpp's own wire-format shape, serialized as-is) rather than as one more of its fields. 0 = off, reproducing the old behavior. */
  reasoningTokenReserve: number
  /** Show a thinking model's reasoning in a collapsible block above its reply instead of discarding it. */
  showReasoning: boolean
  /** Similarity search over documents and the chat's older messages. Needs an embeddings model on a server. */
  vectorsEnabled: boolean
  vectorChatMemory: boolean
  /** Blank uses the chat server (KoboldCpp, or the hosted one) for embeddings too. */
  embeddingsBaseUrl: string
  embeddingsApiKey: string
  embeddingsModel: string
  vectorTopK: number
  vectorMinScore: number
  vectorChunkChars: number
  setVectorSettings: (patch: Partial<Pick<SettingsState, 'vectorsEnabled' | 'vectorChatMemory' | 'embeddingsBaseUrl' | 'embeddingsApiKey' | 'embeddingsModel' | 'vectorTopK' | 'vectorMinScore' | 'vectorChunkChars'>>) => void
  /** Ask KoboldCpp for the token probabilities of each reply, and show them under it. */
  showTokenProbabilities: boolean
  setShowTokenProbabilities: (v: boolean) => void
  /** Own reasoning markers for a model whose tags are not one of the built-in kinds. Both blank means automatic. */
  reasoningPrefix: string
  reasoningSuffix: string
  instructTemplateId: string
  /** Which of `builder.ts`'s fixed prompt sections are included; a missing key defaults to on. */
  promptSections: Record<PromptSectionId, boolean>
  setAdvancedSamplerMode: (v: boolean) => void
  setSampler: (patch: Partial<GenerationParams>) => void
  /** Sets `max_context_length` without turning `contextLengthAuto` off — the auto-detect path only. */
  setDetectedContextLength: (n: number) => void
  setContextLengthAuto: (v: boolean) => void
  setReasoningTokenReserve: (n: number) => void
  setShowReasoning: (v: boolean) => void
  setReasoningMarkers: (prefix: string, suffix: string) => void
  setInstructTemplateId: (id: string) => void
  setPromptSectionEnabled: (id: PromptSectionId, enabled: boolean) => void

  customCss: string
  setCustomCss: (css: string) => void

  /** The nav shows labels unless collapsed to the icon rail. */
  sidebarCollapsed: boolean
  setSidebarCollapsed: (v: boolean) => void


  /** Character ids whose "VN mode has no art yet" setup hint the user has dismissed. */
  vnArtHintDismissed: string[]
  dismissVnArtHint: (characterId: string) => void

  /** The post-first-reply tip card ("turn on VN mode" / "bind a world") — shown once, ever, then
   *  gone for good. Not per-character like the one above; this is a one-time orientation nudge. */
  firstReplyTipDismissed: boolean
  dismissFirstReplyTip: () => void

  // long-term memory
  autoSummarize: boolean
  keepRecentMessages: number
  summaryDetail: 'concise' | 'detailed'
  setAutoSummarize: (v: boolean) => void
  setKeepRecentMessages: (n: number) => void
  setSummaryDetail: (d: 'concise' | 'detailed') => void
  /** Lay prompts out so the backend's KV cache survives between turns, and fold old chat into the summary in rare large steps instead of every few turns. */
  cacheFriendlyPrompts: boolean
  setCacheFriendlyPrompts: (v: boolean) => void
  /** Percent of the history window kept verbatim after a compaction (the rest becomes summary). Lower = fewer, larger compactions = cheaper. */
  compactionKeepPercent: number
  setCompactionKeepPercent: (n: number) => void

  // objectives
  autoDetectTasks: boolean
  setAutoDetectTasks: (v: boolean) => void

  // dating-sim relationship tracking
  autoTrackRelationship: boolean
  setAutoTrackRelationship: (v: boolean) => void
  /** Global multiplier on how far relationship deltas swing; never what a character says or how a scene opens. */
  relationshipDifficulty: RelationshipDifficulty
  setRelationshipDifficulty: (d: RelationshipDifficulty) => void

  // roleplay choices
  autoSuggestChoices: boolean
  setAutoSuggestChoices: (v: boolean) => void

  // find/replace regex scripts over message text
  regexScripts: RegexScript[]
  setRegexScripts: (scripts: RegexScript[]) => void

  // section 14's Quick Replies bar — a fixed row of user-configurable buttons above the composer
  quickReplies: QuickReply[]
  setQuickReplies: (replies: QuickReply[]) => void

  // system prompt — the instruction block at the top of every generation.
  systemPrompt: string
  /** Global steering appended after any per-character post-history instructions. */
  postHistoryInstructions: string
  /** The Assistant view's own instruction (`lib/assistant/prompt.ts`). */
  assistantSystemPrompt: string
  setAssistantSystemPrompt: (v: string) => void
  /** What the Assistant may do with tools: nothing, look at the library, or look and change it. */
  assistantTools: 'off' | 'read' | 'write'
  /** Apply the Assistant's file edits without asking each time (commands always ask). */
  assistantAutoApprove: boolean
  setAssistantAutoApprove: (v: boolean) => void
  /** A message asking for a character builds a draft card straight away, instead of offering a button. */
  assistantAutoBuild: boolean
  setAssistantAutoBuild: (v: boolean) => void
  setAssistantTools: (v: 'off' | 'read' | 'write') => void
  setSystemPrompt: (v: string) => void
  setPostHistoryInstructions: (v: string) => void
  /** User-saved {system prompt + post-history} pairs, shown as a picker in Settings → Generation. */
  promptPresets: PromptPreset[]
  addPromptPreset: (name: string) => void
  removePromptPreset: (id: string) => void

  // writing-style steering — injected into every prompt, right before generation
  styleGuidance: string
  avoidEmDashes: boolean
  /** Rewrite any em dash the model still produces into a comma or ellipsis before the reply is stored. */
  replaceEmDashes: boolean
  setReplaceEmDashes: (v: boolean) => void
  setStyleGuidance: (v: string) => void
  setAvoidEmDashes: (v: boolean) => void
  /** Steers scene content (not just prose) so a character doesn't give in to a request just to be agreeable. Defaults on. */
  slowBurnPacing: boolean
  setSlowBurnPacing: (v: boolean) => void
  /** See `IntimacyDetailLevel`. */
  intimacyLevel: IntimacyDetailLevel
  setIntimacyLevel: (v: IntimacyDetailLevel) => void

  // companion voice
  ttsProvider: TtsProviderId
  ttsApiKey: string
  ttsBaseUrl: string
  ttsRegion: string
  ttsVoice: string
  ttsModel: string
  /** Shared by OpenMayhem chat, images and speech; never used for another provider. */
  openMayhemApiKey: string
  setOpenMayhemApiKey: (key: string) => void
  setVoiceConfig: (patch: Partial<{
    ttsProvider: TtsProviderId
    ttsApiKey: string
    ttsBaseUrl: string
    ttsRegion: string
    ttsVoice: string
    ttsModel: string
  }>) => void

  /** Saved backend, model, template and sampler bundles to switch between. */
  connectionProfiles: ConnectionProfile[]
  saveConnectionProfile: (name: string) => void
  applyConnectionProfile: (id: string) => void
  removeConnectionProfile: (id: string) => void

  /** Defaults to `'koboldcpp'`; the other three fields only matter for `'openai-compatible'`. */
  chatBackend: ChatBackendId
  chatBackendBaseUrl: string
  chatBackendApiKey: string
  chatBackendModel: string
  setChatBackendConfig: (patch: Partial<{
    chatBackend: ChatBackendId
    chatBackendBaseUrl: string
    chatBackendApiKey: string
    chatBackendModel: string
  }>) => void
  /** Kept separate from `sampler` (KoboldCpp-only) so switching `chatBackend` never clobbers either one's tuned values. */
  chatCompletionSampler: ChatCompletionSamplerParams
  setChatCompletionSampler: (patch: Partial<ChatCompletionSamplerParams>) => void

  /** `imageBackendUsername`/`imageBackendPassword` double as Automatic1111's `--api-auth user:pass` or (username only) NovelAI's API key. */
  imageBackend: ImageBackendId
  imageBackendBaseUrl: string
  imageBackendUsername: string
  imageBackendPassword: string
  imageBackendModel: string
  /** ComfyUI only: which graph to run, its model files, and a workflow of your own. Kept apart so switching backends never loses it. */
  comfy: ComfyConfig
  setComfyConfig: (patch: Partial<ComfyConfig>) => void
  setImageBackendConfig: (patch: Partial<{
    imageBackend: ImageBackendId
    imageBackendBaseUrl: string
    imageBackendUsername: string
    imageBackendPassword: string
    imageBackendModel: string
  }>) => void
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      baseUrl: 'http://localhost:5001',
      setBaseUrl: (url) => set({ baseUrl: url }),

      activeCharacterId: null,
      activePersonaId: null,
      activeChatId: null,
      setActiveCharacterId: (id) => set({ activeCharacterId: id }),
      setActivePersonaId: (id) => set({ activePersonaId: id }),
      setActiveChatId: (id) => set({ activeChatId: id }),

      colorMode: 'dark',
      themeTokensLight: { ...DEFAULT_THEME_TOKENS },
      themeTokensDark: { ...DEFAULT_THEME_TOKENS_DARK },
      setColorMode: (m) => set({ colorMode: m }),
      setThemeToken: (key, value, mode) =>
        set((s) => ({
          [mode === 'light' ? 'themeTokensLight' : 'themeTokensDark']: {
            ...(mode === 'light' ? s.themeTokensLight : s.themeTokensDark),
            [key]: value,
          },
        }) as Partial<SettingsState>),
      applyThemePreset: (light, dark) =>
        set({
          themeTokensLight: { ...DEFAULT_THEME_TOKENS, ...light },
          themeTokensDark: { ...DEFAULT_THEME_TOKENS_DARK, ...dark },
        }),
      resetTheme: () =>
        set({
          themeTokensLight: { ...DEFAULT_THEME_TOKENS },
          themeTokensDark: { ...DEFAULT_THEME_TOKENS_DARK },
        }),
      customThemePresets: [],
      addCustomThemePreset: (name) =>
        set((s) => ({
          customThemePresets: [
            ...s.customThemePresets,
            {
              id: `custom-${Date.now().toString(36)}`,
              name: name.trim() || `Preset ${s.customThemePresets.length + 1}`,
              light: { ...s.themeTokensLight },
              dark: { ...s.themeTokensDark },
            },
          ],
        })),
      removeCustomThemePreset: (id) =>
        set((s) => ({ customThemePresets: s.customThemePresets.filter((p) => p.id !== id) })),

      chatStyle: 'flat',
      avatarShape: 'rounded',
      chatWidthRem: 48,
      fontScale: 1,
      blurPx: 0,
      vnTextSpeedMs: 18,
      reducedMotion: false,
      reducedAudio: false,
      sfxBursts: true,
      sfxWords: '',
      setSfxWords: (v) => set({ sfxWords: v }),
      bgmVolume: 0,
      setBgmVolume: (v) => set({ bgmVolume: Math.max(0, Math.min(1, v)) }),
      showTimestamps: true,
      showTokenCounts: false,
      showGenerationHud: true,
      autoVoiceTexting: false,
      tagsAsFolders: true,
      clickToEdit: true,
      visualNovelMode: false,
      setVisualNovelMode: (v) => set({ visualNovelMode: v }),
      vnChoiceStyle: 'centered',
      setVnChoiceStyle: (v) => set({ vnChoiceStyle: v }),
      vnInputMode: 'inline',
      setVnInputMode: (v) => set({ vnInputMode: v }),
      visionSceneDetection: false,
      setChatStyle: (s) => set({ chatStyle: s }),
      setAvatarShape: (s) => set({ avatarShape: s }),
      uiFont: 'inter',
      readFont: 'inter',
      displayFont: 'rounded',
      radiusPx: 6,
      readScale: 1,
      backdrop: 'none',
      glass: false,
      setLook: (patch) => set(patch),
      applyLook: (look) =>
        set({
          themeTokensLight: { ...DEFAULT_THEME_TOKENS, ...look.light },
          themeTokensDark: { ...DEFAULT_THEME_TOKENS_DARK, ...look.dark },
          colorMode: look.mode,
          uiFont: look.uiFont,
          readFont: look.readFont,
          displayFont: look.displayFont,
          radiusPx: look.radiusPx,
          backdrop: look.backdrop,
          glass: look.glass,
          chatStyle: look.chatStyle,
          avatarShape: look.avatarShape,
        }),
      setLayout: (patch) => set(patch),
      toggleFlag: (key) => set((s) => ({ [key]: !s[key] }) as Partial<SettingsState>),

      advancedSamplerMode: false,
      sampler: { ...DEFAULT_SAMPLER },
      contextLengthAuto: true,
      reasoningTokenReserve: 0,
      showReasoning: false,
      showTokenProbabilities: false,
      vectorsEnabled: false,
      vectorChatMemory: true,
      embeddingsBaseUrl: '',
      embeddingsApiKey: '',
      embeddingsModel: '',
      vectorTopK: 4,
      vectorMinScore: 0.3,
      vectorChunkChars: 800,
      setVectorSettings: (patch) =>
        set({
          ...patch,
          ...(patch.vectorTopK !== undefined ? { vectorTopK: Math.max(1, Math.min(20, Math.round(patch.vectorTopK) || 1)) } : {}),
          ...(patch.vectorMinScore !== undefined ? { vectorMinScore: Math.max(0, Math.min(1, patch.vectorMinScore || 0)) } : {}),
          ...(patch.vectorChunkChars !== undefined ? { vectorChunkChars: Math.max(200, Math.min(4000, Math.round(patch.vectorChunkChars) || 800)) } : {}),
        }),
      setShowTokenProbabilities: (v) => set({ showTokenProbabilities: v }),
      reasoningPrefix: '',
      reasoningSuffix: '',
      instructTemplateId: 'plain-chat',
      promptSections: DEFAULT_PROMPT_SECTIONS,
      setAdvancedSamplerMode: (v) => set({ advancedSamplerMode: v }),
      setSampler: (patch) => set((s) => ({ sampler: { ...s.sampler, ...patch } })),
      setDetectedContextLength: (n) =>
        set((s) => (s.sampler.max_context_length === n ? {} : { sampler: { ...s.sampler, max_context_length: n } })),
      setContextLengthAuto: (v) => set({ contextLengthAuto: v }),
      setReasoningTokenReserve: (n) => set({ reasoningTokenReserve: Math.max(0, Math.round(n) || 0) }),
      setShowReasoning: (v) => set({ showReasoning: v }),
      setReasoningMarkers: (prefix, suffix) => set({ reasoningPrefix: prefix, reasoningSuffix: suffix }),
      setInstructTemplateId: (id) => set({ instructTemplateId: id }),
      setPromptSectionEnabled: (id, enabled) => set((s) => ({ promptSections: { ...s.promptSections, [id]: enabled } })),

      customCss: '',
      setCustomCss: (css) => set({ customCss: css }),

      sidebarCollapsed: false,
      setSidebarCollapsed: (v) => set({ sidebarCollapsed: v }),


      vnArtHintDismissed: [],
      dismissVnArtHint: (characterId) =>
        set((s) =>
          s.vnArtHintDismissed.includes(characterId)
            ? s
            : { vnArtHintDismissed: [...s.vnArtHintDismissed, characterId] },
        ),

      firstReplyTipDismissed: false,
      dismissFirstReplyTip: () => set({ firstReplyTipDismissed: true }),

      autoSummarize: true,
      keepRecentMessages: 12,
      summaryDetail: 'concise',
      setAutoSummarize: (v) => set({ autoSummarize: v }),
      setKeepRecentMessages: (n) => set({ keepRecentMessages: n }),
      setSummaryDetail: (d) => set({ summaryDetail: d }),
      cacheFriendlyPrompts: true,
      setCacheFriendlyPrompts: (v) => set({ cacheFriendlyPrompts: v }),
      compactionKeepPercent: 50,
      setCompactionKeepPercent: (n) => set({ compactionKeepPercent: Math.min(80, Math.max(25, Math.round(n) || 50)) }),

      autoDetectTasks: true,
      setAutoDetectTasks: (v) => set({ autoDetectTasks: v }),

      autoTrackRelationship: true,
      setAutoTrackRelationship: (v) => set({ autoTrackRelationship: v }),
      relationshipDifficulty: 'normal',
      setRelationshipDifficulty: (d) => set({ relationshipDifficulty: d }),

      autoSuggestChoices: true,
      setAutoSuggestChoices: (v) => set({ autoSuggestChoices: v }),

      regexScripts: [],
      setRegexScripts: (scripts) => set({ regexScripts: scripts }),

      quickReplies: DEFAULT_QUICK_REPLIES,
      setQuickReplies: (replies) => set({ quickReplies: replies }),

      systemPrompt: '',
      postHistoryInstructions: '',
      assistantSystemPrompt: '',
      setAssistantSystemPrompt: (v) => set({ assistantSystemPrompt: v }),
      assistantTools: 'off',
      assistantAutoApprove: false,
      setAssistantAutoApprove: (v) => set({ assistantAutoApprove: v }),
      assistantAutoBuild: true,
      setAssistantAutoBuild: (v) => set({ assistantAutoBuild: v }),
      setAssistantTools: (v) => set({ assistantTools: v }),
      setSystemPrompt: (v) => set({ systemPrompt: v }),
      setPostHistoryInstructions: (v) => set({ postHistoryInstructions: v }),
      promptPresets: [],
      addPromptPreset: (name) =>
        set((s) => ({
          promptPresets: [
            ...s.promptPresets,
            {
              id: `prompt-${Date.now().toString(36)}`,
              name: name.trim() || `Preset ${s.promptPresets.length + 1}`,
              systemPrompt: s.systemPrompt,
              postHistoryInstructions: s.postHistoryInstructions,
            },
          ],
        })),
      removePromptPreset: (id) => set((s) => ({ promptPresets: s.promptPresets.filter((p) => p.id !== id) })),

      styleGuidance: '',
      avoidEmDashes: false,
      replaceEmDashes: true,
      setReplaceEmDashes: (v) => set({ replaceEmDashes: v }),
      setStyleGuidance: (v) => set({ styleGuidance: v }),
      setAvoidEmDashes: (v) => set({ avoidEmDashes: v }),
      slowBurnPacing: true,
      setSlowBurnPacing: (v) => set({ slowBurnPacing: v }),
      intimacyLevel: 'default',
      setIntimacyLevel: (v) => set({ intimacyLevel: v }),

      ttsProvider: 'koboldcpp',
      ttsApiKey: '',
      ttsBaseUrl: '',
      ttsRegion: '',
      ttsVoice: '',
      ttsModel: '',
      openMayhemApiKey: '',
      setOpenMayhemApiKey: (key) => set((s) => ({ openMayhemApiKey: key,
        ...(s.chatBackend === 'openai-compatible' && isOpenMayhem(s.chatBackendBaseUrl) ? { chatBackendApiKey: key } : {}),
      })),
      setVoiceConfig: (patch) => set((s) => {
        const changesProvider = patch.ttsProvider !== undefined && patch.ttsProvider !== s.ttsProvider
          || patch.ttsBaseUrl !== undefined && patch.ttsBaseUrl !== s.ttsBaseUrl
        return changesProvider ? { ttsApiKey: '', ttsVoice: '', ttsModel: '', ...patch } : patch
      }),

      connectionProfiles: [],
      saveConnectionProfile: (name) => set((s) => ({ connectionProfiles: upsertProfile(s.connectionProfiles, name, s, newId) })),
      applyConnectionProfile: (id) =>
        set((s) => {
          const profile = s.connectionProfiles.find((p) => p.id === id)
          if (!profile) return {}
          const fields = profileFieldsOf(profile)
          // A hosted OpenMayhem connection keeps its key in a second field too.
          const mayhem = fields.chatBackend === 'openai-compatible' && isOpenMayhem(fields.chatBackendBaseUrl)
          return { ...fields, ...(mayhem ? { openMayhemApiKey: fields.chatBackendApiKey } : {}) }
        }),
      removeConnectionProfile: (id) => set((s) => ({ connectionProfiles: s.connectionProfiles.filter((p) => p.id !== id) })),

      chatBackend: 'koboldcpp',
      chatBackendBaseUrl: '',
      chatBackendApiKey: '',
      chatBackendModel: '',
      setChatBackendConfig: (patch) => set((s) => {
        // A provider change must not send the previous provider's secret to its replacement.
        const changesProvider = (patch.chatBackendBaseUrl !== undefined && patch.chatBackendBaseUrl !== s.chatBackendBaseUrl)
          || (patch.chatBackend !== undefined && patch.chatBackend !== s.chatBackend)
        const next = changesProvider ? { chatBackendApiKey: '', chatBackendModel: '', ...patch } : { ...patch }
        if ((patch.chatBackend ?? s.chatBackend) === 'openai-compatible' && isOpenMayhem(patch.chatBackendBaseUrl ?? s.chatBackendBaseUrl)) {
          const key = patch.chatBackendApiKey ?? s.openMayhemApiKey
          return { ...next, openMayhemApiKey: key, chatBackendApiKey: key }
        }
        return next
      }),

      chatCompletionSampler: DEFAULT_CHAT_COMPLETION_SAMPLER,
      setChatCompletionSampler: (patch) => set((s) => ({ chatCompletionSampler: { ...s.chatCompletionSampler, ...patch } })),

      imageBackend: 'a1111',
      imageBackendBaseUrl: '',
      imageBackendUsername: '',
      imageBackendPassword: '',
      imageBackendModel: '',
      comfy: { ...DEFAULT_COMFY_CONFIG },
      setComfyConfig: (patch) => set((s) => ({ comfy: { ...s.comfy, ...patch } })),
      setImageBackendConfig: (patch) => set((s) => {
        const changesProvider = patch.imageBackend !== undefined && patch.imageBackend !== s.imageBackend
          || patch.imageBackendBaseUrl !== undefined && patch.imageBackendBaseUrl !== s.imageBackendBaseUrl
        return changesProvider ? { imageBackendUsername: '', imageBackendPassword: '', imageBackendModel: '', ...patch } : patch
      }),
    }),
    {
      name: 'rp-settings',
      // Deep-merge just these nested keys so new tokens/params backfill instead of being hidden by an old persisted object.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<SettingsState>
        const usesOpenMayhem = p.chatBackend === 'openai-compatible' && isOpenMayhem(p.chatBackendBaseUrl ?? '')
        const key = p.openMayhemApiKey || (usesOpenMayhem ? p.chatBackendApiKey : '') || ''
        return {
          ...current,
          ...p,
          openMayhemApiKey: key,
          ...(usesOpenMayhem ? { chatBackendApiKey: key } : {}),
          themeTokensLight: mergePalette(current.themeTokensLight, p.themeTokensLight, LEGACY_LIGHT_PALETTES),
          themeTokensDark: mergePalette(current.themeTokensDark, p.themeTokensDark, LEGACY_DARK_PALETTES),
          comfy: { ...DEFAULT_COMFY_CONFIG, ...p.comfy },
          sampler: { ...current.sampler, ...p.sampler },
        }
      },
    },
  ),
)

// The text scrubber is plain code with no store access, so it is told the writer's reasoning markers when they change.
configureReasoning(useSettingsStore.getState().reasoningPrefix, useSettingsStore.getState().reasoningSuffix)
useSettingsStore.subscribe((s) => configureReasoning(s.reasoningPrefix, s.reasoningSuffix))
