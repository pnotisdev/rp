import { SelectField, TextAreaField, TextField } from '@/components/ui/Field'
import { Button } from '@/components/ui/Button'
import { Section } from '@/components/ui/Section'
import { TTS_PROVIDER_LABELS, type TtsProviderId } from '@/lib/voice/ttsProviders'
import { OpenMayhemVoiceField } from '@/components/settings/OpenMayhemVoiceField'
import type { CharacterEditorState } from './useCharacterEditor'

export function VoiceTab({ f }: { f: CharacterEditorState }) {
  const {
    explicitVoiceNote, setExplicitVoiceNote, voiceProvider, setVoiceProvider, globalTtsModel,
    usesOpenMayhemVoice, speechModels, voiceId, setVoiceId, verbalTics, setVerbalTics,
    catchphrases, setCatchphrases, dialectNotes, setDialectNotes, sentenceRhythm,
    setSentenceRhythm, detectVoiceFromExamples,
  } = f
  return (
    <>
        <Section
          title="Voice"
          description="Leave blank to use the global voice. A provider override must match Settings → Voice, where its key and model are configured. OpenMayhem voices use that speech model."
          surface="bare"
        >
          <div className="grid grid-cols-1 gap-x-3 sm:grid-cols-2">
            <SelectField label="Provider override" value={voiceProvider} onChange={(e) => setVoiceProvider(e.target.value as TtsProviderId | '')}>
              <option value="">Use global default</option>
              {Object.entries(TTS_PROVIDER_LABELS).map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </SelectField>
            {usesOpenMayhemVoice ? <OpenMayhemVoiceField model={speechModels?.find((m) => m.id === globalTtsModel)} value={voiceId} onChange={setVoiceId} label="Voice / speaker ID override" placeholder="Use global voice" /> : <TextField
              label="Voice / speaker ID override"
              value={voiceId}
              onChange={(e) => setVoiceId(e.target.value)}
              placeholder="Leave blank to use the global voice"
            />}
          </div>
        </Section>
        <Section
          title="Voice fingerprint"
          description="Concrete, recurring speech patterns. Not a general impression like personality, but the actual repeatable tells that make a line unmistakably theirs. Reaches the model every turn alongside their description and personality, plus a short standalone reminder of the single most important catchphrase/tic/register so it doesn't get diluted once a chat runs long."
          surface="bare"
          action={
            <Button variant="ghost" onClick={detectVoiceFromExamples} className="inline-flex items-center">
              Detect from examples
            </Button>
          }
        >
          <div className="grid grid-cols-1 gap-x-3 sm:grid-cols-2">
            <TextField
              label="Verbal tics / filler words"
              value={verbalTics.join(', ')}
              onChange={(e) => setVerbalTics(e.target.value.split(',').map((v) => v.trim()).filter(Boolean))}
              placeholder="well,, I mean, you know?"
              hint="Words or short phrases they lean on, comma separated."
            />
            <TextField
              label="Catchphrases"
              value={catchphrases.join(', ')}
              onChange={(e) => setCatchphrases(e.target.value.split(',').map((v) => v.trim()).filter(Boolean))}
              placeholder="you're impossible, don't push it"
              hint="Signature phrases they reuse across scenes, not just once."
            />
            <TextAreaField
              label="Dialect / register notes"
              rows={2}
              value={dialectNotes}
              onChange={(e) => setDialectNotes(e.target.value)}
              placeholder="Clipped and formal, never contracts a verb. Or: Kansai-ben, drops word endings. Or: never swears, even when hurt."
              hint="Formality, slang density, sentence complexity, and how they handle taboo language all belong here too. Your own words, not a fixed list."
              className="sm:col-span-2"
            />
            <TextField
              label="Sentence rhythm"
              value={sentenceRhythm}
              onChange={(e) => setSentenceRhythm(e.target.value)}
              placeholder="Short and clipped. Or: long, winding, rarely a full stop."
              className="sm:col-span-2"
            />
          </div>
          <p className="mt-2 text-[11px] text-text-muted">
            "Detect from examples" reads this card's own example dialogue and greetings for patterns that actually recur. It never calls the model, so it's instant and never wrong about what's on the page, but it can only find what's
            already written. It adds to what's here rather than replacing it; edit or remove anything it gets wrong.
          </p>
          <div className="mt-4">
            <TextAreaField
              label="Explicit-scene voice note"
              rows={2}
              value={explicitVoiceNote}
              onChange={(e) => setExplicitVoiceNote(e.target.value)}
              placeholder="Goes quieter and shorter, not louder. Full sentences stop happening. Or: gets mouthier and more in control, not less."
              hint="1-2 lines on how this specific voice holds up, cracks, or changes under strain during an explicit scene. Only used while the explicit content rating is on; leave blank to fall back to a generic stay-in-character instruction."
            />
          </div>
        </Section>
  </>
  )
}
