/**
 * NIP-XX — Nostr Node Control (NNC) protocol module.
 *
 * Follows the same pattern as nip47.ts. Self-contained: only imports from
 * nostr-tools. Can be copied into a nostr-tools PR when NNC gets a NIP number.
 *
 * @module nipXX
 */

import type { AbstractSimplePool, SubCloser } from 'nostr-tools/abstract-pool'
import type { NwcSigner } from './src/signer/types.js'
import {
  NwcRequestError,
  NwcWalletError,
  NwcReplyTimeout,
  NwcPublishError,
  NwcDecryptionError,
} from './nip47.js'

// ─── Grant Kind ──────────────────────────────────────────────────────────

const GRANT_KIND = 30078

export interface UsageProfile {
  methods?: Record<string, Record<string, unknown>>
  control?: Record<string, Record<string, unknown>>
  quota?: { rate_per_micro?: number; max_capacity?: number }
}

export interface GrantInfo {
  callerPubkey: string
  profile: UsageProfile
  eventId: string
  createdAt: number
}

// ─── Event Kinds ──────────────────────────────────────────────────────────

export const NNC_INFO_KIND = 13198
export const NNC_REQUEST_KIND = 23198
export const NNC_RESPONSE_KIND = 23199
export const NNC_NOTIFICATION_KIND = 23200

// ─── Error codes from NNC spec ────────────────────────────────────────────

export const NNC_ERROR_CODES = [
  'RATE_LIMITED',
  'NOT_IMPLEMENTED',
  'RESTRICTED',
  'UNAUTHORIZED',
  'QUOTA_EXCEEDED',
  'NOT_FOUND',
  'INTERNAL',
  'OTHER',
  'CHANNEL_FAILED',
  'CONNECTION_FAILED',
] as const

export type NncErrorCode = (typeof NNC_ERROR_CODES)[number]

// ─── Wire Types ───────────────────────────────────────────────────────────

export interface NncResponse {
  result_type: string
  result?: Record<string, unknown>
  error?: { code: string; message: string }
}

export interface NncNotification {
  notification_type: string
  notification: Record<string, unknown>
}

export interface NotificationMeta {
  eventId: string
  authorPubkey: string
  createdAt: number
}

export interface SubscribeOptions {
  types?: string[]
  sinceNow?: boolean
  onError?: (error: unknown, eventId: string) => void
}

// ─── Connection String ────────────────────────────────────────────────────

export interface NncConnectionParams {
  pubkey: string
  relays: string[]
}

/**
 * Parse a `nostr+nodecontrol://` connection URI.
 */
export function parseConnectionString(uri: string): NncConnectionParams {
  if (!uri.startsWith('nostr+nodecontrol://')) {
    throw new Error('Invalid NNC connection string: must start with nostr+nodecontrol://')
  }

  const pubkey = uri.slice('nostr+nodecontrol://'.length).split('?')[0]

  if (!pubkey || pubkey.length !== 64) {
    throw new Error('Invalid NNC connection string: missing or invalid pubkey')
  }

  const url = new URL(uri.replace('nostr+nodecontrol://', 'https://dummy/'))
  const relays = url.searchParams.getAll('relay')
  if (relays.length === 0) {
    throw new Error('Invalid NNC connection string: missing relay parameter')
  }

  return { pubkey, relays }
}

// ─── NIP-XX Method Param/Result Types ────────────────────────────────────

// --- Channel Management ---

export interface ChannelInfo {
  id: string
  short_channel_id?: string
  peer_pubkey: string
  state: 'active' | 'inactive' | 'pending_open' | 'pending_close' | 'force_closing'
  is_private: boolean
  local_balance: number   // value in msats
  remote_balance: number  // value in msats
  capacity: number        // value in msats
  funding_txid: string
  funding_output_index: number
}

export interface ListChannelsResult {
  channels: ChannelInfo[]
}

export interface OpenChannelParams {
  pubkey: string
  amount: number         // value in msats
  push_amount?: number   // value in msats
  private?: boolean
  host?: string
  close_address?: string
  notify?: boolean
}

export interface CloseChannelParams {
  id: string
  force?: boolean
  close_address?: string
  notify?: boolean
}

// --- Peer Management ---

export interface PeerInfo {
  pubkey: string
  address: string
  connected: boolean
  alias?: string
  num_channels: number
}

export interface ListPeersResult {
  peers: PeerInfo[]
}

export interface ConnectPeerParams {
  pubkey: string
  host: string
}

export interface DisconnectPeerParams {
  pubkey: string
}

// --- Fees & Routing ---

export interface ChannelFeeInfo {
  id: string
  short_channel_id?: string
  peer_pubkey: string
  base_fee: number    // value in msats
  fee_rate: number
  min_htlc?: number   // value in msats
  max_htlc?: number   // value in msats
}

export interface GetChannelFeesParams {
  id?: string
}

export interface GetChannelFeesResult {
  fees: ChannelFeeInfo[]
}

export interface SetChannelFeesParams {
  id?: string
  base_fee?: number   // value in msats
  fee_rate?: number
  min_htlc?: number   // value in msats
  max_htlc?: number   // value in msats
}

export interface GetForwardingHistoryParams {
  from?: number
  until?: number
  limit?: number
  offset?: number
}

export interface ForwardInfo {
  incoming_channel_id: string
  outgoing_channel_id: string
  incoming_amount: number   // value in msats
  outgoing_amount: number   // value in msats
  fee_earned: number        // value in msats
  settled_at: number
}

export interface GetForwardingHistoryResult {
  forwards: ForwardInfo[]
}

export interface HtlcInfo {
  channel_id: string
  direction: 'incoming' | 'outgoing'
  amount: number  // value in msats
  hash_lock: string
  expiry_height: number
}

export interface GetPendingHtlcsResult {
  htlcs: HtlcInfo[]
}

export interface QueryRoutesParams {
  destination: string
  amount: number  // value in msats
  max_routes?: number
}

export interface RouteHop {
  pubkey: string
  short_channel_id: string
  fee: number   // value in msats
  expiry: number
}

export interface RouteInfo {
  total_fee: number  // value in msats
  total_time_lock: number
  hops: RouteHop[]
}

export interface QueryRoutesResult {
  routes: RouteInfo[]
}

// --- Network Graph ---

export interface NetworkNodeInfo {
  pubkey: string
  alias?: string
  color?: string
  num_channels: number
  total_capacity: number  // value in msats
  addresses?: string[]
  last_update: number
  features?: Record<string, unknown>
}

export interface ListNetworkNodesParams {
  limit?: number
  offset?: number
}

export interface ListNetworkNodesResult {
  nodes: NetworkNodeInfo[]
}

export interface GetNetworkStatsResult {
  num_nodes: number
  num_channels: number
  total_capacity: number    // value in msats
  avg_channel_size: number  // value in msats
  max_channel_size: number  // value in msats
}

export interface GetNetworkNodeParams {
  pubkey: string
}

export type GetNetworkNodeResult = NetworkNodeInfo

export interface ChannelPolicy {
  base_fee: number   // value in msats
  fee_rate: number
  min_htlc: number   // value in msats
  max_htlc: number   // value in msats
  time_lock_delta: number
  disabled: boolean
  last_update: number
}

export interface GetNetworkChannelParams {
  short_channel_id: string
}

export interface GetNetworkChannelResult {
  short_channel_id: string
  capacity: number  // value in msats
  node1_pubkey: string
  node2_pubkey: string
  node1_policy?: ChannelPolicy
  node2_policy?: ChannelPolicy
}

// ─── Client Options ───────────────────────────────────────────────────────

export interface NncClientOptions {
  pool?: AbstractSimplePool
  timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 30_000

// ─── NncClient ────────────────────────────────────────────────────────────

/**
 * NIP-XX Nostr Node Control client.
 *
 * Same pattern as NwcClient. Takes signer + pool, never owns keys.
 */
export class NncClient {
  private signer: NwcSigner
  private servicePubkey: string
  private relayUrls: string[]
  private pool: AbstractSimplePool
  private ownsPool: boolean
  private timeoutMs: number
  private subscriptions: SubCloser[] = []

  constructor(
    signer: NwcSigner,
    servicePubkey: string,
    relayUrls: string[],
    opts?: NncClientOptions,
  ) {
    this.signer = signer
    this.servicePubkey = servicePubkey
    this.relayUrls = relayUrls
    this.timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS

    if (!opts?.pool) {
      throw new Error('A pool instance is required. Pass { pool: new SimplePool() } in opts.')
    }
    this.pool = opts.pool
    this.ownsPool = false
  }

  /**
   * Factory: create NncClient from a `nostr+nodecontrol://` URI.
   */
  static fromURI(signer: NwcSigner, connectionString: string, opts?: NncClientOptions): NncClient {
    const params = parseConnectionString(connectionString)
    return new NncClient(signer, params.pubkey, params.relays, opts)
  }

  /**
   * Generic protocol method: encrypt → publish → subscribe → decrypt.
   */
  async sendRequest(method: string, params: Record<string, unknown> = {}): Promise<NncResponse> {
    const plaintext = JSON.stringify({ method, params })
    const encrypted = await this.signer.nip44Encrypt(this.servicePubkey, plaintext)

    const event = await this.signer.signEvent({
      kind: NNC_REQUEST_KIND,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ['p', this.servicePubkey],
        ['encryption', 'nip44_v2'],
      ],
      content: encrypted,
    })

    return new Promise<NncResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        sub.close()
        reject(new NwcReplyTimeout(method))
      }, this.timeoutMs)

      const sub = this.pool.subscribeMany(
        this.relayUrls,
        {
          kinds: [NNC_RESPONSE_KIND],
          authors: [this.servicePubkey],
          '#e': [event.id],
        } as any,
        {
          onevent: async (responseEvent) => {
            clearTimeout(timer)
            sub.close()
            try {
              const decrypted = await this.signer.nip44Decrypt(
                responseEvent.pubkey,
                responseEvent.content,
              )
              const response = JSON.parse(decrypted) as NncResponse
              if (response.error) {
                reject(
                  new NwcWalletError(method, response.error.code, response.error.message),
                )
              } else {
                resolve(response)
              }
            } catch (err) {
              reject(
                new NwcDecryptionError(
                  method,
                  err instanceof Error ? err.message : String(err),
                ),
              )
            }
          },
        },
      )

      const publishPromises = this.pool.publish(this.relayUrls, event as any)
      Promise.allSettled(publishPromises).then((results) => {
        const allFailed = results.every((r) => r.status === 'rejected')
        if (allFailed) {
          clearTimeout(timer)
          sub.close()
          reject(new NwcPublishError(method, 'All relays rejected the event'))
        }
      })
    })
  }

  // ─── Channel Management ───────────────────────────────────────────────

  async listChannels(): Promise<ListChannelsResult> {
    const r = await this.sendRequest('list_channels')
    return r.result as unknown as ListChannelsResult
  }

  async openChannel(p: OpenChannelParams): Promise<void> {
    await this.sendRequest('open_channel', p as any)
  }

  async closeChannel(p: CloseChannelParams): Promise<void> {
    await this.sendRequest('close_channel', p as any)
  }

  // ─── Peer Management ─────────────────────────────────────────────────

  async listPeers(): Promise<ListPeersResult> {
    const r = await this.sendRequest('list_peers')
    return r.result as unknown as ListPeersResult
  }

  async connectPeer(p: ConnectPeerParams): Promise<void> {
    await this.sendRequest('connect_peer', p as any)
  }

  async disconnectPeer(p: DisconnectPeerParams): Promise<void> {
    await this.sendRequest('disconnect_peer', p as any)
  }

  // ─── Fees & Routing ───────────────────────────────────────────────────

  async getChannelFees(p?: GetChannelFeesParams): Promise<GetChannelFeesResult> {
    const r = await this.sendRequest('get_channel_fees', (p ?? {}) as any)
    return r.result as unknown as GetChannelFeesResult
  }

  async setChannelFees(p: SetChannelFeesParams): Promise<void> {
    await this.sendRequest('set_channel_fees', p as any)
  }

  async getForwardingHistory(p?: GetForwardingHistoryParams): Promise<GetForwardingHistoryResult> {
    const r = await this.sendRequest('get_forwarding_history', (p ?? {}) as any)
    return r.result as unknown as GetForwardingHistoryResult
  }

  async getPendingHtlcs(): Promise<GetPendingHtlcsResult> {
    const r = await this.sendRequest('get_pending_htlcs')
    return r.result as unknown as GetPendingHtlcsResult
  }

  async queryRoutes(p: QueryRoutesParams): Promise<QueryRoutesResult> {
    const r = await this.sendRequest('query_routes', p as any)
    return r.result as unknown as QueryRoutesResult
  }

  // ─── Network Graph ────────────────────────────────────────────────────

  async listNetworkNodes(p?: ListNetworkNodesParams): Promise<ListNetworkNodesResult> {
    const r = await this.sendRequest('list_network_nodes', (p ?? {}) as any)
    return r.result as unknown as ListNetworkNodesResult
  }

  async getNetworkStats(): Promise<GetNetworkStatsResult> {
    const r = await this.sendRequest('get_network_stats')
    return r.result as unknown as GetNetworkStatsResult
  }

  async getNetworkNode(p: GetNetworkNodeParams): Promise<GetNetworkNodeResult> {
    const r = await this.sendRequest('get_network_node', p as any)
    return r.result as unknown as GetNetworkNodeResult
  }

  async getNetworkChannel(p: GetNetworkChannelParams): Promise<GetNetworkChannelResult> {
    const r = await this.sendRequest('get_network_channel', p as any)
    return r.result as unknown as GetNetworkChannelResult
  }

  // ─── Grant Management ─────────────────────────────────────────────────

  /**
   * Publish a kind 30078 grant for a caller pubkey.
   * Uses the pool already configured in this client.
   */
  async publishGrant(callerPubkey: string, profile: UsageProfile): Promise<string> {
    const event = await this.signer.signEvent({
      kind: GRANT_KIND,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ['d', `${this.servicePubkey}:${callerPubkey}`],
        ['p', this.servicePubkey],
      ],
      content: JSON.stringify(profile),
    })

    const publishPromises = this.pool.publish(this.relayUrls, event as any)
    const results = await Promise.allSettled(publishPromises)
    const allFailed = results.every((r) => r.status === 'rejected')
    if (allFailed) {
      throw new NwcPublishError('publish_grant', 'All relays rejected the grant event')
    }

    return event.id
  }

  /**
   * Revoke a grant by publishing an empty profile (kind 30078 with empty content).
   * The relay replaces the previous event with the same d-tag.
   */
  async revokeGrant(callerPubkey: string): Promise<string> {
    const event = await this.signer.signEvent({
      kind: GRANT_KIND,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ['d', `${this.servicePubkey}:${callerPubkey}`],
        ['p', this.servicePubkey],
      ],
      content: '',
    })

    const publishPromises = this.pool.publish(this.relayUrls, event as any)
    const results = await Promise.allSettled(publishPromises)
    const allFailed = results.every((r) => r.status === 'rejected')
    if (allFailed) {
      throw new NwcPublishError('revoke_grant', 'All relays rejected the revoke event')
    }

    return event.id
  }

  /**
   * List all grants for this service by fetching kind 30078 events.
   */
  async listGrants(): Promise<GrantInfo[]> {
    return new Promise<GrantInfo[]>((resolve) => {
      const grants: GrantInfo[] = []
      const timer = setTimeout(() => {
        sub.close()
        resolve(grants)
      }, this.timeoutMs)

      const sub = this.pool.subscribeMany(
        this.relayUrls,
        { kinds: [GRANT_KIND], '#p': [this.servicePubkey], limit: 500 } as any,
        {
          onevent: (event: any) => {
            const dTag = event.tags?.find((t: string[]) => t[0] === 'd')?.[1] as string | undefined
            if (!dTag?.startsWith(this.servicePubkey + ':')) return
            const callerPubkey = dTag.slice(this.servicePubkey.length + 1)
            if (callerPubkey.length !== 64) return
            if (!event.content) return // skip revoked grants
            try {
              const profile = JSON.parse(event.content) as UsageProfile
              grants.push({
                callerPubkey,
                profile,
                eventId: event.id,
                createdAt: event.created_at,
              })
            } catch {
              // skip unparseable grants
            }
          },
          oneose: () => {
            clearTimeout(timer)
            sub.close()
            resolve(grants)
          },
        },
      )
    })
  }

  // ─── Notifications ────────────────────────────────────────────────────

  /**
   * Subscribe to NNC notification events (kind 23200).
   * Returns an unsubscribe function.
   *
   * Accepts either `string[]` (list of notification types) or a
   * `SubscribeOptions` bag with `types`, `sinceNow`, and `onError`.
   */
  async subscribeNotifications(
    handler: (n: NncNotification, meta: NotificationMeta) => void,
    typesOrOpts?: string[] | SubscribeOptions,
  ): Promise<() => void> {
    const opts: SubscribeOptions = Array.isArray(typesOrOpts)
      ? { types: typesOrOpts }
      : (typesOrOpts ?? {})

    if (opts.types && opts.types.length > 0) {
      await this.sendRequest('subscribe_notifications', { types: opts.types })
    }

    const userPubkey = await this.signer.getPublicKey()
    const filter: Record<string, unknown> = {
      kinds: [NNC_NOTIFICATION_KIND],
      authors: [this.servicePubkey],
      '#p': [userPubkey],
    }
    if (opts.sinceNow) {
      filter.since = Math.floor(Date.now() / 1000)
    }

    const sub = this.pool.subscribeMany(
      this.relayUrls,
      filter as any,
      {
        onevent: async (event) => {
          try {
            const decrypted = await this.signer.nip44Decrypt(event.pubkey, event.content)
            const notification = JSON.parse(decrypted) as NncNotification
            handler(notification, {
              eventId: event.id,
              authorPubkey: event.pubkey,
              createdAt: event.created_at,
            })
          } catch (err) {
            if (opts.onError) {
              opts.onError(err, event.id)
            }
          }
        },
      },
    )

    this.subscriptions.push(sub)

    return () => {
      sub.close()
      this.subscriptions = this.subscriptions.filter((s) => s !== sub)
    }
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────

  close(): void {
    for (const sub of this.subscriptions) {
      sub.close()
    }
    this.subscriptions = []
    if (this.ownsPool) {
      this.pool.close(this.relayUrls)
    }
  }
}
