import { describe, expect, it } from 'vitest'
import { visibleWidth } from '@earendil-works/pi-tui'
import { Banner } from '../../src/components/banner.ts'
import { createPalette } from '../../src/palette.ts'

/** Options for a banner whose dynamic values the test controls. */
interface StubBannerValues {
  model?: () => string
  cwd?: () => string
  sessionId?: string
}

/** @returns a banner over fixed values. */
function banner(options: StubBannerValues = {}): Banner {
  return new Banner(createPalette(false), {
    model: options.model ?? (() => 'deepseek/deepseek-chat'),
    sessionId: options.sessionId ?? 'session-abc',
    cwd: options.cwd ?? (() => '/work/repo'),
  })
}

describe('Banner', () => {
  it('renders the product mark, the model with the Session identity, and the working directory', () => {
    expect(banner().render(80)).toEqual([
      ' DEEPSEEK HARNESS',
      ' deepseek/deepseek-chat • session-abc',
      ' /work/repo',
      '',
    ])
  })

  it('reads the model and working directory on every render', () => {
    let model = 'first/model'
    let cwd = '/first'
    const component = new Banner(createPalette(false), {
      model: () => model,
      sessionId: 'session-abc',
      cwd: () => cwd,
    })
    expect(component.render(80)[1]).toContain('first/model')
    model = 'second/model'
    cwd = '/second'
    const lines = component.render(80)
    expect(lines[1]).toContain('second/model')
    expect(lines[2]).toBe(' /second')
  })

  it('truncates every line to the available width', () => {
    const lines = banner({ sessionId: 'a-fairly-long-session-identity' }).render(12)
    expect(lines).toHaveLength(4)
    for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(12)
    expect(lines[0]).not.toBe(' DEEPSEEK HARNESS')
  })

  it('escapes control characters in the dynamic values', () => {
    const lines = banner({
      model: () => 'model\u001b[31m',
      cwd: () => '/work\u0000',
    }).render(80)
    expect(lines[1]).toContain('model\\x1b[31m')
    expect(lines[2]).toContain('/work\\x00')
  })

  it('has no cached state to invalidate', () => {
    const component = banner()
    expect(() => { component.invalidate() }).not.toThrow()
  })
})
