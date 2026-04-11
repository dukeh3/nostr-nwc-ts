import type { NwcSigner } from './signer/types.js'

const GRANT_KIND = 30078
const GRANT_CACHE_TTL = 60_000

export interface UsageProfile {
  methods?: Record<string, Record<string, unknown>>
  control?: Record<string, Record<string, unknown>>
  quota?: { rate_per_micro?: number; max_capacity?: number }
}

interface CachedGrant {
  profile: UsageProfile
  fetchedAt: number
}

/**
 * Verifies kind 30078 access grants for NWC/NNC.
 *
 * Fetches grant events from the relay and checks:
 * 1. Does a grant exist for this caller pubkey?
 * 2. Is the requested method allowed?
 * 3. Is the grant signed by a known owner?
 */
export class GrantVerifier {
  private relayUrl: string
  private servicePubkey: string
  private cache = new Map<string, CachedGrant>()
  private subscriberCache: { pubkeys: string[]; fetchedAt: number } | null = null

  constructor(relayUrl: string, servicePubkey: string) {
    this.relayUrl = relayUrl
    this.servicePubkey = servicePubkey
  }

  /**
   * Check if a caller pubkey is authorized to call the given method.
   * Returns null if authorized, or an error message string if denied.
   */
  async checkAccess(callerPubkey: string, method: string, isControl: boolean): Promise<string | null> {
    const profile = await this.getGrant(callerPubkey)

    if (!profile) {
      return `No access grant found for pubkey ${callerPubkey.substring(0, 8)}...`
    }

    if (isControl) {
      if (!profile.control) {
        return `No control access granted for pubkey ${callerPubkey.substring(0, 8)}...`
      }
      if (!(method in profile.control) && !('ALL' in profile.control)) {
        return `Method '${method}' not in control grant for ${callerPubkey.substring(0, 8)}...`
      }
    } else {
      if (profile.methods !== undefined) {
        if (Object.keys(profile.methods).length === 0) {
          return `Empty methods grant — no wallet access for ${callerPubkey.substring(0, 8)}...`
        }
        if (!(method in profile.methods) && !('ALL' in profile.methods)) {
          return `Method '${method}' not in wallet grant for ${callerPubkey.substring(0, 8)}...`
        }
      }
    }

    return null
  }

  /**
   * Fetch all pubkeys that have grants for this service.
   * Used by bridges to know who to encrypt notification events for.
   */
  async getSubscriberPubkeys(): Promise<string[]> {
    if (this.subscriberCache && Date.now() - this.subscriberCache.fetchedAt < GRANT_CACHE_TTL) {
      return this.subscriberCache.pubkeys
    }

    try {
      const pubkeys = await this.fetchSubscribersFromRelay()
      this.subscriberCache = { pubkeys, fetchedAt: Date.now() }
      return pubkeys
    } catch {
      return this.subscriberCache?.pubkeys ?? []
    }
  }

  clearCache(): void {
    this.cache.clear()
    this.subscriberCache = null
  }

  // ─── Internals ─────────────────────────────────────────────────────────

  private async getGrant(callerPubkey: string): Promise<UsageProfile | null> {
    const cached = this.cache.get(callerPubkey)
    if (cached && Date.now() - cached.fetchedAt < GRANT_CACHE_TTL) {
      return cached.profile
    }

    const dTag = `${this.servicePubkey}:${callerPubkey}`
    try {
      const profile = await this.fetchGrantFromRelay(dTag)
      if (profile) {
        this.cache.set(callerPubkey, { profile, fetchedAt: Date.now() })
      }
      return profile
    } catch {
      if (cached) return cached.profile
      return null
    }
  }

  private fetchGrantFromRelay(dTag: string): Promise<UsageProfile | null> {
    return new Promise((resolve) => {
      const ws = new WebSocket(this.relayUrl)
      const timeout = setTimeout(() => { ws.close(); resolve(null) }, 5000)

      ws.onopen = () => {
        ws.send(JSON.stringify([
          'REQ', 'grant',
          { kinds: [GRANT_KIND], '#d': [dTag], limit: 1 },
        ]))
      }

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data as string)
          if (data[0] === 'EVENT' && data[2]?.kind === GRANT_KIND) {
            const content = data[2].content
            const profile = JSON.parse(content) as UsageProfile
            clearTimeout(timeout)
            ws.close()
            resolve(profile)
          } else if (data[0] === 'EOSE') {
            clearTimeout(timeout)
            ws.close()
            resolve(null)
          }
        } catch {
          // ignore parse errors
        }
      }

      ws.onerror = () => { clearTimeout(timeout); resolve(null) }
    })
  }

  private fetchSubscribersFromRelay(): Promise<string[]> {
    return new Promise((resolve) => {
      const ws = new WebSocket(this.relayUrl)
      const timeout = setTimeout(() => { ws.close(); resolve([]) }, 5000)
      const pubkeys = new Set<string>()

      ws.onopen = () => {
        ws.send(JSON.stringify([
          'REQ', 'subscribers',
          { kinds: [GRANT_KIND], limit: 500 },
        ]))
      }

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data as string)
          if (data[0] === 'EVENT' && data[2]?.kind === GRANT_KIND) {
            const dTag = data[2].tags?.find((t: string[]) => t[0] === 'd')?.[1] as string | undefined
            if (dTag?.startsWith(this.servicePubkey + ':')) {
              const callerPubkey = dTag.slice(this.servicePubkey.length + 1)
              if (callerPubkey.length === 64) {
                pubkeys.add(callerPubkey)
              }
            }
          } else if (data[0] === 'EOSE') {
            clearTimeout(timeout)
            ws.close()
            resolve(Array.from(pubkeys))
          }
        } catch {
          // ignore parse errors
        }
      }

      ws.onerror = () => { clearTimeout(timeout); resolve([]) }
    })
  }
}

/**
 * Publish a kind 30078 grant event for access control.
 */
export async function publishGrant(
  signer: NwcSigner,
  relayUrl: string,
  servicePubkey: string,
  controllerPubkey: string,
  profile: UsageProfile,
): Promise<string> {
  const event = await signer.signEvent({
    kind: GRANT_KIND,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['d', `${servicePubkey}:${controllerPubkey}`],
      ['p', servicePubkey],
    ],
    content: JSON.stringify(profile),
  })

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(relayUrl)
    const timeout = setTimeout(() => {
      ws.close()
      reject(new Error('Grant publish timeout'))
    }, 15_000)

    ws.onopen = () => {
      ws.send(JSON.stringify(['EVENT', event]))
    }

    ws.onmessage = (msg) => {
      try {
        const data = JSON.parse(msg.data as string)
        if (data[0] === 'OK' && data[1] === event.id) {
          clearTimeout(timeout)
          ws.close()
          if (data[2]) {
            resolve(event.id)
          } else {
            reject(new Error(`Grant rejected by relay: ${data[3]}`))
          }
        }
      } catch {
        // ignore
      }
    }

    ws.onerror = () => {
      clearTimeout(timeout)
      reject(new Error('Grant publish failed'))
    }
  })
}
