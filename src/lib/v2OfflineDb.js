const DB_NAME = 'physio-doc-v2-cache'
const DB_VERSION = 2

const PATIENTS = 'patients'
const PRESCRIPTIONS = 'prescriptions'
const DOC_ENTRIES = 'docEntries'
const OUTBOX = 'outbox'

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = () => {
      const db = request.result

      if (!db.objectStoreNames.contains(PATIENTS)) {
        db.createObjectStore(PATIENTS, { keyPath: 'id' })
      }

      if (!db.objectStoreNames.contains(PRESCRIPTIONS)) {
        const store = db.createObjectStore(PRESCRIPTIONS, { keyPath: 'id' })
        store.createIndex('patientId', 'patientId', { unique: false })
      }

      if (!db.objectStoreNames.contains(DOC_ENTRIES)) {
        const store = db.createObjectStore(DOC_ENTRIES, { keyPath: 'id' })
        store.createIndex('prescriptionId', 'prescriptionId', { unique: false })
      }

      if (!db.objectStoreNames.contains(OUTBOX)) {
        const store = db.createObjectStore(OUTBOX, { keyPath: 'id' })
        store.createIndex('queuedAt', 'queuedAt', { unique: false })
        store.createIndex('kind', 'kind', { unique: false })
      }
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(new Error(request.error?.message || 'Offline-Datenbank konnte nicht geöffnet werden.'))
  })
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(new Error(request.error?.message || 'Offline-Abfrage fehlgeschlagen.'))
  })
}

function transactionDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(new Error(tx.error?.message || 'Offline-Transaktion fehlgeschlagen.'))
    tx.onabort = () => reject(new Error(tx.error?.message || 'Offline-Transaktion wurde abgebrochen.'))
  })
}

async function replaceStore(storeName, items) {
  const db = await openDb()
  const tx = db.transaction(storeName, 'readwrite')
  const store = tx.objectStore(storeName)
  store.clear()
  for (const item of items || []) store.put(item)
  await transactionDone(tx)
}

async function put(storeName, item) {
  if (!item?.id) return
  const db = await openDb()
  const tx = db.transaction(storeName, 'readwrite')
  tx.objectStore(storeName).put(item)
  await transactionDone(tx)
}

async function getAll(storeName) {
  const db = await openDb()
  const tx = db.transaction(storeName, 'readonly')
  return requestResult(tx.objectStore(storeName).getAll())
}

async function getById(storeName, id) {
  const db = await openDb()
  const tx = db.transaction(storeName, 'readonly')
  return requestResult(tx.objectStore(storeName).get(id))
}

async function getByIndex(storeName, indexName, value) {
  const db = await openDb()
  const tx = db.transaction(storeName, 'readonly')
  return requestResult(tx.objectStore(storeName).index(indexName).getAll(value))
}

export async function cachePatients(items) {
  await replaceStore(PATIENTS, items)
}

export async function cachePatient(item) {
  await put(PATIENTS, item)
}

export async function getCachedPatients() {
  const items = await getAll(PATIENTS)
  return items.sort((a, b) =>
    (a.lastName || '').localeCompare(b.lastName || '', 'de') ||
    (a.firstName || '').localeCompare(b.firstName || '', 'de')
  )
}

export async function getCachedPatient(id) {
  return getById(PATIENTS, id)
}

export async function cachePrescriptions(items) {
  for (const item of items || []) await put(PRESCRIPTIONS, item)
}

export async function cachePrescription(item) {
  await put(PRESCRIPTIONS, item)
}

export async function getCachedPrescriptions(patientId) {
  const items = await getByIndex(PRESCRIPTIONS, 'patientId', patientId)
  return items
    .filter(item => !item.deletedAt)
    .sort((a, b) => (b.issueDate || '').localeCompare(a.issueDate || ''))
}

export async function cacheDocEntries(items) {
  for (const item of items || []) await put(DOC_ENTRIES, item)
}

export async function cacheDocEntry(item) {
  await put(DOC_ENTRIES, item)
}

export async function getCachedDocEntries(prescriptionId) {
  const items = await getByIndex(DOC_ENTRIES, 'prescriptionId', prescriptionId)
  return items
    .filter(item => !item.deletedAt)
    .sort((a, b) =>
      (b.entryDate || '').localeCompare(a.entryDate || '') ||
      (b.createdAt || '').localeCompare(a.createdAt || '')
    )
}


export async function enqueueOutbox(operation) {
  if (!operation?.id) throw new Error('Outbox-Eintrag ohne ID.')
  const db = await openDb()
  const tx = db.transaction(OUTBOX, 'readwrite')
  const store = tx.objectStore(OUTBOX)
  const existing = await requestResult(store.get(operation.id))

  const next = {
    ...operation,
    queuedAt: existing?.queuedAt || operation.queuedAt || new Date().toISOString(),
    mode: existing?.mode || operation.mode,
    expectedUpdatedAt: existing?.expectedUpdatedAt || operation.expectedUpdatedAt || '',
    status: 'pending',
  }

  store.put(next)
  await transactionDone(tx)
  return next
}

export async function getOutboxItems() {
  const items = await getAll(OUTBOX)
  const priority = { patient: 1, prescription: 2, docEntry: 3 }
  return items.sort((a, b) =>
    (priority[a.kind] || 99) - (priority[b.kind] || 99) ||
    (a.queuedAt || '').localeCompare(b.queuedAt || '')
  )
}

export async function removeOutboxItem(id) {
  const db = await openDb()
  const tx = db.transaction(OUTBOX, 'readwrite')
  tx.objectStore(OUTBOX).delete(id)
  await transactionDone(tx)
}

export async function markOutboxConflict(id, remote) {
  const db = await openDb()
  const tx = db.transaction(OUTBOX, 'readwrite')
  const store = tx.objectStore(OUTBOX)
  const item = await requestResult(store.get(id))
  if (item) {
    store.put({ ...item, status: 'conflict', remote, conflictAt: new Date().toISOString() })
  }
  await transactionDone(tx)
}

export async function getOutboxCount() {
  const db = await openDb()
  const tx = db.transaction(OUTBOX, 'readonly')
  return requestResult(tx.objectStore(OUTBOX).count())
}
