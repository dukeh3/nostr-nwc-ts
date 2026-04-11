import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  NwcClient,
  parseConnectionString,
  NWC_REQUEST_KIND,
  NWC_RESPONSE_KIND,
  NWC_NOTIFICATION_KIND,
  NwcWalletError,
  NwcReplyTimeout,
  NwcPublishError,
  NwcDecryptionError,
} from '../nip47.js'
import type { NwcSigner } from '../src/signer/types.js'
import { createMockSigner, createMockPool, WALLET_PUBKEY, RELAY_URLS } from './_helpers.js'

// ─── Tests ────────────────────────────────────────────────────────────────

describe('parseConnectionString', () => {
  it('parses a valid NWC connection string', () => {
    const uri =
      'nostr+walletconnect://b889ff5b1513b641e2a139f661a661364979c5beee91842f8f0ef42ab558e9d4?relay=wss%3A%2F%2Frelay.damus.io&secret=71a8c14c1407c113601079c4302dab36460f0ccd0ad506f1f2dc73b5100e4f3c'
    const params = parseConnectionString(uri)
    expect(params.pubkey).toBe(
      'b889ff5b1513b641e2a139f661a661364979c5beee91842f8f0ef42ab558e9d4',
    )
    expect(params.relays).toEqual(['wss://relay.damus.io'])
    expect(params.secret).toBe(
      '71a8c14c1407c113601079c4302dab36460f0ccd0ad506f1f2dc73b5100e4f3c',
    )
  })

  it('supports multiple relays', () => {
    const uri =
      'nostr+walletconnect://b889ff5b1513b641e2a139f661a661364979c5beee91842f8f0ef42ab558e9d4?relay=wss%3A%2F%2Fr1.example.com&relay=wss%3A%2F%2Fr2.example.com'
    const params = parseConnectionString(uri)
    expect(params.relays).toHaveLength(2)
  })

  it('rejects invalid prefix', () => {
    expect(() => parseConnectionString('nostr+wallet://abc')).toThrow('must start with')
  })

  it('rejects missing pubkey', () => {
    expect(() =>
      parseConnectionString('nostr+walletconnect://?relay=wss://relay.damus.io'),
    ).toThrow('missing or invalid pubkey')
  })

  it('rejects missing relay', () => {
    expect(() =>
      parseConnectionString(
        'nostr+walletconnect://b889ff5b1513b641e2a139f661a661364979c5beee91842f8f0ef42ab558e9d4',
      ),
    ).toThrow('missing relay')
  })
})

describe('NwcClient', () => {
  let signer: NwcSigner
  const walletPubkey = WALLET_PUBKEY
  const relayUrls = RELAY_URLS

  beforeEach(() => {
    signer = createMockSigner()
  })

  it('constructs from URI', () => {
    const pool = createMockPool()
    const client = NwcClient.fromURI(
      signer,
      `nostr+walletconnect://${walletPubkey}?relay=wss%3A%2F%2Frelay.example.com&secret=aa`,
      { pool: pool as any },
    )
    expect(client).toBeInstanceOf(NwcClient)
    client.close()
  })

  it('requires pool in opts', () => {
    expect(() => new NwcClient(signer, walletPubkey, relayUrls)).toThrow('pool instance is required')
  })

  it('sendRequest encrypts, publishes, subscribes, and decrypts', async () => {
    const pool = createMockPool({
      result_type: 'get_info',
      result: { alias: 'TestNode', methods: ['get_info'] },
    })

    const client = new NwcClient(signer, walletPubkey, relayUrls, { pool: pool as any })

    const response = await client.sendRequest('get_info')

    expect(response.result_type).toBe('get_info')
    expect(response.result).toEqual({ alias: 'TestNode', methods: ['get_info'] })

    expect(signer.nip44Encrypt).toHaveBeenCalledWith(
      walletPubkey,
      JSON.stringify({ method: 'get_info', params: {} }),
    )
    expect(signer.signEvent).toHaveBeenCalled()

    expect(pool.subscribeMany).toHaveBeenCalledWith(
      relayUrls,
      expect.objectContaining({
        kinds: [NWC_RESPONSE_KIND],
        authors: [walletPubkey],
      }),
      expect.any(Object),
    )
    expect(pool.publish).toHaveBeenCalled()

    client.close()
  })

  it('rejects with NwcWalletError on service error', async () => {
    const pool = createMockPool({
      result_type: 'pay_invoice',
      error: { code: 'INSUFFICIENT_BALANCE', message: 'Not enough sats' },
    })

    const client = new NwcClient(signer, walletPubkey, relayUrls, { pool: pool as any })

    await expect(
      client.sendRequest('pay_invoice', { invoice: 'lnbc...' }),
    ).rejects.toThrow(NwcWalletError)

    client.close()
  })

  it('rejects with NwcPublishError when all relays reject', async () => {
    const pool = createMockPool()
    pool.publish.mockReturnValue([Promise.reject(new Error('relay rejected'))])

    const client = new NwcClient(signer, walletPubkey, relayUrls, { pool: pool as any })

    await expect(client.sendRequest('get_info')).rejects.toThrow(NwcPublishError)

    client.close()
  })

  it('rejects with NwcReplyTimeout when service doesn\'t respond', async () => {
    const pool = createMockPool()
    pool.publish.mockReturnValue([Promise.resolve('ok')])

    const client = new NwcClient(signer, walletPubkey, relayUrls, {
      pool: pool as any,
      timeoutMs: 50,
    })

    await expect(client.sendRequest('get_info')).rejects.toThrow(NwcReplyTimeout)

    client.close()
  })

  // ─── Typed NIP-47 Method Tests ──────────────────────────────────────────

  it('getInfo returns typed result', async () => {
    const pool = createMockPool({
      result_type: 'get_info',
      result: {
        alias: 'TestNode',
        methods: ['get_info', 'pay_invoice'],
        network: 'mainnet',
      },
    })

    const client = new NwcClient(signer, walletPubkey, relayUrls, { pool: pool as any })
    const info = await client.getInfo()

    expect(info.alias).toBe('TestNode')
    expect(info.methods).toContain('pay_invoice')
    expect(info.network).toBe('mainnet')

    client.close()
  })

  it('getBalance returns typed result', async () => {
    const pool = createMockPool({
      result_type: 'get_balance',
      result: { balance: 50000, lightning_balance: 40000, onchain_balance: 10000 },
    })

    const client = new NwcClient(signer, walletPubkey, relayUrls, { pool: pool as any })
    const balance = await client.getBalance()

    expect(balance.balance).toBe(50000)
    expect(balance.lightning_balance).toBe(40000)

    client.close()
  })

  it('payInvoice sends correct method and params', async () => {
    const pool = createMockPool({
      result_type: 'pay_invoice',
      result: { preimage: 'abc123' },
    })

    const client = new NwcClient(signer, walletPubkey, relayUrls, { pool: pool as any })
    const result = await client.payInvoice({ invoice: 'lnbc50n1...' })

    expect(result.preimage).toBe('abc123')
    expect(signer.nip44Encrypt).toHaveBeenCalledWith(
      walletPubkey,
      JSON.stringify({ method: 'pay_invoice', params: { invoice: 'lnbc50n1...' } }),
    )

    client.close()
  })

  it('uses correct request kind (23194)', async () => {
    const pool = createMockPool({
      result_type: 'get_info',
      result: { methods: [] },
    })

    const client = new NwcClient(signer, walletPubkey, relayUrls, { pool: pool as any })
    await client.getInfo()

    const signCall = (signer.signEvent as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(signCall.kind).toBe(NWC_REQUEST_KIND)

    client.close()
  })

  it('payKeysend sends correct method and params', async () => {
    const pool = createMockPool({
      result_type: 'pay_keysend',
      result: { preimage: 'keysend-pre' },
    })

    const client = new NwcClient(signer, walletPubkey, relayUrls, { pool: pool as any })
    const result = await client.payKeysend({ amount: 1000, pubkey: '02abc' })

    expect(result.preimage).toBe('keysend-pre')
    expect(signer.nip44Encrypt).toHaveBeenCalledWith(
      walletPubkey,
      JSON.stringify({ method: 'pay_keysend', params: { amount: 1000, pubkey: '02abc' } }),
    )

    client.close()
  })

  it('makeInvoice sends correct method and params', async () => {
    const pool = createMockPool({
      result_type: 'make_invoice',
      result: { type: 'incoming', invoice: 'lnbc...', amount: 5000 },
    })

    const client = new NwcClient(signer, walletPubkey, relayUrls, { pool: pool as any })
    const result = await client.makeInvoice({ amount: 5000, description: 'test' })

    expect(result.amount).toBe(5000)
    expect(signer.nip44Encrypt).toHaveBeenCalledWith(
      walletPubkey,
      JSON.stringify({ method: 'make_invoice', params: { amount: 5000, description: 'test' } }),
    )

    client.close()
  })

  it('lookupInvoice sends correct params', async () => {
    const pool = createMockPool({
      result_type: 'lookup_invoice',
      result: { type: 'incoming', amount: 5000, payment_hash: 'hash1' },
    })

    const client = new NwcClient(signer, walletPubkey, relayUrls, { pool: pool as any })
    const result = await client.lookupInvoice({ payment_hash: 'hash1' })

    expect(result.payment_hash).toBe('hash1')
    expect(signer.nip44Encrypt).toHaveBeenCalledWith(
      walletPubkey,
      JSON.stringify({ method: 'lookup_invoice', params: { payment_hash: 'hash1' } }),
    )

    client.close()
  })

  it('listTransactions with params', async () => {
    const pool = createMockPool({
      result_type: 'list_transactions',
      result: { transactions: [{ type: 'outgoing', amount: 1000 }] },
    })

    const client = new NwcClient(signer, walletPubkey, relayUrls, { pool: pool as any })
    const result = await client.listTransactions({ limit: 10, type: 'outgoing' })

    expect(result.transactions).toHaveLength(1)
    expect(signer.nip44Encrypt).toHaveBeenCalledWith(
      walletPubkey,
      JSON.stringify({ method: 'list_transactions', params: { limit: 10, type: 'outgoing' } }),
    )

    client.close()
  })

  it('listTransactions without params', async () => {
    const pool = createMockPool({
      result_type: 'list_transactions',
      result: { transactions: [] },
    })

    const client = new NwcClient(signer, walletPubkey, relayUrls, { pool: pool as any })
    const result = await client.listTransactions()

    expect(result.transactions).toEqual([])
    expect(signer.nip44Encrypt).toHaveBeenCalledWith(
      walletPubkey,
      JSON.stringify({ method: 'list_transactions', params: {} }),
    )

    client.close()
  })

  it('payOffer sends correct params', async () => {
    const pool = createMockPool({
      result_type: 'pay_offer',
      result: { preimage: 'offer-pre' },
    })

    const client = new NwcClient(signer, walletPubkey, relayUrls, { pool: pool as any })
    const result = await client.payOffer({ offer: 'lno1...', amount: 2000 })

    expect(result.preimage).toBe('offer-pre')
    expect(signer.nip44Encrypt).toHaveBeenCalledWith(
      walletPubkey,
      JSON.stringify({ method: 'pay_offer', params: { offer: 'lno1...', amount: 2000 } }),
    )

    client.close()
  })

  it('makeOffer sends correct params', async () => {
    const pool = createMockPool({
      result_type: 'make_offer',
      result: { offer: 'lno1...', description: 'donate' },
    })

    const client = new NwcClient(signer, walletPubkey, relayUrls, { pool: pool as any })
    const result = await client.makeOffer({ description: 'donate' })

    expect(result.offer).toBe('lno1...')
    expect(signer.nip44Encrypt).toHaveBeenCalledWith(
      walletPubkey,
      JSON.stringify({ method: 'make_offer', params: { description: 'donate' } }),
    )

    client.close()
  })

  it('lookupOffer sends correct params', async () => {
    const pool = createMockPool({
      result_type: 'lookup_offer',
      result: { offer: 'lno1...', description: 'donate', active: true, num_payments_received: 5, total_received: 50000 },
    })

    const client = new NwcClient(signer, walletPubkey, relayUrls, { pool: pool as any })
    const result = await client.lookupOffer({ offer: 'lno1...' })

    expect(result.active).toBe(true)
    expect(result.num_payments_received).toBe(5)

    client.close()
  })

  it('payOnchain sends correct params', async () => {
    const pool = createMockPool({
      result_type: 'pay_onchain',
      result: { txid: 'txid123' },
    })

    const client = new NwcClient(signer, walletPubkey, relayUrls, { pool: pool as any })
    const result = await client.payOnchain({ address: 'bc1q...', amount: 100000 })

    expect(result.txid).toBe('txid123')
    expect(signer.nip44Encrypt).toHaveBeenCalledWith(
      walletPubkey,
      JSON.stringify({ method: 'pay_onchain', params: { address: 'bc1q...', amount: 100000 } }),
    )

    client.close()
  })

  it('makeNewAddress with params', async () => {
    const pool = createMockPool({
      result_type: 'make_new_address',
      result: { address: 'bc1q...', type: 'p2wpkh' },
    })

    const client = new NwcClient(signer, walletPubkey, relayUrls, { pool: pool as any })
    const result = await client.makeNewAddress({ type: 'p2wpkh' })

    expect(result.address).toBe('bc1q...')
    expect(signer.nip44Encrypt).toHaveBeenCalledWith(
      walletPubkey,
      JSON.stringify({ method: 'make_new_address', params: { type: 'p2wpkh' } }),
    )

    client.close()
  })

  it('makeNewAddress without params', async () => {
    const pool = createMockPool({
      result_type: 'make_new_address',
      result: { address: 'bc1q...', type: 'p2tr' },
    })

    const client = new NwcClient(signer, walletPubkey, relayUrls, { pool: pool as any })
    const result = await client.makeNewAddress()

    expect(result.address).toBe('bc1q...')
    expect(signer.nip44Encrypt).toHaveBeenCalledWith(
      walletPubkey,
      JSON.stringify({ method: 'make_new_address', params: {} }),
    )

    client.close()
  })

  it('lookupAddress sends correct params', async () => {
    const pool = createMockPool({
      result_type: 'lookup_address',
      result: { address: 'bc1q...', type: 'p2wpkh', total_received: 100000, transactions: [] },
    })

    const client = new NwcClient(signer, walletPubkey, relayUrls, { pool: pool as any })
    const result = await client.lookupAddress({ address: 'bc1q...' })

    expect(result.total_received).toBe(100000)

    client.close()
  })

  it('payBip321 sends correct params', async () => {
    const pool = createMockPool({
      result_type: 'pay_bip321',
      result: { payment_method: 'bolt11', preimage: 'bip321-pre' },
    })

    const client = new NwcClient(signer, walletPubkey, relayUrls, { pool: pool as any })
    const result = await client.payBip321({ uri: 'bitcoin:bc1q...' })

    expect(result.payment_method).toBe('bolt11')
    expect(signer.nip44Encrypt).toHaveBeenCalledWith(
      walletPubkey,
      JSON.stringify({ method: 'pay_bip321', params: { uri: 'bitcoin:bc1q...' } }),
    )

    client.close()
  })

  it('makeBip321 sends correct params', async () => {
    const pool = createMockPool({
      result_type: 'make_bip321',
      result: { uri: 'bitcoin:bc1q...?amount=0.001' },
    })

    const client = new NwcClient(signer, walletPubkey, relayUrls, { pool: pool as any })
    const result = await client.makeBip321({ amount: 100000 })

    expect(result.uri).toContain('bitcoin:')

    client.close()
  })

  it('estimateOnchainFees sends correct method', async () => {
    const pool = createMockPool({
      result_type: 'estimate_onchain_fees',
      result: { fees: { fastest: 25, half_hour: 15, hour: 5 } },
    })

    const client = new NwcClient(signer, walletPubkey, relayUrls, { pool: pool as any })
    const result = await client.estimateOnchainFees()

    expect(result.fees).toBeDefined()
    expect(signer.nip44Encrypt).toHaveBeenCalledWith(
      walletPubkey,
      JSON.stringify({ method: 'estimate_onchain_fees', params: {} }),
    )

    client.close()
  })

  it('estimateRoutingFees sends correct params', async () => {
    const pool = createMockPool({
      result_type: 'estimate_routing_fees',
      result: { fee: 100, time_lock_delay: 144 },
    })

    const client = new NwcClient(signer, walletPubkey, relayUrls, { pool: pool as any })
    const result = await client.estimateRoutingFees({ destination: '02abc', amount: 50000 })

    expect(result.fee).toBe(100)
    expect(result.time_lock_delay).toBe(144)

    client.close()
  })

  it('makeHoldInvoice sends correct params', async () => {
    const pool = createMockPool({
      result_type: 'make_hold_invoice',
      result: { type: 'incoming', invoice: 'lnbc...', amount: 10000, payment_hash: 'holdhash' },
    })

    const client = new NwcClient(signer, walletPubkey, relayUrls, { pool: pool as any })
    const result = await client.makeHoldInvoice({ amount: 10000, payment_hash: 'holdhash' })

    expect(result.payment_hash).toBe('holdhash')

    client.close()
  })

  it('settleHoldInvoice sends correct params (void return)', async () => {
    const pool = createMockPool({
      result_type: 'settle_hold_invoice',
      result: {},
    })

    const client = new NwcClient(signer, walletPubkey, relayUrls, { pool: pool as any })
    await client.settleHoldInvoice({ preimage: 'preimage123' })

    expect(signer.nip44Encrypt).toHaveBeenCalledWith(
      walletPubkey,
      JSON.stringify({ method: 'settle_hold_invoice', params: { preimage: 'preimage123' } }),
    )

    client.close()
  })

  it('cancelHoldInvoice sends correct params (void return)', async () => {
    const pool = createMockPool({
      result_type: 'cancel_hold_invoice',
      result: {},
    })

    const client = new NwcClient(signer, walletPubkey, relayUrls, { pool: pool as any })
    await client.cancelHoldInvoice({ payment_hash: 'hash123' })

    expect(signer.nip44Encrypt).toHaveBeenCalledWith(
      walletPubkey,
      JSON.stringify({ method: 'cancel_hold_invoice', params: { payment_hash: 'hash123' } }),
    )

    client.close()
  })

  it('signMessage sends correct params', async () => {
    const pool = createMockPool({
      result_type: 'sign_message',
      result: { signature: 'deadbeef' },
    })

    const client = new NwcClient(signer, walletPubkey, relayUrls, { pool: pool as any })
    const result = await client.signMessage({ message: 'hello world' })

    expect(result.signature).toBe('deadbeef')
    expect(signer.nip44Encrypt).toHaveBeenCalledWith(
      walletPubkey,
      JSON.stringify({ method: 'sign_message', params: { message: 'hello world' } }),
    )

    client.close()
  })

  // ─── Encryption tag test ─────────────────────────────────────────────────

  it('includes encryption nip44_v2 tag in published events', async () => {
    const pool = createMockPool({
      result_type: 'get_info',
      result: { methods: [] },
    })

    const client = new NwcClient(signer, walletPubkey, relayUrls, { pool: pool as any })
    await client.getInfo()

    const signCall = (signer.signEvent as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(signCall.tags).toEqual(
      expect.arrayContaining([['encryption', 'nip44_v2']]),
    )

    client.close()
  })

  // ─── NwcDecryptionError test ──────────────────────────────────────────────

  it('throws NwcDecryptionError when nip44Decrypt fails', async () => {
    const pool = createMockPool({
      result_type: 'get_info',
      result: {},
    })

    const failingSigner = createMockSigner()
    ;(failingSigner.nip44Decrypt as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('decryption failed'),
    )

    const client = new NwcClient(failingSigner, walletPubkey, relayUrls, { pool: pool as any })

    await expect(client.sendRequest('get_info')).rejects.toThrow(NwcDecryptionError)

    client.close()
  })

  // ─── Notification tests ───────────────────────────────────────────────────

  describe('subscribeNotifications', () => {
    it('subscribes for kind 23197 filtered by user pubkey', async () => {
      const pool = createMockPool()
      const client = new NwcClient(signer, walletPubkey, relayUrls, { pool: pool as any })

      const handler = vi.fn()
      const unsub = await client.subscribeNotifications(handler)

      expect(pool.subscribeMany).toHaveBeenCalledWith(
        relayUrls,
        expect.objectContaining({
          kinds: [NWC_NOTIFICATION_KIND],
          authors: [walletPubkey],
          '#p': ['aabb'.repeat(16)],
        }),
        expect.any(Object),
      )

      unsub()
      client.close()
    })

    it('calls sendRequest with types when provided', async () => {
      const pool = createMockPool({
        result_type: 'subscribe_notifications',
        result: {},
      })

      const client = new NwcClient(signer, walletPubkey, relayUrls, { pool: pool as any })

      const handler = vi.fn()
      const unsub = await client.subscribeNotifications(handler, ['payment_received'])

      expect(signer.nip44Encrypt).toHaveBeenCalledWith(
        walletPubkey,
        JSON.stringify({ method: 'subscribe_notifications', params: { types: ['payment_received'] } }),
      )

      unsub()
      client.close()
    })

    it('decrypts and delivers notification to handler', async () => {
      const pool = createMockPool()

      // Override subscribeMany to deliver a notification
      pool.subscribeMany.mockImplementation((_relays: any, _filter: any, params: any) => {
        setTimeout(() => {
          const notification = JSON.stringify({
            notification_type: 'payment_received',
            notification: { amount: 1000 },
          })
          params.onevent({
            id: 'notif-1',
            pubkey: walletPubkey,
            content: `encrypted:${notification}`,
            kind: NWC_NOTIFICATION_KIND,
            created_at: Math.floor(Date.now() / 1000),
            tags: [['p', 'aabb'.repeat(16)]],
            sig: 'sig',
          })
        }, 10)
        return { close: vi.fn() }
      })

      const client = new NwcClient(signer, walletPubkey, relayUrls, { pool: pool as any })

      const handler = vi.fn()
      const unsub = await client.subscribeNotifications(handler)

      // Wait for the notification to be delivered
      await new Promise((r) => setTimeout(r, 50))

      expect(handler).toHaveBeenCalledWith({
        notification_type: 'payment_received',
        notification: { amount: 1000 },
      })

      unsub()
      client.close()
    })

    it('returns unsubscribe function that closes sub', async () => {
      const closeFn = vi.fn()
      const pool = createMockPool()
      pool.subscribeMany.mockReturnValue({ close: closeFn })

      const client = new NwcClient(signer, walletPubkey, relayUrls, { pool: pool as any })

      const handler = vi.fn()
      const unsub = await client.subscribeNotifications(handler)

      unsub()
      expect(closeFn).toHaveBeenCalled()

      client.close()
    })

    it('silently ignores decrypt errors', async () => {
      const pool = createMockPool()

      pool.subscribeMany.mockImplementation((_relays: any, _filter: any, params: any) => {
        setTimeout(() => {
          params.onevent({
            id: 'notif-bad',
            pubkey: walletPubkey,
            content: 'not-valid-encrypted-content',
            kind: NWC_NOTIFICATION_KIND,
            created_at: Math.floor(Date.now() / 1000),
            tags: [['p', 'aabb'.repeat(16)]],
            sig: 'sig',
          })
        }, 10)
        return { close: vi.fn() }
      })

      // Make decrypt fail for non-"encrypted:" prefixed content
      ;(signer.nip44Decrypt as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('decrypt failed'),
      )

      const client = new NwcClient(signer, walletPubkey, relayUrls, { pool: pool as any })

      const handler = vi.fn()
      const unsub = await client.subscribeNotifications(handler)

      await new Promise((r) => setTimeout(r, 50))

      // Handler should not have been called
      expect(handler).not.toHaveBeenCalled()

      unsub()
      client.close()
    })
  })

  // ─── Lifecycle test ────────────────────────────────────────────────────

  it('close() closes all active notification subscriptions', async () => {
    const closeFn1 = vi.fn()
    const closeFn2 = vi.fn()
    let callCount = 0
    const pool = createMockPool()
    pool.subscribeMany.mockImplementation(() => {
      callCount++
      return { close: callCount === 1 ? closeFn1 : closeFn2 }
    })

    const client = new NwcClient(signer, walletPubkey, relayUrls, { pool: pool as any })

    await client.subscribeNotifications(vi.fn())
    await client.subscribeNotifications(vi.fn())

    client.close()

    expect(closeFn1).toHaveBeenCalled()
    expect(closeFn2).toHaveBeenCalled()
  })
})
