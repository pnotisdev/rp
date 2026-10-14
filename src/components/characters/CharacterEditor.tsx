import type { Character } from '@/lib/characters/cardSpec'
import { Button } from '@/components/ui/Button'
import { MenuButton } from '@/components/ui/MenuButton'
import { downloadJson, downloadPng } from '@/lib/characters/importExport'
import { getGiftCatalog } from '@/lib/dating/gifts'
import { EditorShell } from '@/components/ui/EditorShell'
import { GenerateExpressionSetDialog } from './GenerateExpressionSetDialog'
import { GenerateCharacterDialog } from './GenerateCharacterDialog'
import { TemplateGallery } from './TemplateGallery'
import { IdentityTab } from './editor/IdentityTab'
import { LifeTab } from './editor/LifeTab'
import { VisualNovelTab } from './editor/VisualNovelTab'
import { DatingTab } from './editor/DatingTab'
import { WorldSimTab } from './editor/WorldSimTab'
import { VoiceTab } from './editor/VoiceTab'
import { AdvancedTab } from './editor/AdvancedTab'
import { useCharacterEditor } from './editor/useCharacterEditor'

export function CharacterEditor(props: {
  character: Character | null
  onSaved: (id: string) => void
  onDeleted: () => void
  start?: 'blank' | 'template' | 'generate'
}) {
  const f = useCharacterEditor(props)
  const {
    character, onDeleted, avatarDataUrl, exportPack, tab, setTab, form, setForm, sprites, setSprites,
    showExpressionSetDialog, setShowExpressionSetDialog, applyGenerated,
    showGenerate, setShowGenerate, showTemplates, setShowTemplates, saving, editingWorld, save,
    remove, allExpressions, tabs,
  } = f

  return (
    <EditorShell
      onBack={onDeleted}
      backLabel="Characters"
      eyebrow={character ? 'Character' : 'New character'}
      title={form.name || 'Unnamed character'}
      headerActions={
        character && (
          <MenuButton
            label="Export"
            items={[
              { label: 'Card (JSON)', hint: 'SillyTavern-compatible V2 card', onClick: () => downloadJson(form) },
              { label: 'Card (PNG)', hint: 'The avatar with the card embedded', onClick: () => downloadPng(form, avatarDataUrl) },
              { label: 'Full pack', hint: 'Card, sprites, gallery, gifts and bound world', onClick: exportPack },
            ]}
          />
        )
      }
      tabs={tabs}
      activeTab={tab}
      onTabChange={setTab}
      footer={
        <>
          {character ? (
            <Button variant="danger" onClick={remove}>
              Delete character
            </Button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            {!form.name.trim() && <span className="text-xs text-danger">Name is required</span>}
            <Button variant="primary" onClick={save} disabled={!form.name.trim() || saving}>
              {saving ? 'Saving…' : character ? 'Save changes' : 'Create character'}
            </Button>
          </div>
        </>
      }
    >
      {tab === 'identity' && <IdentityTab f={f} />}

      {tab === 'life' && <LifeTab f={f} />}

      {tab === 'vn' && <VisualNovelTab f={f} />}

      {tab === 'dating' && <DatingTab f={f} />}

      {tab === 'worldsim' && <WorldSimTab f={f} />}

      {tab === 'voice' && <VoiceTab f={f} />}


      {tab === 'advanced' && <AdvancedTab f={f} />}

      {showGenerate && (
        <GenerateCharacterDialog
          onClose={() => setShowGenerate(false)}
          onGenerated={(draft) => {
            applyGenerated(draft)
            setShowGenerate(false)
          }}
          worldTone={editingWorld?.description}
          giftCatalog={getGiftCatalog(editingWorld)}
        />
      )}
      {showTemplates && (
        <TemplateGallery
          onClose={() => setShowTemplates(false)}
          onChoose={(card) => {
            setForm(card)
            setShowTemplates(false)
          }}
        />
      )}
      {showExpressionSetDialog && (
        <GenerateExpressionSetDialog
          expressions={allExpressions.map((exp) => ({ id: exp.id, label: exp.label, hasSprite: !!sprites[exp.id] }))}
          initialPrompt={form.description ? `portrait of ${form.name || 'a character'}, ${form.description}`.slice(0, 300) : ''}
          onGenerated={(expressionId, dataUrl) => setSprites((s) => ({ ...s, [expressionId]: dataUrl }))}
          onClose={() => setShowExpressionSetDialog(false)}
        />
      )}
    </EditorShell>
  )
}

