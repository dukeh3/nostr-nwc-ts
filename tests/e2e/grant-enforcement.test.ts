/**
 * E2E Grant Enforcement Tests
 *
 * Tests that the grant system correctly allows/denies requests
 * based on published kind 30078 access grants.
 *
 * Prerequisites:
 *   docker images: strfry-strfry:latest, ruimarinho/bitcoin-core:latest, ldk-controller:e2e
 */

import WebSocket from 'ws'
;(globalThis as any).WebSocket = WebSocket

import { describe, it, afterAll, expect } from 'vitest'
import { SimplePool, generateSecretKey, getPublicKey } from 'nostr-tools'
import { NwcClient, NwcWalletError } from '../../nip47.js'
import { NncClient } from '../../nipXX.js'
import { SecretKeySigner } from '../../src/signer/secret-key.js'
import { publishGrant } from '../../src/grant.js'
import type { UsageProfile } from '../../src/grant.js'
import {
  startRelay,
  startBitcoind,
  writeControllerConfig,
  startController,
  cleanupContainers,
  freePort,
  sleep,
  skHex,
} from './setup.js'

describe('E2E: Grant enforcement', () => {
  const pool = new SimplePool()

  afterAll(() => {
    try { pool.close([]) } catch { /* ignore */ }
    cleanupContainers()
  })

  it(
    'request succeeds with matching grant, rejected without',
    async () => {
      // ── Start single controller ──────────────────────────────────────
      console.log('[e2e] Starting relay and bitcoind...')
      const [relay, bitcoind] = await Promise.all([startRelay(), startBitcoind()])

      const minerAddress = await bitcoind.rpc.getNewAddress()
      await bitcoind.rpc.mineBlocks(101, minerAddress)

      const serviceSk = generateSecretKey()
      const servicePk = getPublicKey(serviceSk)

      const clientSk = generateSecretKey()
      const clientPk = getPublicKey(clientSk)

      const port = await freePort()
      const configDir = writeControllerConfig({
        relayUrl: relay.url,
        privateKey: skHex(serviceSk),
        bitcoindRpcHost: '127.0.0.1',
        bitcoindRpcPort: bitcoind.rpcPort,
        listeningPort: port,
      })

      console.log('[e2e] Starting controller...')
      await startController(configDir, port)

      // ── Publish grant for get_info only ──────────────────────────────
      const ownerSk = generateSecretKey()
      const ownerSigner = new SecretKeySigner(ownerSk)

      const grant: UsageProfile = {
        methods: { get_info: {} },
        // no control field
      }

      await publishGrant(ownerSigner, relay.url, servicePk, clientPk, grant)
      console.log('[e2e] Grant published (get_info only)')
      await sleep(2_000)

      const clientOpts = { pool, timeoutMs: 60_000 }
      const nwc = new NwcClient(
        new SecretKeySigner(clientSk), servicePk, [relay.url], clientOpts,
      )
      const nnc = new NncClient(
        new SecretKeySigner(clientSk), servicePk, [relay.url], clientOpts,
      )

      try {
        // ── get_info should succeed ──────────────────────────────────
        const info = await nwc.getInfo()
        expect(info.network).toBe('regtest')
        console.log('[e2e] get_info succeeded (expected)')

        // ── get_balance should be rejected (not in grant) ──────────
        await expect(
          nwc.getBalance(),
        ).rejects.toThrow(NwcWalletError)
        console.log('[e2e] get_balance rejected (expected)')

        // ── list_channels should be rejected (no control grant) ─────
        await expect(
          nnc.listChannels(),
        ).rejects.toThrow(NwcWalletError)
        console.log('[e2e] list_channels rejected (expected)')
      } finally {
        nwc.close()
        nnc.close()
      }
    },
    { timeout: 120_000 },
  )
})
