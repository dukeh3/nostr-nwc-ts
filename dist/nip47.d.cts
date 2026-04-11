import { AbstractSimplePool } from 'nostr-tools/abstract-pool';
import { N as NwcSigner } from './types-CsbyBm-P.cjs';
import 'nostr-tools/signer';

/**
 * NIP-47 — Nostr Wallet Connect (NWC) protocol module.
 *
 * Follows nostr-tools conventions (like nip46's BunkerSigner pattern).
 * Self-contained: only imports from nostr-tools. Can be copied into a
 * nostr-tools PR when ready.
 *
 * @module nip47
 */

declare const NWC_INFO_KIND = 13194;
declare const NWC_REQUEST_KIND = 23194;
declare const NWC_RESPONSE_KIND = 23195;
declare const NWC_NOTIFICATION_KIND = 23197;
declare class NwcRequestError extends Error {
    readonly method: string;
    readonly code: string;
    constructor(method: string, code: string, message: string);
}
/** Service rejected the request (INSUFFICIENT_BALANCE, RESTRICTED, etc.) */
declare class NwcWalletError extends NwcRequestError {
    constructor(method: string, code: string, message: string);
}
declare class NwcTimeoutError extends NwcRequestError {
    constructor(method: string, message: string);
}
/** Relay didn't acknowledge the published event */
declare class NwcPublishTimeout extends NwcTimeoutError {
    constructor(method: string);
}
/** Service didn't respond within the timeout */
declare class NwcReplyTimeout extends NwcTimeoutError {
    constructor(method: string);
}
/** Relay rejected the event */
declare class NwcPublishError extends NwcRequestError {
    constructor(method: string, reason: string);
}
/** Couldn't connect to relay */
declare class NwcConnectionError extends NwcRequestError {
    constructor(method: string, reason: string);
}
/** Couldn't decrypt response */
declare class NwcDecryptionError extends NwcRequestError {
    constructor(method: string, reason: string);
}
declare const NWC_ERROR_CODES: readonly ["RATE_LIMITED", "NOT_IMPLEMENTED", "INSUFFICIENT_BALANCE", "QUOTA_EXCEEDED", "RESTRICTED", "UNAUTHORIZED", "INTERNAL", "UNSUPPORTED_ENCRYPTION", "OTHER", "PAYMENT_FAILED", "NOT_FOUND"];
type NwcErrorCode = (typeof NWC_ERROR_CODES)[number];
interface NwcResponse {
    result_type: string;
    result?: Record<string, unknown>;
    error?: {
        code: string;
        message: string;
    };
}
interface NwcNotification {
    notification_type: string;
    notification: Record<string, unknown>;
}
interface NwcConnectionParams {
    pubkey: string;
    relays: string[];
    secret?: string;
    lud16?: string;
}
/**
 * Parse a `nostr+walletconnect://` connection URI.
 */
declare function parseConnectionString(uri: string): NwcConnectionParams;
interface PayInvoiceParams {
    invoice: string;
    amount?: number;
    metadata?: Record<string, unknown>;
}
interface PayInvoiceResult {
    preimage: string;
    fees_paid?: number;
}
interface PayKeysendParams {
    amount: number;
    pubkey: string;
    preimage?: string;
    tlv_records?: Array<{
        type: number;
        value: string;
    }>;
}
interface PayKeysendResult {
    preimage: string;
    fees_paid?: number;
}
interface PayOfferParams {
    offer: string;
    amount?: number;
    payer_note?: string;
}
interface PayOfferResult {
    preimage: string;
    fees_paid?: number;
}
interface MakeOfferParams {
    amount?: number;
    description: string;
}
interface MakeOfferResult {
    offer: string;
    description: string;
    amount?: number;
}
interface LookupOfferParams {
    offer: string;
}
interface LookupOfferResult {
    offer: string;
    description: string;
    amount?: number;
    active: boolean;
    num_payments_received: number;
    total_received: number;
}
interface PayOnchainParams {
    address: string;
    amount: number;
    feerate?: number;
}
interface PayOnchainResult {
    txid: string;
}
interface MakeNewAddressParams {
    type?: 'p2pkh' | 'p2sh-segwit' | 'p2wpkh' | 'p2tr';
}
interface MakeNewAddressResult {
    address: string;
    type: string;
}
interface LookupAddressParams {
    address: string;
}
interface LookupAddressResult {
    address: string;
    type: string;
    total_received: number;
    transactions: Array<{
        txid: string;
        amount: number;
        confirmations: number;
        timestamp: number;
    }>;
}
interface PayBip321Params {
    uri: string;
}
interface PayBip321Result {
    payment_method: 'bolt11' | 'bolt12' | 'sp' | 'onchain';
    preimage?: string;
    txid?: string;
    fees_paid?: number;
}
interface MakeBip321Params {
    amount?: number;
    label?: string;
    message?: string;
    methods?: Array<{
        method: string;
        expiry?: number;
        address_type?: string;
    }>;
}
interface MakeBip321Result {
    uri: string;
}
interface MakeInvoiceParams {
    amount: number;
    description?: string;
    description_hash?: string;
    expiry?: number;
    metadata?: Record<string, unknown>;
}
interface TransactionInfo {
    type: 'incoming' | 'outgoing';
    payment_method?: string;
    state?: string;
    invoice?: string;
    description?: string;
    description_hash?: string;
    preimage?: string;
    payment_hash?: string;
    amount: number;
    fees_paid?: number;
    created_at?: number;
    expires_at?: number;
    settled_at?: number;
    txid?: string;
    address?: string;
    confirmations?: number;
    metadata?: Record<string, unknown>;
}
type MakeInvoiceResult = TransactionInfo;
interface LookupInvoiceParams {
    payment_hash?: string;
    invoice?: string;
}
type LookupInvoiceResult = TransactionInfo;
interface ListTransactionsParams {
    from?: number;
    until?: number;
    limit?: number;
    offset?: number;
    unpaid?: boolean;
    type?: 'incoming' | 'outgoing';
    payment_method?: string;
}
interface ListTransactionsResult {
    transactions: TransactionInfo[];
}
interface GetBalanceResult {
    balance: number;
    lightning_balance?: number;
    onchain_balance?: number;
}
interface GetInfoResult {
    alias?: string;
    color?: string;
    pubkey?: string;
    network?: string;
    block_height?: number;
    block_hash?: string;
    methods: string[];
    notifications?: string[];
    bip321_methods?: Array<{
        method: string;
        address_types?: string[];
    }>;
}
interface EstimateOnchainFeesResult {
    fees: Record<string, number>;
}
interface EstimateRoutingFeesParams {
    destination: string;
    amount: number;
}
interface EstimateRoutingFeesResult {
    fee: number;
    time_lock_delay: number;
}
interface MakeHoldInvoiceParams {
    amount: number;
    description?: string;
    description_hash?: string;
    expiry?: number;
    payment_hash: string;
    min_cltv_expiry_delta?: number;
}
type MakeHoldInvoiceResult = TransactionInfo;
interface SettleHoldInvoiceParams {
    preimage: string;
}
interface CancelHoldInvoiceParams {
    payment_hash: string;
}
interface SignMessageParams {
    message: string;
}
interface SignMessageResult {
    signature: string;
}
interface NwcClientOptions {
    pool?: AbstractSimplePool;
    timeoutMs?: number;
}
/**
 * NIP-47 Nostr Wallet Connect client.
 *
 * Takes an NwcSigner + relay pool, never owns keys.
 * Follows nostr-tools' BunkerSigner pattern.
 */
declare class NwcClient {
    private signer;
    private walletPubkey;
    private relayUrls;
    private pool;
    private ownsPool;
    private timeoutMs;
    private subscriptions;
    constructor(signer: NwcSigner, walletPubkey: string, relayUrls: string[], opts?: NwcClientOptions);
    /**
     * Factory: create NwcClient from a `nostr+walletconnect://` URI.
     * If the URI contains a `secret`, a SecretKeySigner is created automatically.
     */
    static fromURI(signer: NwcSigner, connectionString: string, opts?: NwcClientOptions): NwcClient;
    /**
     * Generic protocol method: encrypt → publish → subscribe → decrypt.
     * All typed convenience methods call this internally.
     */
    sendRequest(method: string, params?: Record<string, unknown>): Promise<NwcResponse>;
    getInfo(): Promise<GetInfoResult>;
    getBalance(): Promise<GetBalanceResult>;
    payInvoice(p: PayInvoiceParams): Promise<PayInvoiceResult>;
    payKeysend(p: PayKeysendParams): Promise<PayKeysendResult>;
    makeInvoice(p: MakeInvoiceParams): Promise<MakeInvoiceResult>;
    lookupInvoice(p: LookupInvoiceParams): Promise<LookupInvoiceResult>;
    listTransactions(p?: ListTransactionsParams): Promise<ListTransactionsResult>;
    payOffer(p: PayOfferParams): Promise<PayOfferResult>;
    makeOffer(p: MakeOfferParams): Promise<MakeOfferResult>;
    lookupOffer(p: LookupOfferParams): Promise<LookupOfferResult>;
    payOnchain(p: PayOnchainParams): Promise<PayOnchainResult>;
    makeNewAddress(p?: MakeNewAddressParams): Promise<MakeNewAddressResult>;
    lookupAddress(p: LookupAddressParams): Promise<LookupAddressResult>;
    payBip321(p: PayBip321Params): Promise<PayBip321Result>;
    makeBip321(p?: MakeBip321Params): Promise<MakeBip321Result>;
    estimateOnchainFees(): Promise<EstimateOnchainFeesResult>;
    estimateRoutingFees(p: EstimateRoutingFeesParams): Promise<EstimateRoutingFeesResult>;
    makeHoldInvoice(p: MakeHoldInvoiceParams): Promise<MakeHoldInvoiceResult>;
    settleHoldInvoice(p: SettleHoldInvoiceParams): Promise<void>;
    cancelHoldInvoice(p: CancelHoldInvoiceParams): Promise<void>;
    signMessage(p: SignMessageParams): Promise<SignMessageResult>;
    /**
     * Subscribe to NWC notification events (kind 23197).
     * Returns an unsubscribe function.
     */
    subscribeNotifications(handler: (n: NwcNotification) => void, types?: string[]): Promise<() => void>;
    close(): void;
}

export { type CancelHoldInvoiceParams, type EstimateOnchainFeesResult, type EstimateRoutingFeesParams, type EstimateRoutingFeesResult, type GetBalanceResult, type GetInfoResult, type ListTransactionsParams, type ListTransactionsResult, type LookupAddressParams, type LookupAddressResult, type LookupInvoiceParams, type LookupInvoiceResult, type LookupOfferParams, type LookupOfferResult, type MakeBip321Params, type MakeBip321Result, type MakeHoldInvoiceParams, type MakeHoldInvoiceResult, type MakeInvoiceParams, type MakeInvoiceResult, type MakeNewAddressParams, type MakeNewAddressResult, type MakeOfferParams, type MakeOfferResult, NWC_ERROR_CODES, NWC_INFO_KIND, NWC_NOTIFICATION_KIND, NWC_REQUEST_KIND, NWC_RESPONSE_KIND, NwcClient, type NwcClientOptions, NwcConnectionError, type NwcConnectionParams, NwcDecryptionError, type NwcErrorCode, type NwcNotification, NwcPublishError, NwcPublishTimeout, NwcReplyTimeout, NwcRequestError, type NwcResponse, NwcTimeoutError, NwcWalletError, type PayBip321Params, type PayBip321Result, type PayInvoiceParams, type PayInvoiceResult, type PayKeysendParams, type PayKeysendResult, type PayOfferParams, type PayOfferResult, type PayOnchainParams, type PayOnchainResult, type SettleHoldInvoiceParams, type SignMessageParams, type SignMessageResult, type TransactionInfo, parseConnectionString };
