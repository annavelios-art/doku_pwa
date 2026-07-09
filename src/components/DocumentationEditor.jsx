import { useEffect, useState } from 'react'
import { ArrowLeft, Plus, Save } from 'lucide-react'
import DateInput from './DateInput'
import {
  postProcessText,
  startDictation,
  stopDictation,
} from '../speech/speechService'

export default function DocumentationEditor({
  docForm,
  setDocForm,
  docTextareaRef,
  handleSaveDocEntry,
  setView,
  toolbarInserts,
  insertSymbolText,
  isOwner,
  docImages,
  handleImageUpload,
  setFullscreenImage,
  handleRemoveImage,
  saving,
}) {
  const [isDictating, setIsDictating] = useState(false)
  const [dictationStatus, setDictationStatus] = useState('')

  useEffect(() => {
    return () => {
      stopDictation()
    }
  }, [])

  function focusTextareaEnd() {
    window.setTimeout(() => {
      const textarea = docTextareaRef.current
      if (!textarea) return
      textarea.focus()
      textarea.setSelectionRange(textarea.value.length, textarea.value.length)
    }, 0)
  }

  function appendDictationText(rawText) {
    const cleaned = postProcessText(rawText)
    if (!cleaned) return

    setDocForm(prev => ({
      ...prev,
      text: prev.text.trim().length === 0 ? cleaned : `${prev.text}\n\n${cleaned}`,
    }))

    focusTextareaEnd()
  }

  async function toggleDictation() {
    try {
      if (isDictating) {
        await stopDictation()
        setIsDictating(false)
        setDictationStatus('Diktat gestoppt.')
        return
      }

      setDictationStatus('Sprachsystem wird vorbereitet...')

      await startDictation({
        onStatus(status) {
          setDictationStatus(status)
        },
        onText(text) {
          appendDictationText(text)
          const cleaned = postProcessText(text)
          if (cleaned) setDictationStatus(`Erkannt: ${cleaned}`)
        },
        onError(error) {
          const message = error?.message || String(error)
          setDictationStatus(message)
          setIsDictating(false)
        },
      })

      setIsDictating(true)
    } catch (error) {
      const message = error?.message || String(error)
      setIsDictating(false)
      setDictationStatus(`Diktieren fehlgeschlagen: ${message}`)
    }
  }

  return (
    <section className="surface-card card-doc-edit">
      <form className="stack-lg" onSubmit={handleSaveDocEntry}>
        <button type="button" className="btn btn-ghost-inline" onClick={() => setView('prescriptionDetail')}>
          <ArrowLeft size={16} />
          Abbrechen
        </button>

        <DateInput
  		value={docForm.entryDate}
  		onChange={value =>
    		setDocForm(prev => ({
      		...prev,
      		entryDate: value,
    		}))
  		}
	/>

        <div className="toolbar-box">
          <p className="toolbar-title">Schreibstütze</p>

          <div className="toolbar-row">
            {toolbarInserts.map(item => (
              <button
                key={item.label}
                type="button"
                onClick={() => insertSymbolText(item.insert)}
                className="pill-btn"
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <div className="stack-sm">
          <button
            type="button"
            className={`btn ${isDictating ? 'btn-danger' : 'btn-secondary'}`}
            onClick={toggleDictation}
          >
            🎤 {isDictating ? 'Diktat stoppen' : 'Diktieren testen'}
          </button>

          {dictationStatus && <p className="muted">{dictationStatus}</p>}
        </div>

        <textarea
          ref={docTextareaRef}
          className="field textfield"
          value={docForm.text}
          onChange={event => setDocForm(prev => ({ ...prev, text: event.target.value }))}
        />

        {isOwner ? (
          <div className="image-grid">
            <label className="upload-card">
              <span><Plus className="upload-plus" />Bild hinzufügen</span>
              <input type="file" accept="image/*" multiple className="hidden" onChange={handleImageUpload} />
            </label>

            {docImages.map(image => (
              <div key={image.id} className="image-card">
                <img
                  src={image.dataUrl}
                  alt={image.fileName}
                  className="image-preview"
                  onClick={() => setFullscreenImage(image.dataUrl)}
                />
                <p className="image-name">{image.fileName}</p>
                <button type="button" className="btn btn-danger" onClick={() => handleRemoveImage(image.id)}>
                  Bild entfernen
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted">Bild-Upload ist im Mitarbeiter-Modus deaktiviert.</p>
        )}

        <div className="row-end">
          <button type="button" className="btn btn-ghost" onClick={() => setView('prescriptionDetail')}>
            Abbrechen
          </button>
          <button className="btn btn-primary" disabled={saving}>
            <Save size={16} />
            {saving ? 'Speichern...' : 'Speichern'}
          </button>
        </div>
      </form>
    </section>
  )
}
