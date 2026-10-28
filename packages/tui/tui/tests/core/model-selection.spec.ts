import { describe, expect, it } from 'vitest'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { bindModelSelection } from '../../src/model-selection.ts'
import { agentDouble } from './harness.ts'

describe('bindModelSelection', () => {
  it('starts from the fallback and routes writes through the Agent', () => {
    const { agent } = agentDouble({ session: Session.create(SessionId('model-selection')) })
    const selection = bindModelSelection(agent, { provider: 'test', model: 'fallback' })

    expect(selection.current).toEqual({ provider: 'test', model: 'fallback' })
    selection.current = { provider: 'test', model: 'next' }
    expect(selection.current).toEqual({ provider: 'test', model: 'next' })
    selection.current = undefined
    expect(selection.current).toEqual({ provider: 'test', model: 'next' })
  })
})
