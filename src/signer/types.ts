import type { Signer } from 'nostr-tools/signer'

/**
 * Extends nostr-tools Signer with NIP-44 encryption required by NWC/NNC.
 *
 * NwcClient never touches keys — it only calls signer methods.
 * Three implementations are provided:
 * - SecretKeySigner: wraps a raw secret key (Node.js / backend / CLI)
 * - Nip07Signer: wraps window.nostr (browser extensions)
 * - BunkerSigner: nostr-tools' existing BunkerSigner already implements this
 */
export interface NwcSigner extends Signer {
  nip44Encrypt(pubkey: string, plaintext: string): Promise<string>
  nip44Decrypt(pubkey: string, ciphertext: string): Promise<string>
}
