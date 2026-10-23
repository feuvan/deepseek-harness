import { describe, expect, it } from 'vitest'
import { visibleWidth } from '@earendil-works/pi-tui'
import type { AskUserQuestionAnswer, AskUserQuestionItem, AskUserQuestionRequest } from '@deepseek-ai/dsh-user-questions'
import { ApprovalPanel, QuestionPanel, TextPanel } from '../../src/components/dialogs.ts'
import { copy } from '../../src/copy.ts'
import { createMarkdownTheme } from '../../src/markdown.ts'
import { createPalette } from '../../src/palette.ts'
import { visibleLines } from '../support/terminal.ts'

/** Key sequences the panels must recognize. */
const KEY = {
  up: '\u001b[A',
  down: '\u001b[B',
  pageUp: '\u001b[5~',
  pageDown: '\u001b[6~',
  enter: '\r',
  escape: '\u001b',
  space: ' ',
} as const

/** One question flow the panel answers, plus its recorded callbacks. */
interface QuestionHarness {
  readonly panel: QuestionPanel
  readonly answers: AskUserQuestionAnswer[]
  readonly state: { cancels: number }
}

/** @returns a question panel over fixed questions and recording callbacks. */
function questionPanel(
  questions: readonly AskUserQuestionItem[],
  options: { color?: boolean } = {},
): QuestionHarness {
  const palette = createPalette(options.color ?? false)
  const answers: AskUserQuestionAnswer[] = []
  const state = { cancels: 0 }
  const panel = new QuestionPanel(
    { questions: [...questions] } satisfies AskUserQuestionRequest,
    palette,
    createMarkdownTheme(palette),
    (answer) => { answers.push(answer) },
    () => { state.cancels += 1 },
  )
  return { panel, answers, state }
}

/** @returns a single-select question with the named options. */
function singleQuestion(overrides: Partial<AskUserQuestionItem> = {}): AskUserQuestionItem {
  return {
    id: 'q1',
    question: 'Which approach?',
    header: 'Pick one',
    options: [{ label: 'alpha' }, { label: 'beta', description: 'the second option' }],
    ...overrides,
  }
}

/** @returns a multi-select question with the named options. */
function multiQuestion(overrides: Partial<AskUserQuestionItem> = {}): AskUserQuestionItem {
  return {
    id: 'q1',
    question: 'Which parts?',
    multiSelect: true,
    options: [{ label: 'alpha' }, { label: 'beta' }],
    ...overrides,
  }
}

/** @returns the visible text of one render. */
function rendered(panel: { render(width: number): string[] }, width = 80): string[] {
  return visibleLines(panel.render(width))
}

describe('QuestionPanel single-select', () => {
  it('renders the heading, question, options, custom row, and hint', () => {
    const { panel } = questionPanel([singleQuestion()])
    expect(rendered(panel)).toEqual([
      'Question · Pick one',
      'Which approach?',
      '',
      ' ❯ alpha',
      '   beta',
      '   the second option',
      '   Other answer…',
      '',
      ` ${copy.prompt.selectHint}`,
    ])
  })

  it('moves the cursor with the arrow keys and submits the highlighted option', () => {
    const { panel, answers } = questionPanel([singleQuestion()])
    panel.handleInput(KEY.down)
    expect(rendered(panel)[3]).toBe('   alpha')
    expect(rendered(panel)[4]).toBe(' ❯ beta')
    panel.handleInput(KEY.enter)
    expect(answers).toEqual([{ answers: [{ id: 'q1', selected: ['beta'] }] }])
  })

  it('moves the cursor with j and k', () => {
    const { panel } = questionPanel([singleQuestion()])
    panel.handleInput('j')
    expect(rendered(panel)[4]).toBe(' ❯ beta')
    panel.handleInput('k')
    expect(rendered(panel)[3]).toBe(' ❯ alpha')
  })

  it('wraps the cursor at both ends of the option list', () => {
    const { panel } = questionPanel([singleQuestion()])
    panel.handleInput(KEY.up)
    expect(rendered(panel)).toContain(' ❯ Other answer…')
    panel.handleInput(KEY.down)
    expect(rendered(panel)[3]).toBe(' ❯ alpha')
  })

  it('selects an option by its digit shortcut', () => {
    const { panel, answers } = questionPanel([singleQuestion()])
    panel.handleInput('2')
    expect(answers).toEqual([{ answers: [{ id: 'q1', selected: ['beta'] }] }])
  })

  it('ignores a digit for the custom row and for out-of-range rows', () => {
    const { panel, answers } = questionPanel([singleQuestion()])
    panel.handleInput('3')
    expect(rendered(panel)[3]).toBe(' ❯ alpha')
    panel.handleInput('9')
    expect(answers).toEqual([])
  })

  it('ignores unrelated keys on an option row', () => {
    const { panel, answers } = questionPanel([singleQuestion()])
    panel.handleInput('z')
    expect(rendered(panel)[3]).toBe(' ❯ alpha')
    expect(answers).toEqual([])
  })

  it('rejects a question index beyond the request', () => {
    const { panel } = questionPanel([])
    expect(() => panel.render(80)).toThrow('question panel: index out of bounds')
  })

  it('cancels on Escape', () => {
    const { panel, state } = questionPanel([singleQuestion()])
    panel.handleInput(KEY.escape)
    expect(state.cancels).toBe(1)
  })

  it('unwraps the description with the option width', () => {
    const question = singleQuestion({
      options: [{ label: 'alpha', description: 'one two three four five six seven eight nine ten' }],
    })
    const lines = rendered(questionPanel([question]).panel, 24)
    for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(24)
    expect(lines.filter(line => line.startsWith('   ')).length).toBeGreaterThan(1)
  })

  it('truncates the panel to a narrow width', () => {
    const { panel } = questionPanel([singleQuestion()])
    for (const line of rendered(panel, 12)) expect(visibleWidth(line)).toBeLessThanOrEqual(12)
  })

  it('escapes control characters in the question text', () => {
    const { panel } = questionPanel([singleQuestion({ question: 'bad\u0007question' })])
    expect(rendered(panel).join('\n')).toContain('bad\\x07question')
  })

  it('has no cached state to invalidate', () => {
    const { panel } = questionPanel([singleQuestion()])
    expect(() => { panel.invalidate() }).not.toThrow()
    expect(rendered(panel).length).toBeGreaterThan(0)
  })
})

describe('QuestionPanel custom answer', () => {
  it('opens the custom answer from the custom row and submits typed text', () => {
    const { panel, answers } = questionPanel([singleQuestion()])
    panel.handleInput(KEY.up)
    panel.handleInput(KEY.enter)
    const lines = rendered(panel)
    expect(lines.some(line => line.trimStart().startsWith('›'))).toBe(true)
    for (const character of 'custom answer') panel.handleInput(character)
    panel.handleInput(KEY.enter)
    expect(answers).toEqual([{ answers: [{ id: 'q1', selected: [], custom: 'custom answer' }] }])
  })

  it('opens the custom answer with the c shortcut on the custom row', () => {
    const { panel, answers } = questionPanel([singleQuestion()])
    panel.handleInput(KEY.up)
    panel.handleInput('c')
    for (const character of 'c shortcut') panel.handleInput(character)
    panel.handleInput(KEY.enter)
    expect(answers).toEqual([{ answers: [{ id: 'q1', selected: [], custom: 'c shortcut' }] }])
  })

  it('trims the custom answer', () => {
    const { panel, answers } = questionPanel([singleQuestion()])
    panel.handleInput(KEY.up)
    panel.handleInput(KEY.enter)
    for (const character of '  spaced  ') panel.handleInput(character)
    panel.handleInput(KEY.enter)
    expect(answers).toEqual([{ answers: [{ id: 'q1', selected: [], custom: 'spaced' }] }])
  })

  it('rejects an empty custom answer and shows the error', () => {
    const { panel, answers } = questionPanel([singleQuestion()])
    panel.handleInput(KEY.up)
    panel.handleInput(KEY.enter)
    panel.handleInput(KEY.enter)
    expect(answers).toEqual([])
    expect(rendered(panel).join('\n')).toContain('An answer is required.')
  })

  it('ignores unrelated keys on the custom row', () => {
    const { panel } = questionPanel([singleQuestion()])
    panel.handleInput(KEY.up)
    panel.handleInput('z')
    expect(rendered(panel).some(line => line.trimStart().startsWith('›'))).toBe(false)
    expect(rendered(panel)).toContain(' ❯ Other answer…')
  })

  it('leaves the custom answer with Escape and discards the typed draft', () => {
    const { panel, answers } = questionPanel([singleQuestion()])
    panel.handleInput(KEY.up)
    panel.handleInput(KEY.enter)
    for (const character of 'draft answer') panel.handleInput(character)
    expect(rendered(panel).some(line => line.trimStart().startsWith('›'))).toBe(true)
    panel.handleInput(KEY.escape)
    expect(rendered(panel).some(line => line.trimStart().startsWith('›'))).toBe(false)
    panel.handleInput(KEY.enter)
    for (const character of 'final answer') panel.handleInput(character)
    panel.handleInput(KEY.enter)
    expect(answers).toEqual([{ answers: [{ id: 'q1', selected: [], custom: 'final answer' }] }])
  })

  it('does not open the custom answer when Enter lands on an option', () => {
    const { panel } = questionPanel([singleQuestion()])
    panel.handleInput(KEY.enter)
    expect(rendered(panel).join('\n')).not.toContain(copy.prompt.customHint)
  })
})

describe('QuestionPanel multi-select', () => {
  it('toggles the highlighted option with space and confirms the set with Enter', () => {
    const { panel, answers } = questionPanel([multiQuestion()])
    panel.handleInput(KEY.space)
    expect(rendered(panel)[3]).toBe(' [x] alpha')
    panel.handleInput(KEY.down)
    panel.handleInput(KEY.space)
    expect(rendered(panel)[4]).toBe(' [x] beta')
    panel.handleInput(KEY.enter)
    expect(answers).toEqual([{ answers: [{ id: 'q1', selected: ['alpha', 'beta'] }] }])
  })

  it('removes a selected option when it is toggled again', () => {
    const { panel, answers } = questionPanel([multiQuestion()])
    panel.handleInput(KEY.space)
    panel.handleInput(KEY.space)
    expect(rendered(panel)[3]).toBe(' [ ] alpha')
    panel.handleInput(KEY.enter)
    expect(rendered(panel).join('\n')).toContain('Select at least one option.')
    expect(answers).toEqual([])
  })

  it('toggles options by digit shortcut', () => {
    const { panel, answers } = questionPanel([multiQuestion()])
    panel.handleInput('1')
    panel.handleInput('2')
    panel.handleInput(KEY.enter)
    expect(answers).toEqual([{ answers: [{ id: 'q1', selected: ['alpha', 'beta'] }] }])
  })

  it('ignores space on the custom row', () => {
    const { panel } = questionPanel([multiQuestion()])
    panel.handleInput(KEY.up)
    expect(rendered(panel).join('\n')).toContain('❯ Other answer…')
    panel.handleInput(KEY.space)
    expect(rendered(panel)[3]).toBe(' [ ] alpha')
  })

  it('carries selected labels with a custom answer', () => {
    const { panel, answers } = questionPanel([multiQuestion()])
    panel.handleInput(KEY.space)
    panel.handleInput(KEY.up)
    panel.handleInput(KEY.enter)
    for (const character of 'extra') panel.handleInput(character)
    panel.handleInput(KEY.enter)
    expect(answers).toEqual([{ answers: [{ id: 'q1', selected: ['alpha'], custom: 'extra' }] }])
  })

  it('shows the multi-select hint', () => {
    expect(rendered(questionPanel([multiQuestion()]).panel).join('\n')).toContain(copy.prompt.multiHint)
  })
})

describe('QuestionPanel question flow', () => {
  it('requires a selection before confirming a multi-select question', () => {
    const { panel, answers } = questionPanel([multiQuestion()])
    panel.handleInput(KEY.enter)
    expect(rendered(panel).join('\n')).toContain('Select at least one option.')
    expect(answers).toEqual([])
  })

  it('advances through a batch and submits every answer', () => {
    const questions = [
      singleQuestion({ id: 'q1', header: 'First' }),
      singleQuestion({ id: 'q2', header: 'Second', question: 'And now?' }),
    ]
    const { panel, answers } = questionPanel(questions)
    expect(rendered(panel)[0]).toBe('Question · First 1/2')
    panel.handleInput(KEY.enter)
    expect(rendered(panel)[0]).toBe('Question · Second 2/2')
    expect(rendered(panel)[1]).toBe('And now?')
    panel.handleInput(KEY.enter)
    expect(answers).toEqual([{
      answers: [
        { id: 'q1', selected: ['alpha'] },
        { id: 'q2', selected: ['alpha'] },
      ],
    }])
  })

  it('renders a no-option question and accepts only a typed answer', () => {
    const question: AskUserQuestionItem = { id: 'q1', question: 'Anything else?' }
    const { panel, answers } = questionPanel([question])
    const lines = rendered(panel)
    expect(lines[0]).toBe('Question')
    expect(lines.join('\n')).toContain(copy.prompt.custom)
    panel.handleInput(KEY.enter)
    expect(rendered(panel).some(line => line.trimStart().startsWith('›'))).toBe(true)
    for (const character of 'no thanks') panel.handleInput(character)
    panel.handleInput(KEY.enter)
    expect(answers).toEqual([{ answers: [{ id: 'q1', selected: [], custom: 'no thanks' }] }])
  })

  it('moves a no-option question cursor without options to count', () => {
    const { panel, answers } = questionPanel([{ id: 'q1', question: 'Anything else?' }])
    panel.handleInput(KEY.down)
    panel.handleInput(KEY.up)
    panel.handleInput('k')
    panel.handleInput('j')
    expect(rendered(panel)).toContain(' ❯ Other answer…')
    expect(answers).toEqual([])
  })

  it('renders markdown detail beneath the question', () => {
    const question = singleQuestion({ detail: '## Plan\n\n- first step\n- second step' })
    const { panel } = questionPanel([question])
    const lines = rendered(panel)
    expect(lines.join('\n')).toContain('Plan')
    expect(lines.join('\n')).toContain('first step')
    expect(lines.some(line => line.startsWith('  '))).toBe(true)
  })

  it('renders the plan detail of a plan-review question', () => {
    const question = singleQuestion({
      intent: { kind: 'plan-review', approve: 'Approve' },
      detail: '## Implementation plan\n\n1. add the renderer\n2. cover it',
    })
    const joined = rendered(questionPanel([question]).panel).join('\n')
    expect(joined).toContain('Implementation plan')
    expect(joined).toContain('add the renderer')
  })

  it('reuses the detail renderer for one question and rebuilds it when the index changes', () => {
    const questions = [
      singleQuestion({ id: 'q1', header: 'First', detail: 'first detail' }),
      singleQuestion({ id: 'q2', header: 'Second', detail: 'second detail' }),
    ]
    const { panel } = questionPanel(questions)
    const first = rendered(panel).join('\n')
    expect(first).toContain('first detail')
    expect(rendered(panel).join('\n')).toBe(first)
    panel.handleInput(KEY.enter)
    const second = rendered(panel).join('\n')
    expect(second).toContain('second detail')
    expect(second).not.toContain('first detail')
  })

  it('renders the remaining time when the host supplies a countdown', () => {
    const { panel } = questionPanel([singleQuestion()])
    expect(rendered(panel).join('\n')).not.toContain('left')
    panel.setRemaining(5000)
    expect(rendered(panel).at(-1)).toContain('5s left')
    panel.setRemaining(400)
    expect(rendered(panel).at(-1)).toContain('1s left')
    panel.setRemaining(-400)
    expect(rendered(panel).at(-1)).toContain('0s left')
  })

  it('styles the panel through the palette', () => {
    const { panel } = questionPanel([singleQuestion()], { color: true })
    const lines = panel.render(80)
    expect(lines[0]).toContain('\u001b[1m')
    expect(lines[0]).toContain('\u001b[36m')
    expect(lines.at(-1)).toContain(copy.prompt.selectHint)
    expect(lines.at(-1)).toContain('\u001b[2m')
  })
})

describe('QuestionPanel plan review', () => {
  /** @returns a plan-review question with approve/decline options and detail. */
  function planQuestion(overrides: Partial<AskUserQuestionItem> = {}): AskUserQuestionItem {
    return {
      id: 'plan',
      question: 'Approve this plan?',
      header: 'Plan',
      intent: { kind: 'plan-review', approve: 'Approve' },
      detail: '## Implementation plan\n\n1. add the renderer\n2. cover it',
      options: [{ label: 'Approve' }, { label: 'Decline', description: 'ask for changes' }],
      ...overrides,
    }
  }

  it('renders the plan title, framed detail, verdict marks, and hint', () => {
    const { panel } = questionPanel([planQuestion()])

    const lines = rendered(panel).map(line => line.trimEnd())

    expect(lines[0]).toBe('Plan review · Plan')
    expect(lines).toContain('Approve this plan?')
    expect(lines.join('\n')).toContain('Implementation plan')
    expect(lines.join('\n')).toContain('add the renderer')
    expect(lines).toContain(' ❯ ✓ Approve')
    expect(lines).toContain('   ✗ Decline')
    expect(lines).toContain('   ask for changes')
    expect(lines.at(-1)).toBe(` ${copy.prompt.planReviewHint}`)
    expect(lines.join('\n')).not.toContain(copy.prompt.custom)
  })

  it('frames the rendered plan detail with border rules', () => {
    const { panel } = questionPanel([planQuestion()])

    const lines = rendered(panel, 40).map(line => line.trimEnd())

    const detailStart = lines.indexOf('  Implementation plan')
    expect(detailStart).toBeGreaterThan(0)
    expect(lines[detailStart - 1]).toBe('─'.repeat(40))
    const firstOption = lines.findIndex(line => line.includes(copy.prompt.approveMark))
    expect(lines[firstOption - 1]).toBe('')
    expect(lines[firstOption - 2]).toBe('─'.repeat(40))
  })

  it('styles the approve mark as success and the decline mark as an error', () => {
    const { panel } = questionPanel([planQuestion()], { color: true })

    const text = panel.render(80).join('\n')

    expect(text).toContain('\u001b[32m✓\u001b[39m')
    expect(text).toContain('\u001b[31m✗\u001b[39m')
  })

  it('hides the custom answer row for plan review', () => {
    const { panel } = questionPanel([planQuestion()])

    panel.handleInput(KEY.down)

    const lines = rendered(panel).map(line => line.trimEnd())
    expect(lines).toContain('   ✓ Approve')
    expect(lines).toContain(' ❯ ✗ Decline')
    expect(lines.join('\n')).not.toContain(copy.prompt.custom)
  })

  it('wraps the plan-review cursor within the option rows only', () => {
    const { panel } = questionPanel([planQuestion()])

    panel.handleInput(KEY.up)
    expect(rendered(panel).map(line => line.trimEnd())).toContain(' ❯ ✗ Decline')
    panel.handleInput(KEY.down)
    expect(rendered(panel).map(line => line.trimEnd())).toContain(' ❯ ✓ Approve')
  })

  it('selects the approve label unchanged', () => {
    const { panel, answers } = questionPanel([planQuestion()])

    panel.handleInput(KEY.enter)

    expect(answers).toEqual([{ answers: [{ id: 'plan', selected: ['Approve'] }] }])
  })

  it('selects the decline label unchanged', () => {
    const { panel, answers } = questionPanel([planQuestion()])

    panel.handleInput(KEY.down)
    panel.handleInput(KEY.enter)

    expect(answers).toEqual([{ answers: [{ id: 'plan', selected: ['Decline'] }] }])
  })

  it('renders a plan review without detail and without the custom row', () => {
    const { detail: _detail, ...withoutDetail } = planQuestion()
    const { panel } = questionPanel([withoutDetail])
    const lines = rendered(panel)

    expect(lines.join('\n')).not.toContain('─')
    expect(lines.join('\n')).not.toContain(copy.prompt.custom)
    expect(lines.at(-1)).toBe(` ${copy.prompt.planReviewHint}`)
  })

  it('truncates a plan longer than the review panel shows', () => {
    const detail = Array.from({ length: 40 }, (_, index) => `- plan step ${String(index + 1)}`).join('\n')
    const { panel } = questionPanel([planQuestion({ detail })])

    const lines = rendered(panel).map(line => line.trimEnd())

    expect(lines.join('\n')).toContain(copy.prompt.planTruncated)
    expect(lines.some(line => line.includes('plan step 24'))).toBe(true)
    expect(lines.some(line => line.includes('plan step 25'))).toBe(false)
  })
})

describe('ApprovalPanel', () => {
  /** @returns a panel over one pending decision and its recorded outcomes. */
  function approval(toolName = 'bash', reason: string | null = 'runs a shell command'): { panel: ApprovalPanel; outcomes: string[] } {
    const outcomes: string[] = []
    return {
      panel: new ApprovalPanel(toolName, reason ?? undefined, createPalette(false), (outcome) => { outcomes.push(outcome) }),
      outcomes,
    }
  }

  it('renders the heading, tool, reason, and both actions', () => {
    expect(rendered(approval().panel)).toEqual([
      copy.prompt.approval,
      ` ${copy.card.tool} / bash`,
      ' runs a shell command',
      '',
      ` [a] ${copy.prompt.allow}   [r] ${copy.prompt.reject}`,
    ])
  })

  it('omits the reason row when there is no reason', () => {
    for (const reason of [null, '']) {
      const lines = rendered(approval('bash', reason).panel)
      expect(lines).toHaveLength(4)
      expect(lines[1]).toBe(` ${copy.card.tool} / bash`)
    }
  })

  it('wraps a long reason', () => {
    const lines = rendered(approval('bash', 'one two three four five six seven eight').panel, 16)
    for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(16)
    expect(lines.length).toBeGreaterThan(5)
  })

  it.each([
    [KEY.escape, 'cancelled'],
    [KEY.enter, 'allowed-once'],
    ['y', 'allowed-once'],
    ['a', 'allowed-once'],
    ['n', 'rejected'],
    ['r', 'rejected'],
  ] as const)('settles %j as %s', (input, outcome) => {
    const { panel, outcomes } = approval()
    panel.handleInput(input)
    expect(outcomes).toEqual([outcome])
  })

  it('ignores unrelated keys', () => {
    const { panel, outcomes } = approval()
    panel.handleInput('q')
    expect(outcomes).toEqual([])
  })

  it('truncates to a narrow width', () => {
    for (const line of rendered(approval().panel, 10)) expect(visibleWidth(line)).toBeLessThanOrEqual(10)
  })

  it('escapes control characters in the tool name', () => {
    expect(rendered(approval('bad\u0007tool').panel).join('\n')).toContain('bad\\x07tool')
  })

  it('has no cached state to invalidate', () => {
    const { panel } = approval()
    expect(() => { panel.invalidate() }).not.toThrow()
  })
})

describe('TextPanel', () => {
  /** @returns a panel over fixed lines and a close recorder. */
  function textPanel(
    title = 'Help',
    lines: readonly string[] = ['first line', 'second line'],
    maxVisible = 12,
  ): { panel: TextPanel; state: { closes: number } } {
    const state = { closes: 0 }
    return {
      panel: new TextPanel(title, lines, createPalette(false), () => { state.closes += 1 }, maxVisible),
      state,
    }
  }

  it('renders the title, body, and scroll hint', () => {
    expect(rendered(textPanel().panel)).toEqual([
      'Help',
      'first line',
      'second line',
      '',
      copy.panel.scrollHint,
    ])
  })

  it('splits embedded newlines into rows', () => {
    const { panel } = textPanel('Help', ['first\nsecond'])
    expect(rendered(panel)).toEqual(['Help', 'first', 'second', '', copy.panel.scrollHint])
  })

  it.each([KEY.escape, KEY.enter, 'q'])('closes on %j', (input) => {
    const { panel, state } = textPanel()
    panel.handleInput(input)
    expect(state.closes).toBe(1)
  })

  it('ignores unrelated keys', () => {
    const { panel, state } = textPanel()
    panel.handleInput('x')
    expect(state.closes).toBe(0)
  })

  it('scrolls one row per arrow key and one page per page key', () => {
    const lines = Array.from({ length: 20 }, (_, index) => `row ${String(index)}`)
    const { panel } = textPanel('Help', lines, 5)

    expect(rendered(panel)).toEqual([
      'Help', 'row 0', 'row 1', 'row 2', 'row 3', 'row 4',
      `  ↓ ${copy.moreRows(15)}`, '', copy.panel.scrollHint,
    ])

    const firstRow = (): string => rendered(panel).find(line => line.startsWith('row ')) ?? ''

    panel.handleInput(KEY.down)
    expect(firstRow()).toBe('row 1')
    expect(rendered(panel)).toContain(`  ↑ ${copy.moreRows(1)}`)
    expect(rendered(panel)).toContain(`  ↓ ${copy.moreRows(14)}`)

    panel.handleInput(KEY.pageDown)
    expect(firstRow()).toBe('row 6')
    expect(rendered(panel)).toContain(`  ↑ ${copy.moreRows(6)}`)

    panel.handleInput(KEY.pageUp)
    expect(firstRow()).toBe('row 1')

    panel.handleInput(KEY.up)
    expect(firstRow()).toBe('row 0')
    panel.handleInput(KEY.up)
    expect(firstRow()).toBe('row 0')

    for (let step = 0; step < 10; step += 1) panel.handleInput(KEY.pageDown)
    expect(rendered(panel)).toContain(`  ↑ ${copy.moreRows(15)}`)
    expect(rendered(panel)).not.toContain(copy.moreRows(16))
  })

  it('truncates the title, body, and hint to the panel width', () => {
    const { panel } = textPanel('A very long panel title', ['a very long body line that will not fit'])
    for (const line of rendered(panel, 10)) expect(visibleWidth(line)).toBeLessThanOrEqual(10)
  })
  it('has no cached state to invalidate', () => {
    const { panel } = textPanel()
    expect(() => { panel.invalidate() }).not.toThrow()
  })
})
