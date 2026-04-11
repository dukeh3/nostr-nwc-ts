import type { Transport } from './types.js'

const CONNECT_TIMEOUT_MS = 5_000
const RECONNECT_BASE_MS = 1_000
const RECONNECT_MAX_MS = 30_000
const HEARTBEAT_INTERVAL_MS = 30_000
const MAX_CONCURRENT_REQUESTS = 6

export interface BrowserTransportOptions {
  connectTimeoutMs?: number
  reconnectBaseMs?: number
  reconnectMaxMs?: number
  heartbeatIntervalMs?: number
  maxConcurrentRequests?: number
}

/**
 * Browser WebSocket transport with auto-reconnect, heartbeat, and throttling.
 *
 * Adapted from LP's NostrNodeClient — provides the connection management
 * layer that SimplePool doesn't offer.
 */
export class BrowserTransport implements Transport {
  private relayUrl: string
  private ws: WebSocket | null = null
  private messageHandlers = new Set<(data: string) => void>()
  private connectionListeners = new Set<(connected: boolean) => void>()
  private connectPromise: Promise<WebSocket> | null = null
  private reconnectAttempt = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private disconnectedByUser = false
  private inFlight = 0
  private queue: Array<() => void> = []

  // Configurable
  private connectTimeoutMs: number
  private reconnectBaseMs: number
  private reconnectMaxMs: number
  private heartbeatIntervalMs: number
  private maxConcurrentRequests: number

  constructor(relayUrl: string, opts?: BrowserTransportOptions) {
    this.relayUrl = relayUrl
    this.connectTimeoutMs = opts?.connectTimeoutMs ?? CONNECT_TIMEOUT_MS
    this.reconnectBaseMs = opts?.reconnectBaseMs ?? RECONNECT_BASE_MS
    this.reconnectMaxMs = opts?.reconnectMaxMs ?? RECONNECT_MAX_MS
    this.heartbeatIntervalMs = opts?.heartbeatIntervalMs ?? HEARTBEAT_INTERVAL_MS
    this.maxConcurrentRequests = opts?.maxConcurrentRequests ?? MAX_CONCURRENT_REQUESTS
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN
  }

  onMessage(handler: (data: string) => void): void {
    this.messageHandlers.add(handler)
  }

  onConnectionChange(listener: (connected: boolean) => void): () => void {
    this.connectionListeners.add(listener)
    return () => this.connectionListeners.delete(listener)
  }

  async connect(): Promise<void> {
    await this.ensureConnection()
  }

  send(frame: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket not connected')
    }
    this.ws.send(frame)
  }

  /**
   * Send with throttling — waits if too many requests are in-flight.
   * Returns a release function the caller MUST invoke when the request completes.
   */
  async sendThrottled(frame: string): Promise<() => void> {
    if (this.inFlight >= this.maxConcurrentRequests) {
      await new Promise<void>((resolve) => this.queue.push(resolve))
    }
    this.inFlight++

    const ws = await this.ensureConnection()
    ws.send(frame)

    return () => {
      this.inFlight--
      this.queue.shift()?.()
    }
  }

  disconnect(): void {
    this.disconnectedByUser = true
    this.stopHeartbeat()

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }

    for (const resolve of this.queue) {
      resolve()
    }
    this.queue = []
    this.inFlight = 0

    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
  }

  /**
   * Pre-connect WebSocket. Safe to call multiple times.
   */
  preconnect(): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return
    this.ensureConnection().catch(() => {
      /* best-effort */
    })
  }

  // ─── Internals ─────────────────────────────────────────────────────────

  private async ensureConnection(): Promise<WebSocket> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return this.ws
    }
    if (this.connectPromise) return this.connectPromise
    this.disconnectedByUser = false

    this.connectPromise = new Promise<WebSocket>((resolve, reject) => {
      if (this.ws && this.ws.readyState === WebSocket.CONNECTING) {
        try { this.ws.close() } catch { /* ignore */ }
      }

      const ws = new WebSocket(this.relayUrl)
      this.ws = ws

      ws.onopen = () => {
        this.reconnectAttempt = 0
        this.startHeartbeat(ws)
        this.notifyConnectionChange(true)
        resolve(ws)
      }

      ws.onerror = () => {
        reject(new Error(`Relay connection failed: ${this.relayUrl}`))
      }

      ws.onclose = () => {
        this.stopHeartbeat()
        this.ws = null
        this.notifyConnectionChange(false)
        if (!this.disconnectedByUser) {
          this.scheduleReconnect()
        }
      }

      ws.onmessage = (event) => {
        const data = event.data as string
        for (const handler of this.messageHandlers) {
          handler(data)
        }
      }

      setTimeout(() => {
        if (ws.readyState !== WebSocket.OPEN) {
          reject(new Error('Relay connection timeout'))
        }
      }, this.connectTimeoutMs)
    }).finally(() => {
      this.connectPromise = null
    })

    return this.connectPromise
  }

  private startHeartbeat(ws: WebSocket): void {
    this.stopHeartbeat()
    this.heartbeatTimer = setInterval(() => {
      if (ws.readyState !== WebSocket.OPEN) return
      try {
        ws.send(JSON.stringify(['REQ', 'hb', { kinds: [0], limit: 0, since: 2147483647 }]))
        ws.send(JSON.stringify(['CLOSE', 'hb']))
      } catch {
        ws.close()
      }
    }, this.heartbeatIntervalMs)
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return
    const delay = Math.min(
      this.reconnectBaseMs * 2 ** this.reconnectAttempt,
      this.reconnectMaxMs,
    )
    this.reconnectAttempt++

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null
      try {
        await this.ensureConnection()
      } catch {
        // connect() failed — onclose will fire and schedule another attempt
      }
    }, delay)
  }

  private notifyConnectionChange(connected: boolean): void {
    for (const listener of this.connectionListeners) {
      listener(connected)
    }
  }
}
