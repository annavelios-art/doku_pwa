import { useEffect, useMemo, useState } from 'react'
import { Plus, Search, ArrowLeft, Save, Edit3 } from 'lucide-react'
import {
  getAllPatients,
  getDocEntriesByPrescriptionId,
  getPatientById,
  getPrescriptionsByPatientId,
  getRecentlyOpenedPatients,
  markPatientAsRecentlyOpened,
  saveDocEntry,
  savePatient,
  savePrescription,
} from './lib/patientsDb'

const EMPTY_PATIENT_FORM = { id: '', firstName: '', lastName: '', birthDate: '', createdAt: '' }
const EMPTY_PRESCRIPTION_FORM = { id: '', issueDate: '', remedy: '', createdAt: '' }
const EMPTY_DOC_FORM = { id: '', entryDate: '', text: '', createdAt: '' }

const formatDate = value => (value ? new Date(value).toLocaleDateString('de-DE') : '–')
const snippet = text => (text || '').split('\n')[0].trim().slice(0, 90) || 'Ohne Text'

function PatientCard({ patient, onOpen }) {
  return (
    <button type="button" onClick={() => onOpen(patient.id)} className="w-full text-left rounded-2xl border border-slate-200 bg-white p-4">
      <p className="text-lg font-semibold text-slate-900">{patient.lastName}</p>
      <p className="text-base text-slate-700">{patient.firstName}</p>
      <p className="text-sm text-slate-500 mt-1">Geburtsdatum: {formatDate(patient.birthDate)}</p>
    </button>
  )
}

function PrescriptionCard({ prescription, onOpen }) {
  return (
    <button type="button" onClick={() => onOpen(prescription)} className="w-full text-left rounded-2xl border border-slate-200 bg-white p-4">
      <p className="text-sm text-slate-500">Ausstellungsdatum</p>
      <p className="text-base font-medium text-slate-900">{formatDate(prescription.issueDate)}</p>
      <p className="text-sm text-slate-500 mt-2">Heilmittel</p>
      <p className="text-base text-slate-700">{prescription.remedy}</p>
    </button>
  )
}

function DocEntryCard({ entry, onOpen }) {
  return (
    <button type="button" onClick={() => onOpen(entry)} className="w-full text-left rounded-2xl border border-slate-200 bg-white p-4">
      <p className="text-sm text-slate-500">Datum</p>
      <p className="text-base font-medium text-slate-900">{formatDate(entry.entryDate)}</p>
      <p className="text-sm text-slate-500 mt-2">Vorschau</p>
      <p className="text-base text-slate-700">{snippet(entry.text)}</p>
    </button>
  )
}

export default function App() {
  const [view, setView] = useState('list')
  const [patients, setPatients] = useState([])
  const [recentPatients, setRecentPatients] = useState([])
  const [selectedPatient, setSelectedPatient] = useState(null)
  const [selectedPrescription, setSelectedPrescription] = useState(null)
  const [prescriptions, setPrescriptions] = useState([])
  const [docEntries, setDocEntries] = useState([])
  const [query, setQuery] = useState('')

  const [patientForm, setPatientForm] = useState(EMPTY_PATIENT_FORM)
  const [prescriptionForm, setPrescriptionForm] = useState(EMPTY_PRESCRIPTION_FORM)
  const [docForm, setDocForm] = useState(EMPTY_DOC_FORM)

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const filteredPatients = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    if (!normalized) return patients
    return patients.filter(patient => `${patient.lastName} ${patient.firstName}`.toLowerCase().includes(normalized))
  }, [patients, query])

  useEffect(() => {
    loadListData()
  }, [])

  async function loadListData() {
    setLoading(true)
    setError('')
    try {
      const [all, recents] = await Promise.all([getAllPatients(), getRecentlyOpenedPatients()])
      setPatients(all)
      setRecentPatients(recents)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  async function loadPatientDetail(patientId) {
    setError('')
    try {
      const patient = await getPatientById(patientId)
      if (!patient) throw new Error('Patient wurde nicht gefunden.')
      const patientPrescriptions = await getPrescriptionsByPatientId(patientId)
      setSelectedPatient(patient)
      setPrescriptions(patientPrescriptions)
      setSelectedPrescription(null)
      setDocEntries([])
      await markPatientAsRecentlyOpened(patientId)
      setRecentPatients(await getRecentlyOpenedPatients())
      setView('patientDetail')
    } catch (e) {
      setError(e.message)
    }
  }

  async function loadPrescriptionDetail(prescription) {
    setError('')
    try {
      const entries = await getDocEntriesByPrescriptionId(prescription.id)
      setSelectedPrescription(prescription)
      setDocEntries(entries)
      setView('prescriptionDetail')
    } catch (e) {
      setError(e.message)
    }
  }

  const startCreatePatient = () => {
    setPatientForm(EMPTY_PATIENT_FORM)
    setView('patientEdit')
  }
  const startEditPatient = () => selectedPatient && (setPatientForm(selectedPatient), setView('patientEdit'))
  const startCreatePrescription = () => (setPrescriptionForm(EMPTY_PRESCRIPTION_FORM), setView('prescriptionEdit'))
  const startEditPrescription = prescription => (setPrescriptionForm(prescription), setView('prescriptionEdit'))
  const startCreateDocEntry = () => (setDocForm(EMPTY_DOC_FORM), setView('docEdit'))
  const startEditDocEntry = entry => (setDocForm(entry), setView('docEdit'))

  async function handleSavePatient(event) {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      if (!patientForm.lastName.trim() || !patientForm.firstName.trim() || !patientForm.birthDate) throw new Error('Bitte Name, Vorname und Geburtsdatum ausfüllen.')
      const saved = await savePatient({ ...patientForm, lastName: patientForm.lastName.trim(), firstName: patientForm.firstName.trim() })
      await markPatientAsRecentlyOpened(saved.id)
      await loadListData()
      if (selectedPatient) await loadPatientDetail(saved.id)
      else setView('list')
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleSavePrescription(event) {
    event.preventDefault()
    if (!selectedPatient) return setError('Kein Patient ausgewählt.')
    setSaving(true)
    setError('')
    try {
      if (!prescriptionForm.issueDate || !prescriptionForm.remedy.trim()) throw new Error('Bitte Ausstellungsdatum und Heilmittel ausfüllen.')
      await savePrescription({ ...prescriptionForm, patientId: selectedPatient.id, remedy: prescriptionForm.remedy.trim() })
      const updatedPrescriptions = await getPrescriptionsByPatientId(selectedPatient.id)
      setPrescriptions(updatedPrescriptions)
      setView('patientDetail')
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleSaveDocEntry(event) {
    event.preventDefault()
    if (!selectedPrescription) return setError('Keine Verordnung ausgewählt.')
    setSaving(true)
    setError('')
    try {
      if (!docForm.entryDate || !docForm.text.trim()) throw new Error('Bitte Datum und Text ausfüllen.')
      await saveDocEntry({ ...docForm, prescriptionId: selectedPrescription.id, text: docForm.text.trim() })
      const updatedEntries = await getDocEntriesByPrescriptionId(selectedPrescription.id)
      setDocEntries(updatedEntries)
      setView('prescriptionDetail')
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <main className="mx-auto w-full max-w-xl p-4 pb-12 space-y-4">
        <header className="sticky top-0 z-10 -mx-4 px-4 py-3 bg-slate-50/95 backdrop-blur border-b border-slate-200">
          <h1 className="text-xl font-semibold text-slate-900">Physio Doku (lokal)</h1>
        </header>
        {error && <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-red-700 text-sm">{error}</p>}

        {view === 'list' && <section className="space-y-4"><div className="flex gap-2"><label className="relative flex-1"><Search className="absolute left-3 top-3.5 h-5 w-5 text-slate-400" /><input className="w-full rounded-xl border border-slate-200 bg-white py-3 pl-10 pr-3 text-base" type="search" placeholder="Patient suchen" value={query} onChange={e => setQuery(e.target.value)} /></label><button type="button" onClick={startCreatePatient} className="inline-flex items-center gap-1 rounded-xl bg-sky-600 px-4 py-3 text-white text-base font-medium"><Plus className="h-5 w-5" /> Patient</button></div><div className="space-y-2"><h2 className="text-sm font-medium text-slate-500">Zuletzt geöffnet</h2>{recentPatients.length===0?<p className="text-sm text-slate-400">Noch keine zuletzt geöffneten Patienten.</p>:<div className="grid gap-2">{recentPatients.map(p=><PatientCard key={p.id} patient={p} onOpen={loadPatientDetail} />)}</div>}</div><div className="space-y-2"><h2 className="text-sm font-medium text-slate-500">Patienten</h2>{loading?<p className="text-sm text-slate-400">Lade Patienten...</p>:filteredPatients.length===0?<p className="text-sm text-slate-400">Keine Patienten gefunden.</p>:<div className="grid gap-2">{filteredPatients.map(p=><PatientCard key={p.id} patient={p} onOpen={loadPatientDetail} />)}</div>}</div></section>}

        {view === 'patientDetail' && selectedPatient && <section className="space-y-4"><button type="button" onClick={() => setView('list')} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-base"><ArrowLeft className="h-5 w-5" /> Zurück</button><article className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3"><h2 className="text-lg font-semibold text-slate-900">Patient</h2><p className="text-slate-800">{selectedPatient.lastName}, {selectedPatient.firstName}</p><p className="text-sm text-slate-500">Geburtsdatum: {formatDate(selectedPatient.birthDate)}</p><button type="button" onClick={startEditPatient} className="inline-flex items-center gap-2 rounded-xl bg-slate-800 px-4 py-3 text-white"><Edit3 className="h-5 w-5" /> Bearbeiten</button></article><div className="flex items-center justify-between"><h3 className="text-sm font-medium text-slate-500">Verordnungen</h3><button type="button" onClick={startCreatePrescription} className="inline-flex items-center gap-1 rounded-xl bg-emerald-600 px-4 py-3 text-white text-base font-medium"><Plus className="h-5 w-5" /> Verordnung</button></div>{prescriptions.length===0?<p className="text-sm text-slate-400">Noch keine Verordnungen vorhanden.</p>:<div className="grid gap-2">{prescriptions.map(x=><PrescriptionCard key={x.id} prescription={x} onOpen={loadPrescriptionDetail} />)}</div>}</section>}

        {view === 'prescriptionDetail' && selectedPrescription && <section className="space-y-4"><button type="button" onClick={() => setView('patientDetail')} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-base"><ArrowLeft className="h-5 w-5" /> Zurück</button><article className="rounded-2xl border border-slate-200 bg-white p-4 space-y-2"><p className="text-sm text-slate-500">Ausstellungsdatum</p><p className="text-base font-medium text-slate-900">{formatDate(selectedPrescription.issueDate)}</p><p className="text-sm text-slate-500">Heilmittel</p><p className="text-base text-slate-700">{selectedPrescription.remedy}</p><button type="button" onClick={() => startEditPrescription(selectedPrescription)} className="inline-flex items-center gap-2 rounded-xl bg-slate-800 px-4 py-3 text-white"><Edit3 className="h-5 w-5" /> Verordnung bearbeiten</button></article><div className="flex items-center justify-between"><h3 className="text-sm font-medium text-slate-500">Doku-Einträge</h3><button type="button" onClick={startCreateDocEntry} className="inline-flex items-center gap-1 rounded-xl bg-emerald-600 px-4 py-3 text-white text-base font-medium"><Plus className="h-5 w-5" /> Doku</button></div>{docEntries.length===0?<p className="text-sm text-slate-400">Noch keine Doku-Einträge vorhanden.</p>:<div className="grid gap-2">{docEntries.map(entry=><DocEntryCard key={entry.id} entry={entry} onOpen={startEditDocEntry} />)}</div>}</section>}

        {view === 'patientEdit' && <section className="rounded-2xl border border-slate-200 bg-white p-4"><form className="space-y-4" onSubmit={handleSavePatient}><button type="button" onClick={() => (selectedPatient ? setView('patientDetail') : setView('list'))} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-3 text-base"><ArrowLeft className="h-5 w-5" /> Zurück</button><div><label className="block text-sm text-slate-600 mb-1">Name</label><input className="w-full rounded-xl border border-slate-200 px-3 py-3 text-base" value={patientForm.lastName} onChange={e => setPatientForm(prev => ({ ...prev, lastName: e.target.value }))} /></div><div><label className="block text-sm text-slate-600 mb-1">Vorname</label><input className="w-full rounded-xl border border-slate-200 px-3 py-3 text-base" value={patientForm.firstName} onChange={e => setPatientForm(prev => ({ ...prev, firstName: e.target.value }))} /></div><div><label className="block text-sm text-slate-600 mb-1">Geburtsdatum</label><input type="date" className="w-full rounded-xl border border-slate-200 px-3 py-3 text-base" value={patientForm.birthDate} onChange={e => setPatientForm(prev => ({ ...prev, birthDate: e.target.value }))} /></div><button type="submit" disabled={saving} className="w-full inline-flex justify-center items-center gap-2 rounded-xl bg-emerald-600 px-4 py-4 text-white text-base font-semibold disabled:opacity-70"><Save className="h-5 w-5" /> {saving ? 'Speichern...' : 'Speichern'}</button></form></section>}

        {view === 'prescriptionEdit' && selectedPatient && <section className="rounded-2xl border border-slate-200 bg-white p-4"><form className="space-y-4" onSubmit={handleSavePrescription}><button type="button" onClick={() => setView(selectedPrescription ? 'prescriptionDetail' : 'patientDetail')} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-3 text-base"><ArrowLeft className="h-5 w-5" /> Abbrechen</button><div><label className="block text-sm text-slate-600 mb-1">Ausstellungsdatum</label><input type="date" className="w-full rounded-xl border border-slate-200 px-3 py-3 text-base" value={prescriptionForm.issueDate} onChange={e => setPrescriptionForm(prev => ({ ...prev, issueDate: e.target.value }))} /></div><div><label className="block text-sm text-slate-600 mb-1">Heilmittel</label><input className="w-full rounded-xl border border-slate-200 px-3 py-3 text-base" value={prescriptionForm.remedy} onChange={e => setPrescriptionForm(prev => ({ ...prev, remedy: e.target.value }))} /></div><button type="submit" disabled={saving} className="w-full inline-flex justify-center items-center gap-2 rounded-xl bg-emerald-600 px-4 py-4 text-white text-base font-semibold disabled:opacity-70"><Save className="h-5 w-5" /> {saving ? 'Speichern...' : 'Speichern'}</button></form></section>}

        {view === 'docEdit' && selectedPrescription && <section className="rounded-2xl border border-slate-200 bg-white p-4"><form className="space-y-4" onSubmit={handleSaveDocEntry}><button type="button" onClick={() => setView('prescriptionDetail')} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-3 text-base"><ArrowLeft className="h-5 w-5" /> Abbrechen</button><div><label className="block text-sm text-slate-600 mb-1">Datum</label><input type="date" className="w-full rounded-xl border border-slate-200 px-3 py-3 text-base" value={docForm.entryDate} onChange={e => setDocForm(prev => ({ ...prev, entryDate: e.target.value }))} /></div><div><label className="block text-sm text-slate-600 mb-1">Dokumentation</label><textarea className="w-full min-h-40 rounded-xl border border-slate-200 px-3 py-3 text-base" value={docForm.text} onChange={e => setDocForm(prev => ({ ...prev, text: e.target.value }))} /></div><button type="submit" disabled={saving} className="w-full inline-flex justify-center items-center gap-2 rounded-xl bg-emerald-600 px-4 py-4 text-white text-base font-semibold disabled:opacity-70"><Save className="h-5 w-5" /> {saving ? 'Speichern...' : 'Speichern'}</button></form></section>}
      </main>
    </div>
  )
}