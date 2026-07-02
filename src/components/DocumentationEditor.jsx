import { ArrowLeft, Plus, Save } from 'lucide-react'

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
  return (
    <section className="surface-card card-doc-edit">
      <form className="stack-lg" onSubmit={handleSaveDocEntry}>
        <button type="button" className="btn btn-ghost-inline" onClick={() => setView('prescriptionDetail')}>
          <ArrowLeft size={16} />
          Abbrechen
        </button>

        <input
          type="date"
          className="field"
          value={docForm.entryDate}
          onChange={event => setDocForm(prev => ({ ...prev, entryDate: event.target.value }))}
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
          <button type="button" className="btn btn-ghost" onClick={() => setView('prescriptionDetail')}>Abbrechen</button>
          <button className="btn btn-primary" disabled={saving}>
            <Save size={16} />
            {saving ? 'Speichern...' : 'Speichern'}
          </button>
        </div>
      </form>
    </section>
  )
}