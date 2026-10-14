import { ImagePlus, Plus, X } from 'lucide-react'
import { BASE_OUTFIT_ID, outfitCoverage } from '@/lib/vn/outfits'
import { combinedSceneFlags } from '@/lib/dating/stage'
import { TextField } from '@/components/ui/Field'
import { Button } from '@/components/ui/Button'
import { Section } from '@/components/ui/Section'
import { FileButton } from '@/components/ui/FileButton'
import { GenerateImageButton } from '@/components/ui/GenerateImageButton'
import type { CharacterEditorState } from './useCharacterEditor'

export function VisualNovelTab({ f }: { f: CharacterEditorState }) {
  const {
    setTab, form, sprites, setSprites, spriteUnlocks, spriteVariants, newExpressionLabel,
    setNewExpressionLabel, outfits, activeOutfit, setActiveOutfit, newOutfitLabel,
    setNewOutfitLabel, setShowExpressionSetDialog, sfxWords, setSfxWords, worldId, editingWorld,
    keyFor, handleSpritePick, handleBulkSpritePick, removeSprite, setSpriteUnlock,
    addSpriteVariant, removeSpriteVariant, addCustomExpression, removeCustomExpression,
    activeOutfitLabel, addOutfit, updateOutfit, removeOutfit, allExpressions,
  } = f
  return (
    <div className="space-y-10">
    {!worldId && (
      <p className="rounded-xl bg-bg-sunken px-4 py-3 text-xs text-text-muted">
        Sprites show in Visual Novel mode, but scene <em>backgrounds</em> come from a world. This character isn't
        bound to one, so VN scenes will fall back to a placeholder gradient. Pick a world in the{' '}
        <button type="button" onClick={() => setTab('identity')} className="text-accent hover:underline">
          Identity tab
        </button>
        .
      </p>
    )}
    <Section
      title="Expressions"
      description="Art per expression so Visual Novel mode shows the right one as the model tags each reply's mood. Blank falls back to the avatar. The small number is the warmth needed to unlock it."
      surface="bare"
    >
      {/* Outfits (`outfits.ts`): a second axis on this grid. */}
      <div className="mb-4 rounded-xl bg-bg-sunken/60 p-3">
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[11px] font-medium text-text-muted">Outfit</span>
          {[{ id: BASE_OUTFIT_ID, label: 'Base' }, ...outfits].map((o) => {
            const cov = outfitCoverage(sprites, o.id, allExpressions.map((e) => e.id))
            const active = activeOutfit === o.id
            return (
              <button
                key={o.id}
                type="button"
                onClick={() => setActiveOutfit(o.id)}
                aria-pressed={active}
                title={`${cov.drawn} of ${cov.total} expressions drawn`}
                className={`rounded-md px-2.5 py-1 text-[11px] leading-none transition-colors ${
                  active ? 'bg-accent text-accent-text' : 'text-text-muted hover:bg-bg-elevated hover:text-text'
                }`}
              >
                {o.label}
                <span className={active ? 'ml-1 opacity-70' : 'ml-1 opacity-50'}>{cov.drawn}</span>
              </button>
            )
          })}
          <input
            value={newOutfitLabel}
            onChange={(e) => setNewOutfitLabel(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addOutfit()}
            placeholder="New outfit (e.g. Swimsuit)"
            aria-label="New outfit name"
            className="ml-1 w-44 rounded-md bg-bg px-2.5 py-1 text-[11px] text-text outline-none focus:border-accent/70"
          />
          <Button onClick={addOutfit} disabled={!newOutfitLabel.trim()} variant="ghost" className="!px-2 !py-1 !text-[11px]">
            <Plus size={12} strokeWidth={2} />
          </Button>
        </div>

        {activeOutfit === BASE_OUTFIT_ID ? (
          <p className="text-[11px] text-text-muted">
            The character's default art. Add an outfit to give them a second look the model can switch to mid-scene. Any expression you don't draw for it falls back to this one.
          </p>
        ) : (
          (() => {
            const outfit = outfits.find((o) => o.id === activeOutfit)
            if (!outfit) return null
            const knownFlags = combinedSceneFlags(editingWorld?.customSceneFlags)
            return (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <label className="flex items-center gap-1.5 text-[11px] text-text-muted">
                  Name
                  <input
                    value={outfit.label}
                    onChange={(e) => updateOutfit(outfit.id, { label: e.target.value })}
                    className="w-32 rounded-md bg-bg px-2 py-1 text-[11px] text-text outline-none"
                  />
                </label>
                <label className="flex items-center gap-1.5 text-[11px] text-text-muted">
                  Unlocks at warmth
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={Number(outfit.unlockAffection ?? 0)}
                    onChange={(e) => updateOutfit(outfit.id, { unlockAffection: Number(e.target.value) || 0 })}
                    className="w-12 rounded-md bg-bg px-1 py-1 text-center text-[11px] text-text outline-none"
                  />
                </label>
                <label
                  className="flex items-center gap-1.5 text-[11px] text-text-muted"
                  title="Coins this outfit has to be bought for in the Relationship panel's Shop before it unlocks, on top of any warmth gate. 0 means it is earned rather than sold. Only outfits with art drawn for them are ever offered for sale."
                >
                  Price
                  <input
                    type="number"
                    min={0}
                    max={999}
                    value={Number(outfit.price ?? 0)}
                    onChange={(e) => updateOutfit(outfit.id, { price: Number(e.target.value) || 0 })}
                    className="w-14 rounded-md bg-bg px-1 py-1 text-center text-[11px] text-text outline-none"
                  />
                </label>
                <label className="flex items-center gap-1.5 text-[11px] text-text-muted" title="The model is never offered this outfit. It only appears if the story unlocks it another way. For a state you don't want picked just because a reply read as suggestive.">
                  <input
                    type="checkbox"
                    checked={!!outfit.manualOnly}
                    onChange={(e) => updateOutfit(outfit.id, { manualOnly: e.target.checked })}
                    className="accent-accent"
                  />
                  Never chosen by the model
                </label>
                <label className="flex items-center gap-1.5 text-[11px] text-text-muted" title="Using an explicit action from the Relationship panel (a position, toy, or activity, not a kissing spot) switches to this outfit automatically. The story tags its own way back out afterwards.">
                  <input
                    type="checkbox"
                    checked={!!outfit.intimate}
                    onChange={(e) => updateOutfit(outfit.id, { intimate: e.target.checked })}
                    className="accent-accent"
                  />
                  Used for intimate scenes
                </label>
                {knownFlags.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1">
                    <span className="text-[11px] text-text-muted">Also needs</span>
                    {knownFlags.map((f) => {
                      const on = (outfit.requiredFlags ?? []).includes(f.id)
                      return (
                        <button
                          key={f.id}
                          type="button"
                          aria-pressed={on}
                          onClick={() =>
                            updateOutfit(outfit.id, {
                              requiredFlags: on
                                ? (outfit.requiredFlags ?? []).filter((x) => x !== f.id)
                                : [...(outfit.requiredFlags ?? []), f.id],
                            })
                          }
                          className={`rounded-md px-2 py-0.5 text-[10px] leading-none transition-colors ${
                            on ? 'bg-accent/20 text-accent ring-1 ring-accent/40' : 'text-text-muted hover:bg-bg-elevated'
                          }`}
                        >
                          {f.label}
                        </button>
                      )
                    })}
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => removeOutfit(outfit.id)}
                  className="ml-auto flex items-center gap-1 text-[11px] text-text-muted hover:text-danger"
                >
                  <X size={11} strokeWidth={2.5} />
                  Delete outfit
                </button>
              </div>
            )
          })()
        )}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <FileButton onPick={handleBulkSpritePick} accept="image/png,image/jpeg,image/webp" multiple>
          <Plus size={14} strokeWidth={2} />
          Bulk upload by filename
        </FileButton>
        <span className="text-[11px] text-text-muted">e.g. laughing.png → Laughing</span>
        <Button onClick={() => setShowExpressionSetDialog(true)} className="flex items-center gap-1.5">
          Generate expression set with AI
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
        {allExpressions.map((exp) => (
          <div key={exp.id} className="group relative flex flex-col items-center gap-1">
            <label className="portrait-frame relative flex h-20 w-full cursor-pointer items-center justify-center overflow-hidden rounded-xl border border-dashed border-border bg-bg-sunken">
              {sprites[keyFor(exp.id)] ? (
                <img src={sprites[keyFor(exp.id)]} alt="" className="h-full w-full object-cover" />
              ) : exp.emoji ? (
                <span className="text-xl opacity-60">{exp.emoji}</span>
              ) : (
                <ImagePlus size={16} strokeWidth={1.5} className="text-text-muted" />
              )}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && handleSpritePick(exp.id, e.target.files[0])}
              />
            </label>
            <div className="flex w-full items-center justify-between gap-1 px-0.5">
              <span className="truncate text-[11px] text-text-muted">{exp.label}</span>
              <input
                type="number"
                min={0}
                max={100}
                value={Number(spriteUnlocks[keyFor(exp.id)] ?? 0)}
                onChange={(e) => setSpriteUnlock(exp.id, Number(e.target.value) || 0)}
                className="w-9 rounded-md bg-bg-sunken px-1 py-0.5 text-center text-[11px] text-text outline-none"
                aria-label={`Unlock warmth for ${exp.label}`}
              />
            </div>
            {/* Item 11: extra alternates for this slot — hidden entirely until there's a primary sprite to vary. */}
            {sprites[keyFor(exp.id)] && (
              <div className="flex w-full flex-wrap items-center gap-1 px-0.5">
                {(spriteVariants[keyFor(exp.id)] ?? []).map((url, i) => (
                  <div key={i} className="group/variant relative h-7 w-7 shrink-0 overflow-hidden rounded-md ring-1 ring-border">
                    <img src={url} alt="" className="h-full w-full object-cover" />
                    <button
                      type="button"
                      onClick={() => removeSpriteVariant(exp.id, i)}
                      aria-label={`Remove variant ${i + 1} of ${exp.label}`}
                      className="absolute inset-0 hidden items-center justify-center bg-black/60 text-white group-hover/variant:flex"
                    >
                      <X size={11} strokeWidth={2.5} />
                    </button>
                  </div>
                ))}
                <label
                  title={`Add a variant for ${exp.label}. Shown alongside the primary art for visual variety`}
                  className="flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md border border-dashed border-border text-text-muted hover:text-text"
                >
                  <Plus size={12} strokeWidth={2} />
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="hidden"
                    onChange={(e) => e.target.files?.[0] && addSpriteVariant(exp.id, e.target.files[0])}
                  />
                </label>
              </div>
            )}
            <div className="absolute -bottom-1 -right-1 hidden group-hover:block">
              <GenerateImageButton
                label={`Generate ${exp.label} with AI`}
                initialPrompt={form.description ? `portrait of ${form.name || 'a character'}, ${form.description}, ${exp.label.toLowerCase()} expression${activeOutfit === BASE_OUTFIT_ID ? '' : `, wearing ${activeOutfitLabel.toLowerCase()}`}`.slice(0, 300) : ''}
                onGenerated={(dataUrl) => setSprites((s) => ({ ...s, [keyFor(exp.id)]: dataUrl }))}
              />
            </div>
            {(exp.custom || sprites[keyFor(exp.id)]) && (
              <button
                type="button"
                onClick={() => (exp.custom ? removeCustomExpression(exp.id) : removeSprite(exp.id))}
                aria-label={exp.custom ? `Remove custom expression ${exp.label}` : `Remove ${exp.label} sprite`}
                className="absolute -right-1 -top-1 hidden h-5 w-5 items-center justify-center rounded-full bg-bg-elevated text-text-muted hover:text-danger group-hover:flex"
              >
                <X size={11} strokeWidth={2.5} />
              </button>
            )}
          </div>
        ))}
      </div>

      <div className="mt-4 flex items-center gap-2">
        <input
          value={newExpressionLabel}
          onChange={(e) => setNewExpressionLabel(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addCustomExpression()}
          placeholder="Custom expression name (e.g. Sly grin)"
          className="flex-1 rounded-xl border border-border bg-bg-elevated px-3 py-2 text-sm text-text outline-none focus:border-accent/70"
        />
        <Button onClick={addCustomExpression} disabled={!newExpressionLabel.trim()} className="flex items-center gap-1.5">
          <Plus size={14} strokeWidth={2} />
          Add
        </Button>
      </div>
    </Section>

    <Section
      title="Sound effects"
      description="This character's own comic sound words, on top of the built-in list and any global ones. A catgirl's “nya, nyaa, mrrp”, an imouto's tics. They get the manga-style burst styling in her messages. Display-only; the model never sees this. Turn the whole feature on/off in Settings → Appearance."
      surface="bare"
    >
      <TextField
        label="Extra sound words"
        hint="Comma separated. Punctuation and length variants are handled automatically (“nya” also matches “Nyaa~”)."
        value={sfxWords.join(', ')}
        onChange={(e) => setSfxWords(e.target.value.split(',').map((v) => v.trim()).filter(Boolean))}
        placeholder="nya, nyaa, mrrp, purr"
      />
    </Section>
    </div>
  )
}
