import { supabase } from './supabase'

const BUCKET = 'doku-vault'
const MAX_OBJECT_BYTES = 49 * 1024 * 1024

async function sha256Text(text) {
  const bytes = new TextEncoder().encode(text)
  const digest = await window.crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

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

export async function uploadVault(backup, password, encryptText, userId, previous = null) {
  const prepared = structuredClone(backup)
  const jobs = []

  const previousImages = new Map((previous?.images || []).map(item => [item.id, item]))
  const previousDocuments = new Map((previous?.patientDocuments || []).map(item => [item.id, item]))
  const previousLibrary = new Map((previous?.libraryItems || []).map(item => [item.id, item]))

  for (const image of prepared.images || []) {
    if (!image.dataUrl) continue
    const path = `${userId}/files/doc-images/${image.id}.enc`
    const contentHash = await sha256Text(image.dataUrl)
    const old = previousImages.get(image.id)
    if (old?.cloudContentHash !== contentHash || old?.cloudFilePath !== path) {
      jobs.push(uploadEncrypted(path, await encryptText(image.dataUrl, password)))
    }
    delete image.dataUrl
    image.cloudFilePath = path
    image.cloudContentHash = contentHash
  }
  for (const [group, previousGroup] of [
    [prepared.patientDocuments || [], previousDocuments],
    [prepared.libraryItems || [], previousLibrary],
  ]) {
    for (const item of group) {
      if (!item.file?.dataUrl) continue
      const path = `${userId}/files/stored/${item.file.id || item.id}.enc`
      const contentHash = await sha256Text(item.file.dataUrl)
      const old = previousGroup.get(item.id)
      if (old?.file?.cloudContentHash !== contentHash || old?.file?.cloudFilePath !== path) {
        jobs.push(uploadEncrypted(path, await encryptText(item.file.dataUrl, password)))
      }
      delete item.file.dataUrl
      item.file.cloudFilePath = path
      item.file.cloudContentHash = contentHash
    }
  }
  await Promise.all(jobs)
  prepared.cloudVaultVersion = 1
  const manifest = await encryptText(JSON.stringify(prepared), password)
  await uploadEncrypted(`${userId}/vault.enc`, manifest)
  return { exportedAt: prepared.exportedAt, fileCount: jobs.length }
}

export async function downloadVaultManifest(password, decryptText, userId) {
  if (!decryptText) throw new Error('Entschlüsselungsfunktion fehlt.')
  return JSON.parse(await decryptText(await downloadText(`${userId}/vault.enc`), password))
}

export async function downloadVault(password, decryptText, userId, currentBackup = null) {
  const backup = await downloadVaultManifest(password, decryptText, userId)
  const jobs = []
  const currentImages = new Map((currentBackup?.images || []).map(item => [item.id, item]))
  const currentDocuments = new Map((currentBackup?.patientDocuments || []).map(item => [item.id, item]))
  const currentLibrary = new Map((currentBackup?.libraryItems || []).map(item => [item.id, item]))

  for (const image of backup.images || []) {
    if (!image.cloudFilePath) continue
    const local = currentImages.get(image.id)
    jobs.push((async () => {
      if (local?.dataUrl && image.cloudContentHash && await sha256Text(local.dataUrl) === image.cloudContentHash) {
        image.dataUrl = local.dataUrl
        return
      }
      image.dataUrl = await decryptText(await downloadText(image.cloudFilePath), password)
    })())
  }
  for (const [group, currentGroup] of [
    [backup.patientDocuments || [], currentDocuments],
    [backup.libraryItems || [], currentLibrary],
  ]) {
    for (const item of group) {
      if (!item.file?.cloudFilePath) continue
      const local = currentGroup.get(item.id)
      jobs.push((async () => {
        if (local?.file?.dataUrl && item.file.cloudContentHash && await sha256Text(local.file.dataUrl) === item.file.cloudContentHash) {
          item.file.dataUrl = local.file.dataUrl
          return
        }
        item.file.dataUrl = await decryptText(await downloadText(item.file.cloudFilePath), password)
      })())
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
