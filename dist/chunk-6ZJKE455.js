// nip47.ts
var NWC_INFO_KIND = 13194;
var NWC_REQUEST_KIND = 23194;
var NWC_RESPONSE_KIND = 23195;
var NWC_NOTIFICATION_KIND = 23197;
var NwcRequestError = class extends Error {
  constructor(method, code, message) {
    super(message);
    this.method = method;
    this.code = code;
    this.name = "NwcRequestError";
  }
  method;
  code;
};
var NwcWalletError = class extends NwcRequestError {
  constructor(method, code, message) {
    super(method, code, message);
    this.name = "NwcWalletError";
  }
};
var NwcTimeoutError = class extends NwcRequestError {
  constructor(method, message) {
    super(method, "TIMEOUT", message);
    this.name = "NwcTimeoutError";
  }
};
var NwcPublishTimeout = class extends NwcTimeoutError {
  constructor(method) {
    super(method, `Publish timeout: ${method}`);
    this.name = "NwcPublishTimeout";
  }
};
var NwcReplyTimeout = class extends NwcTimeoutError {
  constructor(method) {
    super(method, `Reply timeout: ${method}`);
    this.name = "NwcReplyTimeout";
  }
};
var NwcPublishError = class extends NwcRequestError {
  constructor(method, reason) {
    super(method, "PUBLISH_FAILED", reason);
    this.name = "NwcPublishError";
  }
};
var NwcConnectionError = class extends NwcRequestError {
  constructor(method, reason) {
    super(method, "CONNECTION_FAILED", reason);
    this.name = "NwcConnectionError";
  }
};
var NwcDecryptionError = class extends NwcRequestError {
  constructor(method, reason) {
    super(method, "DECRYPTION_FAILED", reason);
    this.name = "NwcDecryptionError";
  }
};
var NWC_ERROR_CODES = [
  "RATE_LIMITED",
  "NOT_IMPLEMENTED",
  "INSUFFICIENT_BALANCE",
  "QUOTA_EXCEEDED",
  "RESTRICTED",
  "UNAUTHORIZED",
  "INTERNAL",
  "UNSUPPORTED_ENCRYPTION",
  "OTHER",
  "PAYMENT_FAILED",
  "NOT_FOUND"
];
function parseConnectionString(uri) {
  if (!uri.startsWith("nostr+walletconnect://")) {
    throw new Error("Invalid NWC connection string: must start with nostr+walletconnect://");
  }
  const url = new URL(uri.replace("nostr+walletconnect://", "https://dummy/"));
  const pubkey = uri.slice("nostr+walletconnect://".length).split("?")[0];
  if (!pubkey || pubkey.length !== 64) {
    throw new Error("Invalid NWC connection string: missing or invalid pubkey");
  }
  const relays = url.searchParams.getAll("relay");
  if (relays.length === 0) {
    throw new Error("Invalid NWC connection string: missing relay parameter");
  }
  const secret = url.searchParams.get("secret") ?? void 0;
  const lud16 = url.searchParams.get("lud16") ?? void 0;
  return { pubkey, relays, secret, lud16 };
}
var DEFAULT_TIMEOUT_MS = 3e4;
var NwcClient = class _NwcClient {
  signer;
  walletPubkey;
  relayUrls;
  pool;
  ownsPool;
  timeoutMs;
  subscriptions = [];
  constructor(signer, walletPubkey, relayUrls, opts) {
    this.signer = signer;
    this.walletPubkey = walletPubkey;
    this.relayUrls = relayUrls;
    this.timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!opts?.pool) {
      throw new Error("A pool instance is required. Pass { pool: new SimplePool() } in opts.");
    }
    this.pool = opts.pool;
    this.ownsPool = false;
  }
  /**
   * Factory: create NwcClient from a `nostr+walletconnect://` URI.
   * If the URI contains a `secret`, a SecretKeySigner is created automatically.
   */
  static fromURI(signer, connectionString, opts) {
    const params = parseConnectionString(connectionString);
    return new _NwcClient(signer, params.pubkey, params.relays, opts);
  }
  /**
   * Generic protocol method: encrypt → publish → subscribe → decrypt.
   * All typed convenience methods call this internally.
   */
  async sendRequest(method, params = {}) {
    const plaintext = JSON.stringify({ method, params });
    const encrypted = await this.signer.nip44Encrypt(this.walletPubkey, plaintext);
    const event = await this.signer.signEvent({
      kind: NWC_REQUEST_KIND,
      created_at: Math.floor(Date.now() / 1e3),
      tags: [["p", this.walletPubkey]],
      content: encrypted
    });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        sub.close();
        reject(new NwcReplyTimeout(method));
      }, this.timeoutMs);
      const sub = this.pool.subscribeMany(
        this.relayUrls,
        {
          kinds: [NWC_RESPONSE_KIND],
          authors: [this.walletPubkey],
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
                  new NwcWalletError(method, response.error.code, response.error.message)
                );
              } else {
                resolve(response);
              }
            } catch (err) {
              reject(
                new NwcDecryptionError(
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
          reject(new NwcPublishError(method, "All relays rejected the event"));
        }
      });
    });
  }
  // ─── Typed NIP-47 Methods ──────────────────────────────────────────────
  async getInfo() {
    const r = await this.sendRequest("get_info");
    return r.result;
  }
  async getBalance() {
    const r = await this.sendRequest("get_balance");
    return r.result;
  }
  async payInvoice(p) {
    const r = await this.sendRequest("pay_invoice", p);
    return r.result;
  }
  async payKeysend(p) {
    const r = await this.sendRequest("pay_keysend", p);
    return r.result;
  }
  async makeInvoice(p) {
    const r = await this.sendRequest("make_invoice", p);
    return r.result;
  }
  async lookupInvoice(p) {
    const r = await this.sendRequest("lookup_invoice", p);
    return r.result;
  }
  async listTransactions(p) {
    const r = await this.sendRequest("list_transactions", p ?? {});
    return r.result;
  }
  async payOffer(p) {
    const r = await this.sendRequest("pay_offer", p);
    return r.result;
  }
  async makeOffer(p) {
    const r = await this.sendRequest("make_offer", p);
    return r.result;
  }
  async lookupOffer(p) {
    const r = await this.sendRequest("lookup_offer", p);
    return r.result;
  }
  async payOnchain(p) {
    const r = await this.sendRequest("pay_onchain", p);
    return r.result;
  }
  async makeNewAddress(p) {
    const r = await this.sendRequest("make_new_address", p ?? {});
    return r.result;
  }
  async lookupAddress(p) {
    const r = await this.sendRequest("lookup_address", p);
    return r.result;
  }
  async payBip321(p) {
    const r = await this.sendRequest("pay_bip321", p);
    return r.result;
  }
  async makeBip321(p) {
    const r = await this.sendRequest("make_bip321", p ?? {});
    return r.result;
  }
  async estimateOnchainFees() {
    const r = await this.sendRequest("estimate_onchain_fees");
    return r.result;
  }
  async estimateRoutingFees(p) {
    const r = await this.sendRequest("estimate_routing_fees", p);
    return r.result;
  }
  async makeHoldInvoice(p) {
    const r = await this.sendRequest("make_hold_invoice", p);
    return r.result;
  }
  async settleHoldInvoice(p) {
    await this.sendRequest("settle_hold_invoice", p);
  }
  async cancelHoldInvoice(p) {
    await this.sendRequest("cancel_hold_invoice", p);
  }
  async signMessage(p) {
    const r = await this.sendRequest("sign_message", p);
    return r.result;
  }
  // ─── Notifications ────────────────────────────────────────────────────
  /**
   * Subscribe to NWC notification events (kind 23197).
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
        kinds: [NWC_NOTIFICATION_KIND],
        authors: [this.walletPubkey],
        "#p": [userPubkey]
      },
      {
        onevent: async (event) => {
          try {
            const decrypted = await this.signer.nip44Decrypt(event.pubkey, event.content);
            const notification = JSON.parse(decrypted);
            handler(notification);
          } catch {
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
};

export {
  NWC_INFO_KIND,
  NWC_REQUEST_KIND,
  NWC_RESPONSE_KIND,
  NWC_NOTIFICATION_KIND,
  NwcRequestError,
  NwcWalletError,
  NwcTimeoutError,
  NwcPublishTimeout,
  NwcReplyTimeout,
  NwcPublishError,
  NwcConnectionError,
  NwcDecryptionError,
  NWC_ERROR_CODES,
  parseConnectionString,
  NwcClient
};
//# sourceMappingURL=chunk-6ZJKE455.js.map