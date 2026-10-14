import { describe, expect, it } from 'vitest'
import { extensionAgentTools, runExtensionTool } from './assistantTools'

describe('extension tools for the Assistant', () => {
  it('lists nothing and runs nothing when no extension provides tools', async () => {
    expect(extensionAgentTools()).toEqual([])
    expect(await runExtensionTool({ name: 'list_characters', arguments: {} })).toBeNull()
    expect(await runExtensionTool({ name: 'dice-tray.roll', arguments: {} })).toBeNull()
  })
})
