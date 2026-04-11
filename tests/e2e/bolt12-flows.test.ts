/**
 * E2E BOLT-12 Flow Tests
 *
 * Tests NWC BOLT-12 methods: make_offer, pay_offer, lookup_offer,
 * estimate_routing_fees.
 *
 * Prerequisites:
 *   docker images: strfry-strfry:latest, ruimarinho/bitcoin-core:latest, ldk-controller:e2e
 */

import WebSocket from 'ws'
;(globalThis as any).WebSocket = WebSocket

import { describe, it, afterAll, expect } from 'vitest'
import type { TwoNodeNetwork } from './setup.js'
import { setupTwoNodeNetwork } from './setup.js'

describe('E2E: BOLT-12 flows', () => {
  let net: TwoNodeNetwork
  let bobOffer: string

  afterAll(() => {
    net?.cleanup()
  })

  it(
    'make_offer + pay_offer round-trip',
    async () => {
      if (!net) {
        net = await setupTwoNodeNetwork({
          openChannel: true,
          channelAmount: 2_000_000,
          pushAmount: 1_000_000,
        })
      }

      // Bob creates a BOLT-12 offer
      const offer = await net.bobNwc.makeOffer({
        amount: 10_000_000, // 10k sats in msats
        description: 'e2e bolt12',
      })
      expect(offer.offer).toBeTruthy()
      bobOffer = offer.offer
      console.log(`[e2e] Bob created offer: ${offer.offer.slice(0, 32)}...`)

      // Alice pays the offer
      const payment = await net.aliceNwc.payOffer({ offer: bobOffer })
      expect(payment.preimage).toBeTruthy()
      console.log(`[e2e] Alice paid offer, preimage: ${payment.preimage.slice(0, 16)}...`)
    },
    { timeout: 120_000 },
  )

  it(
    'lookup_offer returns offer stats',
    async () => {
      if (!net) throw new Error('Network not initialized')
      if (!bobOffer) throw new Error('No offer from previous test')

      const lookup = await net.bobNwc.lookupOffer({ offer: bobOffer })
      expect(lookup.active).toBe(true)
      expect(lookup.num_payments_received).toBeGreaterThanOrEqual(1)
      console.log(
        `[e2e] Offer lookup: active=${lookup.active}, payments=${lookup.num_payments_received}`,
      )
    },
    { timeout: 60_000 },
  )

  it(
    'estimate_routing_fees returns fee estimate',
    async () => {
      if (!net) throw new Error('Network not initialized')

      const estimate = await net.aliceNwc.estimateRoutingFees({
        destination: net.bobNodePk,
        amount: 50_000_000, // 50k sats in msats
      })

      expect(estimate.fee).toBeGreaterThanOrEqual(0)
      expect(estimate.time_lock_delay).toBeGreaterThan(0)
      console.log(
        `[e2e] Routing fee estimate: fee=${estimate.fee}, time_lock_delay=${estimate.time_lock_delay}`,
      )
    },
    { timeout: 60_000 },
  )
})
