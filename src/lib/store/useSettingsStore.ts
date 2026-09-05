import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ChatCompletionSamplerParams, GenerationParams } from '@/lib/api/types'
import { DEFAULT_CHAT_COMPLETION_SAMPLER } from '@/lib/api/types'
import type { TtsProviderId } from '@/lib/voice/ttsProviders'
import type { ChatBackendId } from '@/lib/api/chatBackend'
import type { RelationshipDifficulty } from '@/lib/dating/relationshipAssist'
import type { QuickReply, RegexScript } from '@/lib/types'
import type { ThemePreset } from '@/lib/store/themePresets'
import type { PromptSectionId } from '@/lib/prompt/builder'
import { DEFAULT_PROMPT_SECTIONS } from '@/lib/prompt/builder'

/** Seeded on first run only — a returning user's own edits/deletions are never overwritten (see the `merge` config below, which does a plain shallow spread for this key like every other scalar/array setting). */
const DEFAULT_QUICK_REPLIES: QuickReply[] = [
  { id: 'qr-surroundings', label: 'Look around', message: '*takes a moment to look around and take in the surroundings*' },
  { id: 'qr-time-skip', label: 'Let time pass', message: '*lets some time pass*' },
  { id: 'qr-change-subject', label: 'Change the subject', message: 'Anyway — so, what else is new with you?' },
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

export const DEFAULT_THEME_TOKENS: Record<string, string> = {
  '--c-bg': '251 251 250',
  '--c-bg-elevated': '255 255 255',
  '--c-bg-sunken': '244 244 242',
  '--c-border': '231 229 225',
  '--c-text': '30 32 30',
  '--c-text-muted': '133 129 123',
  '--c-accent': '13 121 105',
  '--c-accent-text': '255 255 255',
  '--c-msg-user': '13 121 105',
  '--c-msg-char': '255 255 255',
  '--c-danger': '197 48 48',
  '--c-success': '22 130 74',
  '--c-warning': '180 108 8',
  '--c-romance': '201 63 122',
  '--c-romance-text': '255 255 255',
}

export const DEFAULT_THEME_TOKENS_DARK: Record<string, string> = {
  '--c-bg': '17 18 18',
  '--c-bg-elevated': '26 27 27',
  '--c-bg-sunken': '12 13 13',
  '--c-border': '42 44 43',
  '--c-text': '235 235 232',
  '--c-text-muted': '148 148 143',
  '--c-accent': '94 224 197',
  '--c-accent-text': '12 13 13',
  '--c-msg-user': '94 224 197',
  '--c-msg-char': '26 27 27',
  '--c-danger': '240 120 120',
  '--c-success': '94 220 150',
  '--c-warning': '240 190 90',
  '--c-romance': '236 108 184',
  '--c-romance-text': '12 13 13',
}

// Kept in sync with the "Balanced" built-in preset (builtinPresets.ts) on every field that preset
// opinionates, so a fresh install shows "Balanced" selected rather than "Custom".
export const DEFAULT_SAMPLER: GenerationParams = {
  max_context_length: 8192,
  max_length: 300,
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
  /** Apply a colour preset: a complete palette every time (defaults + the preset's overrides),
   *  so switching presets can't accumulate stray tokens and `resetTheme()` is its clean inverse. */
  applyThemePreset: (light: Record<string, string>, dark: Record<string, string>) => void
  resetTheme: () => void
  /** User-saved colour palettes, shown in the Presets row alongside the built-ins. Snapshots the
   *  full light+dark token maps as they are right now (colours only — never chatStyle/layout/CSS). */
  customThemePresets: ThemePreset[]
  addCustomThemePreset: (name: string) => void
  removeCustomThemePreset: (id: string) => void

  // layout / toggles
  chatStyle: ChatStyle
  avatarShape: AvatarShape
  chatWidthRem: number
  fontScale: number
  blurPx: number
  shadowStrength: number
  reducedMotion: boolean
  reducedAudio: boolean
  /** Style standalone comic sound words ("BOOM!", "knock knock") as manga-style bursts in messages. */
  sfxBursts: boolean
  /** Extra sound-effect words applied to every character, on top of the built-in list — comma / newline separated. Per-character additions live on `Character.sfxWords`. */
  sfxWords: string
  setSfxWords: (v: string) => void
  /** Background-music volume, 0..1. 0 (default) = off; music never plays and never asks the browser to unlock audio until this is raised. Per-world tracks live on `WorldCard.music`. */
  bgmVolume: number
  setBgmVolume: (v: number) => void
  showTimestamps: boolean
  showTokenCounts: boolean
  showGenerationHud: boolean
  tagsAsFolders: boolean
  clickToEdit: boolean
  visualNovelMode: boolean
  /** §8: with a vision-capable model loaded, run a post-reply pass that looks at the character's
   *  actual expression sprites (and any photo the player attached) to correct the model's blind
   *  `<<scene:>>` tag. Off by default — it needs an mmproj and adds a slow image generation per
   *  VN turn; when off, scene tagging behaves exactly as before. */
  visionSceneDetection: boolean
  setChatStyle: (s: ChatStyle) => void
  setAvatarShape: (s: AvatarShape) => void
  setLayout: (patch: Partial<{
    chatWidthRem: number
    fontScale: number
    blurPx: number
    shadowStrength: number
  }>) => void
  toggleFlag: (
    key:
      | 'reducedMotion'
      | 'reducedAudio'
      | 'sfxBursts'
      | 'showTimestamps'
      | 'showTokenCounts'
      | 'showGenerationHud'
      | 'tagsAsFolders'
      | 'clickToEdit'
      | 'visualNovelMode'
      | 'visionSceneDetection',
  ) => void

  // generation
  advancedSamplerMode: boolean
  sampler: GenerationParams
  instructTemplateId: string
  /** Which of `builder.ts`'s fixed prompt sections are included — a missing key defaults to on (`DEFAULT_PROMPT_SECTIONS`). */
  promptSections: Record<PromptSectionId, boolean>
  setAdvancedSamplerMode: (v: boolean) => void
  setSampler: (patch: Partial<GenerationParams>) => void
  setInstructTemplateId: (id: string) => void
  setPromptSectionEnabled: (id: PromptSectionId, enabled: boolean) => void

  customCss: string
  setCustomCss: (css: string) => void

  sidebarExpanded: boolean
  setSidebarExpanded: (v: boolean) => void

  chatsPanelCollapsed: boolean
  setChatsPanelCollapsed: (v: boolean) => void

  // long-term memory
  autoSummarize: boolean
  keepRecentMessages: number
  summaryDetail: 'concise' | 'detailed'
  setAutoSummarize: (v: boolean) => void
  setKeepRecentMessages: (n: number) => void
  setSummaryDetail: (d: 'concise' | 'detailed') => void

  // objectives
  autoDetectTasks: boolean
  setAutoDetectTasks: (v: boolean) => void

  // dating-sim relationship tracking
  autoTrackRelationship: boolean
  setAutoTrackRelationship: (v: boolean) => void
  /** Global multiplier on how far relationship deltas swing — never what a character says or how a scene opens. */
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

  // system prompt — the instruction block at the top of every generation. Empty = the built-in
  // `DEFAULT_SYSTEM_PROMPT` (builder.ts); a character's own `system_prompt` still overrides both.
  systemPrompt: string
  /** Global steering appended after any per-character post-history instructions — applies to every chat. */
  postHistoryInstructions: string
  setSystemPrompt: (v: string) => void
  setPostHistoryInstructions: (v: string) => void
  /** User-saved {system prompt + post-history} pairs, shown as a picker in Settings → Generation. */
  promptPresets: PromptPreset[]
  addPromptPreset: (name: string) => void
  removePromptPreset: (id: string) => void

  // writing-style steering — injected into every prompt, right before generation
  styleGuidance: string
  avoidEmDashes: boolean
  setStyleGuidance: (v: string) => void
  setAvoidEmDashes: (v: boolean) => void
  /** Steers scene *content*, not just prose — the relationship-difficulty slider above only scales
   *  numeric deltas and says so in its own copy ("never what a character says or how a scene
   *  opens"); this is what actually asks the model not to have a character give in to a request
   *  just to be agreeable. Defaults on: reproduced live against the seeded Sumire on a near-strangers
   *  chat, an unprompted kiss request got a token "you can't just demand that" followed by
   *  immediate compliance in the same reply — the character's own card already asks for someone who
   *  "warms up slowly," the model just wasn't holding that line under a direct, escalating request. */
  slowBurnPacing: boolean
  setSlowBurnPacing: (v: boolean) => void

  // companion voice
  ttsProvider: TtsProviderId
  ttsApiKey: string
  ttsBaseUrl: string
  ttsRegion: string
  ttsVoice: string
  setVoiceConfig: (patch: Partial<{
    ttsProvider: TtsProviderId
    ttsApiKey: string
    ttsBaseUrl: string
    ttsRegion: string
    ttsVoice: string
  }>) => void

  /**
   * Section 8's "additional model backends". Defaults to `'koboldcpp'` so every existing user's
   * setup is untouched unless they opt in from Settings. The other three fields only matter for
   * `'openai-compatible'` — mirrors the flat `ttsProvider`/`ttsApiKey`/`ttsBaseUrl` shape above
   * rather than a nested config object, for the same reason: one setter, one persisted shape.
   */
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
  /**
   * The user's own framing, after live-testing section 8: "text completion and chat completion
   * presets are different" — kept as its own object rather than folded into `sampler`
   * (`GenerationParams`, KoboldCpp-only concepts) so switching `chatBackend` back and forth never
   * clobbers either one's last-tuned values.
   */
  chatCompletionSampler: ChatCompletionSamplerParams
  setChatCompletionSampler: (patch: Partial<ChatCompletionSamplerParams>) => void
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
      shadowStrength: 1,
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
      tagsAsFolders: true,
      clickToEdit: true,
      visualNovelMode: false,
      visionSceneDetection: false,
      setChatStyle: (s) => set({ chatStyle: s }),
      setAvatarShape: (s) => set({ avatarShape: s }),
      setLayout: (patch) => set(patch),
      toggleFlag: (key) => set((s) => ({ [key]: !s[key] }) as Partial<SettingsState>),

      advancedSamplerMode: false,
      sampler: { ...DEFAULT_SAMPLER },
      instructTemplateId: 'plain-chat',
      promptSections: DEFAULT_PROMPT_SECTIONS,
      setAdvancedSamplerMode: (v) => set({ advancedSamplerMode: v }),
      setSampler: (patch) => set((s) => ({ sampler: { ...s.sampler, ...patch } })),
      setInstructTemplateId: (id) => set({ instructTemplateId: id }),
      setPromptSectionEnabled: (id, enabled) => set((s) => ({ promptSections: { ...s.promptSections, [id]: enabled } })),

      customCss: '',
      setCustomCss: (css) => set({ customCss: css }),

      sidebarExpanded: false,
      setSidebarExpanded: (v) => set({ sidebarExpanded: v }),

      chatsPanelCollapsed: false,
      setChatsPanelCollapsed: (v) => set({ chatsPanelCollapsed: v }),

      autoSummarize: true,
      keepRecentMessages: 12,
      summaryDetail: 'concise',
      setAutoSummarize: (v) => set({ autoSummarize: v }),
      setKeepRecentMessages: (n) => set({ keepRecentMessages: n }),
      setSummaryDetail: (d) => set({ summaryDetail: d }),

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
      setStyleGuidance: (v) => set({ styleGuidance: v }),
      setAvoidEmDashes: (v) => set({ avoidEmDashes: v }),
      slowBurnPacing: true,
      setSlowBurnPacing: (v) => set({ slowBurnPacing: v }),

      ttsProvider: 'koboldcpp',
      ttsApiKey: '',
      ttsBaseUrl: '',
      ttsRegion: '',
      ttsVoice: '',
      setVoiceConfig: (patch) => set(patch),

      chatBackend: 'koboldcpp',
      chatBackendBaseUrl: '',
      chatBackendApiKey: '',
      chatBackendModel: '',
      setChatBackendConfig: (patch) => set(patch),

      chatCompletionSampler: DEFAULT_CHAT_COMPLETION_SAMPLER,
      setChatCompletionSampler: (patch) => set((s) => ({ chatCompletionSampler: { ...s.chatCompletionSampler, ...patch } })),
    }),
    {
      name: 'rp-settings',
      // zustand's default merge is shallow — a token object already in localStorage (from before
      // this key existed) would otherwise fully replace the default object instead of layering
      // over it, permanently hiding any new token/param this app ships later behind `undefined`
      // for every returning user. Deep-merging just these three keeps a user's customized values
      // while still backfilling new ones with their default.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<SettingsState>
        return {
          ...current,
          ...p,
          themeTokensLight: { ...current.themeTokensLight, ...p.themeTokensLight },
          themeTokensDark: { ...current.themeTokensDark, ...p.themeTokensDark },
          sampler: { ...current.sampler, ...p.sampler },
        }
      },
    },
  ),
)
