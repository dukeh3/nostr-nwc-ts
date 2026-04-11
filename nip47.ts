/**
 * NIP-47 — Nostr Wallet Connect (NWC) protocol module.
 *
 * Follows nostr-tools conventions (like nip46's BunkerSigner pattern).
 * Self-contained: only imports from nostr-tools. Can be copied into a
 * nostr-tools PR when ready.
 *
 * @module nip47
 */

import type { AbstractSimplePool, SubCloser } from 'nostr-tools/abstract-pool'
import type { NwcSigner } from './src/signer/types.js'

// ─── Event Kinds ──────────────────────────────────────────────────────────

export const NWC_INFO_KIND = 13194
export const NWC_REQUEST_KIND = 23194
export const NWC_RESPONSE_KIND = 23195
export const NWC_NOTIFICATION_KIND = 23197

// ─── Error Hierarchy ──────────────────────────────────────────────────────

export class NwcRequestError extends Error {
  constructor(
    public readonly method: string,
    public readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'NwcRequestError'
  }
}

/** Service rejected the request (INSUFFICIENT_BALANCE, RESTRICTED, etc.) */
export class NwcWalletError extends NwcRequestError {
  constructor(method: string, code: string, message: string) {
    super(method, code, message)
    this.name = 'NwcWalletError'
  }
}

export class NwcTimeoutError extends NwcRequestError {
  constructor(method: string, message: string) {
    super(method, 'TIMEOUT', message)
    this.name = 'NwcTimeoutError'
  }
}

/** Relay didn't acknowledge the published event */
export class NwcPublishTimeout extends NwcTimeoutError {
  constructor(method: string) {
    super(method, `Publish timeout: ${method}`)
    this.name = 'NwcPublishTimeout'
  }
}

/** Service didn't respond within the timeout */
export class NwcReplyTimeout extends NwcTimeoutError {
  constructor(method: string) {
    super(method, `Reply timeout: ${method}`)
    this.name = 'NwcReplyTimeout'
  }
}

/** Relay rejected the event */
export class NwcPublishError extends NwcRequestError {
  constructor(method: string, reason: string) {
    super(method, 'PUBLISH_FAILED', reason)
    this.name = 'NwcPublishError'
  }
}

/** Couldn't connect to relay */
export class NwcConnectionError extends NwcRequestError {
  constructor(method: string, reason: string) {
    super(method, 'CONNECTION_FAILED', reason)
    this.name = 'NwcConnectionError'
  }
}

/** Couldn't decrypt response */
export class NwcDecryptionError extends NwcRequestError {
  constructor(method: string, reason: string) {
    super(method, 'DECRYPTION_FAILED', reason)
    this.name = 'NwcDecryptionError'
  }
}

// ─── Error codes from spec ────────────────────────────────────────────────

export const NWC_ERROR_CODES = [
  'RATE_LIMITED',
  'NOT_IMPLEMENTED',
  'INSUFFICIENT_BALANCE',
  'QUOTA_EXCEEDED',
  'RESTRICTED',
  'UNAUTHORIZED',
  'INTERNAL',
  'UNSUPPORTED_ENCRYPTION',
  'OTHER',
  'PAYMENT_FAILED',
  'NOT_FOUND',
] as const

export type NwcErrorCode = (typeof NWC_ERROR_CODES)[number]

// ─── Wire Types ───────────────────────────────────────────────────────────

export interface NwcResponse {
  result_type: string
  result?: Record<string, unknown>
  error?: { code: string; message: string }
}

export interface NwcNotification {
  notification_type: string
  notification: Record<string, unknown>
}

// ─── Connection String ────────────────────────────────────────────────────

export interface NwcConnectionParams {
  pubkey: string
  relays: string[]
  secret?: string
  lud16?: string
}

/**
 * Parse a `nostr+walletconnect://` connection URI.
 */
export function parseConnectionString(uri: string): NwcConnectionParams {
  if (!uri.startsWith('nostr+walletconnect://')) {
    throw new Error('Invalid NWC connection string: must start with nostr+walletconnect://')
  }

  const url = new URL(uri.replace('nostr+walletconnect://', 'https://dummy/'))
  const pubkey = uri.slice('nostr+walletconnect://'.length).split('?')[0]

  if (!pubkey || pubkey.length !== 64) {
    throw new Error('Invalid NWC connection string: missing or invalid pubkey')
  }

  const relays = url.searchParams.getAll('relay')
  if (relays.length === 0) {
    throw new Error('Invalid NWC connection string: missing relay parameter')
  }

  const secret = url.searchParams.get('secret') ?? undefined
  const lud16 = url.searchParams.get('lud16') ?? undefined

  return { pubkey, relays, secret, lud16 }
}

// ─── NIP-47 Method Param/Result Types ────────────────────────────────────

export interface PayInvoiceParams {
  invoice: string
  amount?: number
  metadata?: Record<string, unknown>
}

export interface PayInvoiceResult {
  preimage: string
  fees_paid?: number
}

export interface PayKeysendParams {
  amount: number
  pubkey: string
  preimage?: string
  tlv_records?: Array<{ type: number; value: string }>
}

export interface PayKeysendResult {
  preimage: string
  fees_paid?: number
}

export interface PayOfferParams {
  offer: string
  amount?: number
  payer_note?: string
}

export interface PayOfferResult {
  preimage: string
  fees_paid?: number
}

export interface MakeOfferParams {
  amount?: number
  description: string
}

export interface MakeOfferResult {
  offer: string
  description: string
  amount?: number
}

export interface LookupOfferParams {
  offer: string
}

export interface LookupOfferResult {
  offer: string
  description: string
  amount?: number
  active: boolean
  num_payments_received: number
  total_received: number
}

export interface PayOnchainParams {
  address: string
  amount: number
  feerate?: number
}

export interface PayOnchainResult {
  txid: string
}

export interface MakeNewAddressParams {
  type?: 'p2pkh' | 'p2sh-segwit' | 'p2wpkh' | 'p2tr'
}

export interface MakeNewAddressResult {
  address: string
  type: string
}

export interface LookupAddressParams {
  address: string
}

export interface LookupAddressResult {
  address: string
  type: string
  total_received: number
  transactions: Array<{
    txid: string
    amount: number
    confirmations: number
    timestamp: number
  }>
}

export interface PayBip321Params {
  uri: string
}

export interface PayBip321Result {
  payment_method: 'bolt11' | 'bolt12' | 'sp' | 'onchain'
  preimage?: string
  txid?: string
  fees_paid?: number
}

export interface MakeBip321Params {
  amount?: number
  label?: string
  message?: string
  methods?: Array<{
    method: string
    expiry?: number
    address_type?: string
  }>
}

export interface MakeBip321Result {
  uri: string
}

export interface MakeInvoiceParams {
  amount: number
  description?: string
  description_hash?: string
  expiry?: number
  metadata?: Record<string, unknown>
}

export interface TransactionInfo {
  type: 'incoming' | 'outgoing'
  payment_method?: string
  state?: string
  invoice?: string
  description?: string
  description_hash?: string
  preimage?: string
  payment_hash?: string
  amount: number
  fees_paid?: number
  created_at?: number
  expires_at?: number
  settled_at?: number
  txid?: string
  address?: string
  confirmations?: number
  metadata?: Record<string, unknown>
}

export type MakeInvoiceResult = TransactionInfo

export interface LookupInvoiceParams {
  payment_hash?: string
  invoice?: string
}

export type LookupInvoiceResult = TransactionInfo

export interface ListTransactionsParams {
  from?: number
  until?: number
  limit?: number
  offset?: number
  unpaid?: boolean
  type?: 'incoming' | 'outgoing'
  payment_method?: string
}

export interface ListTransactionsResult {
  transactions: TransactionInfo[]
}

export interface GetBalanceResult {
  balance: number
  lightning_balance?: number
  onchain_balance?: number
}

export interface GetInfoResult {
  alias?: string
  color?: string
  pubkey?: string
  network?: string
  block_height?: number
  block_hash?: string
  methods: string[]
  notifications?: string[]
  bip321_methods?: Array<{
    method: string
    address_types?: string[]
  }>
}

export interface EstimateOnchainFeesResult {
  fees: Record<string, number>
}

export interface EstimateRoutingFeesParams {
  destination: string
  amount: number
}

export interface EstimateRoutingFeesResult {
  fee: number
  time_lock_delay: number
}

export interface MakeHoldInvoiceParams {
  amount: number
  description?: string
  description_hash?: string
  expiry?: number
  payment_hash: string
  min_cltv_expiry_delta?: number
}

export type MakeHoldInvoiceResult = TransactionInfo

export interface SettleHoldInvoiceParams {
  preimage: string
}

export interface CancelHoldInvoiceParams {
  payment_hash: string
}

export interface SignMessageParams {
  message: string
}

export interface SignMessageResult {
  signature: string
}

// ─── Client Options ───────────────────────────────────────────────────────

export interface NwcClientOptions {
  pool?: AbstractSimplePool
  timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 30_000

// ─── NwcClient ────────────────────────────────────────────────────────────

/**
 * NIP-47 Nostr Wallet Connect client.
 *
 * Takes an NwcSigner + relay pool, never owns keys.
 * Follows nostr-tools' BunkerSigner pattern.
 */
export class NwcClient {
  private signer: NwcSigner
  private walletPubkey: string
  private relayUrls: string[]
  private pool: AbstractSimplePool
  private ownsPool: boolean
  private timeoutMs: number
  private subscriptions: SubCloser[] = []

  constructor(
    signer: NwcSigner,
    walletPubkey: string,
    relayUrls: string[],
    opts?: NwcClientOptions,
  ) {
    this.signer = signer
    this.walletPubkey = walletPubkey
    this.relayUrls = relayUrls
    this.timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS

    if (!opts?.pool) {
      throw new Error('A pool instance is required. Pass { pool: new SimplePool() } in opts.')
    }
    this.pool = opts.pool
    this.ownsPool = false
  }

  /**
   * Factory: create NwcClient from a `nostr+walletconnect://` URI.
   * If the URI contains a `secret`, a SecretKeySigner is created automatically.
   */
  static fromURI(signer: NwcSigner, connectionString: string, opts?: NwcClientOptions): NwcClient {
    const params = parseConnectionString(connectionString)
    return new NwcClient(signer, params.pubkey, params.relays, opts)
  }

  /**
   * Generic protocol method: encrypt → publish → subscribe → decrypt.
   * All typed convenience methods call this internally.
   */
  async sendRequest(method: string, params: Record<string, unknown> = {}): Promise<NwcResponse> {
    const plaintext = JSON.stringify({ method, params })
    const encrypted = await this.signer.nip44Encrypt(this.walletPubkey, plaintext)

    const event = await this.signer.signEvent({
      kind: NWC_REQUEST_KIND,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ['p', this.walletPubkey],
        ['encryption', 'nip44_v2'],
      ],
      content: encrypted,
    })

    return new Promise<NwcResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        sub.close()
        reject(new NwcReplyTimeout(method))
      }, this.timeoutMs)

      // Subscribe for the correlated response BEFORE publishing
      const sub = this.pool.subscribeMany(
        this.relayUrls,
        {
          kinds: [NWC_RESPONSE_KIND],
          authors: [this.walletPubkey],
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
              const response = JSON.parse(decrypted) as NwcResponse
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

      // Publish the request event
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

  // ─── Typed NIP-47 Methods ──────────────────────────────────────────────

  async getInfo(): Promise<GetInfoResult> {
    const r = await this.sendRequest('get_info')
    return r.result as unknown as GetInfoResult
  }

  async getBalance(): Promise<GetBalanceResult> {
    const r = await this.sendRequest('get_balance')
    return r.result as unknown as GetBalanceResult
  }

  async payInvoice(p: PayInvoiceParams): Promise<PayInvoiceResult> {
    const r = await this.sendRequest('pay_invoice', p as any)
    return r.result as unknown as PayInvoiceResult
  }

  async payKeysend(p: PayKeysendParams): Promise<PayKeysendResult> {
    const r = await this.sendRequest('pay_keysend', p as any)
    return r.result as unknown as PayKeysendResult
  }

  async makeInvoice(p: MakeInvoiceParams): Promise<MakeInvoiceResult> {
    const r = await this.sendRequest('make_invoice', p as any)
    return r.result as unknown as MakeInvoiceResult
  }

  async lookupInvoice(p: LookupInvoiceParams): Promise<LookupInvoiceResult> {
    const r = await this.sendRequest('lookup_invoice', p as any)
    return r.result as unknown as LookupInvoiceResult
  }

  async listTransactions(p?: ListTransactionsParams): Promise<ListTransactionsResult> {
    const r = await this.sendRequest('list_transactions', (p ?? {}) as any)
    return r.result as unknown as ListTransactionsResult
  }

  async payOffer(p: PayOfferParams): Promise<PayOfferResult> {
    const r = await this.sendRequest('pay_offer', p as any)
    return r.result as unknown as PayOfferResult
  }

  async makeOffer(p: MakeOfferParams): Promise<MakeOfferResult> {
    const r = await this.sendRequest('make_offer', p as any)
    return r.result as unknown as MakeOfferResult
  }

  async lookupOffer(p: LookupOfferParams): Promise<LookupOfferResult> {
    const r = await this.sendRequest('lookup_offer', p as any)
    return r.result as unknown as LookupOfferResult
  }

  async payOnchain(p: PayOnchainParams): Promise<PayOnchainResult> {
    const r = await this.sendRequest('pay_onchain', p as any)
    return r.result as unknown as PayOnchainResult
  }

  async makeNewAddress(p?: MakeNewAddressParams): Promise<MakeNewAddressResult> {
    const r = await this.sendRequest('make_new_address', (p ?? {}) as any)
    return r.result as unknown as MakeNewAddressResult
  }

  async lookupAddress(p: LookupAddressParams): Promise<LookupAddressResult> {
    const r = await this.sendRequest('lookup_address', p as any)
    return r.result as unknown as LookupAddressResult
  }

  async payBip321(p: PayBip321Params): Promise<PayBip321Result> {
    const r = await this.sendRequest('pay_bip321', p as any)
    return r.result as unknown as PayBip321Result
  }

  async makeBip321(p?: MakeBip321Params): Promise<MakeBip321Result> {
    const r = await this.sendRequest('make_bip321', (p ?? {}) as any)
    return r.result as unknown as MakeBip321Result
  }

  async estimateOnchainFees(): Promise<EstimateOnchainFeesResult> {
    const r = await this.sendRequest('estimate_onchain_fees')
    return r.result as unknown as EstimateOnchainFeesResult
  }

  async estimateRoutingFees(p: EstimateRoutingFeesParams): Promise<EstimateRoutingFeesResult> {
    const r = await this.sendRequest('estimate_routing_fees', p as any)
    return r.result as unknown as EstimateRoutingFeesResult
  }

  async makeHoldInvoice(p: MakeHoldInvoiceParams): Promise<MakeHoldInvoiceResult> {
    const r = await this.sendRequest('make_hold_invoice', p as any)
    return r.result as unknown as MakeHoldInvoiceResult
  }

  async settleHoldInvoice(p: SettleHoldInvoiceParams): Promise<void> {
    await this.sendRequest('settle_hold_invoice', p as any)
  }

  async cancelHoldInvoice(p: CancelHoldInvoiceParams): Promise<void> {
    await this.sendRequest('cancel_hold_invoice', p as any)
  }

  async signMessage(p: SignMessageParams): Promise<SignMessageResult> {
    const r = await this.sendRequest('sign_message', p as any)
    return r.result as unknown as SignMessageResult
  }

  // ─── Notifications ────────────────────────────────────────────────────

  /**
   * Subscribe to NWC notification events (kind 23197).
   * Returns an unsubscribe function.
   */
  async subscribeNotifications(
    handler: (n: NwcNotification) => void,
    types?: string[],
  ): Promise<() => void> {
    // If types are specified, tell the service via subscribe_notifications
    if (types && types.length > 0) {
      await this.sendRequest('subscribe_notifications', { types })
    }

    const userPubkey = await this.signer.getPublicKey()
    const sub = this.pool.subscribeMany(
      this.relayUrls,
      {
        kinds: [NWC_NOTIFICATION_KIND],
        authors: [this.walletPubkey],
        '#p': [userPubkey],
      } as any,
      {
        onevent: async (event) => {
          try {
            const decrypted = await this.signer.nip44Decrypt(event.pubkey, event.content)
            const notification = JSON.parse(decrypted) as NwcNotification
            handler(notification)
          } catch {
            // Ignore decrypt/parse errors for notifications
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
