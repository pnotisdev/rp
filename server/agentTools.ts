// In-app agent tools: what the Assistant can call. The library tools MCP agents get, workspace/web/memory tools that only the app's own Assistant gets, and tools from connected servers.

import express from 'express'
import { BRAND, BRAND_ID } from '../src/lib/brand.ts'
import fs from 'node:fs'
import { addNote, MEMORY_TOOLS, readNotes, removeNote } from './assistantMemory.ts'
import { appSettingsStore, dataDir } from './db.ts'
import { callExternalTool, externalTools, isExternalTool } from './mcpClient.ts'
import { validateArgs, type ToolDef } from './mcpProtocol.ts'
import { AGENT_HIDDEN_PROPS, createMcpConfig, restClient } from './mcpTools.ts'
import { inside, saveImage, WEB_TOOLS, workspaceTools, WorkspaceError, type WorkspaceConfig, type WorkspaceCtx, type WorkspaceOutput } from './workspace.ts'

const config = createMcpConfig('0')
const builtin = new Map(config.tools.map((t) => [t.name, t]))

const CHARACTER_WRITERS = new Set(['create_character', 'update_character'])

const WORKSPACE_SETTINGS_ID = 'workspace'

export function readWorkspaceConfig(): WorkspaceConfig {
  const row = appSettingsStore.get(WORKSPACE_SETTINGS_ID)
  return { root: typeof row?.root === 'string' ? row.root : '', allowCommands: row?.allowCommands === true }
}

function writeWorkspaceConfig(next: WorkspaceConfig): void {
  if (appSettingsStore.get(WORKSPACE_SETTINGS_ID)) appSettingsStore.update(WORKSPACE_SETTINGS_ID, { ...next, updatedAt: Date.now() })
  else appSettingsStore.insert({ id: WORKSPACE_SETTINGS_ID, ...next, updatedAt: Date.now() })
}

/** A folder is acceptable when it exists, is a directory, and is not a drive or filesystem root. */
export function validateWorkspaceRoot(root: string): string {
  const trimmed = root.trim()
  if (!trimmed) return ''
  if (!fs.existsSync(trimmed) || !fs.statSync(trimmed).isDirectory()) throw new WorkspaceError('That folder does not exist.')
  const real = fs.realpathSync.native(trimmed)
  if (/^[a-z]:[\/]?$/i.test(real) || real === '/') throw new WorkspaceError('Pick a project folder, not a whole drive.')
  if (inside(fs.realpathSync.native(dataDir), real)) throw new WorkspaceError(`That folder is inside ${BRAND.name}'s own data. Pick a different folder.`)
  return real
}

type LocalTool = ToolDef<WorkspaceCtx> & { needsApproval?: boolean }

/** Tools that run inside this server process: workspace, web and memory. */
function localTools(cfg: WorkspaceConfig): LocalTool[] {
  return [...workspaceTools(cfg), ...WEB_TOOLS, ...MEMORY_TOOLS]
}

export function agentRouter(): express.Router {
  const router = express.Router()

  router.get('/api/agent/tools', async (_req, res) => {
    const cfg = readWorkspaceConfig()
    const shown = (t: (typeof config.tools)[number] | LocalTool) => ({
      name: t.name,
      title: t.title,
      description: t.description,
      inputSchema: { properties: Object.fromEntries(Object.entries(t.inputSchema.properties ?? {}).filter(([k]) => !(CHARACTER_WRITERS.has(t.name) && AGENT_HIDDEN_PROPS.has(k)))), required: t.inputSchema.required ?? [] },
      write: t.annotations?.readOnlyHint !== true,
      confirm: 'needsApproval' in t && t.needsApproval === true,
    })
    res.json([...config.tools.map(shown), ...localTools(cfg).map(shown), ...(await externalTools())])
  })

  router.post('/api/agent/call', async (req, res) => {
    const name = typeof req.body?.name === 'string' ? req.body.name : ''
    const args = req.body?.arguments && typeof req.body.arguments === 'object' && !Array.isArray(req.body.arguments) ? (req.body.arguments as Record<string, unknown>) : {}
    const allowWrites = req.body?.allowWrites === true
    const confirmed = req.body?.confirmed === true
    try {
      const own = builtin.get(name)
      const cfg = readWorkspaceConfig()
      const local = localTools(cfg).find((t) => t.name === name)
      const tool = own ?? local
      if (!tool) {
        if (!isExternalTool(name)) return void res.json({ text: `There is no tool called "${name}".`, isError: true })
        if (!allowWrites && !(await externalTools()).find((t) => t.name === name && !t.write)) return void res.json({ text: `That tool may change things outside ${BRAND.name}, and the Assistant is set to read-only.`, isError: true })
        return void res.json(await callExternalTool(name, args))
      }
      const problems = validateArgs(tool.inputSchema, args)
      if (problems.length) return void res.json({ text: `Invalid arguments for ${name}:\n- ${problems.join('\n- ')}`, isError: true })
      let out: WorkspaceOutput
      if (own) {
        out = await own.run(args, { rest: restClient(`http://127.0.0.1:${req.socket.localPort}`), readOnly: !allowWrites })
      } else {
        const ctx: WorkspaceCtx = { config: cfg, readOnly: !allowWrites, confirmed, protectedDirs: [dataDir] }
        out = await local!.run(args, ctx)
      }
      res.json({ text: out.text, isError: out.isError === true, ...(out.images?.length ? { images: out.images } : {}) })
    } catch (e) {
      const details = e && typeof e === 'object' && Array.isArray((e as { details?: unknown }).details) ? `\n- ${((e as { details: string[] }).details).join('\n- ')}` : ''
      res.json({ text: e instanceof WorkspaceError ? e.message : `${name} failed: ${e instanceof Error ? e.message : String(e)}${details}`, isError: true })
    }
  })

  router.post('/api/agent/save-image', (req, res) => {
    try {
      const ctx: WorkspaceCtx = { config: readWorkspaceConfig(), readOnly: req.body?.allowWrites !== true, confirmed: req.body?.confirmed === true, protectedDirs: [dataDir] }
      res.json({ text: saveImage(ctx, req.body?.path, req.body?.dataUrl), isError: false })
    } catch (e) {
      res.json({ text: e instanceof Error ? e.message : String(e), isError: true })
    }
  })

  router.get('/api/agent/workspace', (_req, res) => res.json(readWorkspaceConfig()))

  router.put('/api/agent/workspace', (req, res) => {
    try {
      const root = validateWorkspaceRoot(typeof req.body?.root === 'string' ? req.body.root : '')
      const next = { root, allowCommands: root ? req.body?.allowCommands === true : false }
      writeWorkspaceConfig(next)
      res.json(next)
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : String(e) })
    }
  })

  router.get('/api/agent/memory', (_req, res) => res.json(readNotes()))
  router.post('/api/agent/memory', (req, res) => {
    try {
      res.json(addNote(typeof req.body?.text === 'string' ? req.body.text : ''))
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : String(e) })
    }
  })
  router.delete('/api/agent/memory/:id', (req, res) => {
    removeNote(req.params.id)
    res.status(204).end()
  })

  return router
}
