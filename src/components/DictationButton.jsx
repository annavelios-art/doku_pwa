import { useRef, useState } from 'react'
import { pipeline } from '@huggingface/transformers'

let transcriberPromise = null

function getTranscriber() {
  if (!transcriberPromise) {
    transcriberPromise = pipeline(
      'automatic-speech-recognition',
      'onnx-community/whisper-tiny',
      {
        device: 'wasm',
        dtype: 'fp32',
      }
    )
  }

  return transcriberPromise
}

export default function DictationButton({ onTextReady }) {
  const [status, setStatus] = useState('idle')
  const [info, setInfo] = useState('')

  const mediaRecorderRef = useRef(null)
  const chunksRef = useRef([])

  async function transcribeAudio(audioBlob) {
  setStatus('processing')
  setInfo('Sprachmodell wird geladen / Sprache wird erkannt...')

  await new Promise(resolve => window.setTimeout(resolve, 500))

  const audioUrl = URL.createObjectURL(audioBlob)

  try {
    const transcriber = await getTranscriber()

    setInfo('Audio wird ausgewertet...')

    const result = await transcriber(audioUrl, {
      language: 'de',
      task: 'transcribe',
    })

    console.log('Whisper-Ergebnis:', result)

    const text = result?.text?.trim() || ''

    if (!text) {
      setStatus('idle')
      setInfo('Kein Text erkannt. Bitte einmal sehr deutlich und kurz testen.')
      return
    }

    setInfo(`Erkannt: ${text}`)
    onTextReady?.(text)

    setStatus('done')

    window.setTimeout(() => {
      setStatus('idle')
    }, 1500)
  } catch (error) {
    console.error('Whisper-Fehler:', error)
    setStatus('idle')
    setInfo(`Spracherkennung fehlgeschlagen: ${error.message || String(error)}`)
  } finally {
    URL.revokeObjectURL(audioUrl)
  }
}

  async function startRecording() {
    setInfo('')

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      chunksRef.current = []

      const recorder = new MediaRecorder(stream)

      recorder.ondataavailable = event => {
        if (event.data.size > 0) chunksRef.current.push(event.data)
      }

      recorder.onstop = () => {
        stream.getTracks().forEach(track => track.stop())

        const audioBlob = new Blob(chunksRef.current, {
          type: recorder.mimeType || 'audio/webm',
        })

        console.log('Audio aufgenommen:', audioBlob)

        transcribeAudio(audioBlob)
      }

      mediaRecorderRef.current = recorder
      recorder.start()
      setStatus('recording')
    } catch (error) {
      console.error(error)
      setStatus('idle')
      setInfo('Mikrofon konnte nicht gestartet werden.')
    }
  }

  function stopRecording() {
    const recorder = mediaRecorderRef.current
    if (recorder && recorder.state !== 'inactive') recorder.stop()
  }

  function handleClick() {
    if (status === 'idle') startRecording()
    if (status === 'recording') stopRecording()
  }

  const labelMap = {
    idle: '🎤 Diktieren',
    recording: '🔴 Aufnahme läuft...',
    processing: '⏳ Sprache wird erkannt...',
    done: '✅ Text übernommen',
  }

  return (
    <div className="dictation-wrap">
      <button
        type="button"
        className={`btn btn-ghost dictation-btn dictation-btn-${status}`}
        onClick={handleClick}
        disabled={status === 'processing'}
      >
        {labelMap[status]}
      </button>

      {info && <p className="muted dictation-info">{info}</p>}
    </div>
  )
}