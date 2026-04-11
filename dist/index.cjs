"use strict";Object.defineProperty(exports, "__esModule", {value: true}); function _interopRequireWildcard(obj) { if (obj && obj.__esModule) { return obj; } else { var newObj = {}; if (obj != null) { for (var key in obj) { if (Object.prototype.hasOwnProperty.call(obj, key)) { newObj[key] = obj[key]; } } } newObj.default = obj; return newObj; } } function _nullishCoalesce(lhs, rhsFn) { if (lhs != null) { return lhs; } else { return rhsFn(); } } function _optionalChain(ops) { let lastAccessLHS = undefined; let value = ops[0]; let i = 1; while (i < ops.length) { const op = ops[i]; const fn = ops[i + 1]; i += 2; if ((op === 'optionalAccess' || op === 'optionalCall') && value == null) { return undefined; } if (op === 'access' || op === 'optionalAccess') { lastAccessLHS = value; value = fn(value); } else if (op === 'call' || op === 'optionalCall') { value = fn((...args) => value.call(lastAccessLHS, ...args)); lastAccessLHS = undefined; } } return value; } var _class; var _class2; var _class3; var _class4;







var _chunkGZ6KDHEEcjs = require('./chunk-GZ6KDHEE.cjs');
















var _chunk3QTLLXZBcjs = require('./chunk-3QTLLXZB.cjs');

// src/signer/secret-key.ts
var _pure = require('nostr-tools/pure');
var _nip44 = require('nostr-tools/nip44'); var nip44 = _interopRequireWildcard(_nip44);
var SecretKeySigner = (_class = class {
  
  
  __init() {this.conversationKeys = /* @__PURE__ */ new Map()}
  constructor(secretKey) {;_class.prototype.__init.call(this);
    this.secretKey = secretKey;
    this.pubkey = _pure.getPublicKey.call(void 0, secretKey);
  }
  async getPublicKey() {
    return this.pubkey;
  }
  async signEvent(event) {
    return _pure.finalizeEvent.call(void 0, event, this.secretKey);
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
}, _class);

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
    if (!_optionalChain([ext, 'access', _ => _.nip44, 'optionalAccess', _2 => _2.encrypt])) {
      throw new Error("Extension does not support NIP-44 encryption");
    }
    return ext.nip44.encrypt(pubkey, plaintext);
  }
  async nip44Decrypt(pubkey, ciphertext) {
    const ext = getNip07Extension();
    if (!_optionalChain([ext, 'access', _3 => _3.nip44, 'optionalAccess', _4 => _4.decrypt])) {
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
var BrowserTransport = (_class2 = class {
  
  __init2() {this.ws = null}
  __init3() {this.messageHandlers = /* @__PURE__ */ new Set()}
  __init4() {this.connectionListeners = /* @__PURE__ */ new Set()}
  __init5() {this.connectPromise = null}
  __init6() {this.reconnectAttempt = 0}
  __init7() {this.reconnectTimer = null}
  __init8() {this.heartbeatTimer = null}
  __init9() {this.disconnectedByUser = false}
  __init10() {this.inFlight = 0}
  __init11() {this.queue = []}
  // Configurable
  
  
  
  
  
  constructor(relayUrl, opts) {;_class2.prototype.__init2.call(this);_class2.prototype.__init3.call(this);_class2.prototype.__init4.call(this);_class2.prototype.__init5.call(this);_class2.prototype.__init6.call(this);_class2.prototype.__init7.call(this);_class2.prototype.__init8.call(this);_class2.prototype.__init9.call(this);_class2.prototype.__init10.call(this);_class2.prototype.__init11.call(this);
    this.relayUrl = relayUrl;
    this.connectTimeoutMs = _nullishCoalesce(_optionalChain([opts, 'optionalAccess', _5 => _5.connectTimeoutMs]), () => ( CONNECT_TIMEOUT_MS));
    this.reconnectBaseMs = _nullishCoalesce(_optionalChain([opts, 'optionalAccess', _6 => _6.reconnectBaseMs]), () => ( RECONNECT_BASE_MS));
    this.reconnectMaxMs = _nullishCoalesce(_optionalChain([opts, 'optionalAccess', _7 => _7.reconnectMaxMs]), () => ( RECONNECT_MAX_MS));
    this.heartbeatIntervalMs = _nullishCoalesce(_optionalChain([opts, 'optionalAccess', _8 => _8.heartbeatIntervalMs]), () => ( HEARTBEAT_INTERVAL_MS));
    this.maxConcurrentRequests = _nullishCoalesce(_optionalChain([opts, 'optionalAccess', _9 => _9.maxConcurrentRequests]), () => ( MAX_CONCURRENT_REQUESTS));
  }
  get connected() {
    return _optionalChain([this, 'access', _10 => _10.ws, 'optionalAccess', _11 => _11.readyState]) === WebSocket.OPEN;
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
      _optionalChain([this, 'access', _12 => _12.queue, 'access', _13 => _13.shift, 'call', _14 => _14(), 'optionalCall', _15 => _15()]);
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
        } catch (e) {
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
      } catch (e2) {
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
      } catch (e3) {
      }
    }, delay);
  }
  notifyConnectionChange(connected) {
    for (const listener of this.connectionListeners) {
      listener(connected);
    }
  }
}, _class2);

// src/grant.ts
var GRANT_KIND = 30078;
var GRANT_CACHE_TTL = 6e4;
var GrantVerifier = (_class3 = class {
  
  
  __init12() {this.cache = /* @__PURE__ */ new Map()}
  __init13() {this.subscriberCache = null}
  constructor(relayUrl, servicePubkey) {;_class3.prototype.__init12.call(this);_class3.prototype.__init13.call(this);
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
    } catch (e4) {
      return _nullishCoalesce(_optionalChain([this, 'access', _16 => _16.subscriberCache, 'optionalAccess', _17 => _17.pubkeys]), () => ( []));
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
    } catch (e5) {
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
          if (data[0] === "EVENT" && _optionalChain([data, 'access', _18 => _18[2], 'optionalAccess', _19 => _19.kind]) === GRANT_KIND) {
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
        } catch (e6) {
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
          if (data[0] === "EVENT" && _optionalChain([data, 'access', _20 => _20[2], 'optionalAccess', _21 => _21.kind]) === GRANT_KIND) {
            const dTag = _optionalChain([data, 'access', _22 => _22[2], 'access', _23 => _23.tags, 'optionalAccess', _24 => _24.find, 'call', _25 => _25((t) => t[0] === "d"), 'optionalAccess', _26 => _26[1]]);
            if (_optionalChain([dTag, 'optionalAccess', _27 => _27.startsWith, 'call', _28 => _28(this.servicePubkey + ":")])) {
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
        } catch (e7) {
        }
      };
      ws.onerror = () => {
        clearTimeout(timeout);
        resolve([]);
      };
    });
  }
}, _class3);
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
      } catch (e8) {
      }
    };
    ws.onerror = () => {
      clearTimeout(timeout);
      reject(new Error("Grant publish failed"));
    };
  });
}

// src/events.ts
var TransportEventEmitter = (_class4 = class {constructor() { _class4.prototype.__init14.call(this); }
  __init14() {this.handlers = /* @__PURE__ */ new Set()}
  on(handler) {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }
  emit(event) {
    const full = { ...event, timestamp: Date.now() };
    for (const handler of this.handlers) {
      try {
        handler(full);
      } catch (e9) {
      }
    }
  }
  removeAllListeners() {
    this.handlers.clear();
  }
}, _class4);





























exports.BrowserTransport = BrowserTransport; exports.GrantVerifier = GrantVerifier; exports.NNC_ERROR_CODES = _chunkGZ6KDHEEcjs.NNC_ERROR_CODES; exports.NNC_INFO_KIND = _chunkGZ6KDHEEcjs.NNC_INFO_KIND; exports.NNC_NOTIFICATION_KIND = _chunkGZ6KDHEEcjs.NNC_NOTIFICATION_KIND; exports.NNC_REQUEST_KIND = _chunkGZ6KDHEEcjs.NNC_REQUEST_KIND; exports.NNC_RESPONSE_KIND = _chunkGZ6KDHEEcjs.NNC_RESPONSE_KIND; exports.NWC_ERROR_CODES = _chunk3QTLLXZBcjs.NWC_ERROR_CODES; exports.NWC_INFO_KIND = _chunk3QTLLXZBcjs.NWC_INFO_KIND; exports.NWC_NOTIFICATION_KIND = _chunk3QTLLXZBcjs.NWC_NOTIFICATION_KIND; exports.NWC_REQUEST_KIND = _chunk3QTLLXZBcjs.NWC_REQUEST_KIND; exports.NWC_RESPONSE_KIND = _chunk3QTLLXZBcjs.NWC_RESPONSE_KIND; exports.Nip07Signer = Nip07Signer; exports.NncClient = _chunkGZ6KDHEEcjs.NncClient; exports.NwcClient = _chunk3QTLLXZBcjs.NwcClient; exports.NwcConnectionError = _chunk3QTLLXZBcjs.NwcConnectionError; exports.NwcDecryptionError = _chunk3QTLLXZBcjs.NwcDecryptionError; exports.NwcPublishError = _chunk3QTLLXZBcjs.NwcPublishError; exports.NwcPublishTimeout = _chunk3QTLLXZBcjs.NwcPublishTimeout; exports.NwcReplyTimeout = _chunk3QTLLXZBcjs.NwcReplyTimeout; exports.NwcRequestError = _chunk3QTLLXZBcjs.NwcRequestError; exports.NwcTimeoutError = _chunk3QTLLXZBcjs.NwcTimeoutError; exports.NwcWalletError = _chunk3QTLLXZBcjs.NwcWalletError; exports.SecretKeySigner = SecretKeySigner; exports.TransportEventEmitter = TransportEventEmitter; exports.parseConnectionString = _chunk3QTLLXZBcjs.parseConnectionString; exports.parseNncConnectionString = _chunkGZ6KDHEEcjs.parseConnectionString; exports.publishGrant = publishGrant;
//# sourceMappingURL=index.cjs.map