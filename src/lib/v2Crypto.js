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
  const CHUNK_SIZE = 0x8000
  const chunks = []

  for (let offset = 0; offset < bytes.length; offset += CHUNK_SIZE) {
    const chunk = bytes.subarray(offset, Math.min(offset + CHUNK_SIZE, bytes.length))
    chunks.push(String.fromCharCode(...chunk))
  }

  return globalThis.btoa(chunks.join(''))
}

function base64ToBytes(base64) {
  const binary = globalThis.atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function bytesToHex(bytes) {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
}

function recoveryCodeToBytes(value) {
  const normalized = String(value || '').replace(/[\s-]/g, '').toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    throw new Error('Der Wiederherstellungsschlüssel hat ein ungültiges Format.')
  }

  const bytes = new Uint8Array(32)
  for (let i = 0; i < 32; i += 1) {
    bytes[i] = Number.parseInt(normalized.slice(i * 2, i * 2 + 2), 16)
  }
  return bytes
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
  const rawRecoveryKey = recoveryCodeToBytes(recoveryCode)

  const recoveryKey = await importAesKey(rawRecoveryKey, ['decrypt'])
  return aesDecryptBytes(
    envelope,
    recoveryKey,
    envelope.aad || RECOVERY_WRAP_CONTEXT,
  )
}

function formatRecoveryCode(rawRecoveryKey) {
  const compact = bytesToHex(rawRecoveryKey)
  return compact.match(/.{1,8}/g)?.join('-') || compact
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

export async function createProductionPracticeKeyBundle(passphrase) {
  if (String(passphrase || '').length < 16) {
    throw new Error('Die echte Verschlüsselungs-Passphrase muss mindestens 16 Zeichen lang sein.')
  }

  return createPracticeKeyBundle(passphrase)
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

export async function decryptPracticeText(envelope, practiceKey, expectedContext = '') {
  if (!practiceKey) throw new Error('Praxisschlüssel ist nicht entsperrt.')

  if (expectedContext && envelope?.aad !== expectedContext) {
    throw new Error('Der verschlüsselte Datensatz gehört nicht an diese Stelle.')
  }

  const context = expectedContext || envelope?.aad || ''
  const plain = await aesDecryptBytes(envelope, practiceKey, context)
  return decoder.decode(plain)
}


export async function createBackupPassphraseKey(passphrase) {
  if (String(passphrase || '').length < 16) {
    throw new Error('Das Backup-Passwort muss mindestens 16 Zeichen lang sein.')
  }

  const salt = randomBytes(16)
  const key = await derivePasswordKey(passphrase, salt)

  return {
    key,
    kdf: {
      name: 'PBKDF2-SHA256',
      iterations: PBKDF2_ITERATIONS,
      salt: bytesToBase64(salt),
    },
  }
}

export async function unlockBackupPassphraseKey(passphrase, kdf) {
  if (!passphrase) throw new Error('Bitte das Backup-Passwort eingeben.')
  if (!kdf?.salt || kdf.name !== 'PBKDF2-SHA256') {
    throw new Error('Das Backup verwendet unbekannte Schlüsselparameter.')
  }

  return derivePasswordKey(
    passphrase,
    base64ToBytes(kdf.salt),
    kdf.iterations || PBKDF2_ITERATIONS,
  )
}

export async function encryptBackupBytesRaw(bytes, key, context) {
  if (!key) throw new Error('Backup-Schlüssel fehlt.')
  if (!context) throw new Error('Backup-Kontext fehlt.')

  const plainBytes = bytes instanceof Uint8Array
    ? bytes
    : new Uint8Array(bytes)
  const iv = randomBytes(12)
  const encrypted = await globalThis.crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv,
      additionalData: encoder.encode(context),
    },
    key,
    plainBytes,
  )

  return {
    iv: bytesToBase64(iv),
    data: new Uint8Array(encrypted),
  }
}

export async function decryptBackupBytesRaw(bytes, key, ivBase64, context) {
  if (!key) throw new Error('Backup-Schlüssel fehlt.')
  if (!ivBase64 || !context) throw new Error('Backup-Verschlüsselungsdaten fehlen.')

  try {
    const encryptedBytes = bytes instanceof Uint8Array
      ? bytes
      : new Uint8Array(bytes)
    const plain = await globalThis.crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: base64ToBytes(ivBase64),
        additionalData: encoder.encode(context),
      },
      key,
      encryptedBytes,
    )
    return new Uint8Array(plain)
  } catch {
    throw new Error('Backup-Passwort falsch oder verschlüsselter Backup-Inhalt beschädigt.')
  }
}

export async function encryptBytesWithPassphrase(
  bytes,
  passphrase,
  context = 'physiooptima:v2:encrypted-backup',
) {
  if (String(passphrase || '').length < 16) {
    throw new Error('Das Backup-Passwort muss mindestens 16 Zeichen lang sein.')
  }

  const plainBytes = bytes instanceof Uint8Array
    ? bytes
    : new Uint8Array(bytes)
  const salt = randomBytes(16)
  const passwordKey = await derivePasswordKey(passphrase, salt)
  const encrypted = await aesEncryptBytes(plainBytes, passwordKey, context)

  return {
    version: 1,
    algorithm: 'AES-256-GCM',
    kdf: 'PBKDF2-SHA256',
    iterations: PBKDF2_ITERATIONS,
    salt: bytesToBase64(salt),
    aad: context,
    ...encrypted,
  }
}

export async function decryptBytesWithPassphrase(
  envelope,
  passphrase,
  expectedContext = 'physiooptima:v2:encrypted-backup',
) {
  if (!passphrase) throw new Error('Bitte das Backup-Passwort eingeben.')
  if (!envelope || envelope.version !== 1 || envelope.algorithm !== 'AES-256-GCM') {
    throw new Error('Das verschlüsselte Backup hat ein unbekanntes Format.')
  }
  if (envelope.aad !== expectedContext) {
    throw new Error('Dieses verschlüsselte Paket ist kein erwartetes PhysioOptima-Backup.')
  }

  try {
    const salt = base64ToBytes(envelope.salt)
    const passwordKey = await derivePasswordKey(
      passphrase,
      salt,
      envelope.iterations || PBKDF2_ITERATIONS,
    )
    return aesDecryptBytes(envelope, passwordKey, expectedContext)
  } catch {
    throw new Error('Backup-Passwort falsch oder Backup beschädigt.')
  }
}

export async function encryptPracticeBytesRaw(bytes, practiceKey, context) {
  if (!practiceKey) throw new Error('Praxisschlüssel ist nicht entsperrt.')
  if (!context) throw new Error('Für Dateiverschlüsselung fehlt der technische Kontext.')

  const plainBytes = bytes instanceof Uint8Array
    ? bytes
    : new Uint8Array(bytes)
  const iv = randomBytes(12)
  const encrypted = await globalThis.crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv,
      additionalData: encoder.encode(context),
    },
    practiceKey,
    plainBytes,
  )

  return {
    version: 1,
    algorithm: 'AES-256-GCM',
    aad: context,
    iv: bytesToBase64(iv),
    data: new Uint8Array(encrypted),
  }
}

export async function decryptPracticeBytesRaw(
  bytes,
  practiceKey,
  ivBase64,
  expectedContext,
) {
  if (!practiceKey) throw new Error('Praxisschlüssel ist nicht entsperrt.')
  if (!ivBase64 || !expectedContext) {
    throw new Error('Datei-Verschlüsselungsdaten fehlen.')
  }

  try {
    const encryptedBytes = bytes instanceof Uint8Array
      ? bytes
      : new Uint8Array(bytes)
    const plain = await globalThis.crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: base64ToBytes(ivBase64),
        additionalData: encoder.encode(expectedContext),
      },
      practiceKey,
      encryptedBytes,
    )
    return new Uint8Array(plain)
  } catch {
    throw new Error('V3-Datei konnte nicht entschlüsselt werden.')
  }
}

export async function encryptPracticeBytes(bytes, practiceKey, context) {
  if (!practiceKey) throw new Error('Praxisschlüssel ist nicht entsperrt.')
  if (!context) throw new Error('Für Dateiverschlüsselung fehlt der technische Kontext.')

  const plainBytes = bytes instanceof Uint8Array
    ? bytes
    : new Uint8Array(bytes)

  const encrypted = await aesEncryptBytes(plainBytes, practiceKey, context)

  return {
    version: 1,
    algorithm: 'AES-256-GCM',
    aad: context,
    ...encrypted,
  }
}

export async function decryptPracticeBytes(envelope, practiceKey, expectedContext) {
  if (!practiceKey) throw new Error('Praxisschlüssel ist nicht entsperrt.')
  if (!expectedContext || envelope?.aad !== expectedContext) {
    throw new Error('Die verschlüsselte Datei gehört nicht an diese Stelle.')
  }

  return aesDecryptBytes(envelope, practiceKey, expectedContext)
}

export async function sha256Hex(bytes) {
  ensureCrypto()
  const plainBytes = bytes instanceof Uint8Array
    ? bytes
    : new Uint8Array(bytes)
  const digest = await globalThis.crypto.subtle.digest('SHA-256', plainBytes)
  return bytesToHex(new Uint8Array(digest))
}

export const V2_CRYPTO_PARAMETERS = Object.freeze({
  algorithm: 'AES-256-GCM',
  kdf: 'PBKDF2-SHA256',
  iterations: PBKDF2_ITERATIONS,
})
