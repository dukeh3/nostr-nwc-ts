import {
  NNC_ERROR_CODES,
  NNC_INFO_KIND,
  NNC_NOTIFICATION_KIND,
  NNC_REQUEST_KIND,
  NNC_RESPONSE_KIND,
  NncClient,
  parseConnectionString as parseConnectionString2
} from "./chunk-UTSCKCML.js";
import {
  NWC_ERROR_CODES,
  NWC_INFO_KIND,
  NWC_NOTIFICATION_KIND,
  NWC_REQUEST_KIND,
  NWC_RESPONSE_KIND,
  NwcClient,
  NwcConnectionError,
  NwcDecryptionError,
  NwcPublishError,
  NwcPublishTimeout,
  NwcReplyTimeout,
  NwcRequestError,
  NwcTimeoutError,
  NwcWalletError,
  parseConnectionString
} from "./chunk-6ZJKE455.js";

// src/signer/secret-key.ts
import { finalizeEvent, getPublicKey } from "nostr-tools/pure";
import * as nip44 from "nostr-tools/nip44";
var SecretKeySigner = class {
  secretKey;
  pubkey;
  conversationKeys = /* @__PURE__ */ new Map();
  constructor(secretKey) {
    this.secretKey = secretKey;
    this.pubkey = getPublicKey(secretKey);
  }
  async getPublicKey() {
    return this.pubkey;
  }
  async signEvent(event) {
    return finalizeEvent(event, this.secretKey);
  }
  async nip44Encrypt(pubkey, plaintext) {
    return nip44.encrypt(plaintext, this.getConversationKey(pubkey));
  }
  async nip44Decrypt(pubkey, ciphertext) {
    return nip44.decrypt(ciphertext, this.getConversationKey(pubkey));
  }
  getConversationKey(pubkey) {
    let key = this.conversationKeys.get(pubkey);
    if (!key) {
      key = nip44.getConversationKey(this.secretKey, pubkey);
      this.conversationKeys.set(pubkey, key);
    }
    return key;
  }
};

// src/signer/nip07.ts
function getNip07Extension() {
  const ext = globalThis.nostr;
  if (!ext) {
    throw new Error(
      "No Nostr extension detected. Install Alby, nos2x, or another NIP-07 signer."
    );
  }
  return ext;
}
var Nip07Signer = class {
  async getPublicKey() {
    return getNip07Extension().getPublicKey();
  }
  async signEvent(event) {
    return getNip07Extension().signEvent(event);
  }
  async nip44Encrypt(pubkey, plaintext) {
    const ext = getNip07Extension();
    if (!ext.nip44?.encrypt) {
      throw new Error("Extension does not support NIP-44 encryption");
    }
    return ext.nip44.encrypt(pubkey, plaintext);
  }
  async nip44Decrypt(pubkey, ciphertext) {
    const ext = getNip07Extension();
    if (!ext.nip44?.decrypt) {
      throw new Error("Extension does not support NIP-44 decryption");
    }
    return ext.nip44.decrypt(pubkey, ciphertext);
  }
};

// src/transport/browser.ts
var CONNECT_TIMEOUT_MS = 5e3;
var RECONNECT_BASE_MS = 1e3;
var RECONNECT_MAX_MS = 3e4;
var HEARTBEAT_INTERVAL_MS = 3e4;
var MAX_CONCURRENT_REQUESTS = 6;
var BrowserTransport = class {
  relayUrl;
  ws = null;
  messageHandlers = /* @__PURE__ */ new Set();
  connectionListeners = /* @__PURE__ */ new Set();
  connectPromise = null;
  reconnectAttempt = 0;
  reconnectTimer = null;
  heartbeatTimer = null;
  disconnectedByUser = false;
  inFlight = 0;
  queue = [];
  // Configurable
  connectTimeoutMs;
  reconnectBaseMs;
  reconnectMaxMs;
  heartbeatIntervalMs;
  maxConcurrentRequests;
  constructor(relayUrl, opts) {
    this.relayUrl = relayUrl;
    this.connectTimeoutMs = opts?.connectTimeoutMs ?? CONNECT_TIMEOUT_MS;
    this.reconnectBaseMs = opts?.reconnectBaseMs ?? RECONNECT_BASE_MS;
    this.reconnectMaxMs = opts?.reconnectMaxMs ?? RECONNECT_MAX_MS;
    this.heartbeatIntervalMs = opts?.heartbeatIntervalMs ?? HEARTBEAT_INTERVAL_MS;
    this.maxConcurrentRequests = opts?.maxConcurrentRequests ?? MAX_CONCURRENT_REQUESTS;
  }
  get connected() {
    return this.ws?.readyState === WebSocket.OPEN;
  }
  onMessage(handler) {
    this.messageHandlers.add(handler);
  }
  onConnectionChange(listener) {
    this.connectionListeners.add(listener);
    return () => this.connectionListeners.delete(listener);
  }
  async connect() {
    await this.ensureConnection();
  }
  send(frame) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("WebSocket not connected");
    }
    this.ws.send(frame);
  }
  /**
   * Send with throttling — waits if too many requests are in-flight.
   * Returns a release function the caller MUST invoke when the request completes.
   */
  async sendThrottled(frame) {
    if (this.inFlight >= this.maxConcurrentRequests) {
      await new Promise((resolve) => this.queue.push(resolve));
    }
    this.inFlight++;
    const ws = await this.ensureConnection();
    ws.send(frame);
    return () => {
      this.inFlight--;
      this.queue.shift()?.();
    };
  }
  disconnect() {
    this.disconnectedByUser = true;
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    for (const resolve of this.queue) {
      resolve();
    }
    this.queue = [];
    this.inFlight = 0;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
  /**
   * Pre-connect WebSocket. Safe to call multiple times.
   */
  preconnect() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return;
    this.ensureConnection().catch(() => {
    });
  }
  // ─── Internals ─────────────────────────────────────────────────────────
  async ensureConnection() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return this.ws;
    }
    if (this.connectPromise) return this.connectPromise;
    this.disconnectedByUser = false;
    this.connectPromise = new Promise((resolve, reject) => {
      if (this.ws && this.ws.readyState === WebSocket.CONNECTING) {
        try {
          this.ws.close();
        } catch {
        }
      }
      const ws = new WebSocket(this.relayUrl);
      this.ws = ws;
      ws.onopen = () => {
        this.reconnectAttempt = 0;
        this.startHeartbeat(ws);
        this.notifyConnectionChange(true);
        resolve(ws);
      };
      ws.onerror = () => {
        reject(new Error(`Relay connection failed: ${this.relayUrl}`));
      };
      ws.onclose = () => {
        this.stopHeartbeat();
        this.ws = null;
        this.notifyConnectionChange(false);
        if (!this.disconnectedByUser) {
          this.scheduleReconnect();
        }
      };
      ws.onmessage = (event) => {
        const data = event.data;
        for (const handler of this.messageHandlers) {
          handler(data);
        }
      };
      setTimeout(() => {
        if (ws.readyState !== WebSocket.OPEN) {
          reject(new Error("Relay connection timeout"));
        }
      }, this.connectTimeoutMs);
    }).finally(() => {
      this.connectPromise = null;
    });
    return this.connectPromise;
  }
  startHeartbeat(ws) {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (ws.readyState !== WebSocket.OPEN) return;
      try {
        ws.send(JSON.stringify(["REQ", "hb", { kinds: [0], limit: 0, since: 2147483647 }]));
        ws.send(JSON.stringify(["CLOSE", "hb"]));
      } catch {
        ws.close();
      }
    }, this.heartbeatIntervalMs);
  }
  stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
  scheduleReconnect() {
    if (this.reconnectTimer) return;
    const delay = Math.min(
      this.reconnectBaseMs * 2 ** this.reconnectAttempt,
      this.reconnectMaxMs
    );
    this.reconnectAttempt++;
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      try {
        await this.ensureConnection();
      } catch {
      }
    }, delay);
  }
  notifyConnectionChange(connected) {
    for (const listener of this.connectionListeners) {
      listener(connected);
    }
  }
};

// src/grant.ts
var GRANT_KIND = 30078;
var GRANT_CACHE_TTL = 6e4;
var GrantVerifier = class {
  relayUrl;
  servicePubkey;
  cache = /* @__PURE__ */ new Map();
  subscriberCache = null;
  constructor(relayUrl, servicePubkey) {
    this.relayUrl = relayUrl;
    this.servicePubkey = servicePubkey;
  }
  /**
   * Check if a caller pubkey is authorized to call the given method.
   * Returns null if authorized, or an error message string if denied.
   */
  async checkAccess(callerPubkey, method, isControl) {
    const profile = await this.getGrant(callerPubkey);
    if (!profile) {
      return `No access grant found for pubkey ${callerPubkey.substring(0, 8)}...`;
    }
    if (isControl) {
      if (!profile.control) {
        return `No control access granted for pubkey ${callerPubkey.substring(0, 8)}...`;
      }
      if (!(method in profile.control) && !("ALL" in profile.control)) {
        return `Method '${method}' not in control grant for ${callerPubkey.substring(0, 8)}...`;
      }
    } else {
      if (profile.methods !== void 0) {
        if (Object.keys(profile.methods).length === 0) {
          return `Empty methods grant \u2014 no wallet access for ${callerPubkey.substring(0, 8)}...`;
        }
        if (!(method in profile.methods) && !("ALL" in profile.methods)) {
          return `Method '${method}' not in wallet grant for ${callerPubkey.substring(0, 8)}...`;
        }
      }
    }
    return null;
  }
  /**
   * Fetch all pubkeys that have grants for this service.
   * Used by bridges to know who to encrypt notification events for.
   */
  async getSubscriberPubkeys() {
    if (this.subscriberCache && Date.now() - this.subscriberCache.fetchedAt < GRANT_CACHE_TTL) {
      return this.subscriberCache.pubkeys;
    }
    try {
      const pubkeys = await this.fetchSubscribersFromRelay();
      this.subscriberCache = { pubkeys, fetchedAt: Date.now() };
      return pubkeys;
    } catch {
      return this.subscriberCache?.pubkeys ?? [];
    }
  }
  clearCache() {
    this.cache.clear();
    this.subscriberCache = null;
  }
  // ─── Internals ─────────────────────────────────────────────────────────
  async getGrant(callerPubkey) {
    const cached = this.cache.get(callerPubkey);
    if (cached && Date.now() - cached.fetchedAt < GRANT_CACHE_TTL) {
      return cached.profile;
    }
    const dTag = `${this.servicePubkey}:${callerPubkey}`;
    try {
      const profile = await this.fetchGrantFromRelay(dTag);
      if (profile) {
        this.cache.set(callerPubkey, { profile, fetchedAt: Date.now() });
      }
      return profile;
    } catch {
      if (cached) return cached.profile;
      return null;
    }
  }
  fetchGrantFromRelay(dTag) {
    return new Promise((resolve) => {
      const ws = new WebSocket(this.relayUrl);
      const timeout = setTimeout(() => {
        ws.close();
        resolve(null);
      }, 5e3);
      ws.onopen = () => {
        ws.send(JSON.stringify([
          "REQ",
          "grant",
          { kinds: [GRANT_KIND], "#d": [dTag], limit: 1 }
        ]));
      };
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data[0] === "EVENT" && data[2]?.kind === GRANT_KIND) {
            const content = data[2].content;
            const profile = JSON.parse(content);
            clearTimeout(timeout);
            ws.close();
            resolve(profile);
          } else if (data[0] === "EOSE") {
            clearTimeout(timeout);
            ws.close();
            resolve(null);
          }
        } catch {
        }
      };
      ws.onerror = () => {
        clearTimeout(timeout);
        resolve(null);
      };
    });
  }
  fetchSubscribersFromRelay() {
    return new Promise((resolve) => {
      const ws = new WebSocket(this.relayUrl);
      const timeout = setTimeout(() => {
        ws.close();
        resolve([]);
      }, 5e3);
      const pubkeys = /* @__PURE__ */ new Set();
      ws.onopen = () => {
        ws.send(JSON.stringify([
          "REQ",
          "subscribers",
          { kinds: [GRANT_KIND], limit: 500 }
        ]));
      };
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data[0] === "EVENT" && data[2]?.kind === GRANT_KIND) {
            const dTag = data[2].tags?.find((t) => t[0] === "d")?.[1];
            if (dTag?.startsWith(this.servicePubkey + ":")) {
              const callerPubkey = dTag.slice(this.servicePubkey.length + 1);
              if (callerPubkey.length === 64) {
                pubkeys.add(callerPubkey);
              }
            }
          } else if (data[0] === "EOSE") {
            clearTimeout(timeout);
            ws.close();
            resolve(Array.from(pubkeys));
          }
        } catch {
        }
      };
      ws.onerror = () => {
        clearTimeout(timeout);
        resolve([]);
      };
    });
  }
};
async function publishGrant(signer, relayUrl, servicePubkey, controllerPubkey, profile) {
  const event = await signer.signEvent({
    kind: GRANT_KIND,
    created_at: Math.floor(Date.now() / 1e3),
    tags: [
      ["d", `${servicePubkey}:${controllerPubkey}`],
      ["p", servicePubkey]
    ],
    content: JSON.stringify(profile)
  });
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(relayUrl);
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error("Grant publish timeout"));
    }, 15e3);
    ws.onopen = () => {
      ws.send(JSON.stringify(["EVENT", event]));
    };
    ws.onmessage = (msg) => {
      try {
        const data = JSON.parse(msg.data);
        if (data[0] === "OK" && data[1] === event.id) {
          clearTimeout(timeout);
          ws.close();
          if (data[2]) {
            resolve(event.id);
          } else {
            reject(new Error(`Grant rejected by relay: ${data[3]}`));
          }
        }
      } catch {
      }
    };
    ws.onerror = () => {
      clearTimeout(timeout);
      reject(new Error("Grant publish failed"));
    };
  });
}

// src/events.ts
var TransportEventEmitter = class {
  handlers = /* @__PURE__ */ new Set();
  on(handler) {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }
  emit(event) {
    const full = { ...event, timestamp: Date.now() };
    for (const handler of this.handlers) {
      try {
        handler(full);
      } catch {
      }
    }
  }
  removeAllListeners() {
    this.handlers.clear();
  }
};
export {
  BrowserTransport,
  GrantVerifier,
  NNC_ERROR_CODES,
  NNC_INFO_KIND,
  NNC_NOTIFICATION_KIND,
  NNC_REQUEST_KIND,
  NNC_RESPONSE_KIND,
  NWC_ERROR_CODES,
  NWC_INFO_KIND,
  NWC_NOTIFICATION_KIND,
  NWC_REQUEST_KIND,
  NWC_RESPONSE_KIND,
  Nip07Signer,
  NncClient,
  NwcClient,
  NwcConnectionError,
  NwcDecryptionError,
  NwcPublishError,
  NwcPublishTimeout,
  NwcReplyTimeout,
  NwcRequestError,
  NwcTimeoutError,
  NwcWalletError,
  SecretKeySigner,
  TransportEventEmitter,
  parseConnectionString,
  parseConnectionString2 as parseNncConnectionString,
  publishGrant
};
//# sourceMappingURL=index.js.map