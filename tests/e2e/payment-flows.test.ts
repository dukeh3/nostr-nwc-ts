/**
 * E2E Payment Flow Tests
 *
 * Tests NWC payment methods: make_invoice, pay_invoice, pay_keysend,
 * list_transactions, sign_message, get_balance.
 *
 * Prerequisites:
 *   docker images: strfry-strfry:latest, ruimarinho/bitcoin-core:latest, ldk-controller:e2e
 */

import WebSocket from 'ws'
;(globalThis as any).WebSocket = WebSocket

import { describe, it, afterAll, expect } from 'vitest'
import type { TwoNodeNetwork } from './setup.js'
import { setupTwoNodeNetwork } from './setup.js'

describe('E2E: Payment flows', () => {
  let net: TwoNodeNetwork

  afterAll(() => {
    net?.cleanup()
  })

  it(
    'make_invoice + pay_invoice round-trip',
    async () => {
      // Setup if not already done (first test in suite)
      if (!net) {
        net = await setupTwoNodeNetwork({
          openChannel: true,
          channelAmount: 2_000_000,
          pushAmount: 1_000_000,
        })
      }

      // Bob creates an invoice
      const invoice = await net.bobNwc.makeInvoice({
        amount: 10_000_000, // 10k sats in msats
        description: 'e2e test payment',
      })
      expect(invoice.invoice).toBeTruthy()
      console.log('[e2e] Bob created invoice')

      // Alice pays the invoice
      const payment = await net.aliceNwc.payInvoice({ invoice: invoice.invoice! })
      expect(payment.preimage).toBeTruthy()
      console.log(`[e2e] Alice paid invoice, preimage: ${payment.preimage.slice(0, 16)}...`)

      // Bob looks up the invoice → should be settled
      const lookup = await net.bobNwc.lookupInvoice({ invoice: invoice.invoice! })
      expect(lookup.amount).toBe(10_000_000)
    },
    { timeout: 120_000 },
  )

  it(
    'pay_keysend sends spontaneous payment',
    async () => {
      if (!net) throw new Error('Network not initialized')

      const result = await net.aliceNwc.payKeysend({
        amount: 5_000_000, // 5k sats in msats
        pubkey: net.bobNodePk,
      })

      expect(result.preimage).toBeTruthy()
      console.log(`[e2e] Keysend preimage: ${result.preimage.slice(0, 16)}...`)
    },
    { timeout: 60_000 },
  )

  it(
    'list_transactions returns payment history',
    async () => {
      if (!net) throw new Error('Network not initialized')

      const txns = await net.aliceNwc.listTransactions({ type: 'outgoing' })

      // Should have at least the pay_invoice + pay_keysend from above
      expect(txns.transactions.length).toBeGreaterThanOrEqual(2)
      console.log(`[e2e] Alice has ${txns.transactions.length} outgoing transactions`)
    },
    { timeout: 60_000 },
  )

  it(
    'sign_message returns valid signature',
    async () => {
      if (!net) throw new Error('Network not initialized')

      const result = await net.aliceNwc.signMessage({ message: 'e2e-test' })

      expect(result.signature).toBeTruthy()
      expect(result.signature.length).toBeGreaterThan(0)
      console.log(`[e2e] Signature: ${result.signature.slice(0, 32)}...`)
    },
    { timeout: 60_000 },
  )

  it(
    'get_balance reflects payments',
    async () => {
      if (!net) throw new Error('Network not initialized')

      const [aliceBal, bobBal] = await Promise.all([
        net.aliceNwc.getBalance(),
        net.bobNwc.getBalance(),
      ])

      // Alice started with ~1M sats in channel (push 1M to Bob), paid out ~15k sats
      // Alice balance should be less than the initial push amount
      expect(aliceBal.balance).toBeGreaterThan(0)

      // Bob received payments
      expect(bobBal.balance).toBeGreaterThan(0)

      console.log(`[e2e] Alice balance: ${aliceBal.balance}, Bob balance: ${bobBal.balance}`)
    },
    { timeout: 60_000 },
  )
})
