import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Nip07Signer } from '../src/signer/nip07.js'

describe('Nip07Signer', () => {
  let savedNostr: unknown

  beforeEach(() => {
    savedNostr = (globalThis as any).nostr
  })

  afterEach(() => {
    if (savedNostr === undefined) {
      delete (globalThis as any).nostr
    } else {
      ;(globalThis as any).nostr = savedNostr
    }
  })

  // ─── No extension installed ──────────────────────────────────────────

  describe('no extension installed', () => {
    beforeEach(() => {
      delete (globalThis as any).nostr
    })

    it('getPublicKey throws "No Nostr extension detected"', async () => {
      const signer = new Nip07Signer()
      await expect(signer.getPublicKey()).rejects.toThrow('No Nostr extension detected')
    })

    it('nip44Encrypt throws "No Nostr extension detected"', async () => {
      const signer = new Nip07Signer()
      await expect(signer.nip44Encrypt('pubkey', 'text')).rejects.toThrow(
        'No Nostr extension detected',
      )
    })
  })

  // ─── With mock extension ─────────────────────────────────────────────

  describe('with mock extension', () => {
    const mockExtension = {
      getPublicKey: vi.fn().mockResolvedValue('aabb'.repeat(16)),
      signEvent: vi.fn().mockImplementation(async (event: any) => ({
        ...event,
        id: 'signed-id',
        pubkey: 'aabb'.repeat(16),
        sig: 'signed-sig',
      })),
      nip44: {
        encrypt: vi.fn().mockResolvedValue('encrypted-text'),
        decrypt: vi.fn().mockResolvedValue('decrypted-text'),
      },
    }

    beforeEach(() => {
      ;(globalThis as any).nostr = mockExtension
    })

    it('getPublicKey delegates to extension', async () => {
      const signer = new Nip07Signer()
      const pk = await signer.getPublicKey()

      expect(pk).toBe('aabb'.repeat(16))
      expect(mockExtension.getPublicKey).toHaveBeenCalled()
    })

    it('signEvent delegates to extension', async () => {
      const signer = new Nip07Signer()
      const event = { kind: 1, created_at: 1234, tags: [], content: 'hello' }
      const signed = await signer.signEvent(event)

      expect(signed.id).toBe('signed-id')
      expect(signed.sig).toBe('signed-sig')
      expect(mockExtension.signEvent).toHaveBeenCalledWith(event)
    })

    it('nip44Encrypt delegates to extension.nip44.encrypt', async () => {
      const signer = new Nip07Signer()
      const result = await signer.nip44Encrypt('pubkey123', 'plaintext')

      expect(result).toBe('encrypted-text')
      expect(mockExtension.nip44.encrypt).toHaveBeenCalledWith('pubkey123', 'plaintext')
    })

    it('nip44Decrypt delegates to extension.nip44.decrypt', async () => {
      const signer = new Nip07Signer()
      const result = await signer.nip44Decrypt('pubkey123', 'ciphertext')

      expect(result).toBe('decrypted-text')
      expect(mockExtension.nip44.decrypt).toHaveBeenCalledWith('pubkey123', 'ciphertext')
    })

    it('nip44Encrypt throws when extension has no nip44', async () => {
      ;(globalThis as any).nostr = {
        getPublicKey: vi.fn(),
        signEvent: vi.fn(),
        // no nip44
      }

      const signer = new Nip07Signer()
      await expect(signer.nip44Encrypt('pk', 'text')).rejects.toThrow(
        'Extension does not support NIP-44 encryption',
      )
    })

    it('nip44Decrypt throws when extension has no nip44', async () => {
      ;(globalThis as any).nostr = {
        getPublicKey: vi.fn(),
        signEvent: vi.fn(),
        // no nip44
      }

      const signer = new Nip07Signer()
      await expect(signer.nip44Decrypt('pk', 'ct')).rejects.toThrow(
        'Extension does not support NIP-44 decryption',
      )
    })
  })
})
