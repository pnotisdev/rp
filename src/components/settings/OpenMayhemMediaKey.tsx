import { useSettingsStore } from '@/lib/store/useSettingsStore'
import { TextField } from '@/components/ui/Field'
import { OpenMayhemSetup } from './OpenMayhemSetup'

export function OpenMayhemMediaKey() {
  const key = useSettingsStore((s) => s.openMayhemApiKey)
  const setKey = useSettingsStore((s) => s.setOpenMayhemApiKey)
  return <>
    <OpenMayhemSetup media />
    <TextField label="OpenMayhem API key" type="password" value={key} onChange={(e) => setKey(e.target.value)}
      hint="One key for OpenMayhem chat, images and voice. Stored in this browser." />
  </>
}
