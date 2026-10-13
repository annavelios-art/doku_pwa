// Device-local opt-in. The non-extractable CryptoKey never leaves this browser.
export const PRACTICE_SESSION_MS = 24 * 60 * 60 * 1000
const DATABASE = 'physiooptima-key-session'
const STORE = 'sessions'
const SLOT = 'practice'

async function access(mode, operation) {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE, mode)
      const request = operation(transaction.objectStore(STORE))
      transaction.oncomplete = () => resolve(request.result)
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error || new Error('Speicherung abgebrochen.'))
    })
  } finally {
    db.close()
  }
}

function identity(userId, keyring) {
  return JSON.stringify([userId, keyring.password_envelope, keyring.recovery_envelope])
}

export async function rememberPracticeKey(key, userId, keyring) {
  if (key.extractable || key.type !== 'secret' || key.algorithm.name !== 'AES-GCM') {
    throw new Error('Ungültiger Praxisschlüssel.')
  }
  const expiresAt = Date.now() + PRACTICE_SESSION_MS
  await access('readwrite', store => store.put({ key, identity: identity(userId, keyring), expiresAt }, SLOT))
  return expiresAt
}

export async function forgetPracticeKey() {
  await access('readwrite', store => store.delete(SLOT))
}

export async function restorePracticeKey(userId, keyring) {
  const saved = await access('readonly', store => store.get(SLOT))
  if (!saved) return null
  if (saved.identity !== identity(userId, keyring) || !Number.isFinite(saved.expiresAt) ||
      saved.expiresAt <= Date.now() || saved.expiresAt > Date.now() + PRACTICE_SESSION_MS ||
      !saved.key || saved.key.extractable || saved.key.type !== 'secret' ||
      saved.key.algorithm?.name !== 'AES-GCM') {
    await forgetPracticeKey()
    return null
  }
  return saved
}
