/**
 * Stage test setup — connects to persistent signet deployment on lp-dev.
 *
 * No Docker, no bitcoind — just grant publishing + SDK client creation.
 * Requires VPN access to 172.16.10.x network.
 */

import WebSocket from 'ws'
;(globalThis as any).WebSocket = WebSocket

import { SimplePool, generateSecretKey, getPublicKey } from 'nostr-tools'
import { NwcClient } from '../../nip47.js'
import { NncClient } from '../../nipXX.js'
import { SecretKeySigner } from '../../src/signer/secret-key.js'
import { publishGrant } from '../../src/grant.js'
import type { UsageProfile } from '../../src/grant.js'

// ─── Stage environment constants ────────────────────────────────────────────

const RELAY_URL = 'ws://172.16.10.101:7777'

const ALICE_SERVICE_PK = 'db0a960a68b14fcd4bf81b7a456e5d94e122f0416db6d3e9cd5c6f2c945e06d7'
const BOB_SERVICE_PK = '9ebcf7de53685bb9aee8a5ab2b132f505cbcc000498670597c1c319c6fdc00c8'

// ─── Types ──────────────────────────────────────────────────────────────────

export interface StagedNetwork {
  relay: string
  aliceNwc: NwcClient
  aliceNnc: NncClient
  bobNwc: NwcClient
  bobNnc: NncClient
  aliceNodePk: string
  bobNodePk: string
  pool: SimplePool
  cleanup: () => void
}

// ─── Setup ──────────────────────────────────────────────────────────────────

export async function setupStagedNetwork(): Promise<StagedNetwork> {
  // 1. Generate ephemeral client keys
  const clientSk = generateSecretKey()
  const clientPk = getPublicKey(clientSk)

  // 2. Publish grants for both nodes
  const ownerSk = generateSecretKey()
  const ownerSigner = new SecretKeySigner(ownerSk)

  const nwcMethods: UsageProfile['methods'] = {
    get_info: {},
    get_balance: {},
    list_transactions: {},
    make_invoice: {},
    pay_invoice: {},
    lookup_invoice: {},
    make_new_address: {},
    make_offer: {},
    pay_offer: {},
    lookup_offer: {},
    make_bip321: {},
  }

  const nncControl: UsageProfile['control'] = {
    list_channels: {},
    get_channel_fees: {},
    get_forwarding_history: {},
  }

  const grant: UsageProfile = {
    methods: nwcMethods,
    control: nncControl,
  }

  console.log('[stage] Publishing grants...')
  await Promise.all([
    publishGrant(ownerSigner, RELAY_URL, ALICE_SERVICE_PK, clientPk, grant),
    publishGrant(ownerSigner, RELAY_URL, BOB_SERVICE_PK, clientPk, grant),
  ])
  console.log('[stage] Grants published')

  // 3. Wait for relay propagation
  await new Promise((r) => setTimeout(r, 2_000))

  // 4. Create SDK clients
  const pool = new SimplePool()
  const signer = new SecretKeySigner(clientSk)
  const clientOpts = { pool, timeoutMs: 30_000 }

  const aliceNwc = new NwcClient(signer, ALICE_SERVICE_PK, [RELAY_URL], clientOpts)
  const aliceNnc = new NncClient(signer, ALICE_SERVICE_PK, [RELAY_URL], clientOpts)
  const bobNwc = new NwcClient(signer, BOB_SERVICE_PK, [RELAY_URL], clientOpts)
  const bobNnc = new NncClient(signer, BOB_SERVICE_PK, [RELAY_URL], clientOpts)

  // 5. Query get_info to extract Lightning node pubkeys
  console.log('[stage] Querying node info...')
  const [aliceInfo, bobInfo] = await Promise.all([
    aliceNwc.getInfo(),
    bobNwc.getInfo(),
  ])

  const aliceNodePk = aliceInfo.pubkey!
  const bobNodePk = bobInfo.pubkey!
  console.log(`[stage] Alice node: ${aliceNodePk.slice(0, 16)}...`)
  console.log(`[stage] Bob node:   ${bobNodePk.slice(0, 16)}...`)

  const cleanup = () => {
    aliceNwc.close()
    aliceNnc.close()
    bobNwc.close()
    bobNnc.close()
    try { pool.close([]) } catch { /* ignore */ }
  }

  return {
    relay: RELAY_URL,
    aliceNwc,
    aliceNnc,
    bobNwc,
    bobNnc,
    aliceNodePk,
    bobNodePk,
    pool,
    cleanup,
  }
}
