import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { BrowserTransport } from '../src/transport/browser.js'

// ─── MockWebSocket ──────────────────────────────────────────────────────────

class MockWebSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3

  readyState = MockWebSocket.CONNECTING
  onopen: (() => void) | null = null
  onerror: (() => void) | null = null
  onclose: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null

  send = vi.fn()
  close = vi.fn().mockImplementation(() => {
    this.readyState = MockWebSocket.CLOSED
    this.onclose?.()
  })

  // Test helpers
  simulateOpen(): void {
    this.readyState = MockWebSocket.OPEN
    this.onopen?.()
  }

  simulateMessage(data: string): void {
    this.onmessage?.({ data })
  }

  simulateClose(): void {
    this.readyState = MockWebSocket.CLOSED
    this.onclose?.()
  }

  simulateError(): void {
    this.onerror?.()
  }
}

// Keep track of all created instances
let wsInstances: MockWebSocket[] = []

function getMockWebSocketConstructor() {
  return vi.fn().mockImplementation(() => {
    const ws = new MockWebSocket()
    wsInstances.push(ws)
    return ws
  })
}

describe('BrowserTransport', () => {
  let savedWS: unknown

  beforeEach(() => {
    vi.useFakeTimers()
    wsInstances = []
    savedWS = (globalThis as any).WebSocket
    ;(globalThis as any).WebSocket = getMockWebSocketConstructor()
    // Copy static constants to the mock constructor
    ;(globalThis as any).WebSocket.OPEN = MockWebSocket.OPEN
    ;(globalThis as any).WebSocket.CONNECTING = MockWebSocket.CONNECTING
    ;(globalThis as any).WebSocket.CLOSING = MockWebSocket.CLOSING
    ;(globalThis as any).WebSocket.CLOSED = MockWebSocket.CLOSED
  })

  afterEach(() => {
    vi.useRealTimers()
    ;(globalThis as any).WebSocket = savedWS
  })

  describe('connect', () => {
    it('creates WebSocket and resolves on open', async () => {
      const transport = new BrowserTransport('wss://relay.example.com')

      const connectPromise = transport.connect()

      // The WebSocket was created
      expect(wsInstances).toHaveLength(1)

      // Simulate connection open
      wsInstances[0].simulateOpen()

      await connectPromise
      expect(transport.connected).toBe(true)

      transport.disconnect()
    })

    it('rejects on connection timeout', async () => {
      const transport = new BrowserTransport('wss://relay.example.com', {
        connectTimeoutMs: 3000,
      })

      const connectPromise = transport.connect()

      // Advance timer past the timeout
      vi.advanceTimersByTime(3001)

      await expect(connectPromise).rejects.toThrow('Relay connection timeout')

      transport.disconnect()
    })

    it('reuses existing open connection (idempotent)', async () => {
      const transport = new BrowserTransport('wss://relay.example.com')

      const p1 = transport.connect()
      wsInstances[0].simulateOpen()
      await p1

      const p2 = transport.connect()
      await p2

      // Only one WebSocket should have been created
      expect(wsInstances).toHaveLength(1)

      transport.disconnect()
    })
  })

  describe('send', () => {
    it('sends frame when connected', async () => {
      const transport = new BrowserTransport('wss://relay.example.com')

      const connectPromise = transport.connect()
      wsInstances[0].simulateOpen()
      await connectPromise

      transport.send('["EVENT", {}]')

      expect(wsInstances[0].send).toHaveBeenCalledWith('["EVENT", {}]')

      transport.disconnect()
    })

    it('throws when not connected', () => {
      const transport = new BrowserTransport('wss://relay.example.com')

      expect(() => transport.send('["EVENT", {}]')).toThrow('WebSocket not connected')
    })
  })

  describe('sendThrottled', () => {
    it('sends immediately when under concurrency limit', async () => {
      const transport = new BrowserTransport('wss://relay.example.com', {
        maxConcurrentRequests: 2,
      })

      const connectPromise = transport.connect()
      wsInstances[0].simulateOpen()
      await connectPromise

      const release = await transport.sendThrottled('["REQ", "sub1"]')

      expect(wsInstances[0].send).toHaveBeenCalledWith('["REQ", "sub1"]')

      release()
      transport.disconnect()
    })

    it('queues when at max concurrent requests, drains on release', async () => {
      const transport = new BrowserTransport('wss://relay.example.com', {
        maxConcurrentRequests: 1,
      })

      const connectPromise = transport.connect()
      wsInstances[0].simulateOpen()
      await connectPromise

      // First request goes through immediately
      const release1 = await transport.sendThrottled('["REQ", "sub1"]')
      expect(wsInstances[0].send).toHaveBeenCalledTimes(1)

      // Second request should queue
      let release2Resolved = false
      const release2Promise = transport.sendThrottled('["REQ", "sub2"]').then((r) => {
        release2Resolved = true
        return r
      })

      // Allow microtasks to run
      await vi.advanceTimersByTimeAsync(0)

      // Still queued
      expect(release2Resolved).toBe(false)

      // Release first request → second should proceed
      release1()
      await vi.advanceTimersByTimeAsync(0)

      const release2 = await release2Promise
      expect(wsInstances[0].send).toHaveBeenCalledTimes(2)

      release2()
      transport.disconnect()
    })
  })

  describe('disconnect', () => {
    it('closes WebSocket, prevents reconnect, drains queue', async () => {
      const transport = new BrowserTransport('wss://relay.example.com')

      const connectPromise = transport.connect()
      wsInstances[0].simulateOpen()
      await connectPromise

      transport.disconnect()

      expect(wsInstances[0].close).toHaveBeenCalled()
      expect(transport.connected).toBe(false)
    })
  })

  describe('message routing', () => {
    it('onMessage delivers incoming frames to handlers', async () => {
      const transport = new BrowserTransport('wss://relay.example.com')

      const handler = vi.fn()
      transport.onMessage(handler)

      const connectPromise = transport.connect()
      wsInstances[0].simulateOpen()
      await connectPromise

      wsInstances[0].simulateMessage('["EVENT", "sub1", {}]')

      expect(handler).toHaveBeenCalledWith('["EVENT", "sub1", {}]')

      transport.disconnect()
    })
  })

  describe('connection state', () => {
    it('onConnectionChange notifies on connect and disconnect', async () => {
      const transport = new BrowserTransport('wss://relay.example.com')

      const listener = vi.fn()
      transport.onConnectionChange(listener)

      const connectPromise = transport.connect()
      wsInstances[0].simulateOpen()
      await connectPromise

      expect(listener).toHaveBeenCalledWith(true)

      transport.disconnect()

      expect(listener).toHaveBeenCalledWith(false)
    })

    it('connected getter reflects WebSocket state', async () => {
      const transport = new BrowserTransport('wss://relay.example.com')

      expect(transport.connected).toBe(false)

      const connectPromise = transport.connect()
      wsInstances[0].simulateOpen()
      await connectPromise

      expect(transport.connected).toBe(true)

      transport.disconnect()

      expect(transport.connected).toBe(false)
    })
  })

  describe('auto-reconnect', () => {
    it('schedules reconnect on unexpected close', async () => {
      const transport = new BrowserTransport('wss://relay.example.com', {
        reconnectBaseMs: 100,
      })

      const connectPromise = transport.connect()
      wsInstances[0].simulateOpen()
      await connectPromise

      // Simulate unexpected close (server-side)
      wsInstances[0].readyState = MockWebSocket.CLOSED
      wsInstances[0].onclose?.()

      // Advance timer to trigger reconnect
      vi.advanceTimersByTime(101)

      // A new WebSocket should have been created
      expect(wsInstances).toHaveLength(2)

      transport.disconnect()
    })

    it('does not reconnect after disconnect()', async () => {
      const transport = new BrowserTransport('wss://relay.example.com', {
        reconnectBaseMs: 100,
      })

      const connectPromise = transport.connect()
      wsInstances[0].simulateOpen()
      await connectPromise

      transport.disconnect()

      // Advance timers well past any reconnect delay
      vi.advanceTimersByTime(5000)

      // No new WebSocket created after explicit disconnect
      expect(wsInstances).toHaveLength(1)
    })

    it('uses exponential backoff capped at reconnectMaxMs', async () => {
      const transport = new BrowserTransport('wss://relay.example.com', {
        reconnectBaseMs: 100,
        reconnectMaxMs: 500,
      })

      const connectPromise = transport.connect()
      wsInstances[0].simulateOpen()
      await connectPromise

      // First unexpected close → delay = 100ms (100 * 2^0)
      wsInstances[0].readyState = MockWebSocket.CLOSED
      wsInstances[0].onclose?.()
      await vi.advanceTimersByTimeAsync(101)
      expect(wsInstances).toHaveLength(2)

      // Second unexpected close → delay = 200ms (100 * 2^1)
      wsInstances[1].simulateError()
      wsInstances[1].readyState = MockWebSocket.CLOSED
      wsInstances[1].onclose?.()
      await vi.advanceTimersByTimeAsync(150)
      // Not yet — need 200ms
      expect(wsInstances).toHaveLength(2)
      await vi.advanceTimersByTimeAsync(51)
      expect(wsInstances).toHaveLength(3)

      // Third unexpected close → delay = 400ms (100 * 2^2)
      wsInstances[2].simulateError()
      wsInstances[2].readyState = MockWebSocket.CLOSED
      wsInstances[2].onclose?.()
      await vi.advanceTimersByTimeAsync(401)
      expect(wsInstances).toHaveLength(4)

      // Fourth unexpected close → delay = 500ms (capped at reconnectMaxMs)
      wsInstances[3].simulateError()
      wsInstances[3].readyState = MockWebSocket.CLOSED
      wsInstances[3].onclose?.()
      await vi.advanceTimersByTimeAsync(499)
      expect(wsInstances).toHaveLength(4) // not yet
      await vi.advanceTimersByTimeAsync(2)
      expect(wsInstances).toHaveLength(5)

      transport.disconnect()
    })
  })
})
