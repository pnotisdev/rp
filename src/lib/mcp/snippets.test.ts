import { describe, expect, it } from 'vitest'
import { claudeCodeCommand, claudeDesktopConfig, connectorUrl, localUrl, maskToken, tunnelCommands, type McpEndpoint } from './snippets'

const e: McpEndpoint = { apiPort: 3001, mcpPort: 3002, token: 'abcDEF123456789xyz', scriptPath: 'C:\\Users\\me\\rp\\scripts\\rp-mcp.mjs' }

describe('mcp snippets', () => {
  it('points local clients at the API port', () => {
    expect(localUrl(e)).toBe('http://127.0.0.1:3001/mcp')
    expect(claudeCodeCommand(e)).toBe('claude mcp add --transport http hakoniwa http://127.0.0.1:3001/mcp --header "Authorization: Bearer abcDEF123456789xyz"')
  })

  it('masks the token in displayed copies', () => {
    expect(maskToken(e.token)).toBe('abcD••••••••9xyz')
    expect(maskToken(e.token)).not.toContain('DEF123')
    expect(claudeCodeCommand(e, maskToken(e.token))).toContain('abcD••••••••9xyz')
    expect(maskToken('short')).toBe('••••••••')
  })

  it('builds valid Claude Desktop JSON, escaping Windows paths', () => {
    const parsed = JSON.parse(claudeDesktopConfig(e))
    expect(parsed.mcpServers['hakoniwa']).toEqual({
      command: 'node',
      args: ['C:\\Users\\me\\rp\\scripts\\rp-mcp.mjs'],
      env: { RP_MCP_URL: 'http://127.0.0.1:3001/mcp', RP_MCP_TOKEN: 'abcDEF123456789xyz' },
    })
  })

  it('tunnels the agent-only port, not the API port', () => {
    const cmds = tunnelCommands(e)
    expect(cmds.every((c) => c.includes('3002'))).toBe(true)
    expect(cmds.some((c) => c.includes('3001'))).toBe(false)
  })

  it('builds the ChatGPT connector address from whatever the user pastes', () => {
    const want = 'https://rapid-fox.trycloudflare.com/mcp/abcDEF123456789xyz'
    expect(connectorUrl('https://rapid-fox.trycloudflare.com', e.token)).toBe(want)
    expect(connectorUrl('rapid-fox.trycloudflare.com/', e.token)).toBe(want)
    expect(connectorUrl('  https://rapid-fox.trycloudflare.com/some/path?x=1 ', e.token)).toBe(want)
    expect(connectorUrl('http://rapid-fox.trycloudflare.com', e.token)).toBe(want)
  })

  it('returns null until the input is a real host', () => {
    expect(connectorUrl('', e.token)).toBeNull()
    expect(connectorUrl('localhost', e.token)).toBeNull()
    expect(connectorUrl('not a url', e.token)).toBeNull()
  })
})
