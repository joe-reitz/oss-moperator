/**
 * Authenticated encryption for per-user Salesforce refresh tokens.
 *
 * AES-256-GCM with a fresh random IV per call. The auth tag detects
 * tampering — decryption fails closed if the ciphertext or the IV is
 * altered. Keys live in MOPERATOR_TOKEN_ENCRYPTION_KEY (64-char hex /
 * 32 bytes). Generate one with: `openssl rand -hex 32`.
 *
 * Stored format: `{ivBase64}:{authTagBase64}:{ciphertextBase64}`. Three
 * pieces, colon-delimited; we never store the key alongside the data.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "crypto"

const ALGORITHM = "aes-256-gcm"
const IV_BYTES = 12
const ENV_VAR = "MOPERATOR_TOKEN_ENCRYPTION_KEY"

function loadKey(): Buffer {
  const raw = process.env[ENV_VAR]
  if (!raw) {
    throw new Error(
      `${ENV_VAR} is not set. Generate one with \`openssl rand -hex 32\` and add it to your env.`,
    )
  }
  if (!/^[0-9a-fA-F]{64}$/.test(raw)) {
    throw new Error(`${ENV_VAR} must be a 64-character hex string (32 bytes).`)
  }
  return Buffer.from(raw, "hex")
}

/** Encrypt a plaintext string into the storage format. */
export function encryptSecret(plaintext: string): string {
  const key = loadKey()
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
  const authTag = cipher.getAuthTag()
  return `${iv.toString("base64")}:${authTag.toString("base64")}:${ciphertext.toString("base64")}`
}

/** Decrypt a value previously produced by encryptSecret. Throws on tamper. */
export function decryptSecret(payload: string): string {
  const parts = payload.split(":")
  if (parts.length !== 3) {
    throw new Error("Encrypted payload is malformed")
  }
  const [ivB64, tagB64, ctB64] = parts
  const key = loadKey()
  const iv = Buffer.from(ivB64, "base64")
  const authTag = Buffer.from(tagB64, "base64")
  const ciphertext = Buffer.from(ctB64, "base64")

  const decipher = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(authTag)
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()])
  return plaintext.toString("utf8")
}

export function assertEncryptionKeyConfigured(): void {
  loadKey()
}
