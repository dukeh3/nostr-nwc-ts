/**
 * Transport interface for relay communication.
 * The default NwcClient uses nostr-tools SimplePool directly.
 * BrowserTransport adds auto-reconnect, heartbeat, and throttling.
 */
export interface Transport {
  /** Send raw JSON frame to the relay. */
  send(frame: string): void
  /** Register handler for incoming frames. */
  onMessage(handler: (data: string) => void): void
  /** Whether the transport is currently connected. */
  readonly connected: boolean
  /** Connect to the relay. */
  connect(): Promise<void>
  /** Disconnect from the relay. */
  disconnect(): void
}
