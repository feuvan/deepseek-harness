import { describe, expect, it } from 'vitest'
import { visibleWidth } from '@earendil-works/pi-tui'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type {
  DiffCallView, FileDiff, GenericCallView, TerminalCallView, ToolResultView,
} from '@deepseek-ai/dsh-tools'
import {
  AssistantBlock, CommandBlock, NoticeBlock, ToolCardBlock, UserMessageBlock,
  type BlockContext, type CardMode,
} from '../../src/components/blocks.ts'
import { copy } from '../../src/copy.ts'
import { createMarkdownTheme } from '../../src/markdown.ts'
import { createPalette } from '../../src/palette.ts'
import { visibleLines } from '../support/terminal.ts'

const ESC = '\u001b'

/** Options for a block context whose render values the test controls. */
interface ContextOptions {
  readonly previewLines?: number
  readonly color?: boolean
  readonly mode?: CardMode
}

/** @returns a block context over a fresh palette and markdown theme. */
function context(options: ContextOptions = {}): BlockContext {
  const palette = createPalette(options.color ?? false)
  return {
    palette,
    markdown: createMarkdownTheme(palette),
    previewLines: options.previewLines ?? 10,
    cardMode: () => options.mode ?? 'collapsed',
  }
}

/** @returns a block context plus a setter for the card mode its renderer reads. */
function mutableMode(initial: CardMode = 'collapsed', previewLines = 10): { context: BlockContext; setMode: (mode: CardMode) => void } {
  const palette = createPalette(false)
  let mode = initial
  return {
    context: {
      palette,
      markdown: createMarkdownTheme(palette),
      previewLines,
      cardMode: () => mode,
    },
    setMode: (next) => { mode = next },
  }
}

/** @returns a text content block. */
function textBlock(text: string): ContentBlock {
  return { type: 'text', text }
}

/** @returns a content block a terminal renders as a placeholder. */
const imageBlock: ContentBlock = {
  type: 'image',
  attachment: { attachmentId: AttachmentId('image-1'), mediaType: 'image/png', bytes: 12, width: 2, height: 2 },
}

/** @returns a content block a terminal renders as a placeholder. */
const fileBlock: ContentBlock = {
  type: 'file',
  attachment: { attachmentId: AttachmentId('file-1'), name: 'notes.txt', bytes: 4 },
}

/** @returns a reasoning block, whose kind this terminal does not render inline. */
const reasoningBlock: ContentBlock = { type: 'reasoning', text: 'withheld chain of thought' }

/** @returns a generic call view with a stable title. */
function genericCall(overrides: Partial<GenericCallView> = {}): GenericCallView {
  return { card: 'generic', title: 'Read file', ...overrides }
}

/** @returns a terminal call view with a stable title. */
function terminalCall(overrides: Partial<TerminalCallView> = {}): TerminalCallView {
  return { card: 'terminal', title: 'ls -la', ...overrides }
}

/** @returns a diff call view for one changed file. */
function diffCall(file: FileDiff = { path: 'notes.txt', oldText: null, newText: 'hello\n' }): DiffCallView {
  return { card: 'diff', title: 'Write notes.txt', diffs: [file] }
}

/** @returns a text composed of the requested number of newline-separated lines. */
function manyLines(count: number): string {
  return Array.from({ length: count }, (_unused, index) => `line ${String(index)}`).join('\n')
}

describe('UserMessageBlock', () => {
  it('prefixes the first line with the prompt marker and indents wrapped lines', () => {
    const lines = new UserMessageBlock('one two three four five six seven', context()).render(16)
    expect(lines.length).toBeGreaterThan(1)
    expect(lines[0]?.startsWith(`${copy.notice.user} `)).toBe(true)
    for (const line of lines.slice(1)) expect(line.startsWith('  ')).toBe(true)
    for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(16)
  })

  it('keeps CJK and emoji within the available width', () => {
    const lines = new UserMessageBlock('中文消息 🚀 emoji 中文中文中文', context()).render(12)
    for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(12)
    expect(lines[0]?.startsWith(`${copy.notice.user} `)).toBe(true)
  })

  it('renders just the prompt marker for an empty message', () => {
    expect(new UserMessageBlock('', context()).render(20)).toEqual([`${copy.notice.user} `])
  })

  it('escapes control characters', () => {
    const lines = new UserMessageBlock('bad\u0000text', context()).render(40)
    expect(lines[0]).toContain('bad\\x00text')
  })

  it('has no cached state to invalidate', () => {
    const block = new UserMessageBlock('hello', context())
    expect(() => { block.invalidate() }).not.toThrow()
    expect(block.render(40)).toHaveLength(1)
  })
})

describe('AssistantBlock', () => {
  it('renders visible reasoning above the response content', () => {
    const block = new AssistantBlock(context())
    block.setReasoning('thinking it through')
    block.setText('# Heading\n\nanswer body')
    const lines = visibleLines(block.render(60))
    const reasoning = lines.findIndex(line => line.includes('thinking it through'))
    const heading = lines.findIndex(line => line.includes('Heading'))
    expect(reasoning).toBeGreaterThanOrEqual(0)
    expect(heading).toBeGreaterThan(reasoning)
    expect(lines.join('\n')).toContain('answer body')
    expect(block.isEmpty()).toBe(false)
  })

  it('hides reasoning when the preview budget is zero', () => {
    const block = new AssistantBlock(context())
    block.setReasoning('private thoughts')
    block.setReasoningPreview(0)

    const lines = visibleLines(block.render(60)).join('\n')
    expect(lines).not.toContain('private thoughts')
    expect(block.isEmpty()).toBe(false)
  })

  it('truncates reasoning to a finite preview budget with a hidden-lines row', () => {
    const block = new AssistantBlock(context())
    block.setReasoning(['one', 'two', 'three', 'four', 'five', 'six'].join('\n'))
    block.setReasoningPreview(2)

    const lines = visibleLines(block.render(60))

    expect(lines.join('\n')).toContain('one')
    expect(lines.join('\n')).toContain('two')
    expect(lines.join('\n')).not.toContain('three')
    expect(lines).toContain(`  ${copy.notice.hiddenLines(4)}`)
  })

  it('shows the complete reasoning block for an infinite preview budget', () => {
    const reasoning = Array.from({ length: 12 }, (_, index) => `thought ${String(index)}`).join('\n')
    const block = new AssistantBlock(context())
    block.setReasoning(reasoning)
    block.setReasoningPreview(Number.POSITIVE_INFINITY)

    const lines = visibleLines(block.render(60)).join('\n')

    expect(lines).toContain('thought 0')
    expect(lines).toContain('thought 11')
    expect(lines).not.toContain(copy.notice.hiddenLines(1))
  })

  it('keeps the reasoning renderer across invalidation', () => {
    const block = new AssistantBlock(context())
    block.setReasoning('survives invalidation')

    block.invalidate()

    expect(visibleLines(block.render(60)).join('\n')).toContain('survives invalidation')
  })

  it('omits the reasoning row when only response content exists', () => {
    const block = new AssistantBlock(context())
    block.setText('plain answer')
    const lines = visibleLines(block.render(60))
    expect(lines[0]?.trim()).toBe('plain answer')
    expect(block.isEmpty()).toBe(false)
  })

  it('reports empty only when both parts are empty', () => {
    const block = new AssistantBlock(context())
    expect(block.isEmpty()).toBe(true)
    block.setReasoning('thought')
    expect(block.isEmpty()).toBe(false)
    block.setReasoning('')
    expect(block.isEmpty()).toBe(true)
  })

  it('escapes control characters in both parts', () => {
    const block = new AssistantBlock(context())
    block.setText('answer\u0007')
    block.setReasoning('reason\u001b[31m')
    const visible = visibleLines(block.render(60)).join('\n')
    expect(visible).toContain('answer\\x07')
    expect(visible).toContain('reason\\x1b[31m')
  })

  it('drops cached renderer state on invalidate', () => {
    const block = new AssistantBlock(context())
    block.setReasoning('thought')
    block.setText('answer')
    block.render(60)
    block.invalidate()
    const visible = visibleLines(block.render(60)).join('\n')
    expect(visible).toContain('thought')
    expect(visible).toContain('answer')
  })
})

describe('NoticeBlock', () => {
  it('renders a dim notice by default', () => {
    const lines = new NoticeBlock('session saved', context({ color: true })).render(80)
    expect(lines).toEqual([`${ESC}[2msession saved${ESC}[22m`])
  })

  it('renders warnings', () => {
    const lines = new NoticeBlock('careful', context({ color: true }), 'warning').render(80)
    expect(lines).toEqual([`${ESC}[33mcareful${ESC}[39m`])
  })

  it('renders errors', () => {
    const lines = new NoticeBlock('broken', context({ color: true }), 'error').render(80)
    expect(lines).toEqual([`${ESC}[31mbroken${ESC}[39m`])
  })

  it('renders successes', () => {
    const lines = new NoticeBlock('done', context({ color: true }), 'success').render(80)
    expect(lines).toEqual([`${ESC}[32mdone${ESC}[39m`])
  })

  it('wraps a long notice and styles every line', () => {
    const lines = new NoticeBlock('one two three four five six', context(), 'error').render(10)
    expect(lines.length).toBeGreaterThan(1)
    for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(10)
  })

  it('escapes control characters', () => {
    expect(new NoticeBlock('a\u0000b', context()).render(40)).toEqual(['a\\x00b'])
  })

  it('has no cached state to invalidate', () => {
    const block = new NoticeBlock('note', context())
    expect(() => { block.invalidate() }).not.toThrow()
    expect(block.render(40)).toEqual(['note'])
  })
})

describe('CommandBlock', () => {
  it('renders the invocation with its recorded arguments', () => {
    expect(new CommandBlock('help', 'topic', context()).render(80)).toEqual([`${copy.notice.command} /help topic`])
  })

  it('omits the argument separator when args are missing or empty', () => {
    expect(new CommandBlock('help', undefined, context()).render(80)).toEqual([`${copy.notice.command} /help`])
    expect(new CommandBlock('help', '', context()).render(80)).toEqual([`${copy.notice.command} /help`])
  })

  it('styles the invocation as an accent', () => {
    const line = new CommandBlock('help', undefined, context({ color: true })).render(80)[0]
    expect(line).toBe(`${ESC}[36m${copy.notice.command} /help${ESC}[39m`)
  })

  it('renders a successful outcome as an indented dim body', () => {
    const block = new CommandBlock('help', undefined, context({ color: true }))
    block.setResult('success', 'usage: help')
    expect(block.render(80)).toEqual([
      `${ESC}[36m${copy.notice.command} /help${ESC}[39m`,
      `  ${ESC}[2musage: help${ESC}[22m`,
    ])
  })

  it('renders a failed outcome as an indented error body', () => {
    const block = new CommandBlock('explode', undefined, context({ color: true }))
    block.setResult('error', 'no such command')
    expect(block.render(80)[1]).toBe(`  ${ESC}[31mno such command${ESC}[39m`)
  })

  it('omits the outcome body when the result has no text or only whitespace', () => {
    const missing = new CommandBlock('help', undefined, context())
    missing.setResult('success', undefined)
    expect(missing.render(80)).toHaveLength(1)
    const blank = new CommandBlock('help', undefined, context())
    blank.setResult('success', '   \n ')
    expect(blank.render(80)).toHaveLength(1)
  })

  it('wraps the outcome text and truncates the header at a narrow width', () => {
    const block = new CommandBlock('a-very-long-command-name', undefined, context())
    block.setResult('success', 'one two three four five')
    const lines = block.render(12)
    for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(12)
    expect(lines.length).toBeGreaterThan(2)
    expect(lines[1]?.startsWith('  ')).toBe(true)
  })

  it('has no cached state to invalidate', () => {
    const block = new CommandBlock('help', undefined, context())
    expect(() => { block.invalidate() }).not.toThrow()
  })
})

describe('ToolCardBlock header', () => {
  it('renders a pending generic card with the running glyph and tone', () => {
    const card = new ToolCardBlock('read', genericCall(), context({ color: true }))
    const header = card.render(80)[0] ?? ''
    expect(header).toContain(`${ESC}[33m○ ${copy.card.tool} / read · Read file${ESC}[39m`)
  })

  it('renders a settled success with the done glyph and tone', () => {
    const card = new ToolCardBlock('read', genericCall(), context({ color: true }))
    card.setResult(undefined, [], false, undefined)
    expect(card.render(80)[0]).toContain(`${ESC}[32m● ${copy.card.tool} / read · Read file${ESC}[39m`)
  })

  it('renders a failure with the done glyph and error tone', () => {
    const card = new ToolCardBlock('read', genericCall(), context({ color: true }))
    card.setResult(undefined, [], true, undefined)
    expect(card.render(80)[0]).toContain(`${ESC}[31m● ${copy.card.tool} / read · Read file${ESC}[39m`)
  })

  it('lets the result view replace the title', () => {
    const card = new ToolCardBlock('read', genericCall(), context())
    card.setResult({ card: 'generic', title: 'Read 3 lines' }, [], false, undefined)
    expect(card.render(80)[0]).toBe(`● ${copy.card.tool} / read · Read 3 lines`)
  })

  it('keeps the call title when the result view has no title', () => {
    const card = new ToolCardBlock('read', genericCall(), context())
    card.setResult({ card: 'generic' }, [], false, undefined)
    expect(card.render(80)[0]).toBe(`● ${copy.card.tool} / read · Read file`)
  })

  it('omits the title separator when neither view has a title', () => {
    const card = new ToolCardBlock('read', undefined, context())
    expect(card.render(80)[0]).toBe(`○ ${copy.card.tool} / read`)
  })

  it('truncates the header to the available width', () => {
    const card = new ToolCardBlock('read', genericCall(), context())
    expect(visibleWidth(card.render(10)[0] ?? '')).toBeLessThanOrEqual(10)
  })

  it('escapes control characters in the tool name and title', () => {
    const card = new ToolCardBlock('bad\u0007tool', { card: 'generic', title: 't\u001b[31m' }, context())
    const header = card.render(80)[0] ?? ''
    expect(header).toContain('bad\\x07tool')
    expect(header).toContain('t\\x1b[31m')
  })
})

describe('ToolCardBlock generic bodies', () => {
  it('renders a raw input string, structured value, and content blocks', () => {
    const call = genericCall({
      rawInput: 'job-42',
      content: [textBlock('first block'), imageBlock, fileBlock, reasoningBlock],
    })
    const lines = visibleLines(new ToolCardBlock('read', call, context()).render(80))
    const joined = lines.join('\n')
    expect(joined).toContain('job-42')
    expect(joined).toContain('first block')
    expect(joined).toContain('[image image/png]')
    expect(joined).toContain('[file notes.txt]')
    expect(joined).not.toContain('withheld chain of thought')
  })

  it('renders an object raw input as indented JSON', () => {
    const lines = visibleLines(new ToolCardBlock('read', genericCall({ rawInput: { path: 'a.txt' } }), context()).render(120))
    const joined = lines.join('\n')
    expect(joined).toContain('"path": "a.txt"')
    expect(joined).toContain('{')
  })

  it('falls back to the string form for a value JSON cannot encode', () => {
    const presenter = (): string => 'function form'
    const lines = visibleLines(new ToolCardBlock('read', genericCall({ rawInput: presenter }), context()).render(120))
    expect(lines.join('\n')).toContain('function form')
  })

  it('renders a placeholder for a value whose serializer throws', () => {
    const rawInput = {
      toJSON(): never {
        throw new Error('cannot serialize')
      },
    }
    const lines = visibleLines(new ToolCardBlock('read', genericCall({ rawInput }), context()).render(120))
    expect(lines.join('\n')).toContain('[unprintable value]')
  })

  it('renders the failure text for a pending card', () => {
    const card = new ToolCardBlock('read', genericCall(), context())
    card.setResult(undefined, [], true, 'presenter failed')
    const joined = visibleLines(card.render(80)).join('\n')
    expect(joined).toContain('presenter failed')
  })

  it('renders the failure text after a result body', () => {
    const card = new ToolCardBlock('read', genericCall(), context())
    card.setResult({ card: 'generic', content: [textBlock('result body')] }, [], true, 'spawn failed')
    const joined = visibleLines(card.render(80)).join('\n')
    expect(joined).toContain('result body')
    expect(joined).toContain('spawn failed')
  })

  it('renders result content when the view supplies it', () => {
    const card = new ToolCardBlock('read', genericCall(), context())
    card.setResult({ card: 'generic', content: [textBlock('formatted result')] }, [textBlock('raw result')], false, undefined)
    const joined = visibleLines(card.render(80)).join('\n')
    expect(joined).toContain('formatted result')
    expect(joined).not.toContain('raw result')
  })

  it('falls back to raw result content when the view supplies none', () => {
    const card = new ToolCardBlock('read', genericCall(), context())
    card.setResult({ card: 'generic' }, [textBlock('raw result')], false, undefined)
    expect(visibleLines(card.render(80)).join('\n')).toContain('raw result')
  })

  it('renders an empty body for a pending card without presentation values', () => {
    expect(new ToolCardBlock('read', undefined, context()).render(80)).toEqual([`○ ${copy.card.tool} / read`])
  })
})

describe('ToolCardBlock terminal views', () => {
  it('renders the command, description, and working directory of a terminal call', () => {
    const call = terminalCall({ description: 'list the directory', cwd: '/work' })
    const lines = visibleLines(new ToolCardBlock('bash', call, context({ mode: 'expanded' })).render(80))
    expect(lines[1]).toBe(`  ${copy.card.command} ls -la`)
    expect(lines[2]).toBe('  list the directory')
    expect(lines[3]).toBe('  /work')
  })

  it('renders command output and a nonzero exit pill', () => {
    const card = new ToolCardBlock('bash', terminalCall(), context())
    card.setResult({ card: 'terminal', output: 'a\nb', exitCode: 2 }, [], false, undefined)
    const lines = visibleLines(card.render(80))
    expect(lines).toContain('  a')
    expect(lines).toContain('  b')
    expect(lines[lines.length - 1]).toBe('  [exit 2]')
  })

  it('renders a signal pill when no exit code settled the run', () => {
    const card = new ToolCardBlock('bash', terminalCall(), context())
    card.setResult({ card: 'terminal', signal: 'SIGTERM' }, [], true, undefined)
    expect(visibleLines(card.render(80)).at(-1)).toBe('  [SIGTERM]')
  })

  it('renders no pill for a zero exit code', () => {
    const card = new ToolCardBlock('bash', terminalCall(), context())
    card.setResult({ card: 'terminal', output: 'ok', exitCode: 0 }, [], false, undefined)
    const lines = visibleLines(card.render(80))
    expect(lines).toContain('  ok')
    expect(lines.join('\n')).not.toContain('[exit')
  })

  it('renders only the header when the output is missing', () => {
    const card = new ToolCardBlock('bash', undefined, context())
    card.setResult({ card: 'terminal' }, [], false, undefined)
    expect(card.render(80)).toEqual([`● ${copy.card.tool} / bash`])
  })

  it('renders only the header when the output is empty', () => {
    const card = new ToolCardBlock('bash', undefined, context())
    card.setResult({ card: 'terminal', output: '' }, [], false, undefined)
    expect(card.render(80)).toEqual([`● ${copy.card.tool} / bash`])
  })

  it('truncates output lines to the body width', () => {
    const card = new ToolCardBlock('bash', undefined, context())
    card.setResult({ card: 'terminal', output: 'abcdefghijklmnop' }, [], false, undefined)
    for (const line of card.render(10)) expect(visibleWidth(line)).toBeLessThanOrEqual(10)
  })
})

describe('ToolCardBlock diff views', () => {
  it('renders a new file as added lines', () => {
    const lines = new ToolCardBlock('write', diffCall(), context({ color: true, mode: 'expanded' })).render(80)
    expect(lines[1]).toContain(`${ESC}[1mnotes.txt${ESC}[22m`)
    expect(lines[2]).toContain(`${ESC}[32m+hello${ESC}[39m`)
  })

  it('renders a diff whose changed value has no trailing newline', () => {
    const file: FileDiff = { path: 'a.txt', oldText: null, newText: 'no trailing newline' }
    const lines = visibleLines(new ToolCardBlock('write', diffCall(file), context({ mode: 'expanded' })).render(80))
    expect(lines).toContain('  +no trailing newline')
  })

  it('renders removed and added lines of an edit with context', () => {
    const file: FileDiff = { path: 'notes.txt', oldText: 'same\nold\n', newText: 'same\nnew\n' }
    const lines = visibleLines(new ToolCardBlock('edit', diffCall(file), context({ mode: 'expanded' })).render(80))
    expect(lines).toContain('   same')
    expect(lines).toContain('  -old')
    expect(lines).toContain('  +new')
  })

  it('renders a diff result', () => {
    const card = new ToolCardBlock('write', undefined, context({ mode: 'expanded' }))
    card.setResult({ card: 'diff', diffs: [{ path: 'a.txt', oldText: null, newText: 'created\n' }] }, [], false, undefined)
    const lines = visibleLines(card.render(80))
    expect(lines).toContain('  a.txt')
    expect(lines).toContain('  +created')
  })

  it('styles removed lines as removals', () => {
    const card = new ToolCardBlock('edit', undefined, context({ color: true, mode: 'expanded' }))
    card.setResult({ card: 'diff', diffs: [{ path: 'a.txt', oldText: 'gone\n', newText: '' }] }, [], false, undefined)
    expect(card.render(80).some(line => line.includes(`${ESC}[31m-gone${ESC}[39m`))).toBe(true)
  })

  it('truncates diff lines to the body width', () => {
    const card = new ToolCardBlock('write', diffCall({ path: 'long-file-name.txt', oldText: null, newText: 'a-long-line-of-content\n' }), context({ mode: 'expanded' }))
    for (const line of card.render(12)) expect(visibleWidth(line)).toBeLessThanOrEqual(12)
  })
})

describe('ToolCardBlock fallback result views', () => {
  it.each([
    ['search', { card: 'search', shape: 'paths', paths: [], truncated: false, total: 0 }],
    ['read', { card: 'read', path: 'a.txt', offset: 1, lines: [], totalLines: 0 }],
    ['web', { card: 'web', kind: 'fetch', url: 'https://example.test', statusCode: 200, truncated: false }],
  ] as const)('renders raw result content for a %s view', (_name, view) => {
    const card = new ToolCardBlock('lookup', undefined, context())
    card.setResult(view as ToolResultView, [textBlock('raw fallback line')], false, undefined)
    expect(visibleLines(card.render(80)).join('\n')).toContain('raw fallback line')
  })
})

describe('ToolCardBlock card modes and cache', () => {
  it('renders nothing when cards are hidden', () => {
    expect(new ToolCardBlock('read', genericCall(), context({ mode: 'hidden' })).render(80)).toEqual([])
  })

  it('collapses the body to the preview budget and reports the hidden lines', () => {
    const call = genericCall({ content: [textBlock('one\ntwo\nthree')] })
    const card = new ToolCardBlock('read', call, context({ previewLines: 1 }))
    const lines = visibleLines(card.render(80))
    expect(lines).toHaveLength(3)
    expect(lines[1]).toBe('  one')
    expect(lines[2]).toBe(`  ${copy.notice.hiddenLines(2)}`)
  })

  it('uses the singular hidden-line notice for one hidden line', () => {
    const call = genericCall({ content: [textBlock('one\ntwo')] })
    const card = new ToolCardBlock('read', call, context({ previewLines: 1 }))
    expect(visibleLines(card.render(80)).at(-1)).toBe(`  ${copy.notice.hiddenLines(1)}`)
  })

  it('shows the whole body in expanded mode', () => {
    const call = genericCall({ content: [textBlock(manyLines(12))] })
    const lines = visibleLines(new ToolCardBlock('read', call, context({ previewLines: 2, mode: 'expanded' })).render(200))
    expect(lines).toHaveLength(13)
    expect(lines.join('\n')).not.toContain('more line')
  })

  it('reuses the rendered lines at the same width and mode', () => {
    const card = new ToolCardBlock('read', genericCall(), context())
    card.setResult({ card: 'generic', content: [textBlock('cached body')] }, [], false, undefined)
    const first = card.render(80)
    expect(card.render(80)).toBe(first)
  })

  it('rebuilds the lines at a different width', () => {
    const card = new ToolCardBlock('read', genericCall(), context())
    card.setResult({ card: 'generic', content: [textBlock('cached body')] }, [], false, undefined)
    const first = card.render(80)
    const second = card.render(40)
    expect(second).not.toBe(first)
    expect(second[0]).toBe(first[0])
  })

  it('rebuilds the lines after the global mode changes', () => {
    const { context: blockContext, setMode } = mutableMode('collapsed', 2)
    const card = new ToolCardBlock('read', genericCall({ content: [textBlock(manyLines(12))] }), blockContext)
    const collapsed = card.render(80)
    setMode('expanded')
    const expanded = card.render(80)
    expect(expanded).not.toBe(collapsed)
    expect(expanded.length).toBeGreaterThan(collapsed.length)
  })

  it('rebuilds the lines after invalidate and a new result', () => {
    const card = new ToolCardBlock('read', genericCall(), context())
    card.setResult({ card: 'generic', content: [textBlock('first')] }, [], false, undefined)
    const first = card.render(80)
    card.invalidate()
    const second = card.render(80)
    expect(second).not.toBe(first)
    expect(second).toEqual(first)
    card.setResult({ card: 'generic', content: [textBlock('second body')] }, [], false, undefined)
    expect(visibleLines(card.render(80)).join('\n')).toContain('second body')
  })
})

describe('ToolCardBlock hard body bound', () => {
  it('caps a pathological generic body', () => {
    const call = genericCall({ content: [textBlock(manyLines(4200))] })
    const lines = new ToolCardBlock('read', call, context({ mode: 'expanded' })).render(200)
    expect(lines).toHaveLength(4001)
  })

  it('caps a pathological terminal output', () => {
    const card = new ToolCardBlock('bash', undefined, context({ mode: 'expanded' }))
    card.setResult({ card: 'terminal', output: manyLines(4200) }, [], false, undefined)
    expect(card.render(200)).toHaveLength(4001)
  })

  it('caps a pathological result body and raw fallback', () => {
    const contentCard = new ToolCardBlock('read', undefined, context({ mode: 'expanded' }))
    contentCard.setResult({ card: 'generic', content: [textBlock(manyLines(4200))] }, [], false, undefined)
    expect(contentCard.render(200)).toHaveLength(4001)

    const rawCard = new ToolCardBlock('read', undefined, context({ mode: 'expanded' }))
    rawCard.setResult({ card: 'generic' }, [textBlock(manyLines(4200))], false, undefined)
    expect(rawCard.render(200)).toHaveLength(4001)
  })

  it('caps a pathological fallback result view', () => {
    const card = new ToolCardBlock('search', undefined, context({ mode: 'expanded' }))
    card.setResult(
      { card: 'search', shape: 'paths', paths: [], truncated: false, total: 0 },
      [textBlock(manyLines(4200))],
      false,
      undefined,
    )
    expect(card.render(200)).toHaveLength(4001)
  })

  it('caps a pathological diff body and stops appending failure text', () => {
    const hugeNew = manyLines(4200)
    const hugeOld = `${manyLines(4200)}old`
    const file: FileDiff = { path: 'huge.txt', oldText: hugeOld, newText: hugeNew }
    const card = new ToolCardBlock('edit', diffCall(file), context({ mode: 'expanded' }))
    card.setResult(undefined, [], false, 'failure after the bound')
    expect(card.render(200)).toHaveLength(4001)
  })
})
