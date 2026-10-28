/**
 * Mutable view of one Agent's model route for the terminal front door.
 *
 * The Agent owns durable model selection. The terminal keeps a small adapter
 * so its existing read/write call sites can keep reading and replacing the
 * current route while every write flows through the Agent's selection API.
 *
 * @module @deepseek-ai/dsh-tui/model-selection
 */

import type { Agent, ModelSelection } from '@deepseek-ai/dsh-agent'

/** Mutable current route used by the terminal surfaces. */
export interface ModelSelectionRef {
  /** Read or replace the route the next model step uses. */
  current: Readonly<ModelSelection> | undefined
}

/**
 * Bind one terminal selection view to an Agent.
 * @param agent - presented root Agent.
 * @param initial - route used before the Agent records a selection.
 * @returns the mutable route view.
 */
export function bindModelSelection(agent: Agent, initial: Readonly<ModelSelection>): ModelSelectionRef {
  let fallback: Readonly<ModelSelection> = initial
  return {
    get current(): Readonly<ModelSelection> | undefined { return agent.model.current() ?? fallback },
    set current(selection: Readonly<ModelSelection> | undefined) {
      if (selection === undefined) return
      fallback = selection
      agent.model.select(selection)
    },
  }
}
