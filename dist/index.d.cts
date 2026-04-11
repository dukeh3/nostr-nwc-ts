export { CancelHoldInvoiceParams, EstimateOnchainFeesResult, EstimateRoutingFeesParams, EstimateRoutingFeesResult, GetBalanceResult, GetInfoResult, ListTransactionsParams, ListTransactionsResult, LookupAddressParams, LookupAddressResult, LookupInvoiceParams, LookupInvoiceResult, LookupOfferParams, LookupOfferResult, MakeBip321Params, MakeBip321Result, MakeHoldInvoiceParams, MakeHoldInvoiceResult, MakeInvoiceParams, MakeInvoiceResult, MakeNewAddressParams, MakeNewAddressResult, MakeOfferParams, MakeOfferResult, NWC_ERROR_CODES, NWC_INFO_KIND, NWC_NOTIFICATION_KIND, NWC_REQUEST_KIND, NWC_RESPONSE_KIND, NwcClient, NwcClientOptions, NwcConnectionError, NwcConnectionParams, NwcDecryptionError, NwcErrorCode, NwcNotification, NwcPublishError, NwcPublishTimeout, NwcReplyTimeout, NwcRequestError, NwcResponse, NwcTimeoutError, NwcWalletError, PayBip321Params, PayBip321Result, PayInvoiceParams, PayInvoiceResult, PayKeysendParams, PayKeysendResult, PayOfferParams, PayOfferResult, PayOnchainParams, PayOnchainResult, SettleHoldInvoiceParams, SignMessageParams, SignMessageResult, TransactionInfo, parseConnectionString } from './nip47.cjs';
export { ChannelFeeInfo, ChannelInfo, ChannelPolicy, CloseChannelParams, ConnectPeerParams, DisconnectPeerParams, ForwardInfo, GetChannelFeesParams, GetChannelFeesResult, GetForwardingHistoryParams, GetForwardingHistoryResult, GetNetworkChannelParams, GetNetworkChannelResult, GetNetworkNodeParams, GetNetworkNodeResult, GetNetworkStatsResult, GetPendingHtlcsResult, HtlcInfo, ListChannelsResult, ListNetworkNodesParams, ListNetworkNodesResult, ListPeersResult, NNC_ERROR_CODES, NNC_INFO_KIND, NNC_NOTIFICATION_KIND, NNC_REQUEST_KIND, NNC_RESPONSE_KIND, NetworkNodeInfo, NncClient, NncClientOptions, NncConnectionParams, NncErrorCode, NncNotification, NncResponse, OpenChannelParams, PeerInfo, QueryRoutesParams, QueryRoutesResult, RouteHop, RouteInfo, SetChannelFeesParams, parseConnectionString as parseNncConnectionString } from './nipXX.cjs';
import { N as NwcSigner } from './types-CsbyBm-P.cjs';
import { EventTemplate, VerifiedEvent } from 'nostr-tools/core';
import 'nostr-tools/abstract-pool';
import 'nostr-tools/signer';

/**
 * Signer that wraps a raw secret key. Uses nostr-tools finalizeEvent + nip44.
 * Caches NIP-44 conversation keys per pubkey for performance.
 *
 * Suitable for Node.js, backend, and CLI usage where the secret key is available.
 */
declare class SecretKeySigner implements NwcSigner {
    private secretKey;
    private pubkey;
    private conversationKeys;
    constructor(secretKey: Uint8Array);
    getPublicKey(): Promise<string>;
    signEvent(event: EventTemplate): Promise<VerifiedEvent>;
    nip44Encrypt(pubkey: string, plaintext: string): Promise<string>;
    nip44Decrypt(pubkey: string, ciphertext: string): Promise<string>;
    private getConversationKey;
}

/**
 * Signer that delegates to a NIP-07 browser extension (Alby, nos2x, etc.).
 * Throws if the extension doesn't support NIP-44.
 */
declare class Nip07Signer implements NwcSigner {
    getPublicKey(): Promise<string>;
    signEvent(event: EventTemplate): Promise<VerifiedEvent>;
    nip44Encrypt(pubkey: string, plaintext: string): Promise<string>;
    nip44Decrypt(pubkey: string, ciphertext: string): Promise<string>;
}

/**
 * Transport interface for relay communication.
 * The default NwcClient uses nostr-tools SimplePool directly.
 * BrowserTransport adds auto-reconnect, heartbeat, and throttling.
 */
interface Transport {
    /** Send raw JSON frame to the relay. */
    send(frame: string): void;
    /** Register handler for incoming frames. */
    onMessage(handler: (data: string) => void): void;
    /** Whether the transport is currently connected. */
    readonly connected: boolean;
    /** Connect to the relay. */
    connect(): Promise<void>;
    /** Disconnect from the relay. */
    disconnect(): void;
}

interface BrowserTransportOptions {
    connectTimeoutMs?: number;
    reconnectBaseMs?: number;
    reconnectMaxMs?: number;
    heartbeatIntervalMs?: number;
    maxConcurrentRequests?: number;
}
/**
 * Browser WebSocket transport with auto-reconnect, heartbeat, and throttling.
 *
 * Adapted from LP's NostrNodeClient — provides the connection management
 * layer that SimplePool doesn't offer.
 */
declare class BrowserTransport implements Transport {
    private relayUrl;
    private ws;
    private messageHandlers;
    private connectionListeners;
    private connectPromise;
    private reconnectAttempt;
    private reconnectTimer;
    private heartbeatTimer;
    private disconnectedByUser;
    private inFlight;
    private queue;
    private connectTimeoutMs;
    private reconnectBaseMs;
    private reconnectMaxMs;
    private heartbeatIntervalMs;
    private maxConcurrentRequests;
    constructor(relayUrl: string, opts?: BrowserTransportOptions);
    get connected(): boolean;
    onMessage(handler: (data: string) => void): void;
    onConnectionChange(listener: (connected: boolean) => void): () => void;
    connect(): Promise<void>;
    send(frame: string): void;
    /**
     * Send with throttling — waits if too many requests are in-flight.
     * Returns a release function the caller MUST invoke when the request completes.
     */
    sendThrottled(frame: string): Promise<() => void>;
    disconnect(): void;
    /**
     * Pre-connect WebSocket. Safe to call multiple times.
     */
    preconnect(): void;
    private ensureConnection;
    private startHeartbeat;
    private stopHeartbeat;
    private scheduleReconnect;
    private notifyConnectionChange;
}

interface UsageProfile {
    methods?: Record<string, Record<string, unknown>>;
    control?: Record<string, Record<string, unknown>>;
    quota?: {
        rate_per_micro?: number;
        max_capacity?: number;
    };
}
/**
 * Verifies kind 30078 access grants for NWC/NNC.
 *
 * Fetches grant events from the relay and checks:
 * 1. Does a grant exist for this caller pubkey?
 * 2. Is the requested method allowed?
 * 3. Is the grant signed by a known owner?
 */
declare class GrantVerifier {
    private relayUrl;
    private servicePubkey;
    private cache;
    private subscriberCache;
    constructor(relayUrl: string, servicePubkey: string);
    /**
     * Check if a caller pubkey is authorized to call the given method.
     * Returns null if authorized, or an error message string if denied.
     */
    checkAccess(callerPubkey: string, method: string, isControl: boolean): Promise<string | null>;
    /**
     * Fetch all pubkeys that have grants for this service.
     * Used by bridges to know who to encrypt notification events for.
     */
    getSubscriberPubkeys(): Promise<string[]>;
    clearCache(): void;
    private getGrant;
    private fetchGrantFromRelay;
    private fetchSubscribersFromRelay;
}
/**
 * Publish a kind 30078 grant event for access control.
 */
declare function publishGrant(signer: NwcSigner, relayUrl: string, servicePubkey: string, controllerPubkey: string, profile: UsageProfile): Promise<string>;

/**
 * Structured event emitter for SDK diagnostics.
 * Replaces LP's pushConsoleLog() with typed events.
 */
interface TransportEvent {
    type: 'request' | 'response' | 'notification' | 'error' | 'connection';
    timestamp: number;
    method?: string;
    servicePubkey?: string;
    kind?: number;
    latencyMs?: number;
    error?: string;
    eventId?: string;
}
type EventHandler = (event: TransportEvent) => void;
declare class TransportEventEmitter {
    private handlers;
    on(handler: EventHandler): () => void;
    emit(event: Omit<TransportEvent, 'timestamp'>): void;
    removeAllListeners(): void;
}

export { BrowserTransport, type BrowserTransportOptions, GrantVerifier, Nip07Signer, NwcSigner, SecretKeySigner, type Transport, type TransportEvent, TransportEventEmitter, type UsageProfile, publishGrant };
