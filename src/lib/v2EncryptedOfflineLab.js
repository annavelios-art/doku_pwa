const DB_NAME = 'physiooptima-v2-encrypted-offline-lab'
const DB_VERSION = 1

const CACHE = 'encryptedCache'
const OUTBOX = 'encryptedOutbox'

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = () => {
      const db = request.result

      if (!db.objectStoreNames.contains(CACHE)) {
        const store = db.createObjectStore(CACHE, { keyPath: 'id' })
        store.createIndex('kind', 'kind', { unique: false })
      }

      if (!db.objectStoreNames.contains(OUTBOX)) {
        const store = db.createObjectStore(OUTBOX, { keyPath: 'id' })
        store.createIndex('queuedAt', 'queuedAt', { unique: false })
        store.createIndex('kind', 'kind', { unique: false })
      }
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(
      new Error(request.error?.message || 'Verschlüsseltes Offline-Labor konnte nicht geöffnet werden.'),
    )
  })
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(
      new Error(request.error?.message || 'Offline-Labor-Abfrage fehlgeschlagen.'),
    )
  })
}

function transactionDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(
      new Error(tx.error?.message || 'Offline-Labor-Transaktion fehlgeschlagen.'),
    )
    tx.onabort = () => reject(
      new Error(tx.error?.message || 'Offline-Labor-Transaktion wurde abgebrochen.'),
    )
  })
}

async function getAll(storeName) {
  const db = await openDb()
  const tx = db.transaction(storeName, 'readonly')
  return requestResult(tx.objectStore(storeName).getAll())
}

export async function saveEncryptedOfflineSnapshot(rows) {
  if (!rows?.patient || !rows?.prescription || !rows?.docEntry) {
    throw new Error('Für den Offline-Test fehlen Patient, Verordnung oder Doku.')
  }

  const db = await openDb()
  const tx = db.transaction(CACHE, 'readwrite')
  const store = tx.objectStore(CACHE)
  store.clear()

  store.put({
    id: rows.patient.id,
    kind: 'patient',
    parentId: '',
    payload: rows.patient.payload,
    updatedAt: rows.patient.updated_at || new Date().toISOString(),
  })

  store.put({
    id: rows.prescription.id,
    kind: 'prescription',
    parentId: rows.prescription.patient_id,
    payload: rows.prescription.payload,
    updatedAt: rows.prescription.updated_at || new Date().toISOString(),
  })

  store.put({
    id: rows.docEntry.id,
    kind: 'docEntry',
    parentId: rows.docEntry.prescription_id,
    payload: rows.docEntry.payload,
    updatedAt: rows.docEntry.updated_at || new Date().toISOString(),
  })

  await transactionDone(tx)
}

export async function loadEncryptedOfflineSnapshot() {
  const rows = await getAll(CACHE)
  const patient = rows.find(row => row.kind === 'patient') || null
  const prescription = rows.find(row => row.kind === 'prescription') || null
  const docEntry = rows.find(row => row.kind === 'docEntry') || null

  if (!patient || !prescription || !docEntry) return null

  return { patient, prescription, docEntry }
}

export async function queueEncryptedOfflineDocEntry({
  id,
  prescriptionId,
  payload,
}) {
  if (!id || !prescriptionId || !payload) {
    throw new Error('Verschlüsselte Offline-Doku ist unvollständig.')
  }

  const now = new Date().toISOString()
  const db = await openDb()
  const tx = db.transaction([CACHE, OUTBOX], 'readwrite')

  tx.objectStore(CACHE).put({
    id,
    kind: 'docEntry',
    parentId: prescriptionId,
    payload,
    updatedAt: now,
  })

  const outbox = tx.objectStore(OUTBOX)
  const outboxId = `docEntry:${id}`
  const existing = await requestResult(outbox.get(outboxId))

  outbox.put({
    id: outboxId,
    kind: 'docEntry',
    entityId: id,
    parentId: prescriptionId,
    payload,
    queuedAt: existing?.queuedAt || now,
    updatedAt: now,
    status: 'pending',
  })

  await transactionDone(tx)
}

export async function getEncryptedOfflineOutbox() {
  const rows = await getAll(OUTBOX)
  return rows.sort((a, b) =>
    (a.queuedAt || '').localeCompare(b.queuedAt || ''),
  )
}

export async function removeEncryptedOfflineOutboxItem(id) {
  const db = await openDb()
  const tx = db.transaction(OUTBOX, 'readwrite')
  tx.objectStore(OUTBOX).delete(id)
  await transactionDone(tx)
}

export async function inspectEncryptedOfflineLabRaw() {
  const [cache, outbox] = await Promise.all([
    getAll(CACHE),
    getAll(OUTBOX),
  ])

  const raw = JSON.stringify({ cache, outbox })
  const forbiddenPatterns = [
    '"firstName":"Erika"',
    '"lastName":"Probe"',
    '"birthDate":"1965-04-12"',
    '"remedy":"MT"',
    'Schulter rechts',
    'Elevation eingeschränkt',
    'Elevation verbessert',
    'Behandlung gut vertragen',
  ]

  const leaks = forbiddenPatterns.filter(pattern => raw.includes(pattern))

  return {
    cacheCount: cache.length,
    outboxCount: outbox.length,
    rawChars: raw.length,
    leaks,
    safe: leaks.length === 0,
  }
}

export async function clearEncryptedOfflineLab() {
  const db = await openDb()
  const tx = db.transaction([CACHE, OUTBOX], 'readwrite')
  tx.objectStore(CACHE).clear()
  tx.objectStore(OUTBOX).clear()
  await transactionDone(tx)
}
