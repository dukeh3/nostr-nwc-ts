"use strict";Object.defineProperty(exports, "__esModule", {value: true}); function _nullishCoalesce(lhs, rhsFn) { if (lhs != null) { return lhs; } else { return rhsFn(); } } function _optionalChain(ops) { let lastAccessLHS = undefined; let value = ops[0]; let i = 1; while (i < ops.length) { const op = ops[i]; const fn = ops[i + 1]; i += 2; if ((op === 'optionalAccess' || op === 'optionalCall') && value == null) { return undefined; } if (op === 'access' || op === 'optionalAccess') { lastAccessLHS = value; value = fn(value); } else if (op === 'call' || op === 'optionalCall') { value = fn((...args) => value.call(lastAccessLHS, ...args)); lastAccessLHS = undefined; } } return value; } var _class;




var _chunk3QTLLXZBcjs = require('./chunk-3QTLLXZB.cjs');

// nipXX.ts
var NNC_INFO_KIND = 13198;
var NNC_REQUEST_KIND = 23198;
var NNC_RESPONSE_KIND = 23199;
var NNC_NOTIFICATION_KIND = 23200;
var NNC_ERROR_CODES = [
  "RATE_LIMITED",
  "NOT_IMPLEMENTED",
  "RESTRICTED",
  "UNAUTHORIZED",
  "QUOTA_EXCEEDED",
  "NOT_FOUND",
  "INTERNAL",
  "OTHER",
  "CHANNEL_FAILED",
  "CONNECTION_FAILED"
];
function parseConnectionString(uri) {
  if (!uri.startsWith("nostr+nodecontrol://")) {
    throw new Error("Invalid NNC connection string: must start with nostr+nodecontrol://");
  }
  const pubkey = uri.slice("nostr+nodecontrol://".length).split("?")[0];
  if (!pubkey || pubkey.length !== 64) {
    throw new Error("Invalid NNC connection string: missing or invalid pubkey");
  }
  const url = new URL(uri.replace("nostr+nodecontrol://", "https://dummy/"));
  const relays = url.searchParams.getAll("relay");
  if (relays.length === 0) {
    throw new Error("Invalid NNC connection string: missing relay parameter");
  }
  return { pubkey, relays };
}
var DEFAULT_TIMEOUT_MS = 3e4;
var NncClient = (_class = class _NncClient {
  
  
  
  
  
  
  __init() {this.subscriptions = []}
  constructor(signer, servicePubkey, relayUrls, opts) {;_class.prototype.__init.call(this);
    this.signer = signer;
    this.servicePubkey = servicePubkey;
    this.relayUrls = relayUrls;
    this.timeoutMs = _nullishCoalesce(_optionalChain([opts, 'optionalAccess', _ => _.timeoutMs]), () => ( DEFAULT_TIMEOUT_MS));
    if (!_optionalChain([opts, 'optionalAccess', _2 => _2.pool])) {
      throw new Error("A pool instance is required. Pass { pool: new SimplePool() } in opts.");
    }
    this.pool = opts.pool;
    this.ownsPool = false;
  }
  /**
   * Factory: create NncClient from a `nostr+nodecontrol://` URI.
   */
  static fromURI(signer, connectionString, opts) {
    const params = parseConnectionString(connectionString);
    return new _NncClient(signer, params.pubkey, params.relays, opts);
  }
  /**
   * Generic protocol method: encrypt → publish → subscribe → decrypt.
   */
  async sendRequest(method, params = {}) {
    const plaintext = JSON.stringify({ method, params });
    const encrypted = await this.signer.nip44Encrypt(this.servicePubkey, plaintext);
    const event = await this.signer.signEvent({
      kind: NNC_REQUEST_KIND,
      created_at: Math.floor(Date.now() / 1e3),
      tags: [["p", this.servicePubkey]],
      content: encrypted
    });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        sub.close();
        reject(new (0, _chunk3QTLLXZBcjs.NwcReplyTimeout)(method));
      }, this.timeoutMs);
      const sub = this.pool.subscribeMany(
        this.relayUrls,
        {
          kinds: [NNC_RESPONSE_KIND],
          authors: [this.servicePubkey],
          "#e": [event.id]
        },
        {
          onevent: async (responseEvent) => {
            clearTimeout(timer);
            sub.close();
            try {
              const decrypted = await this.signer.nip44Decrypt(
                responseEvent.pubkey,
                responseEvent.content
              );
              const response = JSON.parse(decrypted);
              if (response.error) {
                reject(
                  new (0, _chunk3QTLLXZBcjs.NwcWalletError)(method, response.error.code, response.error.message)
                );
              } else {
                resolve(response);
              }
            } catch (err) {
              reject(
                new (0, _chunk3QTLLXZBcjs.NwcDecryptionError)(
                  method,
                  err instanceof Error ? err.message : String(err)
                )
              );
            }
          }
        }
      );
      const publishPromises = this.pool.publish(this.relayUrls, event);
      Promise.allSettled(publishPromises).then((results) => {
        const allFailed = results.every((r) => r.status === "rejected");
        if (allFailed) {
          clearTimeout(timer);
          sub.close();
          reject(new (0, _chunk3QTLLXZBcjs.NwcPublishError)(method, "All relays rejected the event"));
        }
      });
    });
  }
  // ─── Channel Management ───────────────────────────────────────────────
  async listChannels() {
    const r = await this.sendRequest("list_channels");
    return r.result;
  }
  async openChannel(p) {
    await this.sendRequest("open_channel", p);
  }
  async closeChannel(p) {
    await this.sendRequest("close_channel", p);
  }
  // ─── Peer Management ─────────────────────────────────────────────────
  async listPeers() {
    const r = await this.sendRequest("list_peers");
    return r.result;
  }
  async connectPeer(p) {
    await this.sendRequest("connect_peer", p);
  }
  async disconnectPeer(p) {
    await this.sendRequest("disconnect_peer", p);
  }
  // ─── Fees & Routing ───────────────────────────────────────────────────
  async getChannelFees(p) {
    const r = await this.sendRequest("get_channel_fees", _nullishCoalesce(p, () => ( {})));
    return r.result;
  }
  async setChannelFees(p) {
    await this.sendRequest("set_channel_fees", p);
  }
  async getForwardingHistory(p) {
    const r = await this.sendRequest("get_forwarding_history", _nullishCoalesce(p, () => ( {})));
    return r.result;
  }
  async getPendingHtlcs() {
    const r = await this.sendRequest("get_pending_htlcs");
    return r.result;
  }
  async queryRoutes(p) {
    const r = await this.sendRequest("query_routes", p);
    return r.result;
  }
  // ─── Network Graph ────────────────────────────────────────────────────
  async listNetworkNodes(p) {
    const r = await this.sendRequest("list_network_nodes", _nullishCoalesce(p, () => ( {})));
    return r.result;
  }
  async getNetworkStats() {
    const r = await this.sendRequest("get_network_stats");
    return r.result;
  }
  async getNetworkNode(p) {
    const r = await this.sendRequest("get_network_node", p);
    return r.result;
  }
  async getNetworkChannel(p) {
    const r = await this.sendRequest("get_network_channel", p);
    return r.result;
  }
  // ─── Notifications ────────────────────────────────────────────────────
  /**
   * Subscribe to NNC notification events (kind 23200).
   * Returns an unsubscribe function.
   */
  async subscribeNotifications(handler, types) {
    if (types && types.length > 0) {
      await this.sendRequest("subscribe_notifications", { types });
    }
    const userPubkey = await this.signer.getPublicKey();
    const sub = this.pool.subscribeMany(
      this.relayUrls,
      {
        kinds: [NNC_NOTIFICATION_KIND],
        authors: [this.servicePubkey],
        "#p": [userPubkey]
      },
      {
        onevent: async (event) => {
          try {
            const decrypted = await this.signer.nip44Decrypt(event.pubkey, event.content);
            const notification = JSON.parse(decrypted);
            handler(notification);
          } catch (e) {
          }
        }
      }
    );
    this.subscriptions.push(sub);
    return () => {
      sub.close();
      this.subscriptions = this.subscriptions.filter((s) => s !== sub);
    };
  }
  // ─── Lifecycle ────────────────────────────────────────────────────────
  close() {
    for (const sub of this.subscriptions) {
      sub.close();
    }
    this.subscriptions = [];
    if (this.ownsPool) {
      this.pool.close(this.relayUrls);
    }
  }
}, _class);









exports.NNC_INFO_KIND = NNC_INFO_KIND; exports.NNC_REQUEST_KIND = NNC_REQUEST_KIND; exports.NNC_RESPONSE_KIND = NNC_RESPONSE_KIND; exports.NNC_NOTIFICATION_KIND = NNC_NOTIFICATION_KIND; exports.NNC_ERROR_CODES = NNC_ERROR_CODES; exports.parseConnectionString = parseConnectionString; exports.NncClient = NncClient;
//# sourceMappingURL=chunk-GZ6KDHEE.cjs.map