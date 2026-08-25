/**
 * Packs `dist/` into a signed `.crx`, with no Chrome and no dependencies.
 *
 * A CRX3 file is three things glued together:
 *
 *   "Cr24" | version=3 (u32 LE) | header length (u32 LE) | header | zip
 *
 * where `header` is a protobuf `CrxFileHeader` carrying the public key, an
 * RSA-SHA256 signature, and a `signed_header_data` blob holding the extension
 * id. The signature covers a very specific byte sequence — the magic string
 * `CRX3 SignedData\0`, the length of `signed_header_data`, that blob, and then
 * the entire zip. Get the order wrong and Chrome rejects the file with a
 * message that does not say which part was wrong, which is why every step below
 * is spelled out rather than folded together.
 *
 * The key is generated on first run and kept out of git. **It is the
 * extension's identity**: the id Chrome shows is derived from the public key,
 * so losing it means every existing install sees the next build as a different
 * extension.
 *
 * Usage: node scripts/pack-crx.mjs
 */
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  createSign,
  generateKeyPairSync,
} from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dist = join(root, 'dist')
const keyPath = join(root, '.crx-key.pem')

if (!existsSync(dist)) {
  console.error('dist/ does not exist — run `npm run build` first.')
  process.exit(1)
}

// --- key -------------------------------------------------------------------

if (!existsSync(keyPath)) {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  writeFileSync(keyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 })
  console.log(`generated a new signing key at ${keyPath}`)
  console.log('KEEP IT. The extension id is derived from it; a new key is a new extension.')
}

const privateKey = createPrivateKey(readFileSync(keyPath))
// `spki` is a *public* key encoding; deriving the public key first is not a
// formality, it is the only way to get the DER bytes the crx id is hashed from.
const publicKeyDer = createPublicKey(privateKey).export({ type: 'spki', format: 'der' })

/**
 * Chrome's extension id: the first 16 bytes of SHA-256 over the public key,
 * rendered in "mpdecimal" — hex digits mapped onto a-p, which is why extension
 * ids look like words rather than hashes.
 */
const crxId = createHash('sha256').update(publicKeyDer).digest().subarray(0, 16)
const extensionId = [...crxId]
  .map((byte) => byte.toString(16).padStart(2, '0'))
  .join('')
  .split('')
  .map((digit) => String.fromCharCode(97 + parseInt(digit, 16)))
  .join('')

// --- zip -------------------------------------------------------------------

const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version
const zipPath = join(root, `.crx-payload-${version}.zip`)
rmSync(zipPath, { force: true })
try {
  // Source maps are useful locally but bloat the package and leak source.
  execFileSync('zip', ['-r', '-q', '-X', zipPath, '.', '-x', '*.map'], { cwd: dist })
} catch (error) {
  console.error('Packing failed. Is the `zip` command available on this system?')
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
}
const zip = readFileSync(zipPath)

// --- protobuf --------------------------------------------------------------

/** Minimal protobuf writer: only the two wire types CRX3 needs. */
const varint = (value) => {
  const bytes = []
  let rest = value
  while (rest > 0x7f) {
    bytes.push((rest & 0x7f) | 0x80)
    rest >>>= 7
  }
  bytes.push(rest)
  return Buffer.from(bytes)
}

/** field number + wire type 2 (length-delimited), then length, then payload. */
const field = (number, payload) =>
  Buffer.concat([varint((number << 3) | 2), varint(payload.length), payload])

// SignedData { bytes crx_id = 1; }
const signedHeaderData = field(1, crxId)

// AsymmetricKeyProof { bytes public_key = 1; bytes signature = 2; }
const signatureInput = Buffer.concat([
  Buffer.from('CRX3 SignedData\x00', 'binary'),
  (() => {
    const length = Buffer.alloc(4)
    length.writeUInt32LE(signedHeaderData.length)
    return length
  })(),
  signedHeaderData,
  zip,
])

const signature = createSign('sha256').update(signatureInput).sign(privateKey)
const proof = Buffer.concat([field(1, publicKeyDer), field(2, signature)])

// CrxFileHeader { repeated AsymmetricKeyProof sha256_with_rsa = 2; bytes signed_header_data = 10000; }
const header = Buffer.concat([field(2, proof), field(10000, signedHeaderData)])

// --- container -------------------------------------------------------------

const prefix = Buffer.alloc(12)
prefix.write('Cr24', 0, 'ascii')
prefix.writeUInt32LE(3, 4) // CRX3
prefix.writeUInt32LE(header.length, 8)

const output = join(root, `fanfan-cards-v${version}.crx`)
writeFileSync(output, Buffer.concat([prefix, header, zip]))
rmSync(zipPath, { force: true })

// The policy-install companion. Chrome fetches this to discover the version.
const updateXml = `<?xml version="1.0" encoding="UTF-8"?>
<gupdate xmlns="http://www.google.com/update2/response" protocol="2.0">
  <app appid="${extensionId}">
    <updatecheck codebase="REPLACE_WITH_HTTPS_URL_TO_THE_CRX" version="${version}" />
  </app>
</gupdate>
`
writeFileSync(join(root, 'update.xml'), updateXml)

console.log(`packed ${output}`)
console.log(`extension id: ${extensionId}`)
console.log('wrote update.xml (fill in the codebase URL before serving it)')
console.log('')
console.log('拖进 chrome://extensions 会报 CRX_REQUIRED_PROOF_MISSING —— 这不是包坏了。')
console.log('Chrome 要求 .crx 里额外带一份应用商店的发布者签名，自签名的包永远没有，')
console.log('所以拖拽安装被硬性拒绝，且没有开关可以绕过。三条能用的路：')
console.log('')
console.log('  1. 日常自测：chrome://extensions 开发者模式 →「加载已解压的扩展程序」→ dist/')
console.log('  2. 上架商店：用 `npm run zip`，商店收的是 zip，不是 crx')
console.log('  3. 企业分发：把这个 crx 与 update.xml 放到 HTTPS 上，用 ExtensionSettings')
console.log('     策略按 id 强制安装（macOS 走 /Library/Managed Preferences 的 plist）')
console.log('')
console.log('这个 crx 的真正用处是第 3 条，以及在多台机器上保持同一个扩展 id。')
