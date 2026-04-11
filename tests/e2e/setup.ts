import { execSync } from 'child_process'
import { mkdirSync, writeFileSync, chmodSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createServer } from 'net'

// ─── Container tracking ─────────────────────────────────────────────────────

const trackedContainers: string[] = []

export function cleanupContainers(): void {
  for (const name of trackedContainers) {
    try {
      execSync(`docker rm -f ${name}`, { stdio: 'ignore' })
    } catch {
      /* ignore */
    }
  }
  trackedContainers.length = 0
}

function uniqueId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

// ─── Port allocation ─────────────────────────────────────────────────────────

export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer()
    srv.listen(0, () => {
      const addr = srv.address()
      if (addr && typeof addr === 'object') {
        const port = addr.port
        srv.close(() => resolve(port))
      } else {
        srv.close(() => reject(new Error('Could not allocate port')))
      }
    })
    srv.on('error', reject)
  })
}

// ─── Docker helpers ──────────────────────────────────────────────────────────

function getMappedPort(containerName: string, internalPort: number): number {
  const output = execSync(`docker port ${containerName} ${internalPort}`)
    .toString()
    .trim()
  // Output: "0.0.0.0:12345" or ":::12345" or multiple lines
  const match = output.match(/:(\d+)/)
  if (!match) {
    throw new Error(
      `Could not get mapped port for ${containerName}:${internalPort}: ${output}`,
    )
  }
  return parseInt(match[1], 10)
}

async function waitForLog(
  containerName: string,
  message: string,
  timeoutMs: number,
): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const logs = containerLogs(containerName)
    if (logs.includes(message)) {
      return
    }

    // Check container is still running
    try {
      const state = execSync(
        `docker inspect -f "{{.State.Running}}" ${containerName}`,
      )
        .toString()
        .trim()
      if (state !== 'true') {
        throw new Error(
          `Container ${containerName} exited before "${message}". Logs:\n${logs}`,
        )
      }
    } catch (e) {
      if (e instanceof Error && e.message.includes('exited before')) throw e
      throw new Error(`Container ${containerName} not found`)
    }

    await sleep(500)
  }
  const logs = containerLogs(containerName)
  throw new Error(
    `Timed out waiting for "${message}" in ${containerName}. Logs:\n${logs}`,
  )
}

export function containerLogs(name: string): string {
  try {
    return execSync(`docker logs ${name} 2>&1`).toString()
  } catch {
    return ''
  }
}

// ─── Relay ───────────────────────────────────────────────────────────────────

export interface RelayInfo {
  name: string
  port: number
  url: string
}

export async function startRelay(): Promise<RelayInfo> {
  const name = uniqueId('strfry-e2e')

  execSync(
    `docker run -d --name ${name} -p 0:7777 strfry-strfry:latest`,
  )
  trackedContainers.push(name)

  await waitForLog(name, 'Started websocket server', 15_000)

  const port = getMappedPort(name, 7777)
  return { name, port, url: `ws://localhost:${port}` }
}

// ─── Bitcoind ────────────────────────────────────────────────────────────────

const RPC_USER = 'rpcuser'
const RPC_PASS = 'rpcpass'
const BITCOIND_RPC_PORT = 18443

export interface BitcoindInfo {
  name: string
  rpcPort: number
  rpc: BitcoindRpc
}

export async function startBitcoind(): Promise<BitcoindInfo> {
  const name = uniqueId('bitcoind-e2e')

  const args = [
    'docker run -d',
    `--name ${name}`,
    `-p 0:${BITCOIND_RPC_PORT}`,
    'ruimarinho/bitcoin-core:latest',
    '-regtest=1',
    '-server=1',
    '-txindex=1',
    '-printtoconsole',
    '-fallbackfee=0.0002',
    '-rpcbind=0.0.0.0',
    '-rpcallowip=0.0.0.0/0',
    `-rpcuser=${RPC_USER}`,
    `-rpcpassword=${RPC_PASS}`,
  ].join(' ')

  execSync(args)
  trackedContainers.push(name)

  const rpcPort = getMappedPort(name, BITCOIND_RPC_PORT)
  const rpc = new BitcoindRpc(rpcPort)

  await rpc.waitUntilReady()
  await rpc.createWallet('testwallet')

  return { name, rpcPort, rpc }
}

export class BitcoindRpc {
  private url: string

  constructor(port: number) {
    this.url = `http://localhost:${port}`
  }

  async call(method: string, params: unknown[] = []): Promise<unknown> {
    const response = await fetch(this.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization:
          'Basic ' + Buffer.from(`${RPC_USER}:${RPC_PASS}`).toString('base64'),
      },
      body: JSON.stringify({
        jsonrpc: '1.0',
        id: 'test',
        method,
        params,
      }),
    })

    const json = (await response.json()) as {
      result: unknown
      error: unknown
    }
    if (json.error) {
      throw new Error(`RPC ${method} error: ${JSON.stringify(json.error)}`)
    }
    return json.result
  }

  async waitUntilReady(): Promise<void> {
    for (let i = 0; i < 60; i++) {
      try {
        await this.call('getblockchaininfo')
        return
      } catch {
        await sleep(250)
      }
    }
    throw new Error('bitcoind RPC did not become ready in time')
  }

  async createWallet(name: string): Promise<void> {
    await this.call('createwallet', [name])
  }

  async getNewAddress(): Promise<string> {
    return (await this.call('getnewaddress', [])) as string
  }

  async mineBlocks(count: number, address: string): Promise<void> {
    await this.call('generatetoaddress', [count, address])
  }

  async sendToAddress(address: string, amountBtc: number): Promise<string> {
    return (await this.call('sendtoaddress', [address, amountBtc])) as string
  }
}

// ─── LDK Controller ─────────────────────────────────────────────────────────

export interface ControllerConfig {
  relayUrl: string
  privateKey: string // hex secret key
  bitcoindRpcHost: string
  bitcoindRpcPort: number
  listeningPort: number
}

export function writeControllerConfig(config: ControllerConfig): string {
  const dir = join(tmpdir(), uniqueId('ldk-controller-config'))
  mkdirSync(dir, { recursive: true })
  chmodSync(dir, 0o777)

  const dataDir = join(dir, 'data')
  mkdirSync(dataDir, { recursive: true })
  chmodSync(dataDir, 0o777)

  const toml = `[node]
network = "regtest"
listening_port = ${config.listeningPort}
data_dir = "/var/lib/ldk-controller/data"

[nostr]
relay = "${config.relayUrl}"
private_key = "${config.privateKey}"

[wallet]
max_channel_size_sats = 1000000
min_channel_size_sats = 20000
auto_accept_channels = false

[bitcoind]
rpc_host = "${config.bitcoindRpcHost}"
rpc_port = ${config.bitcoindRpcPort}
rpc_user = "${RPC_USER}"
rpc_password = "${RPC_PASS}"
`

  writeFileSync(join(dir, 'config.toml'), toml)
  return dir
}

export interface ControllerInfo {
  name: string
  configDir: string
  listeningPort: number
}

export async function startController(
  configDir: string,
  listeningPort: number,
): Promise<ControllerInfo> {
  const name = uniqueId('ldk-controller-e2e')

  const args = [
    'docker run -d',
    `--name ${name}`,
    `-v ${configDir}:/var/lib/ldk-controller`,
    '--network host',
    'ldk-controller:e2e',
  ].join(' ')

  execSync(args)
  trackedContainers.push(name)

  await waitForLog(name, 'Press Ctrl+C to stop.', 30_000)

  return { name, configDir, listeningPort }
}

// ─── Utilities ───────────────────────────────────────────────────────────────

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function skHex(sk: Uint8Array): string {
  return Buffer.from(sk).toString('hex')
}

// ─── Two-Node Network Setup ─────────────────────────────────────────────────

import { SimplePool, generateSecretKey, getPublicKey } from 'nostr-tools'
import { NwcClient } from '../../nip47.js'
import { NncClient } from '../../nipXX.js'
import { SecretKeySigner } from '../../src/signer/secret-key.js'
import { publishGrant } from '../../src/grant.js'
import type { UsageProfile } from '../../src/grant.js'

export interface TwoNodeNetwork {
  relay: RelayInfo
  bitcoind: BitcoindInfo
  alice: ControllerInfo
  bob: ControllerInfo
  aliceNwc: NwcClient
  aliceNnc: NncClient
  bobNwc: NwcClient
  bobNnc: NncClient
  aliceNodePk: string
  bobNodePk: string
  minerAddress: string
  pool: SimplePool
  cleanup: () => void
}

export async function setupTwoNodeNetwork(opts?: {
  openChannel?: boolean
  channelAmount?: number
  pushAmount?: number
  aliceGrantMethods?: Record<string, Record<string, unknown>>
  aliceGrantControl?: Record<string, Record<string, unknown>>
  bobGrantMethods?: Record<string, Record<string, unknown>>
  bobGrantControl?: Record<string, Record<string, unknown>>
}): Promise<TwoNodeNetwork> {
  const openChannel = opts?.openChannel ?? true
  const channelAmount = opts?.channelAmount ?? 2_000_000
  const pushAmount = opts?.pushAmount ?? 1_000_000

  // ── 1. Start infrastructure ──────────────────────────────────────────
  console.log('[e2e] Starting relay and bitcoind...')
  const [relay, bitcoind] = await Promise.all([startRelay(), startBitcoind()])
  console.log(`[e2e] Relay at ${relay.url}, bitcoind RPC on port ${bitcoind.rpcPort}`)

  const minerAddress = await bitcoind.rpc.getNewAddress()
  await bitcoind.rpc.mineBlocks(101, minerAddress)

  // ── 2. Generate keys ─────────────────────────────────────────────────
  const aliceServiceSk = generateSecretKey()
  const aliceServicePk = getPublicKey(aliceServiceSk)
  const bobServiceSk = generateSecretKey()
  const bobServicePk = getPublicKey(bobServiceSk)

  const aliceClientSk = generateSecretKey()
  const aliceClientPk = getPublicKey(aliceClientSk)
  const bobClientSk = generateSecretKey()
  const bobClientPk = getPublicKey(bobClientSk)

  // ── 3. Write configs and start controllers ───────────────────────────
  const alicePort = await freePort()
  const bobPort = await freePort()

  const aliceConfigDir = writeControllerConfig({
    relayUrl: relay.url,
    privateKey: skHex(aliceServiceSk),
    bitcoindRpcHost: '127.0.0.1',
    bitcoindRpcPort: bitcoind.rpcPort,
    listeningPort: alicePort,
  })

  const bobConfigDir = writeControllerConfig({
    relayUrl: relay.url,
    privateKey: skHex(bobServiceSk),
    bitcoindRpcHost: '127.0.0.1',
    bitcoindRpcPort: bitcoind.rpcPort,
    listeningPort: bobPort,
  })

  console.log('[e2e] Starting Alice and Bob controllers...')
  const [alice, bob] = await Promise.all([
    startController(aliceConfigDir, alicePort),
    startController(bobConfigDir, bobPort),
  ])
  console.log(
    `[e2e] Alice (${alice.name}) on :${alicePort}, Bob (${bob.name}) on :${bobPort}`,
  )

  // ── 4. Publish grants ────────────────────────────────────────────────
  const ownerSk = generateSecretKey()
  const ownerSigner = new SecretKeySigner(ownerSk)

  const aliceGrant: UsageProfile = {
    methods: opts?.aliceGrantMethods ?? {
      get_info: {},
      get_balance: {},
      make_new_address: {},
      pay_invoice: {},
      pay_keysend: {},
      make_invoice: {},
      lookup_invoice: {},
      list_transactions: {},
      sign_message: {},
      pay_offer: {},
      make_offer: {},
      lookup_offer: {},
      pay_onchain: {},
      lookup_address: {},
      pay_bip321: {},
      make_bip321: {},
      make_hold_invoice: {},
      settle_hold_invoice: {},
      cancel_hold_invoice: {},
      estimate_routing_fees: {},
    },
    control: opts?.aliceGrantControl ?? {
      connect_peer: {},
      open_channel: {},
      close_channel: {},
      list_channels: {},
      get_channel_fees: {},
      set_channel_fees: {},
      get_forwarding_history: {},
    },
  }

  const bobGrant: UsageProfile = {
    methods: opts?.bobGrantMethods ?? {
      get_info: {},
      get_balance: {},
      make_invoice: {},
      lookup_invoice: {},
      list_transactions: {},
      make_offer: {},
      lookup_offer: {},
      make_new_address: {},
      lookup_address: {},
      make_bip321: {},
    },
    control: opts?.bobGrantControl ?? {
      list_channels: {},
      get_channel_fees: {},
    },
  }

  await Promise.all([
    publishGrant(ownerSigner, relay.url, aliceServicePk, aliceClientPk, aliceGrant),
    publishGrant(ownerSigner, relay.url, bobServicePk, bobClientPk, bobGrant),
  ])
  console.log('[e2e] Grants published')

  await sleep(2_000)

  // ── 5. Create SDK clients ────────────────────────────────────────────
  const pool = new SimplePool()
  const clientOpts = { pool, timeoutMs: 60_000 }

  const aliceNwc = new NwcClient(
    new SecretKeySigner(aliceClientSk), aliceServicePk, [relay.url], clientOpts,
  )
  const aliceNnc = new NncClient(
    new SecretKeySigner(aliceClientSk), aliceServicePk, [relay.url], clientOpts,
  )
  const bobNwc = new NwcClient(
    new SecretKeySigner(bobClientSk), bobServicePk, [relay.url], clientOpts,
  )
  const bobNnc = new NncClient(
    new SecretKeySigner(bobClientSk), bobServicePk, [relay.url], clientOpts,
  )

  // ── 6. get_info → extract Lightning node pubkeys ────────────────────
  console.log('[e2e] Querying node info...')
  const [aliceInfo, bobInfo] = await Promise.all([
    aliceNwc.getInfo(),
    bobNwc.getInfo(),
  ])

  const aliceNodePk = aliceInfo.pubkey!
  const bobNodePk = bobInfo.pubkey!
  console.log(`[e2e] Alice node: ${aliceNodePk.slice(0, 16)}...`)
  console.log(`[e2e] Bob node:   ${bobNodePk.slice(0, 16)}...`)

  // ── 7. Fund Alice ──────────────────────────────────────────────────
  console.log('[e2e] Funding Alice...')
  const addrResult = await aliceNwc.makeNewAddress()
  await bitcoind.rpc.sendToAddress(addrResult.address, 0.05)
  await bitcoind.rpc.mineBlocks(1, minerAddress)

  const FUNDING_MSATS = 5_000_000_000
  const balanceDeadline = Date.now() + 30_000
  while (Date.now() < balanceDeadline) {
    const balance = await aliceNwc.getBalance()
    if (balance.balance >= FUNDING_MSATS) {
      console.log(`[e2e] Alice funded: ${balance.balance} msats`)
      break
    }
    await sleep(500)
  }

  if (openChannel) {
    // ── 8. Connect peer and open channel ───────────────────────────────
    console.log(`[e2e] Connecting Alice → Bob at 127.0.0.1:${bobPort}...`)
    await aliceNnc.connectPeer({ pubkey: bobNodePk, host: `127.0.0.1:${bobPort}` })

    console.log(`[e2e] Opening ${channelAmount} sat channel (push ${pushAmount})...`)
    await aliceNnc.openChannel({
      pubkey: bobNodePk,
      host: `127.0.0.1:${bobPort}`,
      amount: channelAmount,
      push_amount: pushAmount,
    })

    await bitcoind.rpc.mineBlocks(6, minerAddress)

    // Poll until channel is active
    const channelDeadline = Date.now() + 60_000
    while (Date.now() < channelDeadline) {
      const [aliceChannels, bobChannels] = await Promise.all([
        aliceNnc.listChannels(),
        bobNnc.listChannels(),
      ])

      const aliceReady = aliceChannels.channels.some(
        (ch) => ch.peer_pubkey === bobNodePk && ch.state === 'active',
      )
      const bobReady = bobChannels.channels.some(
        (ch) => ch.peer_pubkey === aliceNodePk && ch.state === 'active',
      )

      if (aliceReady && bobReady) {
        console.log('[e2e] Channel is active!')
        break
      }

      await bitcoind.rpc.mineBlocks(1, minerAddress)
      await sleep(500)
    }
  }

  const cleanup = () => {
    aliceNwc.close()
    aliceNnc.close()
    bobNwc.close()
    bobNnc.close()
    try { pool.close([]) } catch { /* ignore */ }
    cleanupContainers()
  }

  return {
    relay,
    bitcoind,
    alice,
    bob,
    aliceNwc,
    aliceNnc,
    bobNwc,
    bobNnc,
    aliceNodePk,
    bobNodePk,
    minerAddress,
    pool,
    cleanup,
  }
}
