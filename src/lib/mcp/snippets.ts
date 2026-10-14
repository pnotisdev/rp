// Copy-paste setup text for connecting AI agents to the app over MCP.

import { BRAND_ID } from '@/lib/brand'

export interface McpEndpoint {
  apiPort: number
  mcpPort: number
  token: string
  scriptPath: string
}

export const localUrl = (e: McpEndpoint) => `http://127.0.0.1:${e.apiPort}/mcp`

/** Shows the ends of a token so a screen share does not leak it. */
export function maskToken(token: string): string {
  return token.length <= 10 ? '••••••••' : `${token.slice(0, 4)}••••••••${token.slice(-4)}`
}

export function claudeCodeCommand(e: McpEndpoint, token = e.token): string {
  return `claude mcp add --transport http ${BRAND_ID} ${localUrl(e)} --header "Authorization: Bearer ${token}"`
}

export function claudeDesktopConfig(e: McpEndpoint, token = e.token): string {
  return JSON.stringify(
    { mcpServers: { [BRAND_ID]: { command: 'node', args: [e.scriptPath], env: { RP_MCP_URL: localUrl(e), RP_MCP_TOKEN: token } } } },
    null,
    2,
  )
}

export function tunnelCommands(e: McpEndpoint): string[] {
  return [`cloudflared tunnel --url http://127.0.0.1:${e.mcpPort}`, `ngrok http ${e.mcpPort}`]
}

/** The address to give ChatGPT: the tunnel's public origin plus the secret path. Returns null until the input looks like a host. */
export function connectorUrl(tunnel: string, token: string): string | null {
  const raw = tunnel.trim()
  if (!raw) return null
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`)
    if (!url.hostname.includes('.')) return null
    return `https://${url.host}/mcp/${token}`
  } catch {
    return null
  }
}
