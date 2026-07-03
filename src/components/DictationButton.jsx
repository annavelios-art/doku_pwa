import { useRef, useState } from 'react'

export default function DictationButton({ onTextReady }) {
  const [status, setStatus] = useState('idle')
  const [info, setInfo] = useState('')

  const mediaRecorderRef = useRef(null)
  const streamRef = useRef(null)
  const chunksRef = useRef([])

  async function startRecording() {
    setInfo('')

    if (!navigator.mediaDevices?.getUserMedia) {
      setInfo('Mikrofon wird von diesem Browser nicht unterstützt.')
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })

      streamRef.current = stream
      chunksRef.current = []

      const recorder = new MediaRecorder(stream)

      recorder.ondataavailable = event => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data)
        }
      }

      recorder.onstop = () => {
        const audioBlob = new Blob(chunksRef.current, {
          type: recorder.mimeType || 'audio/webm',
        })

        console.log('Audio aufgenommen:', {
          type: audioBlob.type,
          size: audioBlob.size,
        })

        stream.getTracks().forEach(track => track.stop())

        setStatus('processing')
        setInfo(`Audio aufgenommen: ${Math.round(audioBlob.size / 1024)} kB`)

        window.setTimeout(() => {
          onTextReady?.('')
          setStatus('done')

          window.setTimeout(() => {
            setStatus('idle')
            setInfo('')
          }, 1000)
        }, 800)
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

    if (recorder && recorder.state !== 'inactive') {
      recorder.stop()
    }
  }

  function handleClick() {
    if (status === 'idle') {
      startRecording()
      return
    }

    if (status === 'recording') {
      stopRecording()
    }
  }

  const labelMap = {
    idle: '🎤 Diktieren',
    recording: '🔴 Aufnahme läuft...',
    processing: '⏳ Aufnahme wird vorbereitet...',
    done: '✅ Aufnahme beendet',
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