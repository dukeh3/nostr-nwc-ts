/**
 * E2E Hold Invoice Flow Tests
 *
 * Tests NWC hold invoice stubs: make_hold_invoice, settle_hold_invoice,
 * cancel_hold_invoice.
 *
 * Hold invoices are stubs in ldk-controller: they validate params and return
 * placeholder responses. Tests verify the SDK-to-controller round-trip works.
 *
 * Prerequisites:
 *   docker images: strfry-strfry:latest, ruimarinho/bitcoin-core:latest, ldk-controller:e2e
 */

import WebSocket from 'ws'
;(globalThis as any).WebSocket = WebSocket

import { describe, it, afterAll, expect } from 'vitest'
import type { TwoNodeNetwork } from './setup.js'
import { setupTwoNodeNetwork } from './setup.js'

describe('E2E: Hold invoice flows', () => {
  let net: TwoNodeNetwork

  afterAll(() => {
    net?.cleanup()
  })

  it(
    'make_hold_invoice returns stub response',
    async () => {
      if (!net) {
        net = await setupTwoNodeNetwork({
          openChannel: true,
          channelAmount: 2_000_000,
          pushAmount: 1_000_000,
        })
      }

      const paymentHash = 'aa'.repeat(32) // 32-byte hex
      const result = await net.aliceNwc.makeHoldInvoice({
        amount: 10_000_000,
        payment_hash: paymentHash,
      })

      expect(result.payment_hash).toBeTruthy()
      console.log(`[e2e] Hold invoice created, payment_hash: ${result.payment_hash}`)
    },
    { timeout: 120_000 },
  )

  it(
    'settle_hold_invoice accepts preimage (stub)',
    async () => {
      if (!net) throw new Error('Network not initialized')

      const preimage = 'bb'.repeat(32) // 32-byte hex

      // settleHoldInvoice returns void — just assert no error
      await net.aliceNwc.settleHoldInvoice({ preimage })
      console.log('[e2e] settle_hold_invoice succeeded (stub)')
    },
    { timeout: 60_000 },
  )

  it(
    'cancel_hold_invoice accepts payment_hash (stub)',
    async () => {
      if (!net) throw new Error('Network not initialized')

      const paymentHash = 'aa'.repeat(32)

      // cancelHoldInvoice returns void — just assert no error
      await net.aliceNwc.cancelHoldInvoice({ payment_hash: paymentHash })
      console.log('[e2e] cancel_hold_invoice succeeded (stub)')
    },
    { timeout: 60_000 },
  )
})
