import { vi } from 'vitest'
import type { NwcSigner } from '../src/signer/types.js'
import { NWC_RESPONSE_KIND } from '../nip47.js'
import { NNC_RESPONSE_KIND } from '../nipXX.js'

export const WALLET_PUBKEY = 'cc'.repeat(32)
export const SERVICE_PUBKEY = 'dd'.repeat(32)
export const RELAY_URLS = ['wss://relay.example.com']

export function createMockSigner(): NwcSigner {
  let eventCounter = 0
  return {
    getPublicKey: vi.fn().mockResolvedValue('aabb'.repeat(16)),
    signEvent: vi.fn().mockImplementation(async (event) => ({
      ...event,
      id: `event-${++eventCounter}`,
      pubkey: 'aabb'.repeat(16),
      sig: 'sig-' + eventCounter,
    })),
    nip44Encrypt: vi.fn().mockImplementation(async (_pk, pt) => `encrypted:${pt}`),
    nip44Decrypt: vi.fn().mockImplementation(async (_pk, ct) => {
      if (ct.startsWith('encrypted:')) return ct.slice('encrypted:'.length)
      return ct
    }),
  }
}

export function createMockPool(
  responsePayload?: Record<string, unknown>,
  responseKind: number = NWC_RESPONSE_KIND,
) {
  const subscribeManyMock = vi.fn().mockImplementation((_relays, _filter, params) => {
    if (responsePayload) {
      setTimeout(() => {
        const response = JSON.stringify({
          result_type: responsePayload.result_type ?? 'get_info',
          result: responsePayload.result ?? {},
          error: responsePayload.error ?? null,
        })
        params.onevent({
          id: 'resp-1',
          pubkey: responseKind === NNC_RESPONSE_KIND ? SERVICE_PUBKEY : WALLET_PUBKEY,
          content: `encrypted:${response}`,
          kind: responseKind,
          created_at: Math.floor(Date.now() / 1000),
          tags: [['e', 'event-1']],
          sig: 'sig',
        })
      }, 10)
    }
    return { close: vi.fn() }
  })

  const publishMock = vi.fn().mockReturnValue([Promise.resolve('ok')])

  return {
    subscribeMany: subscribeManyMock,
    publish: publishMock,
    close: vi.fn(),
  }
}
