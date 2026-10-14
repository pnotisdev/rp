import { useState, type ReactNode } from 'react'
import { mcpApi, mcpServersApi } from '@/lib/api/client'
import { useApiQuery } from '@/lib/hooks/useApiQuery'
import { claudeCodeCommand, claudeDesktopConfig, connectorUrl, localUrl, maskToken, tunnelCommands, type McpEndpoint } from '@/lib/mcp/snippets'
import { errorMessage, toastError, toastSuccess } from '@/lib/store/useToastStore'
import { Button } from '@/components/ui/Button'
import { confirmDialog } from '@/lib/store/useConfirmStore'
import { TextField } from '@/components/ui/Field'
import { Section } from '@/components/ui/Section'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { SettingsPage } from '@/components/ui/SettingsPage'
import { Toggle } from '@/components/ui/Toggle'
import { AssistantWorkspaceSettings } from './AssistantWorkspaceSettings'
import { BRAND } from '@/lib/brand'

type Client = 'claude-code' | 'claude-desktop' | 'chatgpt' | 'other'

const CLIENTS: { value: Client; label: string }[] = [
  { value: 'claude-code', label: 'Claude Code' },
  { value: 'claude-desktop', label: 'Claude Desktop' },
  { value: 'chatgpt', label: 'ChatGPT' },
  { value: 'other', label: 'Other' },
]

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    toastSuccess('Copied')
  } catch {
    toastError('Could not copy. Select the text and copy it by hand.')
  }
}

/** Monospace block with a Copy button; `shown` is what is displayed, `text` is what gets copied. */
function Snippet({ text, shown = text }: { text: string; shown?: string }) {
  return (
    <div className="relative">
      <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-xl bg-bg-sunken p-3 pr-16 font-mono text-xs leading-relaxed text-text">{shown}</pre>
      <button
        type="button"
        onClick={() => void copy(text)}
        className="absolute right-2 top-2 rounded-lg border border-border bg-bg-elevated px-2.5 py-1 text-xs font-medium text-text-muted transition-colors hover:text-text"
      >
        Copy
      </button>
    </div>
  )
}

function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-bg-sunken text-[11px] font-medium text-text-muted">{n}</span>
      <div className="min-w-0 flex-1 space-y-2 text-[13px] leading-relaxed text-text-muted">{children}</div>
    </li>
  )
}

function ConnectGuide({ client, endpoint, reveal }: { client: Client; endpoint: McpEndpoint; reveal: boolean }) {
  const [tunnel, setTunnel] = useState('')
  const hidden = reveal ? endpoint.token : maskToken(endpoint.token)

  if (client === 'claude-code') {
    return (
      <ol className="space-y-4">
        <Step n={1}>
          <p>Run this once in a terminal. {BRAND.name} needs to be running.</p>
          <Snippet text={claudeCodeCommand(endpoint)} shown={claudeCodeCommand(endpoint, hidden)} />
        </Step>
        <Step n={2}>
          <p>Start Claude Code and ask it to build something, for example "make me a rival character for my lighthouse story".</p>
        </Step>
      </ol>
    )
  }

  if (client === 'claude-desktop') {
    return (
      <ol className="space-y-4">
        <Step n={1}>
          <p>
            In Claude Desktop open Settings, Developer, Edit Config. Add this to <code className="text-text">claude_desktop_config.json</code>, then restart Claude. It needs{' '}
            <a className="underline hover:text-text" href="https://nodejs.org" target="_blank" rel="noreferrer">
              Node.js
            </a>{' '}
            installed.
          </p>
          <Snippet text={claudeDesktopConfig(endpoint)} shown={claudeDesktopConfig(endpoint, hidden)} />
        </Step>
        <Step n={2}>
          <p>The {BRAND.name} tools appear in the chat's tools menu. Prompts such as "Design a character" show up too.</p>
        </Step>
      </ol>
    )
  }

  if (client === 'chatgpt') {
    const url = connectorUrl(tunnel, endpoint.token)
    return (
      <ol className="space-y-4">
        <Step n={1}>
          <p>
            ChatGPT connects from the internet, so your computer needs a temporary public address. Start a tunnel to the agent port (<code className="text-text">{endpoint.mcpPort}</code>) with one of these:
          </p>
          <Snippet text={tunnelCommands(endpoint).join('\n')} />
        </Step>
        <Step n={2}>
          <p>Paste the address the tunnel prints.</p>
          <TextField label="Tunnel address" value={tunnel} onChange={(e) => setTunnel(e.target.value)} placeholder="https://something.trycloudflare.com" className="!mb-0" />
        </Step>
        <Step n={3}>
          <p>
            In ChatGPT open Settings, Connectors, turn on Developer mode, and add a custom connector with this address. Choose "No authentication", because the key is already part of the address.
          </p>
          {url ? <Snippet text={url} shown={reveal ? url : url.replace(endpoint.token, maskToken(endpoint.token))} /> : <p className="rounded-xl bg-bg-sunken p-3 text-xs">Your connector address appears here once you paste the tunnel address.</p>}
        </Step>
        <Step n={4}>
          <p className="text-warning">Anyone holding that address can use your library until you close the tunnel. Close it when you are done, and make a new key if you shared the address.</p>
        </Step>
      </ol>
    )
  }

  return (
    <div className="space-y-3 text-[13px] leading-relaxed text-text-muted">
      <p>Any client that speaks MCP over HTTP can connect. Send requests to this address with the key as a bearer token.</p>
      <Snippet text={localUrl(endpoint)} />
      <Snippet text={`Authorization: Bearer ${endpoint.token}`} shown={`Authorization: Bearer ${hidden}`} />
      <p>
        A client that cannot set headers can use <code className="text-text">{localUrl(endpoint)}/&lt;key&gt;</code> instead. Clients that only launch programs can run{' '}
        <code className="text-text">node scripts/rp-mcp.mjs</code> with <code className="text-text">RP_MCP_URL</code> and <code className="text-text">RP_MCP_TOKEN</code> set.
      </p>
    </div>
  )
}

/** Other MCP servers the in-app Assistant can borrow tools from. */
function ConnectedServers() {
  const servers = useApiQuery('mcp-servers', () => mcpServersApi.list(), []) ?? []
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)

  const connect = async () => {
    setBusy(true)
    try {
      const added = await mcpServersApi.add({ name, url, token: token || undefined })
      toastSuccess(`Connected ${added.name}: ${added.tools ?? 0} ${added.tools === 1 ? 'tool' : 'tools'}`)
      setName('')
      setUrl('')
      setToken('')
    } catch (e) {
      toastError(errorMessage(e).replace(/^POST \S+ failed \(\d+\): /, '').replace(/^\{"error":"(.*)"\}$/, '$1'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Section
      title="Connect tools to the Assistant"
      description={`Give the Assistant more tools by connecting other MCP servers, such as web search or notes. They must be reachable over http or https. Tools that may change things outside ${BRAND.name} are only used when the Assistant is set to Look and change.`}
    >
      {servers.length > 0 && (
        <ul className="mb-4 space-y-2">
          {servers.map((s) => (
            <li key={s.id} className="flex items-center gap-3 rounded-xl bg-bg-sunken px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-text">{s.name}</div>
                <div className="truncate text-[11px] text-text-muted">
                  {s.url}
                  {s.tools !== null ? ` · ${s.tools} ${s.tools === 1 ? 'tool' : 'tools'}` : ''}
                </div>
              </div>
              <Button variant="ghost" onClick={() => void mcpServersApi.remove(s.id).catch((e) => toastError(errorMessage(e)))}>
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="grid gap-x-3 sm:grid-cols-2">
        <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Web search" />
        <TextField label="Key (if it needs one)" type="password" value={token} onChange={(e) => setToken(e.target.value)} />
      </div>
      <TextField label="Address" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/mcp" />
      <Button variant="primary" onClick={() => void connect()} disabled={busy || !name.trim() || !url.trim()}>
        {busy ? 'Connecting…' : 'Connect'}
      </Button>
    </Section>
  )
}

export function AgentSettings() {
  const settings = useApiQuery('mcp', () => mcpApi.get(), [])
  const [client, setClient] = useState<Client>('claude-code')
  const [reveal, setReveal] = useState(false)

  if (!settings) return <p className="text-sm text-text-muted">Loading…</p>

  const update = (patch: { enabled?: boolean; readOnly?: boolean }) => mcpApi.update(patch).catch((e) => toastError(errorMessage(e)))

  const rotate = async () => {
    const ok = await confirmDialog({
      title: 'Make a new key?',
      body: 'Every agent using the current key stops working until you give it the new one.',
      confirmLabel: 'Make a new key',
    })
    if (!ok) return
    try {
      await mcpApi.rotateToken()
      toastSuccess('New key created')
    } catch (e) {
      toastError(errorMessage(e))
    }
  }

  return (
    <SettingsPage>
      <AssistantWorkspaceSettings />

      <Section
        title="Let AI agents help"
        description="Connect Claude, ChatGPT or any assistant that supports MCP. Agents can read your library and write characters, worlds, lore and extensions for you."
      >
        <Toggle checked={settings.enabled} onChange={(enabled) => void update({ enabled })} label="Allow agents to connect" description="Off by default. Nothing is reachable until you switch this on." />
      </Section>

      {settings.enabled && (
        <>
          <Section title="What agents may do" description="Agents cannot delete characters, worlds or chats. Extensions they write arrive switched off until you review them.">
            <SegmentedControl
              options={[
                { value: 'write', label: 'Read and write' },
                { value: 'read', label: 'Read only' },
              ]}
              value={settings.readOnly ? 'read' : 'write'}
              onChange={(v) => void update({ readOnly: v === 'read' })}
            />
            <p className="mt-3 text-xs text-text-muted">
              {settings.readOnly ? 'Agents can look at your library and chats but cannot change anything.' : 'Agents can create and edit characters, worlds, lorebooks, personas and extensions, and add messages to a chat.'}
            </p>
          </Section>

          <Section title="Connect an agent">
            <SegmentedControl options={CLIENTS} value={client} onChange={setClient} className="mb-5 max-w-full overflow-x-auto" />
            <ConnectGuide client={client} endpoint={settings} reveal={reveal} />
          </Section>

          <Section title="Connection key" description="The key proves it is you. Keep it private, like a password.">
            <div className="flex flex-wrap items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-xl bg-bg-sunken px-3 py-2 font-mono text-xs text-text">{reveal ? settings.token : maskToken(settings.token)}</code>
              <Button onClick={() => setReveal((v) => !v)}>{reveal ? 'Hide' : 'Show'}</Button>
              <Button onClick={() => void copy(settings.token)}>Copy</Button>
              <Button variant="ghost" onClick={() => void rotate()}>
                Make a new key
              </Button>
            </div>
          </Section>
        </>
      )}

      <ConnectedServers />
    </SettingsPage>
  )
}
