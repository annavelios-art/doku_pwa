const PBKDF2_ITERATIONS = 600000
const PASSWORD_WRAP_CONTEXT = 'physiooptima:v2:practice-key:password'
const RECOVERY_WRAP_CONTEXT = 'physiooptima:v2:practice-key:recovery'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

function ensureCrypto() {
  if (!globalThis.crypto?.subtle || !globalThis.crypto?.getRandomValues) {
    throw new Error('Dieser Browser unterstützt die benötigte Web-Crypto-Verschlüsselung nicht.')
  }
}

function bytesToBase64(bytes) {
  let binary = ''
  bytes.forEach(byte => { binary += String.fromCharCode(byte) })
  return globalThis.btoa(binary)
}

function base64ToBytes(base64) {
  const binary = globalThis.atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function bytesToBase64Url(bytes) {
  return bytesToBase64(bytes)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

function base64UrlToBytes(value) {
  const normalized = String(value || '')
    .replace(/[\s-]/g, '')
    .replace(/_/g, '/')
    .replace(/-/g, '+')

  const padding = normalized.length % 4 === 0
    ? ''
    : '='.repeat(4 - (normalized.length % 4))

  return base64ToBytes(normalized + padding)
}

function randomBytes(length) {
  ensureCrypto()
  return globalThis.crypto.getRandomValues(new Uint8Array(length))
}

async function importAesKey(rawBytes, usages) {
  ensureCrypto()
  return globalThis.crypto.subtle.importKey(
    'raw',
    rawBytes,
    { name: 'AES-GCM', length: 256 },
    false,
    usages,
  )
}

async function derivePasswordKey(passphrase, salt, iterations = PBKDF2_ITERATIONS) {
  ensureCrypto()

  const material = await globalThis.crypto.subtle.importKey(
    'raw',
    encoder.encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  )

  return globalThis.crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt,
      iterations,
    },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

async function aesEncryptBytes(plainBytes, key, aad = '') {
  const iv = randomBytes(12)
  const additionalData = aad ? encoder.encode(aad) : undefined
  const encrypted = await globalThis.crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv,
      ...(additionalData ? { additionalData } : {}),
    },
    key,
    plainBytes,
  )

  return {
    iv: bytesToBase64(iv),
    data: bytesToBase64(new Uint8Array(encrypted)),
  }
}

async function aesDecryptBytes(payload, key, aad = '') {
  const iv = base64ToBytes(payload.iv)
  const encrypted = base64ToBytes(payload.data)
  const additionalData = aad ? encoder.encode(aad) : undefined

  const plain = await globalThis.crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv,
      ...(additionalData ? { additionalData } : {}),
    },
    key,
    encrypted,
  )

  return new Uint8Array(plain)
}

async function wrapWithPassword(rawPracticeKey, passphrase) {
  const salt = randomBytes(16)
  const passwordKey = await derivePasswordKey(passphrase, salt)
  const encrypted = await aesEncryptBytes(rawPracticeKey, passwordKey, PASSWORD_WRAP_CONTEXT)

  return {
    version: 1,
    algorithm: 'AES-256-GCM',
    kdf: 'PBKDF2-SHA256',
    iterations: PBKDF2_ITERATIONS,
    salt: bytesToBase64(salt),
    aad: PASSWORD_WRAP_CONTEXT,
    ...encrypted,
  }
}

async function unwrapWithPassword(envelope, passphrase) {
  if (!envelope || envelope.version !== 1 || envelope.algorithm !== 'AES-256-GCM') {
    throw new Error('Der geschützte Praxisschlüssel hat ein unbekanntes Format.')
  }

  const salt = base64ToBytes(envelope.salt)
  const passwordKey = await derivePasswordKey(
    passphrase,
    salt,
    envelope.iterations || PBKDF2_ITERATIONS,
  )

  return aesDecryptBytes(
    envelope,
    passwordKey,
    envelope.aad || PASSWORD_WRAP_CONTEXT,
  )
}

async function wrapWithRecoveryKey(rawPracticeKey, rawRecoveryKey) {
  const recoveryKey = await importAesKey(rawRecoveryKey, ['encrypt'])
  const encrypted = await aesEncryptBytes(rawPracticeKey, recoveryKey, RECOVERY_WRAP_CONTEXT)

  return {
    version: 1,
    algorithm: 'AES-256-GCM',
    aad: RECOVERY_WRAP_CONTEXT,
    ...encrypted,
  }
}

async function unwrapWithRecoveryKey(envelope, recoveryCode) {
  const rawRecoveryKey = base64UrlToBytes(recoveryCode)
  if (rawRecoveryKey.length !== 32) {
    throw new Error('Der Wiederherstellungsschlüssel hat ein ungültiges Format.')
  }

  const recoveryKey = await importAesKey(rawRecoveryKey, ['decrypt'])
  return aesDecryptBytes(
    envelope,
    recoveryKey,
    envelope.aad || RECOVERY_WRAP_CONTEXT,
  )
}

function formatRecoveryCode(rawRecoveryKey) {
  const compact = bytesToBase64Url(rawRecoveryKey)
  return compact.match(/.{1,6}/g)?.join('-') || compact
}

export async function createPracticeKeyBundle(passphrase) {
  if (String(passphrase || '').length < 12) {
    throw new Error('Für den Test bitte eine Passphrase mit mindestens 12 Zeichen verwenden.')
  }

  const rawPracticeKey = randomBytes(32)
  const rawRecoveryKey = randomBytes(32)

  const [passwordEnvelope, recoveryEnvelope] = await Promise.all([
    wrapWithPassword(rawPracticeKey, passphrase),
    wrapWithRecoveryKey(rawPracticeKey, rawRecoveryKey),
  ])

  const practiceKey = await importAesKey(rawPracticeKey, ['encrypt', 'decrypt'])

  return {
    practiceKey,
    passwordEnvelope,
    recoveryEnvelope,
    recoveryCode: formatRecoveryCode(rawRecoveryKey),
  }
}

export async function unlockPracticeKey(passphrase, passwordEnvelope) {
  if (!passphrase) throw new Error('Bitte die Verschlüsselungs-Passphrase eingeben.')

  try {
    const rawPracticeKey = await unwrapWithPassword(passwordEnvelope, passphrase)
    if (rawPracticeKey.length !== 32) throw new Error('Ungültige Schlüssellänge.')
    return importAesKey(rawPracticeKey, ['encrypt', 'decrypt'])
  } catch {
    throw new Error('Passphrase falsch oder Testschlüssel beschädigt.')
  }
}

export async function unlockPracticeKeyWithRecovery(recoveryCode, recoveryEnvelope) {
  try {
    const rawPracticeKey = await unwrapWithRecoveryKey(recoveryEnvelope, recoveryCode)
    if (rawPracticeKey.length !== 32) throw new Error('Ungültige Schlüssellänge.')
    return importAesKey(rawPracticeKey, ['encrypt', 'decrypt'])
  } catch {
    throw new Error('Wiederherstellungsschlüssel falsch oder Testschlüssel beschädigt.')
  }
}

export async function encryptPracticeText(text, practiceKey, context = 'physiooptima:v2:test-text') {
  if (!practiceKey) throw new Error('Praxisschlüssel ist nicht entsperrt.')

  const encrypted = await aesEncryptBytes(encoder.encode(String(text || '')), practiceKey, context)

  return {
    version: 1,
    algorithm: 'AES-256-GCM',
    aad: context,
    ...encrypted,
  }
}

export async function decryptPracticeText(envelope, practiceKey) {
  if (!practiceKey) throw new Error('Praxisschlüssel ist nicht entsperrt.')
  const plain = await aesDecryptBytes(envelope, practiceKey, envelope.aad || '')
  return decoder.decode(plain)
}

export const V2_CRYPTO_PARAMETERS = Object.freeze({
  algorithm: 'AES-256-GCM',
  kdf: 'PBKDF2-SHA256',
  iterations: PBKDF2_ITERATIONS,
})
