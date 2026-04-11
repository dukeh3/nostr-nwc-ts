/**
 * E2E Integration Test: Alice opens a Lightning channel to Bob.
 *
 * Spins up bitcoind + strfry relay + two ldk-controller containers (Alice & Bob)
 * and drives the entire flow through the TypeScript SDK (NwcClient, NncClient).
 *
 * Prerequisites:
 *   docker images: strfry-strfry:latest, ruimarinho/bitcoin-core:latest, ldk-controller:e2e
 */

import WebSocket from 'ws'
;(globalThis as any).WebSocket = WebSocket

import { describe, it, afterAll, expect } from 'vitest'
import type { TwoNodeNetwork } from './setup.js'
import { setupTwoNodeNetwork } from './setup.js'

describe('E2E: Alice opens channel to Bob', () => {
  let net: TwoNodeNetwork

  afterAll(() => {
    net?.cleanup()
  })

  it(
    'should open a funded channel from Alice to Bob',
    async () => {
      net = await setupTwoNodeNetwork({
        openChannel: true,
        channelAmount: 2_000_000,
        pushAmount: 1_000_000,
      })

      expect(net.aliceNodePk).toBeTruthy()
      expect(net.bobNodePk).toBeTruthy()

      // Verify channel state
      const aliceChannels = await net.aliceNnc.listChannels()
      const channel = aliceChannels.channels.find(
        (ch) => ch.peer_pubkey === net.bobNodePk,
      )

      expect(channel).toBeDefined()
      expect(channel!.state).toBe('active')
      expect(channel!.capacity).toBe(2_000_000 * 1000)

      console.log('[e2e] Channel is active!')
      console.log(
        `[e2e]   capacity=${channel!.capacity}, local=${channel!.local_balance}, remote=${channel!.remote_balance}`,
      )
    },
    { timeout: 120_000 },
  )
})
