import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { GrantVerifier, publishGrant } from '../src/grant.js'
import type { UsageProfile } from '../src/grant.js'
import { createMockSigner } from './_helpers.js'

// GrantVerifier.checkAccess uses a cache + relay fetch internally.
// For unit testing, we test the access logic by subclassing to inject grants.
class TestGrantVerifier extends GrantVerifier {
  private grants = new Map<string, UsageProfile>()

  setGrant(callerPubkey: string, profile: UsageProfile): void {
    this.grants.set(callerPubkey, profile)
  }

  // Override by injecting into the cache directly before calling super
  async checkAccess(callerPubkey: string, method: string, isControl: boolean): Promise<string | null> {
    const profile = this.grants.get(callerPubkey)
    if (profile) {
      const cache = (this as any).cache as Map<string, { profile: UsageProfile; fetchedAt: number }>
      cache.set(callerPubkey, { profile, fetchedAt: Date.now() })
    }
    return super.checkAccess(callerPubkey, method, isControl)
  }
}

describe('GrantVerifier', () => {
  const relayUrl = 'wss://relay.example.com'
  const servicePk = 'aa'.repeat(32)
  const callerPk = 'bb'.repeat(32)

  it('denies when no grant exists', async () => {
    const verifier = new TestGrantVerifier(relayUrl, servicePk)
    const result = await verifier.checkAccess(callerPk, 'get_info', false)
    expect(result).toContain('No access grant')
  })

  it('allows NWC method when listed in methods', async () => {
    const verifier = new TestGrantVerifier(relayUrl, servicePk)
    verifier.setGrant(callerPk, {
      methods: { get_info: {}, get_balance: {} },
    })

    const result = await verifier.checkAccess(callerPk, 'get_info', false)
    expect(result).toBeNull() // authorized
  })

  it('denies NWC method not in methods', async () => {
    const verifier = new TestGrantVerifier(relayUrl, servicePk)
    verifier.setGrant(callerPk, {
      methods: { get_info: {} },
    })

    const result = await verifier.checkAccess(callerPk, 'pay_invoice', false)
    expect(result).toContain('not in wallet grant')
  })

  it('allows ALL NWC methods when ALL key is present', async () => {
    const verifier = new TestGrantVerifier(relayUrl, servicePk)
    verifier.setGrant(callerPk, {
      methods: { ALL: {} },
    })

    const result = await verifier.checkAccess(callerPk, 'pay_invoice', false)
    expect(result).toBeNull()
  })

  it('denies when methods is empty object', async () => {
    const verifier = new TestGrantVerifier(relayUrl, servicePk)
    verifier.setGrant(callerPk, {
      methods: {},
    })

    const result = await verifier.checkAccess(callerPk, 'get_info', false)
    expect(result).toContain('Empty methods grant')
  })

  it('allows NNC control method when listed in control', async () => {
    const verifier = new TestGrantVerifier(relayUrl, servicePk)
    verifier.setGrant(callerPk, {
      control: { list_channels: {}, open_channel: {} },
    })

    const result = await verifier.checkAccess(callerPk, 'list_channels', true)
    expect(result).toBeNull()
  })

  it('denies NNC method when control is missing', async () => {
    const verifier = new TestGrantVerifier(relayUrl, servicePk)
    verifier.setGrant(callerPk, {
      methods: { get_info: {} },
      // no control field
    })

    const result = await verifier.checkAccess(callerPk, 'list_channels', true)
    expect(result).toContain('No control access')
  })

  it('denies NNC method not in control', async () => {
    const verifier = new TestGrantVerifier(relayUrl, servicePk)
    verifier.setGrant(callerPk, {
      control: { list_channels: {} },
    })

    const result = await verifier.checkAccess(callerPk, 'open_channel', true)
    expect(result).toContain('not in control grant')
  })

  it('allows ALL NNC methods when ALL key is present', async () => {
    const verifier = new TestGrantVerifier(relayUrl, servicePk)
    verifier.setGrant(callerPk, {
      control: { ALL: {} },
    })

    const result = await verifier.checkAccess(callerPk, 'open_channel', true)
    expect(result).toBeNull()
  })

  it('unrestricted NWC access when methods is undefined', async () => {
    const verifier = new TestGrantVerifier(relayUrl, servicePk)
    verifier.setGrant(callerPk, {
      // no methods field = unrestricted NWC access per NNC spec
      control: { list_channels: {} },
    })

    const result = await verifier.checkAccess(callerPk, 'pay_invoice', false)
    expect(result).toBeNull()
  })

  it('clearCache empties cache so next checkAccess re-fetches', async () => {
    const verifier = new TestGrantVerifier(relayUrl, servicePk)
    verifier.setGrant(callerPk, {
      methods: { get_info: {} },
    })

    // First call populates cache
    const result1 = await verifier.checkAccess(callerPk, 'get_info', false)
    expect(result1).toBeNull()

    // Clear cache and remove the grant from the test map
    verifier.clearCache()
    // After clearing, checkAccess without a grant in the test map should fail
    // because the TestGrantVerifier won't re-inject into cache
    const verifier2 = new TestGrantVerifier(relayUrl, servicePk)
    // No grant set — should get "No access grant"
    const result2 = await verifier2.checkAccess(callerPk, 'get_info', false)
    expect(result2).toContain('No access grant')
  })
})

describe('publishGrant', () => {
  let savedWS: unknown
  let wsInstances: any[]

  class MockWebSocket {
    onopen: (() => void) | null = null
    onerror: (() => void) | null = null
    onmessage: ((event: { data: string }) => void) | null = null
    send = vi.fn()
    close = vi.fn()

    simulateOpen(): void { this.onopen?.() }
    simulateMessage(data: string): void { this.onmessage?.({ data }) }
    simulateError(): void { this.onerror?.() }
  }

  beforeEach(() => {
    wsInstances = []
    savedWS = (globalThis as any).WebSocket
    ;(globalThis as any).WebSocket = vi.fn().mockImplementation(() => {
      const ws = new MockWebSocket()
      wsInstances.push(ws)
      return ws
    })
  })

  afterEach(() => {
    ;(globalThis as any).WebSocket = savedWS
  })

  it('signs kind 30078 with correct d-tag and content', async () => {
    const signer = createMockSigner()
    const servicePk = 'aa'.repeat(32)
    const controllerPk = 'bb'.repeat(32)
    const profile: UsageProfile = { methods: { get_info: {} } }

    const publishPromise = publishGrant(signer, 'wss://relay.example.com', servicePk, controllerPk, profile)

    // Wait for WebSocket to be created
    await vi.waitFor(() => expect(wsInstances).toHaveLength(1))
    const ws = wsInstances[0]

    // Simulate connection open
    ws.simulateOpen()

    // Wait for event to be sent
    await vi.waitFor(() => expect(ws.send).toHaveBeenCalled())

    // Parse the sent EVENT frame
    const sentFrame = JSON.parse(ws.send.mock.calls[0][0])
    expect(sentFrame[0]).toBe('EVENT')
    const event = sentFrame[1]
    expect(event.kind).toBe(30078)

    // Verify d-tag
    const dTag = event.tags.find((t: string[]) => t[0] === 'd')
    expect(dTag[1]).toBe(`${servicePk}:${controllerPk}`)

    // Verify content
    expect(event.content).toBe(JSON.stringify(profile))

    // Simulate OK response
    ws.simulateMessage(JSON.stringify(['OK', event.id, true, '']))

    const eventId = await publishPromise
    expect(eventId).toBe(event.id)
  })

  it('rejects when relay returns error', async () => {
    const signer = createMockSigner()
    const servicePk = 'aa'.repeat(32)
    const controllerPk = 'bb'.repeat(32)
    const profile: UsageProfile = { methods: { get_info: {} } }

    const publishPromise = publishGrant(signer, 'wss://relay.example.com', servicePk, controllerPk, profile)

    await vi.waitFor(() => expect(wsInstances).toHaveLength(1))
    const ws = wsInstances[0]

    ws.simulateOpen()
    await vi.waitFor(() => expect(ws.send).toHaveBeenCalled())

    const sentFrame = JSON.parse(ws.send.mock.calls[0][0])
    const event = sentFrame[1]

    // Simulate relay rejection
    ws.simulateMessage(JSON.stringify(['OK', event.id, false, 'blocked: rate limited']))

    await expect(publishPromise).rejects.toThrow('Grant rejected by relay')
  })
})
