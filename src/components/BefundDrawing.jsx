import { useEffect, useRef, useState } from 'react'
import templateUrl from '../assets/befund-vorlage.gif'
import { readDrawing, writeDrawing } from '../lib/befundDrawing'
import './BefundDrawing.css'
const WIDTH = 2000, HEIGHT = 1200
export default function BefundDrawing({ file, onApply, onClose }) {
  const [strokes, setStrokes] = useState(() => readDrawing(file)?.strokes || [])
  const [redo, setRedo] = useState([])
  const [color, setColor] = useState('#c62828')
  const [tool, setTool] = useState('pen')
  const [width, setWidth] = useState(4)
  const [zoom, setZoom] = useState(1)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  const canvas = useRef(null), background = useRef(null), active = useRef(null)
  const dirty = useRef(false), strokesRef = useRef(strokes)
  function render(list) {
    const ctx = canvas.current.getContext('2d')
    ctx.clearRect(0, 0, WIDTH, HEIGHT)
    for (const stroke of list) {
      ctx.globalCompositeOperation = stroke.tool === 'eraser' ? 'destination-out' : 'source-over'
      ctx.strokeStyle = stroke.color; ctx.fillStyle = stroke.color
      ctx.lineWidth = stroke.width; ctx.lineCap = 'round'; ctx.lineJoin = 'round'
      const first = stroke.points[0]
      if (!first) continue
      ctx.beginPath(); ctx.moveTo(first[0] * WIDTH, first[1] * HEIGHT)
      if (stroke.points.length === 1) {
        ctx.arc(first[0] * WIDTH, first[1] * HEIGHT, stroke.width / 2, 0, Math.PI * 2); ctx.fill()
      } else {
        for (const p of stroke.points.slice(1)) ctx.lineTo(p[0] * WIDTH, p[1] * HEIGHT)
        ctx.stroke()
      }
    }
    ctx.globalCompositeOperation = 'source-over'
  }
  useEffect(() => {
    const image = new Image()
    image.onload = () => {
      const ctx = background.current.getContext('2d')
      ctx.fillStyle = 'white'; ctx.fillRect(0, 0, WIDTH, HEIGHT)
      ctx.filter = 'grayscale(1) brightness(1.08)'
      ctx.globalAlpha = 0.65
      ctx.drawImage(image, 20, 20, 1480, 1167)
      ctx.filter = 'none'; ctx.globalAlpha = 1
      ctx.strokeStyle = '#ddd'; ctx.beginPath(); ctx.moveTo(1520, 20); ctx.lineTo(1520, 1180); ctx.stroke()
      ctx.fillStyle = '#777'; ctx.font = '24px sans-serif'; ctx.fillText('Freie Skizzen / Notizen', 1550, 40)
      setReady(true)
    }
    image.onerror = () => setError('Körpervorlage konnte nicht geladen werden. Bitte erneut öffnen.')
    image.src = templateUrl
    return () => { image.onload = null; image.onerror = null }
  }, [])
  useEffect(() => { strokesRef.current = strokes; render(strokes) }, [strokes])
  useEffect(() => {
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    function warn(event) { if (dirty.current) { event.preventDefault(); event.returnValue = '' } }
    window.addEventListener('beforeunload', warn)
    return () => { document.body.style.overflow = previous; window.removeEventListener('beforeunload', warn) }
  }, [])
  function point(event) {
    const rect = canvas.current.getBoundingClientRect()
    return [Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height))]
  }
  function start(event) {
    if (tool === 'pan' || !ready || active.current || (event.pointerType === 'mouse' && event.button !== 0)) return
    event.preventDefault(); canvas.current.setPointerCapture(event.pointerId)
    active.current = { pointerId: event.pointerId, stroke: { tool, color, width: tool === 'eraser' ? 30 : width, points: [point(event)] } }
    render([...strokesRef.current, active.current.stroke])
  }
  function move(event) {
    if (active.current?.pointerId !== event.pointerId) return
    for (const e of event.getCoalescedEvents?.() || [event]) active.current.stroke.points.push(point(e))
    render([...strokesRef.current, active.current.stroke])
  }
  function finish(event) {
    if (active.current?.pointerId !== event.pointerId) return
    const next = [...strokesRef.current, active.current.stroke]
    active.current = null; strokesRef.current = next; dirty.current = true
    setStrokes(next); setRedo([])
  }
  function close() { if (!dirty.current || window.confirm('Zeichnung ohne Übernahme schließen?')) onClose() }
  function apply() {
    if (!ready || active.current) return
    try {
      const merged = document.createElement('canvas'); merged.width = WIDTH; merged.height = HEIGHT
      const ctx = merged.getContext('2d'); ctx.drawImage(background.current, 0, 0); ctx.drawImage(canvas.current, 0, 0)
      onApply(writeDrawing(merged.toDataURL('image/png'), strokesRef.current))
    } catch (e) { setError('Zeichnung konnte nicht übernommen werden: ' + e.message) }
  }
  return <div className="befund-dialog" role="dialog" aria-modal="true" aria-label="Befund zeichnen">
    <div className="befund-toolbar">
      <strong>Befund zeichnen</strong>
      <button type="button" aria-pressed={tool === 'pen' && color === '#c62828'} onClick={() => { setTool('pen'); setColor('#c62828') }}>🔴 Markierungen</button>
      <button type="button" aria-pressed={tool === 'pen' && color === '#1565c0'} onClick={() => { setTool('pen'); setColor('#1565c0') }}>🔵 Notizen</button>
      <label>Strich <select value={width} onChange={e => setWidth(Number(e.target.value))}><option value={2}>Fein</option><option value={4}>Mittel</option><option value={8}>Dick</option></select></label>
      <button type="button" aria-pressed={tool === 'eraser'} onClick={() => setTool('eraser')}>Radierer</button>
      <button type="button" disabled={!strokes.length} onClick={() => { dirty.current = true; setRedo(r => [...r, strokes.at(-1)]); setStrokes(s => s.slice(0, -1)) }}>Rückgängig</button>
      <button type="button" disabled={!redo.length} onClick={() => { dirty.current = true; setStrokes(s => [...s, redo.at(-1)]); setRedo(r => r.slice(0, -1)) }}>Wiederholen</button>
      <label>Ansicht <select value={zoom} onChange={e => setZoom(Number(e.target.value))}><option value={1}>Ganzes Blatt</option><option value={1.5}>150 %</option><option value={2}>200 %</option><option value={3}>300 %</option></select></label>
      <button type="button" aria-pressed={tool === 'pan'} onClick={() => setTool('pan')}>Verschieben</button>
      <button type="button" onClick={close}>Abbrechen</button>
      <button type="button" disabled={!ready} onClick={apply}>Zeichnung übernehmen</button>
    </div>
    <p className="befund-hint">Mit Finger, Stift oder Maus zeichnen. Für ein vergrößertes Blatt „Verschieben“ wählen. Danach im Befundformular speichern.</p>
    {error && <p role="alert">{error}</p>}
    <div className="befund-scroll"><div className="befund-paper" style={{ width: `${zoom * 100}%` }}>
      <canvas ref={background} width={WIDTH} height={HEIGHT} aria-hidden="true" />
      <canvas ref={canvas} width={WIDTH} height={HEIGHT} className="befund-ink" style={{ touchAction: tool === 'pan' ? 'pan-x pan-y' : 'none', cursor: tool === 'pan' ? 'grab' : 'crosshair' }} aria-label="Zeichenfläche" onPointerDown={start} onPointerMove={move} onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish} />
    </div></div>
  </div>
}
