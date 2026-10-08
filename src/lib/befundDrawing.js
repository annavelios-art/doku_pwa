// A regular PNG with a private, ancillary chunk containing editable strokes.
// Both the image and its stroke data pass through the existing encrypted file path.
const TYPE = 'bfNd'
function bytesOf(url) {
  return Uint8Array.from(atob(url.split(',')[1]), char => char.charCodeAt(0))
}
function crc32(bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}
export function readDrawing(file) {
  if (!file?.dataUrl?.startsWith('data:image/png;')) return null
  const bytes = bytesOf(file.dataUrl)
  const view = new DataView(bytes.buffer)
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const length = view.getUint32(offset)
    if (offset + length + 12 > bytes.length) throw new Error('Ungültige Befunddatei.')
    const type = String.fromCharCode(...bytes.slice(offset + 4, offset + 8))
    if (type === TYPE) {
      if (crc32(bytes.slice(offset + 4, offset + 8 + length)) !== view.getUint32(offset + 8 + length)) throw new Error('Befund-Zeichendaten sind beschädigt.')
      const data = JSON.parse(new TextDecoder().decode(bytes.slice(offset + 8, offset + 8 + length)))
      if (data.version !== 1 || !Array.isArray(data.strokes)) throw new Error('Unbekanntes Befundformat.')
      for (const stroke of data.strokes) {
        if (!['pen', 'eraser'].includes(stroke.tool) || !['#c62828', '#1565c0'].includes(stroke.color) || !Number.isFinite(stroke.width) || stroke.width < 1 || stroke.width > 50 || !Array.isArray(stroke.points) || stroke.points.some(p => !Array.isArray(p) || p.length !== 2 || p.some(n => !Number.isFinite(n) || n < 0 || n > 1))) throw new Error('Ungültige Zeichenstriche.')
      }
      return data
    }
    offset += length + 12
  }
  return null
}
export function writeDrawing(pngUrl, strokes) {
  const bytes = bytesOf(pngUrl)
  const payload = new TextEncoder().encode(JSON.stringify({ version: 1, template: 'body-four-v1', strokes }))
  const chunk = new Uint8Array(payload.length + 12)
  const view = new DataView(chunk.buffer)
  view.setUint32(0, payload.length)
  chunk.set(new TextEncoder().encode(TYPE), 4)
  chunk.set(payload, 8)
  view.setUint32(payload.length + 8, crc32(chunk.slice(4, payload.length + 8)))
  const output = new Uint8Array(bytes.length + chunk.length)
  output.set(bytes.slice(0, -12))
  output.set(chunk, bytes.length - 12)
  output.set(bytes.slice(-12), bytes.length - 12 + chunk.length)
  let binary = ''
  for (let i = 0; i < output.length; i += 8192) binary += String.fromCharCode(...output.slice(i, i + 8192))
  return { fileName: 'Zeichenbefund.png', mimeType: 'image/png', dataUrl: 'data:image/png;base64,' + btoa(binary) }
}
