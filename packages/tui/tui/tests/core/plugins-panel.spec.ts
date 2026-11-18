import { describe, expect, it, vi } from 'vitest'
import { PluginPanel, type PluginPanelActions, type PluginPanelRow, type PluginPanelView } from '../../src/components/plugins.ts'
import { copy } from '../../src/copy.ts'
import { createPalette } from '../../src/palette.ts'

function fixture(): { panel: PluginPanel; actions: { [K in keyof PluginPanelActions]: ReturnType<typeof vi.fn> } } {
  const actions = {
    switchTab: vi.fn(),
    toggle: vi.fn(),
    refresh: vi.fn(),
    close: vi.fn(),
    requestRender: vi.fn(),
  }
  return { panel: new PluginPanel({ palette: createPalette(false), actions }), actions }
}

const rows: readonly PluginPanelRow[] = [
  { id: 'plugin:a', kind: 'plugin', target: 'a', label: 'Plugin A', enabled: true, readOnly: false, value: copy.plugin.on },
  { id: 'plugin:b', kind: 'plugin', target: 'b', label: 'Plugin B', enabled: false, readOnly: false, value: copy.plugin.off, description: 'second' },
  { id: 'plugin:c', kind: 'plugin', target: 'c', label: 'Plugin C', enabled: false, readOnly: true, value: copy.plugin.off },
]

const view: PluginPanelView = { tab: 'session', rows }

describe('PluginPanel', () => {
  it('renders tabs, rows, values, and the key hint', () => {
    const { panel } = fixture()
    panel.setView(view)
    const text = panel.render(120).join('\n')
    expect(text).toContain(copy.plugin.title)
    expect(text).toContain(copy.plugin.sessionTab)
    expect(text).toContain('Plugin A')
    expect(text).toContain(copy.plugin.on)
    expect(text).toContain('second')
  })

  it('switches tabs and navigates rows', () => {
    const { panel, actions } = fixture()
    panel.setView(view)
    panel.handleInput('\t')
    expect(actions.switchTab).toHaveBeenCalledWith('global')
    panel.handleInput('\x1b[C')
    expect(actions.switchTab).toHaveBeenCalledTimes(2)
    panel.handleInput('\x1b[D')
    expect(actions.switchTab).toHaveBeenCalledTimes(3)
    panel.handleInput('\x1b[B')
    panel.handleInput('\r')
    expect(actions.toggle).toHaveBeenCalledWith(rows[1])
    panel.handleInput('\x1b[A')
    panel.handleInput('\r')
    expect(actions.toggle).toHaveBeenCalledWith(rows[0])
  })

  it('does not activate read-only rows', () => {
    const { panel, actions } = fixture()
    panel.setView(view)
    panel.handleInput('\x1b[B')
    panel.handleInput('\x1b[B')
    panel.handleInput('\r')
    expect(actions.toggle).not.toHaveBeenCalled()
  })

  it('refreshes and closes from the dock', () => {
    const { panel, actions } = fixture()
    panel.setView(view)
    panel.handleInput('r')
    expect(actions.refresh).toHaveBeenCalledOnce()
    panel.handleInput('\x1b')
    expect(actions.close).toHaveBeenCalledOnce()
  })

  it('renders loading, error, and empty states', () => {
    const { panel } = fixture()
    expect(panel.render(80).join('\n')).toContain(copy.plugin.loading)
    panel.setView({ tab: 'global', rows: [], status: 'done' })
    expect(panel.render(80).join('\n')).toContain('done')
    panel.setView({ tab: 'session', rows: [], error: 'failed' })
    expect(panel.render(80).join('\n')).toContain('failed')
    expect(panel.render(80).join('\n')).toContain(copy.plugin.hint)
  })

  it('keeps the selected row inside a long list', () => {
    const { panel } = fixture()
    const many = Array.from({ length: 20 }, (_, index) => ({
      id: `bundle:${String(index)}`,
      kind: 'bundle' as const,
      target: String(index),
      label: `Bundle ${String(index)}`,
      enabled: index % 2 === 0,
      readOnly: false,
      value: index % 2 === 0 ? copy.plugin.on : copy.plugin.off,
      ...(index === 0 ? { marker: copy.plugin.optional } : {}),
    }))
    panel.setView({ tab: 'global', rows: many })
    for (let index = 0; index < 15; index += 1) panel.handleInput('\x1b[B')
    const lines = panel.render(80)
    expect(lines.some(line => line.includes('Bundle 15'))).toBe(true)
    expect(lines.some(line => line.includes(copy.plugin.optional))).toBe(false)
  })
})
