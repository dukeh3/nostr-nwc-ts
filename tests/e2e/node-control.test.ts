/**
 * E2E Node Control Tests
 *
 * Tests NNC methods: get_channel_fees, set_channel_fees,
 * get_forwarding_history, close_channel.
 *
 * Prerequisites:
 *   docker images: strfry-strfry:latest, ruimarinho/bitcoin-core:latest, ldk-controller:e2e
 */

import WebSocket from 'ws'
;(globalThis as any).WebSocket = WebSocket

import { describe, it, afterAll, expect } from 'vitest'
import type { TwoNodeNetwork } from './setup.js'
import { setupTwoNodeNetwork, sleep } from './setup.js'

describe('E2E: Node control', () => {
  let net: TwoNodeNetwork

  afterAll(() => {
    net?.cleanup()
  })

  it(
    'get_channel_fees returns fee config',
    async () => {
      if (!net) {
        net = await setupTwoNodeNetwork({
          openChannel: true,
          channelAmount: 2_000_000,
          pushAmount: 1_000_000,
        })
      }

      const fees = await net.aliceNnc.getChannelFees()

      expect(fees.fees).toBeDefined()
      expect(fees.fees.length).toBeGreaterThanOrEqual(1)

      const channelFee = fees.fees[0]
      expect(channelFee.peer_pubkey).toBeTruthy()
      expect(typeof channelFee.base_fee_msat).toBe('number')
      expect(typeof channelFee.fee_rate).toBe('number')

      console.log(`[e2e] Channel fees: base=${channelFee.base_fee_msat}, rate=${channelFee.fee_rate}`)
    },
    { timeout: 120_000 },
  )

  it(
    'set_channel_fees updates fee policy',
    async () => {
      if (!net) throw new Error('Network not initialized')

      const feesBefore = await net.aliceNnc.getChannelFees()
      const channelId = feesBefore.fees[0].id

      await net.aliceNnc.setChannelFees({
        id: channelId,
        base_fee_msat: 999,
        fee_rate: 42,
      })

      // Re-fetch and verify
      const feesAfter = await net.aliceNnc.getChannelFees({ id: channelId })
      const updated = feesAfter.fees.find((f) => f.id === channelId)

      expect(updated).toBeDefined()
      expect(updated!.base_fee_msat).toBe(999)
      expect(updated!.fee_rate).toBe(42)

      console.log('[e2e] Channel fees updated successfully')
    },
    { timeout: 60_000 },
  )

  it(
    'get_forwarding_history returns array',
    async () => {
      if (!net) throw new Error('Network not initialized')

      const history = await net.aliceNnc.getForwardingHistory()

      expect(history.forwards).toBeDefined()
      expect(Array.isArray(history.forwards)).toBe(true)

      console.log(`[e2e] Forwarding history: ${history.forwards.length} entries`)
    },
    { timeout: 60_000 },
  )

  it(
    'close_channel closes the channel',
    async () => {
      if (!net) throw new Error('Network not initialized')

      // Get the channel to close
      const channels = await net.aliceNnc.listChannels()
      const channel = channels.channels.find(
        (ch) => ch.peer_pubkey === net.bobNodePk && ch.state === 'active',
      )
      expect(channel).toBeDefined()

      // Close the channel
      await net.aliceNnc.closeChannel({ id: channel!.id })
      console.log('[e2e] close_channel request sent')

      // Mine blocks and poll until channel is gone or state changes
      const deadline = Date.now() + 60_000
      let channelGone = false

      while (Date.now() < deadline) {
        await net.bitcoind.rpc.mineBlocks(1, net.minerAddress)
        await sleep(1000)

        const updated = await net.aliceNnc.listChannels()
        const ch = updated.channels.find((c) => c.id === channel!.id)

        if (!ch || ch.state !== 'active') {
          channelGone = true
          break
        }
      }

      expect(channelGone).toBe(true)
      console.log('[e2e] Channel closed successfully')
    },
    { timeout: 120_000 },
  )
})
