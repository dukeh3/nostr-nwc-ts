import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    nip47: 'nip47.ts',
    nipXX: 'nipXX.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  splitting: true,
  clean: true,
  sourcemap: true,
  external: ['nostr-tools'],
})
