/**
 * E2E On-chain Flow Tests
 *
 * Tests NWC on-chain methods: pay_onchain, lookup_address, make_bip321.
 *
 * Prerequisites:
 *   docker images: strfry-strfry:latest, ruimarinho/bitcoin-core:latest, ldk-controller:e2e
 */

import WebSocket from 'ws'
;(globalThis as any).WebSocket = WebSocket

import { describe, it, afterAll, expect } from 'vitest'
import type { TwoNodeNetwork } from './setup.js'
import { setupTwoNodeNetwork, sleep } from './setup.js'

describe('E2E: On-chain flows', () => {
  let net: TwoNodeNetwork
  let bobAddress: string

  afterAll(() => {
    net?.cleanup()
  })

  it(
    'pay_onchain sends to Bob address',
    async () => {
      if (!net) {
        net = await setupTwoNodeNetwork({
          openChannel: true,
          channelAmount: 2_000_000,
          pushAmount: 1_000_000,
        })
      }

      // Bob gets a new on-chain address
      const addr = await net.bobNwc.makeNewAddress()
      expect(addr.address).toBeTruthy()
      bobAddress = addr.address
      console.log(`[e2e] Bob address: ${bobAddress}`)

      // Alice pays on-chain to Bob (100k sats = 100_000_000 msats)
      const result = await net.aliceNwc.payOnchain({
        address: bobAddress,
        amount: 100_000_000,
      })
      expect(result.txid).toBeTruthy()
      console.log(`[e2e] On-chain txid: ${result.txid}`)

      // Mine a block to confirm the transaction
      await net.bitcoind.rpc.mineBlocks(1, net.minerAddress)
      await sleep(2_000)
    },
    { timeout: 120_000 },
  )

  it(
    'lookup_address shows received transaction',
    async () => {
      if (!net) throw new Error('Network not initialized')
      if (!bobAddress) throw new Error('No address from previous test')

      const lookup = await net.bobNwc.lookupAddress({ address: bobAddress })
      expect(lookup.total_received).toBeGreaterThan(0)
      expect(lookup.transactions.length).toBeGreaterThanOrEqual(1)
      console.log(
        `[e2e] Address lookup: received=${lookup.total_received}, txns=${lookup.transactions.length}`,
      )
    },
    { timeout: 60_000 },
  )

  it(
    'make_bip321 generates unified payment URI',
    async () => {
      if (!net) throw new Error('Network not initialized')

      const bip321 = await net.bobNwc.makeBip321({
        amount: 5_000_000,
        methods: [
          { method: 'bolt11' },
          { method: 'bolt12' },
          { method: 'onchain' },
        ],
      })

      expect(bip321.uri).toBeTruthy()
      expect(bip321.uri).toMatch(/^bitcoin:/)
      console.log(`[e2e] BIP-321 URI: ${bip321.uri.slice(0, 60)}...`)
    },
    { timeout: 60_000 },
  )
})
