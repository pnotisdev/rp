import { useSettingsStore } from '@/lib/store/useSettingsStore'
import { IMAGE_BACKEND_LABELS, type ImageBackendId } from '@/lib/api/imageBackend'
import { NOVELAI_IMAGE_MODELS } from '@/lib/api/novelaiImage'
import { TextField, SelectField } from '@/components/ui/Field'
import { Section } from '@/components/ui/Section'
import { SettingsPage } from '@/components/ui/SettingsPage'

const IMAGE_BACKENDS = Object.keys(IMAGE_BACKEND_LABELS) as ImageBackendId[]

const LOCAL_BACKEND_DEFAULTS: Record<'a1111' | 'comfyui' | 'swarmui', string> = {
  a1111: 'http://127.0.0.1:7860',
  comfyui: 'http://127.0.0.1:8188',
  swarmui: 'http://127.0.0.1:7801',
}

/**
 * Section 11's "image/asset generation backends" — none of these four has been run against a real
 * server this session (no local install, and NovelAI needs the same paid subscription its text
 * backend does). Built to each project's own documented API, same honesty bar as every other
 * unverified backend in this app: sanity-check the first real generation before trusting it. This
 * settings page only configures a shared connection; where a generation actually happens (a
 * character portrait, a VN sprite, a background) is a separate, much smaller follow-up — see
 * ROADMAP.md section 11's own remaining "generate directly into a slot" item.
 */
export function ImageGenSettings() {
  const imageBackend = useSettingsStore((s) => s.imageBackend)
  const imageBackendBaseUrl = useSettingsStore((s) => s.imageBackendBaseUrl)
  const imageBackendUsername = useSettingsStore((s) => s.imageBackendUsername)
  const imageBackendPassword = useSettingsStore((s) => s.imageBackendPassword)
  const imageBackendModel = useSettingsStore((s) => s.imageBackendModel)
  const setImageBackendConfig = useSettingsStore((s) => s.setImageBackendConfig)

  const isLocal = imageBackend === 'a1111' || imageBackend === 'comfyui' || imageBackend === 'swarmui'

  return (
    <SettingsPage>
      <Section
        title="Image generation"
        description="Generates portraits, sprites, gallery CGs, and backgrounds — none of these four have been run against a real server yet (see ROADMAP.md section 11); each is built to that project's own documented API."
        surface="bare"
      >
        <SelectField
          label="Backend"
          value={imageBackend}
          onChange={(e) => {
            const backend = e.target.value as ImageBackendId
            const patch: Parameters<typeof setImageBackendConfig>[0] = { imageBackend: backend }
            // A fresh local-backend pick with no URL yet gets a sane default instead of a blank
            // field — the same convenience the chat-backend provider picker already gives.
            if (backend !== 'novelai-image' && !imageBackendBaseUrl) {
              patch.imageBackendBaseUrl = LOCAL_BACKEND_DEFAULTS[backend]
            }
            setImageBackendConfig(patch)
          }}
        >
          {IMAGE_BACKENDS.map((id) => (
            <option key={id} value={id}>
              {IMAGE_BACKEND_LABELS[id]}
            </option>
          ))}
        </SelectField>

        {isLocal && (
          <TextField
            label="Server URL"
            value={imageBackendBaseUrl}
            onChange={(e) => setImageBackendConfig({ imageBackendBaseUrl: e.target.value })}
            placeholder={LOCAL_BACKEND_DEFAULTS[imageBackend as 'a1111' | 'comfyui' | 'swarmui']}
          />
        )}

        {imageBackend === 'a1111' && (
          <>
            <p className="mb-2 text-xs text-text-muted">
              Requires launching with <code className="font-mono">--api</code> (add{' '}
              <code className="font-mono">--api-auth user:pass</code> too if this server is reachable
              by anyone else on your network).
            </p>
            <TextField
              label="Username (optional)"
              value={imageBackendUsername}
              onChange={(e) => setImageBackendConfig({ imageBackendUsername: e.target.value })}
            />
            <TextField
              label="Password (optional)"
              type="password"
              value={imageBackendPassword}
              onChange={(e) => setImageBackendConfig({ imageBackendPassword: e.target.value })}
            />
          </>
        )}

        {imageBackend === 'comfyui' && (
          <p className="mb-2 text-xs text-text-muted">
            Uses ComfyUI's own default txt2img workflow (checkpoint → positive/negative prompt →
            sampler → save) with your prompt and settings substituted in — a heavily customized
            workflow of your own isn't supported yet.
          </p>
        )}

        {imageBackend === 'swarmui' && (
          <p className="mb-2 text-xs text-text-muted">
            No login needed for a default local install. If yours requires an account, this isn't
            wired up yet — sessions are requested anonymously.
          </p>
        )}

        {(isLocal || imageBackend === 'novelai-image') && (
          <TextField
            label={imageBackend === 'novelai-image' ? 'Model' : 'Checkpoint / model (optional)'}
            value={imageBackendModel}
            onChange={(e) => setImageBackendConfig({ imageBackendModel: e.target.value })}
            placeholder={imageBackend === 'novelai-image' ? NOVELAI_IMAGE_MODELS[0] : 'Leave blank to use whatever is already loaded'}
            list={imageBackend === 'novelai-image' ? 'novelai-image-models' : undefined}
          />
        )}
        {imageBackend === 'novelai-image' && (
          <datalist id="novelai-image-models">
            {NOVELAI_IMAGE_MODELS.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        )}

        {imageBackend === 'novelai-image' && (
          <TextField
            label="API key"
            type="password"
            value={imageBackendUsername}
            onChange={(e) => setImageBackendConfig({ imageBackendUsername: e.target.value })}
            hint="Same NovelAI account as the chat backend, if you use both — not shared automatically since either can be configured alone."
          />
        )}

        <p className="mt-2 text-xs text-text-muted">
          {imageBackend === 'novelai-image'
            ? 'Keys are stored only in this browser and sent directly to NovelAI — never through any other server.'
            : 'Requests go straight from this browser to the server URL above — never through any other server.'}
        </p>
      </Section>
    </SettingsPage>
  )
}
