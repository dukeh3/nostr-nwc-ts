import { finalizeEvent, getPublicKey } from 'nostr-tools/pure'
import * as nip44 from 'nostr-tools/nip44'
import type { EventTemplate, VerifiedEvent } from 'nostr-tools/core'
import type { NwcSigner } from './types.js'

/**
 * Signer that wraps a raw secret key. Uses nostr-tools finalizeEvent + nip44.
 * Caches NIP-44 conversation keys per pubkey for performance.
 *
 * Suitable for Node.js, backend, and CLI usage where the secret key is available.
 */
export class SecretKeySigner implements NwcSigner {
  private secretKey: Uint8Array
  private pubkey: string
  private conversationKeys = new Map<string, Uint8Array>()

  constructor(secretKey: Uint8Array) {
    this.secretKey = secretKey
    this.pubkey = getPublicKey(secretKey)
  }

  async getPublicKey(): Promise<string> {
    return this.pubkey
  }

  async signEvent(event: EventTemplate): Promise<VerifiedEvent> {
    return finalizeEvent(event, this.secretKey)
  }

  async nip44Encrypt(pubkey: string, plaintext: string): Promise<string> {
    return nip44.encrypt(plaintext, this.getConversationKey(pubkey))
  }

  async nip44Decrypt(pubkey: string, ciphertext: string): Promise<string> {
    return nip44.decrypt(ciphertext, this.getConversationKey(pubkey))
  }

  private getConversationKey(pubkey: string): Uint8Array {
    let key = this.conversationKeys.get(pubkey)
    if (!key) {
      key = nip44.getConversationKey(this.secretKey, pubkey)
      this.conversationKeys.set(pubkey, key)
    }
    return key
  }
}
