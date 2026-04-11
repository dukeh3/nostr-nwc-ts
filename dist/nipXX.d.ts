import { AbstractSimplePool } from 'nostr-tools/abstract-pool';
import { N as NwcSigner } from './types-CsbyBm-P.js';
import 'nostr-tools/signer';

/**
 * NIP-XX — Nostr Node Control (NNC) protocol module.
 *
 * Follows the same pattern as nip47.ts. Self-contained: only imports from
 * nostr-tools. Can be copied into a nostr-tools PR when NNC gets a NIP number.
 *
 * @module nipXX
 */

declare const NNC_INFO_KIND = 13198;
declare const NNC_REQUEST_KIND = 23198;
declare const NNC_RESPONSE_KIND = 23199;
declare const NNC_NOTIFICATION_KIND = 23200;
declare const NNC_ERROR_CODES: readonly ["RATE_LIMITED", "NOT_IMPLEMENTED", "RESTRICTED", "UNAUTHORIZED", "QUOTA_EXCEEDED", "NOT_FOUND", "INTERNAL", "OTHER", "CHANNEL_FAILED", "CONNECTION_FAILED"];
type NncErrorCode = (typeof NNC_ERROR_CODES)[number];
interface NncResponse {
    result_type: string;
    result?: Record<string, unknown>;
    error?: {
        code: string;
        message: string;
    };
}
interface NncNotification {
    notification_type: string;
    notification: Record<string, unknown>;
}
interface NncConnectionParams {
    pubkey: string;
    relays: string[];
}
/**
 * Parse a `nostr+nodecontrol://` connection URI.
 */
declare function parseConnectionString(uri: string): NncConnectionParams;
interface ChannelInfo {
    id: string;
    short_channel_id?: string;
    peer_pubkey: string;
    state: 'active' | 'inactive' | 'pending_open' | 'pending_close' | 'force_closing';
    is_private: boolean;
    local_balance: number;
    remote_balance: number;
    capacity: number;
    funding_txid: string;
    funding_output_index: number;
}
interface ListChannelsResult {
    channels: ChannelInfo[];
}
interface OpenChannelParams {
    pubkey: string;
    amount: number;
    push_amount?: number;
    private?: boolean;
    host?: string;
    close_address?: string;
    notify?: boolean;
}
interface CloseChannelParams {
    id: string;
    force?: boolean;
    close_address?: string;
    notify?: boolean;
}
interface PeerInfo {
    pubkey: string;
    address: string;
    connected: boolean;
    alias?: string;
    num_channels: number;
}
interface ListPeersResult {
    peers: PeerInfo[];
}
interface ConnectPeerParams {
    pubkey: string;
    host: string;
}
interface DisconnectPeerParams {
    pubkey: string;
}
interface ChannelFeeInfo {
    id: string;
    short_channel_id?: string;
    peer_pubkey: string;
    base_fee_msat: number;
    fee_rate: number;
    min_htlc_msat?: number;
    max_htlc_msat?: number;
}
interface GetChannelFeesParams {
    id?: string;
}
interface GetChannelFeesResult {
    fees: ChannelFeeInfo[];
}
interface SetChannelFeesParams {
    id?: string;
    base_fee_msat?: number;
    fee_rate?: number;
    min_htlc_msat?: number;
    max_htlc_msat?: number;
}
interface GetForwardingHistoryParams {
    from?: number;
    until?: number;
    limit?: number;
    offset?: number;
}
interface ForwardInfo {
    incoming_channel_id: string;
    outgoing_channel_id: string;
    incoming_amount: number;
    outgoing_amount: number;
    fee_earned: number;
    settled_at: number;
}
interface GetForwardingHistoryResult {
    forwards: ForwardInfo[];
}
interface HtlcInfo {
    channel_id: string;
    direction: 'incoming' | 'outgoing';
    amount: number;
    hash_lock: string;
    expiry_height: number;
}
interface GetPendingHtlcsResult {
    htlcs: HtlcInfo[];
}
interface QueryRoutesParams {
    destination: string;
    amount: number;
    max_routes?: number;
}
interface RouteHop {
    pubkey: string;
    short_channel_id: string;
    fee: number;
    expiry: number;
}
interface RouteInfo {
    total_fee: number;
    total_time_lock: number;
    hops: RouteHop[];
}
interface QueryRoutesResult {
    routes: RouteInfo[];
}
interface NetworkNodeInfo {
    pubkey: string;
    alias?: string;
    color?: string;
    num_channels: number;
    total_capacity: number;
    addresses?: string[];
    last_update: number;
    features?: Record<string, unknown>;
}
interface ListNetworkNodesParams {
    limit?: number;
    offset?: number;
}
interface ListNetworkNodesResult {
    nodes: NetworkNodeInfo[];
}
interface GetNetworkStatsResult {
    num_nodes: number;
    num_channels: number;
    total_capacity: number;
    avg_channel_size: number;
    max_channel_size: number;
}
interface GetNetworkNodeParams {
    pubkey: string;
}
type GetNetworkNodeResult = NetworkNodeInfo;
interface ChannelPolicy {
    base_fee_msat: number;
    fee_rate: number;
    min_htlc_msat: number;
    max_htlc_msat: number;
    time_lock_delta: number;
    disabled: boolean;
    last_update: number;
}
interface GetNetworkChannelParams {
    short_channel_id: string;
}
interface GetNetworkChannelResult {
    short_channel_id: string;
    capacity: number;
    node1_pubkey: string;
    node2_pubkey: string;
    node1_policy?: ChannelPolicy;
    node2_policy?: ChannelPolicy;
}
interface NncClientOptions {
    pool?: AbstractSimplePool;
    timeoutMs?: number;
}
/**
 * NIP-XX Nostr Node Control client.
 *
 * Same pattern as NwcClient. Takes signer + pool, never owns keys.
 */
declare class NncClient {
    private signer;
    private servicePubkey;
    private relayUrls;
    private pool;
    private ownsPool;
    private timeoutMs;
    private subscriptions;
    constructor(signer: NwcSigner, servicePubkey: string, relayUrls: string[], opts?: NncClientOptions);
    /**
     * Factory: create NncClient from a `nostr+nodecontrol://` URI.
     */
    static fromURI(signer: NwcSigner, connectionString: string, opts?: NncClientOptions): NncClient;
    /**
     * Generic protocol method: encrypt → publish → subscribe → decrypt.
     */
    sendRequest(method: string, params?: Record<string, unknown>): Promise<NncResponse>;
    listChannels(): Promise<ListChannelsResult>;
    openChannel(p: OpenChannelParams): Promise<void>;
    closeChannel(p: CloseChannelParams): Promise<void>;
    listPeers(): Promise<ListPeersResult>;
    connectPeer(p: ConnectPeerParams): Promise<void>;
    disconnectPeer(p: DisconnectPeerParams): Promise<void>;
    getChannelFees(p?: GetChannelFeesParams): Promise<GetChannelFeesResult>;
    setChannelFees(p: SetChannelFeesParams): Promise<void>;
    getForwardingHistory(p?: GetForwardingHistoryParams): Promise<GetForwardingHistoryResult>;
    getPendingHtlcs(): Promise<GetPendingHtlcsResult>;
    queryRoutes(p: QueryRoutesParams): Promise<QueryRoutesResult>;
    listNetworkNodes(p?: ListNetworkNodesParams): Promise<ListNetworkNodesResult>;
    getNetworkStats(): Promise<GetNetworkStatsResult>;
    getNetworkNode(p: GetNetworkNodeParams): Promise<GetNetworkNodeResult>;
    getNetworkChannel(p: GetNetworkChannelParams): Promise<GetNetworkChannelResult>;
    /**
     * Subscribe to NNC notification events (kind 23200).
     * Returns an unsubscribe function.
     */
    subscribeNotifications(handler: (n: NncNotification) => void, types?: string[]): Promise<() => void>;
    close(): void;
}

export { type ChannelFeeInfo, type ChannelInfo, type ChannelPolicy, type CloseChannelParams, type ConnectPeerParams, type DisconnectPeerParams, type ForwardInfo, type GetChannelFeesParams, type GetChannelFeesResult, type GetForwardingHistoryParams, type GetForwardingHistoryResult, type GetNetworkChannelParams, type GetNetworkChannelResult, type GetNetworkNodeParams, type GetNetworkNodeResult, type GetNetworkStatsResult, type GetPendingHtlcsResult, type HtlcInfo, type ListChannelsResult, type ListNetworkNodesParams, type ListNetworkNodesResult, type ListPeersResult, NNC_ERROR_CODES, NNC_INFO_KIND, NNC_NOTIFICATION_KIND, NNC_REQUEST_KIND, NNC_RESPONSE_KIND, type NetworkNodeInfo, NncClient, type NncClientOptions, type NncConnectionParams, type NncErrorCode, type NncNotification, type NncResponse, type OpenChannelParams, type PeerInfo, type QueryRoutesParams, type QueryRoutesResult, type RouteHop, type RouteInfo, type SetChannelFeesParams, parseConnectionString };
