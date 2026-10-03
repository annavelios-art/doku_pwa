const DB_NAME = 'physiooptima-v3-mirror-outbox'
const DB_VERSION = 1
const STORE = 'outbox'

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' })
        store.createIndex('queuedAt', 'queuedAt', { unique: false })
        store.createIndex('kind', 'kind', { unique: false })
      }
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(
      new Error(request.error?.message || 'V3-Spiegel-Outbox konnte nicht geöffnet werden.'),
    )
  })
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(
      new Error(request.error?.message || 'V3-Spiegel-Outbox-Abfrage fehlgeschlagen.'),
    )
  })
}

function transactionDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(
      new Error(tx.error?.message || 'V3-Spiegel-Outbox-Transaktion fehlgeschlagen.'),
    )
    tx.onabort = () => reject(
      new Error(tx.error?.message || 'V3-Spiegel-Outbox-Transaktion wurde abgebrochen.'),
    )
  })
}

export async function enqueueV3MirrorOutbox(item) {
  const db = await openDb()
  const tx = db.transaction(STORE, 'readwrite')
  const store = tx.objectStore(STORE)
  const existing = await requestResult(store.get(item.id))
  const now = new Date().toISOString()

  store.put({
    ...item,
    queuedAt: existing?.queuedAt || item.queuedAt || now,
    updatedAt: now,
  })

  await transactionDone(tx)
}

export async function getV3MirrorOutboxItems() {
  const db = await openDb()
  const tx = db.transaction(STORE, 'readonly')
  const rows = await requestResult(tx.objectStore(STORE).getAll())

  return (rows || []).sort((a, b) =>
    (a.queuedAt || '').localeCompare(b.queuedAt || ''),
  )
}

export async function getV3MirrorOutboxCount() {
  const db = await openDb()
  const tx = db.transaction(STORE, 'readonly')
  return requestResult(tx.objectStore(STORE).count())
}

export async function removeV3MirrorOutboxItem(id) {
  const db = await openDb()
  const tx = db.transaction(STORE, 'readwrite')
  tx.objectStore(STORE).delete(id)
  await transactionDone(tx)
}

export async function inspectV3MirrorOutboxRaw(forbiddenValues = []) {
  const rows = await getV3MirrorOutboxItems()
  const raw = JSON.stringify(rows)
  const normalized = (forbiddenValues || [])
    .map(value => String(value || '').trim())
    .filter(value => value.length >= 3)

  const leaks = [...new Set(normalized.filter(value => raw.includes(value)))]

  return {
    count: rows.length,
    rawChars: raw.length,
    leaks,
    safe: leaks.length === 0,
  }
}
