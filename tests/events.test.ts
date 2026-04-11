import { describe, it, expect, vi } from 'vitest'
import { TransportEventEmitter } from '../src/events.js'

describe('TransportEventEmitter', () => {
  it('emits events to registered handlers', () => {
    const emitter = new TransportEventEmitter()
    const handler = vi.fn()
    emitter.on(handler)

    emitter.emit({ type: 'request', method: 'get_info' })

    expect(handler).toHaveBeenCalledOnce()
    expect(handler.mock.calls[0][0]).toMatchObject({
      type: 'request',
      method: 'get_info',
    })
    expect(handler.mock.calls[0][0].timestamp).toBeTypeOf('number')
  })

  it('supports multiple handlers', () => {
    const emitter = new TransportEventEmitter()
    const h1 = vi.fn()
    const h2 = vi.fn()
    emitter.on(h1)
    emitter.on(h2)

    emitter.emit({ type: 'connection' })

    expect(h1).toHaveBeenCalledOnce()
    expect(h2).toHaveBeenCalledOnce()
  })

  it('returns unsubscribe function', () => {
    const emitter = new TransportEventEmitter()
    const handler = vi.fn()
    const unsub = emitter.on(handler)

    emitter.emit({ type: 'request' })
    expect(handler).toHaveBeenCalledOnce()

    unsub()
    emitter.emit({ type: 'request' })
    expect(handler).toHaveBeenCalledOnce() // still 1
  })

  it('removeAllListeners clears everything', () => {
    const emitter = new TransportEventEmitter()
    const handler = vi.fn()
    emitter.on(handler)

    emitter.removeAllListeners()
    emitter.emit({ type: 'error', error: 'test' })

    expect(handler).not.toHaveBeenCalled()
  })

  it('handler errors do not crash other handlers', () => {
    const emitter = new TransportEventEmitter()
    const badHandler = vi.fn().mockImplementation(() => {
      throw new Error('boom')
    })
    const goodHandler = vi.fn()

    emitter.on(badHandler)
    emitter.on(goodHandler)

    emitter.emit({ type: 'notification', method: 'payment_received' })

    expect(badHandler).toHaveBeenCalledOnce()
    expect(goodHandler).toHaveBeenCalledOnce()
  })
})
