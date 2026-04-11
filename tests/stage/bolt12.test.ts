/**
 * Stage BOLT-12 tests — offer creation, payment, and lookup between
 * Alice and Bob on the persistent signet deployment (lp-dev 110/111).
 *
 * Manual-only: requires VPN, excluded from default `npx vitest run`.
 * Run with: npx vitest run --config tests/stage/vitest.config.ts
 *
 * Known issue: ldk-controller doesn't handle PaymentKind::Bolt12Offer
 * when extracting preimage, so pay_offer returns a wallet error even
 * though the payment succeeds. Tests assert on the error message to
 * confirm the payment went through. Once the server is fixed, the
 * happy-path assertions will kick in automatically.
 */

import { describe, it, afterAll, expect } from 'vitest'
import type { StagedNetwork } from './setup.js'
import { setupStagedNetwork } from './setup.js'
import { NwcWalletError } from '../../nip47.js'

describe('Stage: BOLT-12 (110/111)', () => {
  let net: StagedNetwork

  afterAll(() => {
    net?.cleanup()
  })

  it(
    'Bob creates a BOLT-12 offer',
    async () => {
      if (!net) net = await setupStagedNetwork()

      const offer = await net.bobNwc.makeOffer({
        amount: 1_000_000, // 1000 sats in msats
        description: 'stage bolt12: Alice→Bob',
      })
      expect(offer.offer).toBeTruthy()
      expect(offer.offer).toMatch(/^lno1/)
      console.log(`[stage] Bob offer: ${offer.offer.slice(0, 40)}...`)
    },
    { timeout: 60_000 },
  )

  it(
    'Alice creates a BOLT-12 offer',
    async () => {
      if (!net) net = await setupStagedNetwork()

      const offer = await net.aliceNwc.makeOffer({
        amount: 1_000_000,
        description: 'stage bolt12: Bob→Alice',
      })
      expect(offer.offer).toBeTruthy()
      expect(offer.offer).toMatch(/^lno1/)
      console.log(`[stage] Alice offer: ${offer.offer.slice(0, 40)}...`)
    },
    { timeout: 60_000 },
  )

  it(
    'Alice pays Bob via BOLT-12 offer',
    async () => {
      if (!net) net = await setupStagedNetwork()

      const offer = await net.bobNwc.makeOffer({
        amount: 1_000_000,
        description: 'stage bolt12 pay: Alice→Bob',
      })

      try {
        const payment = await net.aliceNwc.payOffer({ offer: offer.offer })
        // Server fix landed — preimage now returned
        expect(payment.preimage).toBeTruthy()
        console.log(`[stage] Alice paid, preimage: ${payment.preimage.slice(0, 16)}...`)
      } catch (e) {
        // Known: payment succeeds but preimage extraction fails server-side
        expect(e).toBeInstanceOf(NwcWalletError)
        expect((e as NwcWalletError).message).toContain('payment succeeded')
        console.log('[stage] Alice→Bob payment succeeded (preimage extraction pending server fix)')
      }
    },
    { timeout: 60_000 },
  )

  it(
    'Bob pays Alice via BOLT-12 offer',
    async () => {
      if (!net) net = await setupStagedNetwork()

      const offer = await net.aliceNwc.makeOffer({
        amount: 1_000_000,
        description: 'stage bolt12 pay: Bob→Alice',
      })

      try {
        const payment = await net.bobNwc.payOffer({ offer: offer.offer })
        expect(payment.preimage).toBeTruthy()
        console.log(`[stage] Bob paid, preimage: ${payment.preimage.slice(0, 16)}...`)
      } catch (e) {
        expect(e).toBeInstanceOf(NwcWalletError)
        expect((e as NwcWalletError).message).toContain('payment succeeded')
        console.log('[stage] Bob→Alice payment succeeded (preimage extraction pending server fix)')
      }
    },
    { timeout: 60_000 },
  )
})
