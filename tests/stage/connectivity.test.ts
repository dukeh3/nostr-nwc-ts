/**
 * Stage connectivity tests — read-only validation against persistent
 * signet deployment on lp-dev (Alice 110, Bob 111).
 *
 * Manual-only: requires VPN, excluded from default `npx vitest run`.
 * Run with: npx vitest run tests/stage/
 */

import { describe, it, afterAll, expect } from 'vitest'
import type { StagedNetwork } from './setup.js'
import { setupStagedNetwork } from './setup.js'

describe('Stage: connectivity (110/111)', () => {
  let net: StagedNetwork

  afterAll(() => {
    net?.cleanup()
  })

  it(
    'Alice get_info returns signet network',
    async () => {
      if (!net) net = await setupStagedNetwork()

      const info = await net.aliceNwc.getInfo()

      expect(info.network).toBe('signet')
      expect(info.pubkey).toBeTruthy()
      expect(info.methods).toContain('get_info')
      console.log(`[stage] Alice: network=${info.network}, alias=${info.alias}`)
    },
    { timeout: 60_000 },
  )

  it(
    'Bob get_info returns signet network',
    async () => {
      if (!net) net = await setupStagedNetwork()

      const info = await net.bobNwc.getInfo()

      expect(info.network).toBe('signet')
      expect(info.pubkey).toBeTruthy()
      expect(info.methods).toContain('get_info')
      console.log(`[stage] Bob: network=${info.network}, alias=${info.alias}`)
    },
    { timeout: 60_000 },
  )

  it(
    'Alice get_balance returns non-negative balance',
    async () => {
      if (!net) net = await setupStagedNetwork()

      const balance = await net.aliceNwc.getBalance()

      expect(balance.balance).toBeGreaterThanOrEqual(0)
      console.log(`[stage] Alice balance: ${balance.balance} msats`)
    },
    { timeout: 60_000 },
  )

  it(
    'Bob get_balance returns non-negative balance',
    async () => {
      if (!net) net = await setupStagedNetwork()

      const balance = await net.bobNwc.getBalance()

      expect(balance.balance).toBeGreaterThanOrEqual(0)
      console.log(`[stage] Bob balance: ${balance.balance} msats`)
    },
    { timeout: 60_000 },
  )

  it(
    'Alice has active channel to Bob',
    async () => {
      if (!net) net = await setupStagedNetwork()

      const channels = await net.aliceNnc.listChannels()

      expect(channels.channels.length).toBeGreaterThanOrEqual(1)

      const toBob = channels.channels.find(
        (ch) => ch.peer_pubkey === net.bobNodePk,
      )
      expect(toBob).toBeDefined()
      expect(toBob!.state).toBe('active')
      console.log(`[stage] Alice→Bob channel: id=${toBob!.id}, state=${toBob!.state}`)
    },
    { timeout: 60_000 },
  )

  it(
    'get_channel_fees returns fee config',
    async () => {
      if (!net) net = await setupStagedNetwork()

      const fees = await net.aliceNnc.getChannelFees()

      expect(fees.fees).toBeDefined()
      expect(fees.fees.length).toBeGreaterThanOrEqual(1)

      const fee = fees.fees[0]
      expect(fee.peer_pubkey).toBeTruthy()
      expect(typeof fee.base_fee_msat).toBe('number')
      expect(typeof fee.fee_rate).toBe('number')
      console.log(`[stage] Channel fees: base=${fee.base_fee_msat}, rate=${fee.fee_rate}`)
    },
    { timeout: 60_000 },
  )

  it(
    'list_transactions returns array',
    async () => {
      if (!net) net = await setupStagedNetwork()

      const txns = await net.aliceNwc.listTransactions()

      expect(txns.transactions).toBeDefined()
      expect(Array.isArray(txns.transactions)).toBe(true)
      console.log(`[stage] Alice transactions: ${txns.transactions.length} entries`)
    },
    { timeout: 60_000 },
  )
})
