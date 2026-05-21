const DB_NAME = 'physio-doc-local';
const DB_VERSION = 1;
const PATIENT_STORE = 'patients';
const META_STORE = 'meta';
const LAST_OPENED_KEY = 'lastOpenedPatientIds';
const MAX_RECENT = 5;

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(PATIENT_STORE)) {
        const patientStore = db.createObjectStore(PATIENT_STORE, { keyPath: 'id' });
        patientStore.createIndex('lastName', 'lastName', { unique: false });
      }

      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE, { keyPath: 'key' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error(request.error?.message || 'Datenbank konnte nicht geöffnet werden.'));
  });
}

function runTransaction(storeName, mode, executor) {
  return openDb().then(
    db =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, mode);
        const store = tx.objectStore(storeName);

        let result;
        try {
          result = executor(store);
        } catch (error) {
          reject(error);
          return;
        }

        tx.oncomplete = () => resolve(result);
        tx.onerror = () => reject(new Error(tx.error?.message || 'Datenbank-Transaktion fehlgeschlagen.'));
      }),
  );
}

function getRequestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error(request.error?.message || 'Datenbankabfrage fehlgeschlagen.'));
  });
}

export async function getAllPatients() {
  try {
    const db = await openDb();
    const tx = db.transaction(PATIENT_STORE, 'readonly');
    const store = tx.objectStore(PATIENT_STORE);
    const patients = await getRequestResult(store.getAll());
    return patients.sort((a, b) => {
      const byLastName = a.lastName.localeCompare(b.lastName, 'de');
      if (byLastName !== 0) return byLastName;
      return a.firstName.localeCompare(b.firstName, 'de');
    });
  } catch (error) {
    throw new Error(`Patienten konnten nicht geladen werden: ${error.message}`);
  }
}

export async function getPatientById(id) {
  try {
    const db = await openDb();
    const tx = db.transaction(PATIENT_STORE, 'readonly');
    const store = tx.objectStore(PATIENT_STORE);
    return await getRequestResult(store.get(id));
  } catch (error) {
    throw new Error(`Patient konnte nicht geladen werden: ${error.message}`);
  }
}

export async function savePatient(patientInput) {
  const now = new Date().toISOString();
  const patient = {
    ...patientInput,
    id: patientInput.id || crypto.randomUUID(),
    updatedAt: now,
    createdAt: patientInput.createdAt || now,
  };

  try {
    await runTransaction(PATIENT_STORE, 'readwrite', store => {
      store.put(patient);
      return patient;
    });
    return patient;
  } catch (error) {
    throw new Error(`Patient konnte nicht gespeichert werden: ${error.message}`);
  }
}

export async function deletePatient(id) {
  try {
    await runTransaction(PATIENT_STORE, 'readwrite', store => store.delete(id));
  } catch (error) {
    throw new Error(`Patient konnte nicht gelöscht werden: ${error.message}`);
  }
}

export async function markPatientAsRecentlyOpened(id) {
  try {
    const db = await openDb();
    const tx = db.transaction(META_STORE, 'readwrite');
    const store = tx.objectStore(META_STORE);

    const existing = await getRequestResult(store.get(LAST_OPENED_KEY));
    const previous = Array.isArray(existing?.value) ? existing.value : [];
    const next = [id, ...previous.filter(item => item !== id)].slice(0, MAX_RECENT);

    store.put({ key: LAST_OPENED_KEY, value: next });

    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(new Error(tx.error?.message || 'Zuletzt-geöffnet-Liste konnte nicht aktualisiert werden.'));
    });

    return next;
  } catch (error) {
    throw new Error(`Zuletzt geöffneter Patient konnte nicht gespeichert werden: ${error.message}`);
  }
}

export async function getRecentlyOpenedPatients() {
  try {
    const db = await openDb();
    const tx = db.transaction([META_STORE, PATIENT_STORE], 'readonly');
    const metaStore = tx.objectStore(META_STORE);
    const patientStore = tx.objectStore(PATIENT_STORE);

    const recentsEntry = await getRequestResult(metaStore.get(LAST_OPENED_KEY));
    const recentIds = Array.isArray(recentsEntry?.value) ? recentsEntry.value : [];

    const patients = await Promise.all(recentIds.map(id => getRequestResult(patientStore.get(id))));
    return patients.filter(Boolean);
  } catch (error) {
    throw new Error(`Zuletzt geöffnete Patienten konnten nicht geladen werden: ${error.message}`);
  }
}
