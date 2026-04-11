import type { EventTemplate, VerifiedEvent } from 'nostr-tools/core'
import type { NwcSigner } from './types.js'

interface Nip07Extension {
  getPublicKey(): Promise<string>
  signEvent(event: EventTemplate): Promise<VerifiedEvent>
  nip44?: {
    encrypt(pubkey: string, plaintext: string): Promise<string>
    decrypt(pubkey: string, ciphertext: string): Promise<string>
  }
}

function getNip07Extension(): Nip07Extension {
  const ext = (globalThis as unknown as { nostr?: Nip07Extension }).nostr
  if (!ext) {
    throw new Error(
      'No Nostr extension detected. Install Alby, nos2x, or another NIP-07 signer.',
    )
  }
  return ext
}

/**
 * Signer that delegates to a NIP-07 browser extension (Alby, nos2x, etc.).
 * Throws if the extension doesn't support NIP-44.
 */
export class Nip07Signer implements NwcSigner {
  async getPublicKey(): Promise<string> {
    return getNip07Extension().getPublicKey()
  }

  async signEvent(event: EventTemplate): Promise<VerifiedEvent> {
    return getNip07Extension().signEvent(event)
  }

  async nip44Encrypt(pubkey: string, plaintext: string): Promise<string> {
    const ext = getNip07Extension()
    if (!ext.nip44?.encrypt) {
      throw new Error('Extension does not support NIP-44 encryption')
    }
    return ext.nip44.encrypt(pubkey, plaintext)
  }

  async nip44Decrypt(pubkey: string, ciphertext: string): Promise<string> {
    const ext = getNip07Extension()
    if (!ext.nip44?.decrypt) {
      throw new Error('Extension does not support NIP-44 decryption')
    }
    return ext.nip44.decrypt(pubkey, ciphertext)
  }
}
