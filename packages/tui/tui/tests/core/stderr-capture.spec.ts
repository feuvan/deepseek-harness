import { afterEach, describe, expect, it, vi } from 'vitest'
import { StderrCapture } from '../../src/stderr-capture.ts'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('StderrCapture', () => {
  it('emits complete lines, callbacks, and restores the original stream', () => {
    const original = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const lines: string[] = []
    const callbacks: (Error | null | undefined)[] = []
    const capture = new StderrCapture((line) => { lines.push(line) })

    capture.install()
    process.stderr.write('first\nsecond', 'utf8', (error) => { callbacks.push(error) })
    process.stderr.write(new Uint8Array([10]), 'utf8', (error) => { callbacks.push(error) })
    process.stderr.write('third\n')
    process.stderr.write('fourth\n', (error) => { callbacks.push(error) })
    process.stderr.write(new Uint8Array([120, 10]), (error) => { callbacks.push(error) })
    expect(lines).toEqual(['first', 'second', 'third', 'fourth', 'x'])
    expect(callbacks).toEqual([undefined, undefined, undefined, undefined])
    expect(original).not.toHaveBeenCalled()

    capture.uninstall()
    expect(lines).toEqual(['first', 'second', 'third', 'fourth', 'x'])
    process.stderr.write('after\n')
    expect(original).toHaveBeenCalledWith('after\n')
  })

  it('truncates an unterminated overlong line and ignores blank lines', () => {
    const lines: string[] = []
    const capture = new StderrCapture((line) => { lines.push(line) })

    capture.install()
    process.stderr.write('\n  \n')
    process.stderr.write('x'.repeat(17 * 1024))
    capture.uninstall()

    expect(lines).toHaveLength(2)
    expect(lines[0]).toBe('x'.repeat(16 * 1024))
    expect(lines[1]).toBe('x'.repeat(1024))
  })

  it('installs idempotently and uninstalls idempotently', () => {
    const original = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const capture = new StderrCapture(() => {})

    capture.install()
    capture.install()
    capture.uninstall()
    capture.uninstall()

    // oxlint-disable-next-line typescript/unbound-method -- identity comparison of the restored stream method
    expect(process.stderr.write).toBe(original)
  })
})
