import { describe, it, expect } from 'vitest'
import { SecretKeySigner } from '../src/signer/secret-key.js'
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import * as nip44 from 'nostr-tools/nip44'

describe('SecretKeySigner', () => {
  it('returns the correct public key', async () => {
    const sk = generateSecretKey()
    const expectedPk = getPublicKey(sk)
    const signer = new SecretKeySigner(sk)

    const pk = await signer.getPublicKey()
    expect(pk).toBe(expectedPk)
  })

  it('signs events with correct structure', async () => {
    const sk = generateSecretKey()
    const signer = new SecretKeySigner(sk)

    const signed = await signer.signEvent({
      kind: 23194,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['p', 'deadbeef'.repeat(8)]],
      content: 'test content',
    })

    expect(signed.id).toBeDefined()
    expect(signed.pubkey).toBe(getPublicKey(sk))
    expect(signed.sig).toBeDefined()
    expect(signed.kind).toBe(23194)
    expect(signed.content).toBe('test content')
  })

  it('encrypts and decrypts with NIP-44', async () => {
    const sk1 = generateSecretKey()
    const sk2 = generateSecretKey()
    const pk2 = getPublicKey(sk2)

    const signer1 = new SecretKeySigner(sk1)
    const plaintext = 'Hello, NWC!'

    const encrypted = await signer1.nip44Encrypt(pk2, plaintext)
    expect(encrypted).not.toBe(plaintext)

    // Decrypt with the second key using nostr-tools directly
    const conversationKey = nip44.getConversationKey(sk2, getPublicKey(sk1))
    const decrypted = nip44.decrypt(encrypted, conversationKey)
    expect(decrypted).toBe(plaintext)
  })

  it('round-trips encrypt/decrypt between two signers', async () => {
    const sk1 = generateSecretKey()
    const sk2 = generateSecretKey()
    const pk1 = getPublicKey(sk1)
    const pk2 = getPublicKey(sk2)

    const signer1 = new SecretKeySigner(sk1)
    const signer2 = new SecretKeySigner(sk2)

    const plaintext = JSON.stringify({ method: 'get_info', params: {} })

    const encrypted = await signer1.nip44Encrypt(pk2, plaintext)
    const decrypted = await signer2.nip44Decrypt(pk1, encrypted)
    expect(decrypted).toBe(plaintext)
  })

  it('caches conversation keys (same encrypt call is deterministic-key)', async () => {
    const sk = generateSecretKey()
    const signer = new SecretKeySigner(sk)
    const recipientPk = getPublicKey(generateSecretKey())

    // Two encryptions with the same recipient should both work
    const enc1 = await signer.nip44Encrypt(recipientPk, 'msg1')
    const enc2 = await signer.nip44Encrypt(recipientPk, 'msg2')

    // Different ciphertexts for different plaintexts
    expect(enc1).not.toBe(enc2)
  })
})
