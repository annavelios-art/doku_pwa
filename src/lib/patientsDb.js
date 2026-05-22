const DB_NAME = 'physio-doc-local';
const DB_VERSION = 4;
const BACKUP_VERSION = 1;
const PATIENT_STORE = 'patients';
const PRESCRIPTION_STORE = 'prescriptions';
const DOC_ENTRY_STORE = 'docEntries';
const DOC_IMAGE_STORE = 'docEntryImages';
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

      if (!db.objectStoreNames.contains(PRESCRIPTION_STORE)) {
        const prescriptionStore = db.createObjectStore(PRESCRIPTION_STORE, { keyPath: 'id' });
        prescriptionStore.createIndex('patientId', 'patientId', { unique: false });
        prescriptionStore.createIndex('issueDate', 'issueDate', { unique: false });
      }

      if (!db.objectStoreNames.contains(DOC_ENTRY_STORE)) {
        const docEntryStore = db.createObjectStore(DOC_ENTRY_STORE, { keyPath: 'id' });
        docEntryStore.createIndex('prescriptionId', 'prescriptionId', { unique: false });
        docEntryStore.createIndex('entryDate', 'entryDate', { unique: false });
      }

      if (!db.objectStoreNames.contains(DOC_IMAGE_STORE)) {
        const imageStore = db.createObjectStore(DOC_IMAGE_STORE, { keyPath: 'id' });
        imageStore.createIndex('docEntryId', 'docEntryId', { unique: false });
      }

      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE, { keyPath: 'key' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error(request.error?.message || 'Datenbank konnte nicht geöffnet werden.'));
  });
}

function getRequestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error(request.error?.message || 'Datenbankabfrage fehlgeschlagen.'));
  });
}

function waitForTransaction(tx, fallbackMessage) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(new Error(tx.error?.message || fallbackMessage));
  });
}

async function getAllFromStore(storeName) {
  const db = await openDb();
  const tx = db.transaction(storeName, 'readonly');
  return getRequestResult(tx.objectStore(storeName).getAll());
}

export async function getAllPatients() {
  try {
    const patients = await getAllFromStore(PATIENT_STORE);
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
    return await getRequestResult(tx.objectStore(PATIENT_STORE).get(id));
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
    const db = await openDb();
    const tx = db.transaction(PATIENT_STORE, 'readwrite');
    tx.objectStore(PATIENT_STORE).put(patient);
    await waitForTransaction(tx, 'Datenbank-Transaktion fehlgeschlagen.');
    return patient;
  } catch (error) {
    throw new Error(`Patient konnte nicht gespeichert werden: ${error.message}`);
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
    await waitForTransaction(tx, 'Zuletzt-geöffnet-Liste konnte nicht aktualisiert werden.');

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

export async function getPrescriptionsByPatientId(patientId) {
  try {
    const db = await openDb();
    const tx = db.transaction(PRESCRIPTION_STORE, 'readonly');
    const index = tx.objectStore(PRESCRIPTION_STORE).index('patientId');
    const prescriptions = await getRequestResult(index.getAll(patientId));
    return prescriptions.sort((a, b) => b.issueDate.localeCompare(a.issueDate));
  } catch (error) {
    throw new Error(`Verordnungen konnten nicht geladen werden: ${error.message}`);
  }
}

export async function savePrescription(prescriptionInput) {
  const now = new Date().toISOString();
  const prescription = {
    ...prescriptionInput,
    id: prescriptionInput.id || crypto.randomUUID(),
    updatedAt: now,
    createdAt: prescriptionInput.createdAt || now,
  };

  try {
    const db = await openDb();
    const tx = db.transaction(PRESCRIPTION_STORE, 'readwrite');
    tx.objectStore(PRESCRIPTION_STORE).put(prescription);
    await waitForTransaction(tx, 'Datenbank-Transaktion fehlgeschlagen.');
    return prescription;
  } catch (error) {
    throw new Error(`Verordnung konnte nicht gespeichert werden: ${error.message}`);
  }
}

export async function getDocEntriesByPrescriptionId(prescriptionId) {
  try {
    const db = await openDb();
    const tx = db.transaction(DOC_ENTRY_STORE, 'readonly');
    const index = tx.objectStore(DOC_ENTRY_STORE).index('prescriptionId');
    const entries = await getRequestResult(index.getAll(prescriptionId));
    return entries.sort((a, b) => b.entryDate.localeCompare(a.entryDate));
  } catch (error) {
    throw new Error(`Doku-Einträge konnten nicht geladen werden: ${error.message}`);
  }
}

export async function saveDocEntry(docEntryInput) {
  const now = new Date().toISOString();
  const entry = {
    ...docEntryInput,
    id: docEntryInput.id || crypto.randomUUID(),
    updatedAt: now,
    createdAt: docEntryInput.createdAt || now,
  };

  try {
    const db = await openDb();
    const tx = db.transaction(DOC_ENTRY_STORE, 'readwrite');
    tx.objectStore(DOC_ENTRY_STORE).put(entry);
    await waitForTransaction(tx, 'Datenbank-Transaktion fehlgeschlagen.');
    return entry;
  } catch (error) {
    throw new Error(`Doku-Eintrag konnte nicht gespeichert werden: ${error.message}`);
  }
}

export async function getDocEntryImages(docEntryId) {
  try {
    const db = await openDb();
    const tx = db.transaction(DOC_IMAGE_STORE, 'readonly');
    const index = tx.objectStore(DOC_IMAGE_STORE).index('docEntryId');
    const images = await getRequestResult(index.getAll(docEntryId));
    return images.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  } catch (error) {
    throw new Error(`Bilder konnten nicht geladen werden: ${error.message}`);
  }
}

export async function saveDocEntryImages(docEntryId, imagesInput) {
  try {
    const db = await openDb();
    const tx = db.transaction(DOC_IMAGE_STORE, 'readwrite');
    const store = tx.objectStore(DOC_IMAGE_STORE);
    const index = store.index('docEntryId');

    const existing = await getRequestResult(index.getAll(docEntryId));
    existing.forEach(image => store.delete(image.id));

    const now = new Date().toISOString();
    imagesInput.forEach(image => {
      store.put({
        ...image,
        id: image.id || crypto.randomUUID(),
        docEntryId,
        createdAt: image.createdAt || now,
      });
    });

    await waitForTransaction(tx, 'Bilder konnten nicht gespeichert werden.');
  } catch (error) {
    throw new Error(`Bilder konnten nicht gespeichert werden: ${error.message}`);
  }
}

export async function getDocEntryImageCountMap(docEntryIds) {
  if (!docEntryIds.length) return {};

  try {
    const pairs = await Promise.all(
      docEntryIds.map(async docEntryId => {
        const images = await getDocEntryImages(docEntryId);
        return [docEntryId, images.length];
      }),
    );

    return Object.fromEntries(pairs);
  } catch (error) {
    throw new Error(`Bildanzahl konnte nicht geladen werden: ${error.message}`);
  }
}

export async function exportAllData() {
  try {
    const [patients, prescriptions, documentationEntries, images] = await Promise.all([
      getAllFromStore(PATIENT_STORE),
      getAllFromStore(PRESCRIPTION_STORE),
      getAllFromStore(DOC_ENTRY_STORE),
      getAllFromStore(DOC_IMAGE_STORE),
    ]);

    const db = await openDb();
    const tx = db.transaction(META_STORE, 'readonly');
    const recentlyOpenedEntry = await getRequestResult(tx.objectStore(META_STORE).get(LAST_OPENED_KEY));
    const recentlyOpened = Array.isArray(recentlyOpenedEntry?.value) ? recentlyOpenedEntry.value : [];

    return {
      version: BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      patients,
      prescriptions,
      documentationEntries,
      images,
      recentlyOpened,
    };
  } catch (error) {
    throw new Error(`Backup konnte nicht exportiert werden: ${error.message}`);
  }
}

function validateBackupData(backup) {
  const required = ['version', 'exportedAt', 'patients', 'prescriptions', 'documentationEntries', 'images', 'recentlyOpened'];
  const missing = required.filter(field => !(field in backup));
  if (missing.length > 0) {
    throw new Error(`Backup ist unvollständig. Fehlende Felder: ${missing.join(', ')}`);
  }
  if (!Array.isArray(backup.patients) || !Array.isArray(backup.prescriptions) || !Array.isArray(backup.documentationEntries) || !Array.isArray(backup.images) || !Array.isArray(backup.recentlyOpened)) {
    throw new Error('Backup ist ungültig: Listenfelder haben ein falsches Format.');
  }
}

export async function clearAllData() {
  try {
    const db = await openDb();
    const tx = db.transaction([PATIENT_STORE, PRESCRIPTION_STORE, DOC_ENTRY_STORE, DOC_IMAGE_STORE, META_STORE], 'readwrite');
    tx.objectStore(PATIENT_STORE).clear();
    tx.objectStore(PRESCRIPTION_STORE).clear();
    tx.objectStore(DOC_ENTRY_STORE).clear();
    tx.objectStore(DOC_IMAGE_STORE).clear();
    tx.objectStore(META_STORE).clear();
    await waitForTransaction(tx, 'Lokale Daten konnten nicht gelöscht werden.');
  } catch (error) {
    throw new Error(`Lokale Daten konnten nicht gelöscht werden: ${error.message}`);
  }
}

export async function importAllDataReplace(backupData) {
  validateBackupData(backupData);

  try {
    await clearAllData();

    const db = await openDb();
    const tx = db.transaction([PATIENT_STORE, PRESCRIPTION_STORE, DOC_ENTRY_STORE, DOC_IMAGE_STORE, META_STORE], 'readwrite');

    backupData.patients.forEach(item => tx.objectStore(PATIENT_STORE).put(item));
    backupData.prescriptions.forEach(item => tx.objectStore(PRESCRIPTION_STORE).put(item));
    backupData.documentationEntries.forEach(item => tx.objectStore(DOC_ENTRY_STORE).put(item));
    backupData.images.forEach(item => tx.objectStore(DOC_IMAGE_STORE).put(item));
    tx.objectStore(META_STORE).put({ key: LAST_OPENED_KEY, value: backupData.recentlyOpened });

    await waitForTransaction(tx, 'Backup konnte nicht importiert werden.');
  } catch (error) {
    throw new Error(`Backup-Import fehlgeschlagen: ${error.message}`);
  }
}