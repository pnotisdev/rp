import { useSettingsStore } from '@/lib/store/useSettingsStore'
import { isOpenMayhem } from '@/lib/api/openMayhem'
import { TextField } from '@/components/ui/Field'
import { Button } from '@/components/ui/Button'
import { OpenMayhemSetup } from './OpenMayhemSetup'

export function OpenMayhemMediaKey() {
  const key = useSettingsStore((s) => s.openMayhemApiKey)
  const setKey = useSettingsStore((s) => s.setOpenMayhemApiKey)
  const chatKey = useSettingsStore((s) => s.chatBackendApiKey)
  const chatUrl = useSettingsStore((s) => s.chatBackendBaseUrl)
  const chatBackend = useSettingsStore((s) => s.chatBackend)
  return <>
    <OpenMayhemSetup media />
    <TextField label="OpenMayhem media API key" type="password" value={key} onChange={(e) => setKey(e.target.value)}
      hint="Shared by OpenMayhem Images and Voice. Stored in this browser; requests pass through RP Suite's local relay to OpenMayhem." />
    {chatBackend === 'openai-compatible' && isOpenMayhem(chatUrl) && chatKey && <Button onClick={() => setKey(chatKey)}>Use OpenMayhem chat key</Button>}
  </>
}
