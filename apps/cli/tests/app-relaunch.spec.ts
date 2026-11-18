/** Launcher relaunch ordering: enter the target workspace, dispose the tree, then replace the process. */

import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createAppRelaunch } from '../src/profile-boot.ts'
import { absolutizePatchArgs, relaunchArgs } from '../src/relaunch.ts'

describe('createAppRelaunch', () => {
  it('enters the workspace, disposes the tree, and executes the replacement in order', async () => {
    const order: string[] = []
    const relaunch = createAppRelaunch(
      (args) => {
        order.push(`exec:${args.join(' ')}`)
        throw new Error('replacement returned')
      },
      async () => { order.push('dispose') },
      (cwd) => { order.push(`chdir:${cwd}`) },
    )

    await expect(relaunch.relaunch(['--resume', 'session-next'], '/workspace')).rejects.toThrow(
      'replacement returned',
    )
    expect(order).toEqual(['chdir:/workspace', 'dispose', 'exec:--resume session-next'])
  })

  it('rejects an unreachable workspace before disposing the tree', async () => {
    const dispose = vi.fn(async () => {})
    const relaunch = createAppRelaunch(() => { throw new Error('must not execute') }, dispose, () => {
      throw new Error('no such directory')
    })

    await expect(relaunch.relaunch([], '/missing')).rejects.toThrow('no such directory')
    expect(dispose).not.toHaveBeenCalled()
  })

  it('does not execute when teardown fails', async () => {
    const exec = vi.fn((_args: readonly string[]) => { throw new Error('must not execute') })
    const relaunch = createAppRelaunch(exec, async () => { throw new Error('teardown failed') }, () => {})

    await expect(relaunch.relaunch([], '/workspace')).rejects.toThrow('teardown failed')
    expect(exec).not.toHaveBeenCalled()
  })
})

describe('absolutizePatchArgs', () => {
  it('resolves both --patch forms and leaves other launcher flags alone', () => {
    expect(absolutizePatchArgs([
      '--profile', 'tui', '--patch', './one.yml', '--patch=./two.yml', '--from-default-profile', 'tui',
    ])).toEqual([
      '--profile', 'tui', '--patch', resolve('one.yml'), `--patch=${resolve('two.yml')}`,
      '--from-default-profile', 'tui',
    ])
  })

  it('leaves a trailing --patch without a value for the launcher parser', () => {
    expect(absolutizePatchArgs(['--patch'])).toEqual(['--patch'])
  })
})


describe('relaunchArgs', () => {
  it('keeps Node script entry and exec arguments for a source launcher', () => {
    expect(relaunchArgs({
      execPath: '/usr/bin/node', execArgv: ['--import', 'tsx/esm'], entry: 'apps/cli/src/bin.ts',
      launcherArgs: ['tui'], args: ['--resume', 'session-next'], standalone: false,
    })).toEqual([
      '/usr/bin/node', '--import', 'tsx/esm', resolve('apps/cli/src/bin.ts'), 'tui', '--resume', 'session-next',
    ])
  })

  it('omits the embedded SEA entry and exec arguments for a standalone runtime', () => {
    expect(relaunchArgs({
      execPath: '/Users/me/.local/share/dsh-tui/dsh-tui', execArgv: [], entry: '/snapshot/node/runtime-bootstrap.mjs',
      launcherArgs: ['tui'], args: ['--resume', 'session-next'], standalone: true,
    })).toEqual(['/Users/me/.local/share/dsh-tui/dsh-tui', 'tui', '--resume', 'session-next'])
  })
})
