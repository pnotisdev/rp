import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { GenerationParams } from '@/lib/api/types'
import type { TtsProviderId } from '@/lib/voice/ttsProviders'
import type { RelationshipDifficulty } from '@/lib/dating/relationshipAssist'

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

export const DEFAULT_SAMPLER: GenerationParams = {
  max_context_length: 8192,
  max_length: 300,
  temperature: 0.9,
  top_p: 0.95,
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
  resetTheme: () => void

  // layout / toggles
  chatStyle: ChatStyle
  avatarShape: AvatarShape
  chatWidthRem: number
  fontScale: number
  blurPx: number
  shadowStrength: number
  reducedMotion: boolean
  showTimestamps: boolean
  showTokenCounts: boolean
  tagsAsFolders: boolean
  clickToEdit: boolean
  visualNovelMode: boolean
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
      | 'showTimestamps'
      | 'showTokenCounts'
      | 'tagsAsFolders'
      | 'clickToEdit'
      | 'visualNovelMode',
  ) => void

  // generation
  advancedSamplerMode: boolean
  sampler: GenerationParams
  instructTemplateId: string
  setAdvancedSamplerMode: (v: boolean) => void
  setSampler: (patch: Partial<GenerationParams>) => void
  setInstructTemplateId: (id: string) => void

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
      resetTheme: () =>
        set({
          themeTokensLight: { ...DEFAULT_THEME_TOKENS },
          themeTokensDark: { ...DEFAULT_THEME_TOKENS_DARK },
        }),

      chatStyle: 'flat',
      avatarShape: 'rounded',
      chatWidthRem: 48,
      fontScale: 1,
      blurPx: 0,
      shadowStrength: 1,
      reducedMotion: false,
      showTimestamps: true,
      showTokenCounts: false,
      tagsAsFolders: true,
      clickToEdit: true,
      visualNovelMode: false,
      setChatStyle: (s) => set({ chatStyle: s }),
      setAvatarShape: (s) => set({ avatarShape: s }),
      setLayout: (patch) => set(patch),
      toggleFlag: (key) => set((s) => ({ [key]: !s[key] }) as Partial<SettingsState>),

      advancedSamplerMode: false,
      sampler: { ...DEFAULT_SAMPLER },
      instructTemplateId: 'plain-chat',
      setAdvancedSamplerMode: (v) => set({ advancedSamplerMode: v }),
      setSampler: (patch) => set((s) => ({ sampler: { ...s.sampler, ...patch } })),
      setInstructTemplateId: (id) => set({ instructTemplateId: id }),

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

      ttsProvider: 'koboldcpp',
      ttsApiKey: '',
      ttsBaseUrl: '',
      ttsRegion: '',
      ttsVoice: '',
      setVoiceConfig: (patch) => set(patch),
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
