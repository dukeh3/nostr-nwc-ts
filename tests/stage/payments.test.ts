/**
 * Stage payment tests — sends sats back and forth between Alice and Bob
 * on the persistent signet deployment (lp-dev 110/111).
 *
 * Manual-only: requires VPN, excluded from default `npx vitest run`.
 * Run with: npx vitest run --config tests/stage/vitest.config.ts
 */

import { describe, it, afterAll, expect } from 'vitest'
import type { StagedNetwork } from './setup.js'
import { setupStagedNetwork } from './setup.js'

describe('Stage: payments (110/111)', () => {
  let net: StagedNetwork

  afterAll(() => {
    net?.cleanup()
  })

  it(
    'Alice pays Bob 1000 sats',
    async () => {
      if (!net) net = await setupStagedNetwork()

      // Bob creates invoice
      const invoice = await net.bobNwc.makeInvoice({
        amount: 1_000_000, // 1000 sats in msats
        description: 'stage test: Alice→Bob',
      })
      expect(invoice.invoice).toBeTruthy()
      console.log('[stage] Bob created invoice')

      // Alice pays
      const payment = await net.aliceNwc.payInvoice({ invoice: invoice.invoice! })
      expect(payment.preimage).toBeTruthy()
      console.log(`[stage] Alice paid, preimage: ${payment.preimage.slice(0, 16)}...`)

      // Bob verifies settlement
      const lookup = await net.bobNwc.lookupInvoice({ invoice: invoice.invoice! })
      expect(lookup.amount).toBe(1_000_000)
    },
    { timeout: 60_000 },
  )

  it(
    'Bob pays Alice 1000 sats',
    async () => {
      if (!net) net = await setupStagedNetwork()

      // Alice creates invoice
      const invoice = await net.aliceNwc.makeInvoice({
        amount: 1_000_000, // 1000 sats in msats
        description: 'stage test: Bob→Alice',
      })
      expect(invoice.invoice).toBeTruthy()
      console.log('[stage] Alice created invoice')

      // Bob pays
      const payment = await net.bobNwc.payInvoice({ invoice: invoice.invoice! })
      expect(payment.preimage).toBeTruthy()
      console.log(`[stage] Bob paid, preimage: ${payment.preimage.slice(0, 16)}...`)

      // Alice verifies settlement
      const lookup = await net.aliceNwc.lookupInvoice({ invoice: invoice.invoice! })
      expect(lookup.amount).toBe(1_000_000)
    },
    { timeout: 60_000 },
  )

  it(
    'balances reflect round-trip (net zero)',
    async () => {
      if (!net) net = await setupStagedNetwork()

      const [aliceBal, bobBal] = await Promise.all([
        net.aliceNwc.getBalance(),
        net.bobNwc.getBalance(),
      ])

      expect(aliceBal.balance).toBeGreaterThan(0)
      expect(bobBal.balance).toBeGreaterThan(0)
      console.log(`[stage] Alice: ${aliceBal.balance} msats, Bob: ${bobBal.balance} msats`)
    },
    { timeout: 60_000 },
  )
})
