/**
 * Structured event emitter for SDK diagnostics.
 * Replaces LP's pushConsoleLog() with typed events.
 */

export interface TransportEvent {
  type: 'request' | 'response' | 'notification' | 'error' | 'connection'
  timestamp: number
  method?: string
  servicePubkey?: string
  kind?: number
  latencyMs?: number
  error?: string
  eventId?: string
}

type EventHandler = (event: TransportEvent) => void

export class TransportEventEmitter {
  private handlers = new Set<EventHandler>()

  on(handler: EventHandler): () => void {
    this.handlers.add(handler)
    return () => this.handlers.delete(handler)
  }

  emit(event: Omit<TransportEvent, 'timestamp'>): void {
    const full: TransportEvent = { ...event, timestamp: Date.now() }
    for (const handler of this.handlers) {
      try {
        handler(full)
      } catch {
        // Never let a handler error crash the SDK
      }
    }
  }

  removeAllListeners(): void {
    this.handlers.clear()
  }
}
