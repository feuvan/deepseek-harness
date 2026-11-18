/**
 * Launcher argument preparation for an in-place relaunch.
 *
 * A relaunch may enter another workspace before executing, so path-valued
 * launcher flags must be absolute before the process leaves the directory they
 * were resolved against.
 *
 * @module @deepseek-ai/dsh/relaunch
 */

import { resolve } from 'node:path'

/**
 * Resolve every launcher `--patch` path against the launching directory.
 * @param args - the launcher arguments as typed, before the app arguments.
 * @returns a fresh list with absolute patch paths; every other argument is unchanged.
 */
export function absolutizePatchArgs(args: readonly string[]): string[] {
  const resolved: string[] = []
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    /* v8 ignore next -- the loop bound proves the indexed argument exists */
    if (argument === undefined) continue
    if (argument === '--patch') {
      resolved.push(argument)
      const value = args[index + 1]
      if (value === undefined) continue
      resolved.push(resolve(value))
      index += 1
      continue
    }
    if (argument.startsWith('--patch=')) {
      resolved.push(`--patch=${resolve(argument.slice('--patch='.length))}`)
      continue
    }
    resolved.push(argument)
  }
  return resolved
}

/**
 * Build the replacement argv for one launcher process.
 *
 * A standalone single-file runtime has no script entry or Node exec arguments;
 * passing its embedded bootstrap path as an argument makes the next process
 * read it as the profile name. A Node launcher still needs both.
 * @param options - executable, entry, launcher flags, app arguments, and whether the runtime is standalone.
 * @returns argv for the replacement process.
 */
export function relaunchArgs(options: {
  readonly execPath: string
  readonly execArgv: readonly string[]
  readonly entry: string | undefined
  readonly launcherArgs: readonly string[]
  readonly args: readonly string[]
  readonly standalone: boolean
}): string[] {
  if (options.standalone) return [options.execPath, ...options.launcherArgs, ...options.args]
  return [
    options.execPath,
    ...options.execArgv,
    ...(options.entry === undefined ? [] : [resolve(options.entry)]),
    ...options.launcherArgs,
    ...options.args,
  ]
}
