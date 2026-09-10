import { supabase } from './supabase'

const BUCKET = 'doku-vault'
const MAX_OBJECT_BYTES = 49 * 1024 * 1024

async function uploadEncrypted(path, text) {
  const blob = new Blob([text], { type: 'application/octet-stream' })
  if (blob.size > MAX_OBJECT_BYTES) throw new Error('Eine verschlüsselte Datei überschreitet die 50-MB-Grenze.')
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, {
    contentType: 'application/octet-stream', upsert: true,
  })
  if (error) throw error
}

async function downloadText(path) {
  const { data, error } = await supabase.storage.from(BUCKET).download(path)
  if (error) throw error
  return data.text()
}

export async function uploadVault(backup, password, encryptText, userId) {
  const prepared = structuredClone(backup)
  const jobs = []
  for (const image of prepared.images || []) {
    if (!image.dataUrl) continue
    const path = `${userId}/files/doc-images/${image.id}.enc`
    jobs.push(uploadEncrypted(path, await encryptText(image.dataUrl, password)))
    delete image.dataUrl
    image.cloudFilePath = path
  }
  for (const group of [prepared.patientDocuments || [], prepared.libraryItems || []]) {
    for (const item of group) {
      if (!item.file?.dataUrl) continue
      const path = `${userId}/files/stored/${item.file.id || item.id}.enc`
      jobs.push(uploadEncrypted(path, await encryptText(item.file.dataUrl, password)))
      delete item.file.dataUrl
      item.file.cloudFilePath = path
    }
  }
  await Promise.all(jobs)
  prepared.cloudVaultVersion = 1
  const manifest = await encryptText(JSON.stringify(prepared), password)
  await uploadEncrypted(`${userId}/vault.enc`, manifest)
  return { exportedAt: prepared.exportedAt, fileCount: jobs.length }
}

export async function downloadVault(password, decryptText, userId) {
  const backup = JSON.parse(await decryptText(await downloadText(`${userId}/vault.enc`), password))
  const jobs = []
  for (const image of backup.images || []) {
    if (image.cloudFilePath) jobs.push((async () => { image.dataUrl = await decryptText(await downloadText(image.cloudFilePath), password) })())
  }
  for (const group of [backup.patientDocuments || [], backup.libraryItems || []]) {
    for (const item of group) {
      if (item.file?.cloudFilePath) jobs.push((async () => { item.file.dataUrl = await decryptText(await downloadText(item.file.cloudFilePath), password) })())
    }
  }
  await Promise.all(jobs)
  return backup
}

export async function getVaultInfo(userId) {
  const { data, error } = await supabase.storage.from(BUCKET).list(userId, { search: 'vault.enc' })
  if (error) throw error
  const item = data?.find(entry => entry.name === 'vault.enc')
  return item ? { updatedAt: item.updated_at || item.created_at || '' } : null
}
