import { BODY_REGIONS } from '@/lib/dating/arousal'
import { BUILT_IN_KINKS } from '@/lib/dating/kinks'
import { ImagePlus, Plus, X } from 'lucide-react'
import type { RelationshipStage } from '@/lib/types'
import { NumberField, SelectField, TextAreaField, TextField } from '@/components/ui/Field'
import { Toggle } from '@/components/ui/Toggle'
import { Section } from '@/components/ui/Section'
import { ListEditor } from '@/components/ui/ListEditor'
import { GenerateImageButton } from '@/components/ui/GenerateImageButton'
import { getGiftCatalog } from '@/lib/dating/gifts'
import type { CharacterEditorState } from './useCharacterEditor'

export function DatingTab({ f }: { f: CharacterEditorState }) {
  const {
    form, giftPreferences, giftLikes, setGiftLikes, giftDislikes, setGiftDislikes, loveLanguage,
    setLoveLanguage, gallery, relationshipStarters, dateModeOptOut, setDateModeOptOut,
    sensitiveRegions, setSensitiveRegions, unresponsiveRegions, setUnresponsiveRegions,
    offLimitRegions, setOffLimitRegions, likedKinks, setLikedKinks, dislikedKinks,
    setDislikedKinks, hardLimitKinks, setHardLimitKinks, editingWorld, setGiftPreference,
    addGalleryEntry, updateGalleryEntry, removeGalleryEntry, pickGalleryImage, addGalleryVariant,
    removeGalleryVariant, addRelationshipStarter, updateRelationshipStarter,
    removeRelationshipStarter,
  } = f
  return (
    <div className="space-y-10">
      <Section
        title="CG gallery"
        description="Unlockable images shown in the Gallery tab. By warmth threshold, story beat, or (for endings) reaching Sweethearts."
        surface="bare"
      >
        <ListEditor
          items={gallery}
          getKey={(g) => g.id}
          onAdd={addGalleryEntry}
          onRemove={(g) => removeGalleryEntry(g.id)}
          addLabel="Add CG"
          emptyHint="No gallery images yet."
          renderItem={(entry) => (
            <div className="space-y-2">
              <div className="flex items-start gap-3">
                <label className="portrait-frame relative block h-16 w-24 shrink-0 cursor-pointer overflow-hidden rounded-lg border border-dashed border-border bg-bg-elevated" aria-label="Change CG image">
                  {entry.imageUrl ? (
                    <img src={entry.imageUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <span className="flex h-full w-full items-center justify-center">
                      <ImagePlus size={14} strokeWidth={1.5} className="text-text-muted" />
                    </span>
                  )}
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="hidden"
                    onChange={(e) => e.target.files?.[0] && pickGalleryImage(entry.id, e.target.files[0])}
                  />
                </label>
                <div className="relative shrink-0 self-center">
                  <GenerateImageButton
                    label={`Generate "${entry.title}" with AI`}
                    initialPrompt={[
                      form.description ? `${form.name || 'a character'}, ${form.description}` : form.name,
                      entry.unlockHint,
                      entry.title,
                    ]
                      .filter(Boolean)
                      .join(', ')
                      .slice(0, 300)}
                    width={1216}
                    height={832}
                    onGenerated={(dataUrl) => updateGalleryEntry(entry.id, { imageUrl: dataUrl })}
                  />
                </div>
                <div className="flex-1">
                  <TextField label="Title" value={entry.title} onChange={(e) => updateGalleryEntry(entry.id, { title: e.target.value })} />
                </div>
              </div>
              {/* Item 11: extra alternates for this same CG — hidden until there's a primary image to vary. */}
              {entry.imageUrl && (
                <div className="flex flex-wrap items-center gap-1">
                  <span className="mr-1 text-[11px] text-text-muted">Variants</span>
                  {(entry.variants ?? []).map((url, i) => (
                    <div key={i} className="group/variant relative h-10 w-14 shrink-0 overflow-hidden rounded-md ring-1 ring-border">
                      <img src={url} alt="" className="h-full w-full object-cover" />
                      <button
                        type="button"
                        onClick={() => removeGalleryVariant(entry.id, i)}
                        aria-label={`Remove variant ${i + 1} of ${entry.title}`}
                        className="absolute inset-0 hidden items-center justify-center bg-black/60 text-white group-hover/variant:flex"
                      >
                        <X size={12} strokeWidth={2.5} />
                      </button>
                    </div>
                  ))}
                  <label
                    title={`Add a variant for "${entry.title}". Picked alongside the primary image for visual variety`}
                    className="flex h-10 w-14 shrink-0 cursor-pointer items-center justify-center rounded-md border border-dashed border-border text-text-muted hover:text-text"
                  >
                    <Plus size={13} strokeWidth={2} />
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      className="hidden"
                      onChange={(e) => e.target.files?.[0] && addGalleryVariant(entry.id, e.target.files[0])}
                    />
                  </label>
                </div>
              )}
              <div className="grid grid-cols-1 gap-x-3 sm:grid-cols-2">
                <TextField
                  label="Unlock hint"
                  value={entry.unlockHint ?? ''}
                  onChange={(e) => updateGalleryEntry(entry.id, { unlockHint: e.target.value })}
                  placeholder="Confess under the lanterns"
                />
                <NumberField
                  label="Unlock warmth"
                  value={entry.unlockAffection}
                  onChange={(e) => updateGalleryEntry(entry.id, { unlockAffection: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })}
                />
                <TextField
                  label="Required scene flags"
                  value={(entry.requiredFlags ?? []).join(', ')}
                  onChange={(e) => updateGalleryEntry(entry.id, { requiredFlags: e.target.value.split(',').map((v) => v.trim()).filter(Boolean) })}
                  placeholder="first_date, confession"
                  className="sm:col-span-2"
                />
              </div>
              <Toggle
                checked={entry.isEnding ?? false}
                onChange={(v) => updateGalleryEntry(entry.id, { isEnding: v || undefined })}
                label="Ending"
                description="Unlocks the moment the relationship reaches Sweethearts, ignoring the fields above. A once-per-relationship epilogue."
              />
              {!entry.isEnding && (
                <div className="grid grid-cols-1 gap-x-3 gap-y-2 rounded-lg bg-bg-sunken p-3 sm:grid-cols-2">
                  <SelectField
                    label="Auto-show full-bleed when…"
                    hint="Once unlocked (above), swaps this in for the ordinary sprite/background live on the VN stage. No need to browse the Gallery to see it."
                    value={entry.autoTrigger?.kind ?? 'none'}
                    onChange={(e) => {
                      const kind = e.target.value
                      if (kind === 'none') return updateGalleryEntry(entry.id, { autoTrigger: undefined })
                      if (kind === 'intimacyPhase') return updateGalleryEntry(entry.id, { autoTrigger: { kind, phase: 'peak' } })
                      if (kind === 'catalogAction') return updateGalleryEntry(entry.id, { autoTrigger: { kind, optionId: '' } })
                      if (kind === 'sceneFlag') return updateGalleryEntry(entry.id, { autoTrigger: { kind, flag: '' } })
                      return updateGalleryEntry(entry.id, { autoTrigger: { kind: 'relationshipStage', stage: 'sweethearts' } })
                    }}
                  >
                    <option value="none">Never (Gallery only)</option>
                    <option value="intimacyPhase">An intimacy phase</option>
                    <option value="catalogAction">A specific catalog action</option>
                    <option value="sceneFlag">A scene flag</option>
                    <option value="relationshipStage">Reaching a relationship stage</option>
                  </SelectField>
                  {entry.autoTrigger?.kind === 'intimacyPhase' && (
                    <SelectField
                      label="Phase"
                      value={entry.autoTrigger.phase}
                      onChange={(e) => updateGalleryEntry(entry.id, { autoTrigger: { kind: 'intimacyPhase', phase: e.target.value as 'building' | 'peak' } })}
                    >
                      <option value="building">Building</option>
                      <option value="peak">Peak</option>
                    </SelectField>
                  )}
                  {entry.autoTrigger?.kind === 'catalogAction' && (
                    <TextField
                      label="Catalog action id"
                      value={entry.autoTrigger.optionId}
                      onChange={(e) => updateGalleryEntry(entry.id, { autoTrigger: { kind: 'catalogAction', optionId: e.target.value.trim() } })}
                      placeholder="toy-vibrator"
                      hint="The unlockable's id, e.g. from the Dating sim tab's intimacy catalog."
                    />
                  )}
                  {entry.autoTrigger?.kind === 'sceneFlag' && (
                    <TextField
                      label="Scene flag"
                      value={entry.autoTrigger.flag}
                      onChange={(e) => updateGalleryEntry(entry.id, { autoTrigger: { kind: 'sceneFlag', flag: e.target.value.trim() } })}
                      placeholder="first_kiss"
                    />
                  )}
                  {entry.autoTrigger?.kind === 'relationshipStage' && (
                    <SelectField
                      label="Stage"
                      value={entry.autoTrigger.stage}
                      onChange={(e) =>
                        updateGalleryEntry(entry.id, { autoTrigger: { kind: 'relationshipStage', stage: e.target.value as RelationshipStage } })
                      }
                    >
                      <option value="near_strangers">Near strangers</option>
                      <option value="acquaintances">Acquaintances</option>
                      <option value="warming_up">Warming up</option>
                      <option value="getting_close">Getting close</option>
                      <option value="close">Close</option>
                      <option value="sweethearts">Sweethearts</option>
                    </SelectField>
                  )}
                </div>
              )}
            </div>
          )}
        />
      </Section>

      <Section
        title="Gift preferences"
        description="The free-text fields feed the model so it can react in character; the numeric scores (−2 disliked … 3 favorite) drive the mechanical warmth gain."
        surface="bare"
      >
        <div className="grid grid-cols-1 gap-x-3 sm:grid-cols-2">
          <TextField
            label="Loves gifts like"
            value={giftLikes.join(', ')}
            onChange={(e) => setGiftLikes(e.target.value.split(',').map((v) => v.trim()).filter(Boolean))}
            placeholder="thoughtful books, anything handmade"
          />
          <TextField
            label="Not moved by gifts like"
            value={giftDislikes.join(', ')}
            onChange={(e) => setGiftDislikes(e.target.value.split(',').map((v) => v.trim()).filter(Boolean))}
            placeholder="anything flashy or impersonal"
          />
          <TextField
            label="Love language"
            value={loveLanguage}
            onChange={(e) => setLoveLanguage(e.target.value)}
            placeholder="quality time, acts of service"
            className="sm:col-span-2"
          />
        </div>
        <div className="mt-2 space-y-1.5">
          {getGiftCatalog(editingWorld).map((gift) => (
            <div key={gift.id} className="flex items-center justify-between gap-3 rounded-lg bg-bg-sunken px-3 py-2">
              <div>
                <div className="text-sm text-text">{gift.name}</div>
                <div className="text-[11px] text-text-muted">{gift.rarity}</div>
              </div>
              <input
                type="number"
                min={-2}
                max={3}
                value={Number(giftPreferences[gift.id] ?? 0)}
                onChange={(e) => setGiftPreference(gift.id, Number(e.target.value) || 0)}
                className="w-16 rounded-lg border border-border bg-bg-elevated px-2 py-1.5 text-center text-sm text-text outline-none"
                aria-label={`Preference score for ${gift.name}`}
              />
            </div>
          ))}
        </div>
      </Section>

      <Section
        title="Relationship starters"
        description="Narrative starting points offered when creating a new chat (e.g. 'Childhood friends' vs 'Just met'). The blurb seeds the chat's memory so the model knows the backstory."
        surface="bare"
      >
        <ListEditor
          items={relationshipStarters}
          getKey={(s) => s.id}
          onAdd={addRelationshipStarter}
          onRemove={(s) => removeRelationshipStarter(s.id)}
          addLabel="Add starter"
          emptyHint="Every chat starts from a blank slate."
          renderItem={(starter) => (
            <div className="space-y-1">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_140px]">
                <TextField label="Label" value={starter.label} onChange={(e) => updateRelationshipStarter(starter.id, { label: e.target.value })} />
                <NumberField
                  label="Starting warmth"
                  value={starter.startingAffection}
                  onChange={(e) => updateRelationshipStarter(starter.id, { startingAffection: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })}
                />
              </div>
              <TextAreaField
                label="Blurb"
                rows={2}
                value={starter.blurb}
                onChange={(e) => updateRelationshipStarter(starter.id, { blurb: e.target.value })}
                placeholder="We grew up next door to each other and have been close ever since."
              />
            </div>
          )}
        />
      </Section>

      <Section
        title="Touch & limits"
        description="Where this character responds, and what is off the table. The limits here are enforced by removing content from the action set — never offered, never described, never routed to — unlike free-text boundaries, which only reach the model as prose."
        surface="bare"
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField
            label="Especially sensitive"
            value={sensitiveRegions}
            onChange={(e) => setSensitiveRegions(e.target.value)}
            placeholder="neck, ears, inner_thigh"
            hint={`Where this character responds most. Anything not listed sits at the default. Regions: ${BODY_REGIONS.join(', ')}.`}
          />
          <TextField
            label="Does nothing for them"
            value={unresponsiveRegions}
            onChange={(e) => setUnresponsiveRegions(e.target.value)}
            placeholder="feet"
            hint="Touched there, nothing happens — arousal simply doesn't move."
          />
          <TextField
            label="Off-limits (regions)"
            value={offLimitRegions}
            onChange={(e) => setOffLimitRegions(e.target.value)}
            placeholder="feet"
            hint="Enforced, not suggested: any action involving these is removed from the panel and never reaches the prompt."
          />
          <TextField
            label="Into (kinks)"
            value={likedKinks}
            onChange={(e) => setLikedKinks(e.target.value)}
            placeholder="praise, gentle"
            hint={`Speeds a scene involving these up. Built-ins: ${BUILT_IN_KINKS.join(', ')}. Your own names work too.`}
          />
          <TextField
            label="Not into (kinks)"
            value={dislikedKinks}
            onChange={(e) => setDislikedKinks(e.target.value)}
            placeholder="rough"
            hint="Still available, but it slows the scene and reads as reluctance rather than enthusiasm."
          />
          <TextField
            label="Hard limits (kinks)"
            value={hardLimitKinks}
            onChange={(e) => setHardLimitKinks(e.target.value)}
            placeholder="bondage"
            hint="Enforced the same way as off-limits regions — the content is never offered, never described, never routed to."
          />
        </div>
      </Section>

      <Section title="Content & features" description="An authorial opt-out. Unlike every warmth gate elsewhere, this doesn't unlock with progress." surface="bare">
        <div className="rounded-xl bg-bg-sunken px-4 py-1">
          <Toggle
            checked={dateModeOptOut}
            onChange={setDateModeOptOut}
            label="Opt out of date / event mode"
            description="Hides the date button for this character entirely. For one better suited to lore, reference, or plain-assistant use."
          />
        </div>
      </Section>
    </div>
  )
}
