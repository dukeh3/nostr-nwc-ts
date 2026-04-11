import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  NncClient,
  parseConnectionString,
  NNC_REQUEST_KIND,
  NNC_RESPONSE_KIND,
  NNC_NOTIFICATION_KIND,
} from '../nipXX.js'
import { NwcWalletError, NwcReplyTimeout } from '../nip47.js'
import type { NwcSigner } from '../src/signer/types.js'
import { createMockSigner, createMockPool, SERVICE_PUBKEY, RELAY_URLS } from './_helpers.js'

describe('NNC parseConnectionString', () => {
  it('parses a valid NNC connection string', () => {
    const uri =
      'nostr+nodecontrol://b889ff5b1513b641e2a139f661a661364979c5beee91842f8f0ef42ab558e9d4?relay=wss%3A%2F%2Frelay.damus.io'
    const params = parseConnectionString(uri)
    expect(params.pubkey).toBe(
      'b889ff5b1513b641e2a139f661a661364979c5beee91842f8f0ef42ab558e9d4',
    )
    expect(params.relays).toEqual(['wss://relay.damus.io'])
  })

  it('rejects invalid prefix', () => {
    expect(() => parseConnectionString('nostr+walletconnect://abc')).toThrow(
      'must start with nostr+nodecontrol://',
    )
  })

  it('rejects missing relay', () => {
    expect(() =>
      parseConnectionString(
        'nostr+nodecontrol://b889ff5b1513b641e2a139f661a661364979c5beee91842f8f0ef42ab558e9d4',
      ),
    ).toThrow('missing relay')
  })
})

describe('NncClient', () => {
  let signer: NwcSigner
  const servicePubkey = SERVICE_PUBKEY
  const relayUrls = RELAY_URLS

  beforeEach(() => {
    signer = createMockSigner()
  })

  function nncPool(responsePayload?: Record<string, unknown>) {
    return createMockPool(responsePayload, NNC_RESPONSE_KIND)
  }

  it('requires pool in opts', () => {
    expect(() => new NncClient(signer, servicePubkey, relayUrls)).toThrow(
      'pool instance is required',
    )
  })

  it('constructs from URI', () => {
    const pool = nncPool()
    const client = NncClient.fromURI(
      signer,
      `nostr+nodecontrol://${servicePubkey}?relay=wss%3A%2F%2Frelay.example.com`,
      { pool: pool as any },
    )
    expect(client).toBeInstanceOf(NncClient)
    client.close()
  })

  it('uses NNC request kind (23198)', async () => {
    const pool = nncPool({
      result_type: 'list_channels',
      result: { channels: [] },
    })

    const client = new NncClient(signer, servicePubkey, relayUrls, { pool: pool as any })
    await client.listChannels()

    const signCall = (signer.signEvent as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(signCall.kind).toBe(NNC_REQUEST_KIND)

    client.close()
  })

  it('subscribes for NNC response kind (23199)', async () => {
    const pool = nncPool({
      result_type: 'list_channels',
      result: { channels: [] },
    })

    const client = new NncClient(signer, servicePubkey, relayUrls, { pool: pool as any })
    await client.listChannels()

    expect(pool.subscribeMany).toHaveBeenCalledWith(
      relayUrls,
      expect.objectContaining({
        kinds: [NNC_RESPONSE_KIND],
        authors: [servicePubkey],
      }),
      expect.any(Object),
    )

    client.close()
  })

  // ─── Channel Management ─────────────────────────────────────────────────

  it('listChannels returns typed result', async () => {
    const pool = nncPool({
      result_type: 'list_channels',
      result: {
        channels: [
          {
            id: 'ch1',
            peer_pubkey: '02abc',
            state: 'active',
            is_private: false,
            local_balance: 500000,
            remote_balance: 500000,
            capacity: 1000000,
            funding_txid: 'tx1',
            funding_output_index: 0,
          },
        ],
      },
    })

    const client = new NncClient(signer, servicePubkey, relayUrls, { pool: pool as any })
    const result = await client.listChannels()

    expect(result.channels).toHaveLength(1)
    expect(result.channels[0].state).toBe('active')
    expect(result.channels[0].local_balance).toBe(500000)

    client.close()
  })

  it('openChannel sends correct params', async () => {
    const pool = nncPool({
      result_type: 'open_channel',
      result: {},
    })

    const client = new NncClient(signer, servicePubkey, relayUrls, { pool: pool as any })
    await client.openChannel({ pubkey: '02abc', amount: 1000000 })

    expect(signer.nip44Encrypt).toHaveBeenCalledWith(
      servicePubkey,
      JSON.stringify({
        method: 'open_channel',
        params: { pubkey: '02abc', amount: 1000000 },
      }),
    )

    client.close()
  })

  it('closeChannel sends correct params', async () => {
    const pool = nncPool({
      result_type: 'close_channel',
      result: {},
    })

    const client = new NncClient(signer, servicePubkey, relayUrls, { pool: pool as any })
    await client.closeChannel({ id: 'ch1' })

    expect(signer.nip44Encrypt).toHaveBeenCalledWith(
      servicePubkey,
      JSON.stringify({ method: 'close_channel', params: { id: 'ch1' } }),
    )

    client.close()
  })

  it('closeChannel with force=true', async () => {
    const pool = nncPool({
      result_type: 'close_channel',
      result: {},
    })

    const client = new NncClient(signer, servicePubkey, relayUrls, { pool: pool as any })
    await client.closeChannel({ id: 'ch1', force: true })

    expect(signer.nip44Encrypt).toHaveBeenCalledWith(
      servicePubkey,
      JSON.stringify({ method: 'close_channel', params: { id: 'ch1', force: true } }),
    )

    client.close()
  })

  // ─── Peer Management ─────────────────────────────────────────────────

  it('listPeers returns typed result', async () => {
    const pool = nncPool({
      result_type: 'list_peers',
      result: {
        peers: [
          {
            pubkey: '02abc',
            address: '10.0.0.1:9735',
            connected: true,
            alias: 'ACINQ',
            num_channels: 2,
          },
        ],
      },
    })

    const client = new NncClient(signer, servicePubkey, relayUrls, { pool: pool as any })
    const result = await client.listPeers()

    expect(result.peers).toHaveLength(1)
    expect(result.peers[0].alias).toBe('ACINQ')

    client.close()
  })

  it('connectPeer sends correct params', async () => {
    const pool = nncPool({
      result_type: 'connect_peer',
      result: {},
    })

    const client = new NncClient(signer, servicePubkey, relayUrls, { pool: pool as any })
    await client.connectPeer({ pubkey: '02abc', host: '10.0.0.1:9735' })

    expect(signer.nip44Encrypt).toHaveBeenCalledWith(
      servicePubkey,
      JSON.stringify({ method: 'connect_peer', params: { pubkey: '02abc', host: '10.0.0.1:9735' } }),
    )

    client.close()
  })

  it('disconnectPeer sends correct params', async () => {
    const pool = nncPool({
      result_type: 'disconnect_peer',
      result: {},
    })

    const client = new NncClient(signer, servicePubkey, relayUrls, { pool: pool as any })
    await client.disconnectPeer({ pubkey: '02abc' })

    expect(signer.nip44Encrypt).toHaveBeenCalledWith(
      servicePubkey,
      JSON.stringify({ method: 'disconnect_peer', params: { pubkey: '02abc' } }),
    )

    client.close()
  })

  // ─── Fees & Routing ─────────────────────────────────────────────────

  it('getChannelFees with params', async () => {
    const pool = nncPool({
      result_type: 'get_channel_fees',
      result: { fees: [{ id: 'ch1', peer_pubkey: '02abc', base_fee_msat: 1000, fee_rate: 100 }] },
    })

    const client = new NncClient(signer, servicePubkey, relayUrls, { pool: pool as any })
    const result = await client.getChannelFees({ id: 'ch1' })

    expect(result.fees).toHaveLength(1)
    expect(result.fees[0].base_fee_msat).toBe(1000)

    client.close()
  })

  it('getChannelFees without params', async () => {
    const pool = nncPool({
      result_type: 'get_channel_fees',
      result: { fees: [] },
    })

    const client = new NncClient(signer, servicePubkey, relayUrls, { pool: pool as any })
    const result = await client.getChannelFees()

    expect(result.fees).toEqual([])
    expect(signer.nip44Encrypt).toHaveBeenCalledWith(
      servicePubkey,
      JSON.stringify({ method: 'get_channel_fees', params: {} }),
    )

    client.close()
  })

  it('setChannelFees sends correct params', async () => {
    const pool = nncPool({
      result_type: 'set_channel_fees',
      result: {},
    })

    const client = new NncClient(signer, servicePubkey, relayUrls, { pool: pool as any })
    await client.setChannelFees({ id: 'ch1', base_fee_msat: 500, fee_rate: 50 })

    expect(signer.nip44Encrypt).toHaveBeenCalledWith(
      servicePubkey,
      JSON.stringify({ method: 'set_channel_fees', params: { id: 'ch1', base_fee_msat: 500, fee_rate: 50 } }),
    )

    client.close()
  })

  it('getForwardingHistory with params', async () => {
    const pool = nncPool({
      result_type: 'get_forwarding_history',
      result: { forwards: [{ incoming_channel_id: 'ch1', outgoing_channel_id: 'ch2', fee_earned: 100, settled_at: 1234 }] },
    })

    const client = new NncClient(signer, servicePubkey, relayUrls, { pool: pool as any })
    const result = await client.getForwardingHistory({ limit: 10 })

    expect(result.forwards).toHaveLength(1)
    expect(result.forwards[0].fee_earned).toBe(100)

    client.close()
  })

  it('getForwardingHistory without params', async () => {
    const pool = nncPool({
      result_type: 'get_forwarding_history',
      result: { forwards: [] },
    })

    const client = new NncClient(signer, servicePubkey, relayUrls, { pool: pool as any })
    const result = await client.getForwardingHistory()

    expect(result.forwards).toEqual([])
    expect(signer.nip44Encrypt).toHaveBeenCalledWith(
      servicePubkey,
      JSON.stringify({ method: 'get_forwarding_history', params: {} }),
    )

    client.close()
  })

  it('getPendingHtlcs returns typed result', async () => {
    const pool = nncPool({
      result_type: 'get_pending_htlcs',
      result: { htlcs: [{ channel_id: 'ch1', direction: 'incoming', amount: 5000, hash_lock: 'hl1', expiry_height: 800000 }] },
    })

    const client = new NncClient(signer, servicePubkey, relayUrls, { pool: pool as any })
    const result = await client.getPendingHtlcs()

    expect(result.htlcs).toHaveLength(1)
    expect(result.htlcs[0].direction).toBe('incoming')

    client.close()
  })

  it('queryRoutes sends correct params', async () => {
    const pool = nncPool({
      result_type: 'query_routes',
      result: { routes: [{ total_fee: 10, total_time_lock: 144, hops: [] }] },
    })

    const client = new NncClient(signer, servicePubkey, relayUrls, { pool: pool as any })
    const result = await client.queryRoutes({ destination: '02abc', amount: 50000 })

    expect(result.routes).toHaveLength(1)
    expect(result.routes[0].total_fee).toBe(10)

    client.close()
  })

  // ─── Network Graph ─────────────────────────────────────────────────

  it('listNetworkNodes with params', async () => {
    const pool = nncPool({
      result_type: 'list_network_nodes',
      result: { nodes: [{ pubkey: '02abc', alias: 'ACINQ', num_channels: 100, total_capacity: 999999, last_update: 1234 }] },
    })

    const client = new NncClient(signer, servicePubkey, relayUrls, { pool: pool as any })
    const result = await client.listNetworkNodes({ limit: 5 })

    expect(result.nodes).toHaveLength(1)
    expect(result.nodes[0].alias).toBe('ACINQ')

    client.close()
  })

  it('listNetworkNodes without params', async () => {
    const pool = nncPool({
      result_type: 'list_network_nodes',
      result: { nodes: [] },
    })

    const client = new NncClient(signer, servicePubkey, relayUrls, { pool: pool as any })
    const result = await client.listNetworkNodes()

    expect(result.nodes).toEqual([])
    expect(signer.nip44Encrypt).toHaveBeenCalledWith(
      servicePubkey,
      JSON.stringify({ method: 'list_network_nodes', params: {} }),
    )

    client.close()
  })

  it('getNetworkStats returns typed result', async () => {
    const pool = nncPool({
      result_type: 'get_network_stats',
      result: {
        num_nodes: 15000,
        num_channels: 65000,
        total_capacity: 500000000000000,
        avg_channel_size: 7692307692,
        max_channel_size: 1000000000000,
      },
    })

    const client = new NncClient(signer, servicePubkey, relayUrls, { pool: pool as any })
    const result = await client.getNetworkStats()

    expect(result.num_nodes).toBe(15000)
    expect(result.num_channels).toBe(65000)

    client.close()
  })

  it('getNetworkNode sends correct params', async () => {
    const pool = nncPool({
      result_type: 'get_network_node',
      result: { pubkey: '02abc', alias: 'ACINQ', num_channels: 100, total_capacity: 999999, last_update: 1234 },
    })

    const client = new NncClient(signer, servicePubkey, relayUrls, { pool: pool as any })
    const result = await client.getNetworkNode({ pubkey: '02abc' })

    expect(result.alias).toBe('ACINQ')
    expect(signer.nip44Encrypt).toHaveBeenCalledWith(
      servicePubkey,
      JSON.stringify({ method: 'get_network_node', params: { pubkey: '02abc' } }),
    )

    client.close()
  })

  it('getNetworkChannel sends correct params', async () => {
    const pool = nncPool({
      result_type: 'get_network_channel',
      result: {
        short_channel_id: '123x456x0',
        capacity: 1000000,
        node1_pubkey: '02abc',
        node2_pubkey: '02def',
      },
    })

    const client = new NncClient(signer, servicePubkey, relayUrls, { pool: pool as any })
    const result = await client.getNetworkChannel({ short_channel_id: '123x456x0' })

    expect(result.capacity).toBe(1000000)
    expect(signer.nip44Encrypt).toHaveBeenCalledWith(
      servicePubkey,
      JSON.stringify({ method: 'get_network_channel', params: { short_channel_id: '123x456x0' } }),
    )

    client.close()
  })

  // ─── Error tests ─────────────────────────────────────────────────

  it('rejects with NwcWalletError on service error', async () => {
    const pool = nncPool({
      result_type: 'open_channel',
      error: { code: 'RESTRICTED', message: 'Not authorized' },
    })

    const client = new NncClient(signer, servicePubkey, relayUrls, { pool: pool as any })
    await expect(
      client.openChannel({ pubkey: '02abc', amount: 1000000 }),
    ).rejects.toThrow(NwcWalletError)

    client.close()
  })

  it('timeout works for NNC requests', async () => {
    const pool = nncPool()
    pool.publish = vi.fn().mockReturnValue([Promise.resolve('ok')])

    const client = new NncClient(signer, servicePubkey, relayUrls, {
      pool: pool as any,
      timeoutMs: 50,
    })

    await expect(client.listChannels()).rejects.toThrow(NwcReplyTimeout)

    client.close()
  })

  // ─── Notification tests ───────────────────────────────────────────────

  describe('subscribeNotifications', () => {
    it('subscribes for kind 23200 filtered by user pubkey', async () => {
      const pool = nncPool()
      const client = new NncClient(signer, servicePubkey, relayUrls, { pool: pool as any })

      const handler = vi.fn()
      const unsub = await client.subscribeNotifications(handler)

      expect(pool.subscribeMany).toHaveBeenCalledWith(
        relayUrls,
        expect.objectContaining({
          kinds: [NNC_NOTIFICATION_KIND],
          authors: [servicePubkey],
          '#p': ['aabb'.repeat(16)],
        }),
        expect.any(Object),
      )

      unsub()
      client.close()
    })

    it('calls sendRequest with types when provided', async () => {
      const pool = nncPool({
        result_type: 'subscribe_notifications',
        result: {},
      })

      const client = new NncClient(signer, servicePubkey, relayUrls, { pool: pool as any })

      const handler = vi.fn()
      const unsub = await client.subscribeNotifications(handler, ['channel_opened'])

      expect(signer.nip44Encrypt).toHaveBeenCalledWith(
        servicePubkey,
        JSON.stringify({ method: 'subscribe_notifications', params: { types: ['channel_opened'] } }),
      )

      unsub()
      client.close()
    })

    it('decrypts and delivers notification to handler', async () => {
      const pool = nncPool()

      pool.subscribeMany.mockImplementation((_relays: any, _filter: any, params: any) => {
        setTimeout(() => {
          const notification = JSON.stringify({
            notification_type: 'channel_opened',
            notification: { channel_id: 'ch1' },
          })
          params.onevent({
            id: 'notif-1',
            pubkey: servicePubkey,
            content: `encrypted:${notification}`,
            kind: NNC_NOTIFICATION_KIND,
            created_at: Math.floor(Date.now() / 1000),
            tags: [['p', 'aabb'.repeat(16)]],
            sig: 'sig',
          })
        }, 10)
        return { close: vi.fn() }
      })

      const client = new NncClient(signer, servicePubkey, relayUrls, { pool: pool as any })

      const handler = vi.fn()
      const unsub = await client.subscribeNotifications(handler)

      await new Promise((r) => setTimeout(r, 50))

      expect(handler).toHaveBeenCalledWith({
        notification_type: 'channel_opened',
        notification: { channel_id: 'ch1' },
      })

      unsub()
      client.close()
    })

    it('returns unsubscribe function that closes sub', async () => {
      const closeFn = vi.fn()
      const pool = nncPool()
      pool.subscribeMany.mockReturnValue({ close: closeFn })

      const client = new NncClient(signer, servicePubkey, relayUrls, { pool: pool as any })

      const handler = vi.fn()
      const unsub = await client.subscribeNotifications(handler)

      unsub()
      expect(closeFn).toHaveBeenCalled()

      client.close()
    })
  })

  // ─── Lifecycle test ────────────────────────────────────────────────────

  it('close() closes all active subscriptions', async () => {
    const closeFn1 = vi.fn()
    const closeFn2 = vi.fn()
    let callCount = 0
    const pool = nncPool()
    pool.subscribeMany.mockImplementation(() => {
      callCount++
      return { close: callCount === 1 ? closeFn1 : closeFn2 }
    })

    const client = new NncClient(signer, servicePubkey, relayUrls, { pool: pool as any })

    await client.subscribeNotifications(vi.fn())
    await client.subscribeNotifications(vi.fn())

    client.close()

    expect(closeFn1).toHaveBeenCalled()
    expect(closeFn2).toHaveBeenCalled()
  })
})
