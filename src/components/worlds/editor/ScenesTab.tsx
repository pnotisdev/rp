import { ImagePlus, Moon, Music, Plus, Star, X } from 'lucide-react'
import { BGM_DEFAULT_KEY, SCENE_MOODS } from '@/lib/vn/moods'
import { Button } from '@/components/ui/Button'
import { Section } from '@/components/ui/Section'
import { FileButton } from '@/components/ui/FileButton'
import { GenerateImageButton } from '@/components/ui/GenerateImageButton'
import type { EditorState } from './useWorldEditor'

export function ScenesTab({ f }: { f: EditorState }) {
  const {
    name, description, backgrounds, setBackgrounds, backgroundsNight, backgroundUnlocks,
    defaultBackgroundId, newBackgroundLabel, setNewBackgroundLabel, music, handleBackgroundPick,
    handleBackgroundNightPick, removeBackgroundNight, handleBulkBackgroundPick, handleMusicPick,
    removeMusic, removeBackground, setDefaultBackground, setBackgroundUnlock, addCustomBackground,
    removeCustomBackground, allBackgrounds,
  } = f
  return (
    <div className="space-y-10">
    <Section
      title="Scene backgrounds"
      description="Art per location for Visual Novel mode. The model tags each reply's setting; anything left blank falls back to a placeholder gradient."
      surface="bare"
    >
      <p className="mb-2 text-xs text-text-muted">
        {Object.keys(backgrounds).length}/{allBackgrounds.length} set. The number under each is
        the warmth needed before that background can appear. The <Star size={11} strokeWidth={2} className="mb-0.5 inline text-accent" />{' '}
        marks the opening scene. Where a new chat starts before the model (or nothing, if
        there's no model connected) has tagged one of its own. The small moon toggle on each
        tile switches it to a night variant, shown automatically once the world clock (Clock tab)
        reaches evening or night. Leave it unset to always show the day art.
      </p>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <FileButton onPick={handleBulkBackgroundPick} accept="image/png,image/jpeg,image/webp" multiple>
          <Plus size={14} strokeWidth={2} />
          Bulk upload by filename
        </FileButton>
        <span className="text-[11px] text-text-muted">e.g. classroom_day.png + classroom_night.png → Classroom</span>
      </div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        {allBackgrounds.map((bg) => (
          <div key={bg.id} className="group relative space-y-1.5">
            <label className="portrait-frame relative block aspect-video cursor-pointer overflow-hidden rounded-xl border border-dashed border-border bg-bg-sunken">
              {backgrounds[bg.id] ? (
                <img src={backgrounds[bg.id]} alt="" className="h-full w-full object-cover" />
              ) : (
                <span className="flex h-full w-full items-center justify-center gap-1 text-[11px] text-text-muted">
                  <ImagePlus size={14} strokeWidth={1.5} />
                  {bg.label}
                </span>
              )}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && handleBackgroundPick(bg.id, e.target.files[0])}
              />
              {(bg.custom || backgrounds[bg.id]) && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault()
                    bg.custom ? removeCustomBackground(bg.id) : removeBackground(bg.id)
                  }}
                  aria-label={bg.custom ? `Remove custom location ${bg.label}` : `Remove ${bg.label} background`}
                  className="absolute right-1.5 top-1.5 hidden h-6 w-6 items-center justify-center rounded-lg bg-bg-elevated/90 text-text-muted hover:text-danger group-hover:flex"
                >
                  ✕
                </button>
              )}
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault()
                  setDefaultBackground(bg.id)
                }}
                aria-pressed={defaultBackgroundId === bg.id}
                aria-label={
                  defaultBackgroundId === bg.id
                    ? `Unset ${bg.label} as the opening scene`
                    : `Set ${bg.label} as the opening scene`
                }
                className={`absolute left-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-lg bg-bg-elevated/90 transition-opacity ${
                  defaultBackgroundId === bg.id
                    ? 'text-accent opacity-100'
                    : 'text-text-muted opacity-0 hover:text-accent group-hover:opacity-100'
                }`}
              >
                <Star size={13} strokeWidth={2} fill={defaultBackgroundId === bg.id ? 'currentColor' : 'none'} />
              </button>
            </label>
            <div className="absolute bottom-8 right-1.5 hidden group-hover:block">
              <GenerateImageButton
                label={`Generate ${bg.label} with AI`}
                initialPrompt={description ? `${bg.label}, ${description}`.slice(0, 300) : `${bg.label}, ${name || 'a scene'}`}
                width={1216}
                height={832}
                onGenerated={(dataUrl) => setBackgrounds((b) => ({ ...b, [bg.id]: dataUrl }))}
              />
            </div>
            <div className="flex items-center justify-between gap-2 px-0.5">
              <span className="truncate text-[11px] text-text-muted">{bg.label}</span>
              <div className="flex items-center gap-1">
                <label
                  title={backgroundsNight[bg.id] ? `Replace ${bg.label}'s night art` : `Add night art for ${bg.label}`}
                  className={`relative flex h-6 w-6 cursor-pointer items-center justify-center rounded-md ${
                    backgroundsNight[bg.id] ? 'bg-accent/20 text-accent' : 'bg-bg-sunken text-text-muted hover:text-text'
                  }`}
                >
                  <Moon size={12} strokeWidth={2} fill={backgroundsNight[bg.id] ? 'currentColor' : 'none'} />
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="hidden"
                    onChange={(e) => e.target.files?.[0] && handleBackgroundNightPick(bg.id, e.target.files[0])}
                  />
                </label>
                {backgroundsNight[bg.id] && (
                  <button
                    type="button"
                    onClick={() => removeBackgroundNight(bg.id)}
                    aria-label={`Remove ${bg.label}'s night art`}
                    className="flex h-6 w-6 items-center justify-center rounded-md bg-bg-sunken text-text-muted hover:text-danger"
                  >
                    <X size={11} strokeWidth={2.5} />
                  </button>
                )}
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={Number(backgroundUnlocks[bg.id] ?? 0)}
                  onChange={(e) => setBackgroundUnlock(bg.id, Number(e.target.value) || 0)}
                  className="w-12 rounded-md bg-bg-sunken px-1.5 py-0.5 text-center text-[11px] text-text outline-none"
                  aria-label={`Unlock warmth for ${bg.label}`}
                />
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-4 flex items-center gap-2">
        <input
          value={newBackgroundLabel}
          onChange={(e) => setNewBackgroundLabel(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addCustomBackground()}
          placeholder="Custom location (e.g. Her family)'s bookshop"
          className="flex-1 rounded-xl border border-border bg-bg-elevated px-3 py-2 text-sm text-text outline-none focus:border-accent/70"
        />
        <Button onClick={addCustomBackground} disabled={!newBackgroundLabel.trim()} className="flex items-center gap-1.5">
          <Plus size={14} strokeWidth={2} />
          Add
        </Button>
      </div>
    </Section>

    <Section
      title="Background music"
      description="One looping track per scene mood, for Visual Novel mode. The model tags each reply's mood; the matching track crossfades in. “Default” plays whenever nothing more specific applies. Set at least that one. Turn playback on with the volume slider in Settings → Appearance."
      surface="bare"
    >
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {[{ id: BGM_DEFAULT_KEY, label: 'Default', hint: 'The fallback loop. Plays when no mood-specific track is set or tagged' }, ...SCENE_MOODS].map(
          (slot) => (
            <div
              key={slot.id}
              className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 ${
                music[slot.id] ? 'border-accent/40 bg-accent/5' : 'border-dashed border-border'
              }`}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-sm text-text">
                  {music[slot.id] ? <Music size={13} strokeWidth={2} className="shrink-0 text-accent" /> : null}
                  {slot.label}
                </div>
                <p className="truncate text-[11px] text-text-muted">{slot.hint}</p>
              </div>
              <label className="shrink-0 cursor-pointer rounded-lg bg-bg-sunken px-2.5 py-1.5 text-xs text-text-muted transition-colors hover:text-text">
                {music[slot.id] ? 'Replace' : 'Upload'}
                <input
                  type="file"
                  accept="audio/*"
                  className="hidden"
                  onChange={(e) => e.target.files?.[0] && handleMusicPick(slot.id, e.target.files[0])}
                />
              </label>
              {music[slot.id] && (
                <button
                  type="button"
                  onClick={() => removeMusic(slot.id)}
                  aria-label={`Remove ${slot.label} music`}
                  className="shrink-0 text-text-muted hover:text-danger"
                >
                  <X size={14} strokeWidth={2} />
                </button>
              )}
            </div>
          ),
        )}
      </div>
    </Section>
    </div>
  )
}
