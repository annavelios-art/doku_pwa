import { useEffect, useMemo, useState } from 'react'
import { Plus, Search, ArrowLeft, Save } from 'lucide-react'
import {
  getAllPatients,
  getPatientById,
  getRecentlyOpenedPatients,
  markPatientAsRecentlyOpened,
  savePatient,
} from './lib/patientsDb'

const EMPTY_FORM = { id: '', firstName: '', lastName: '', birthDate: '', createdAt: '' }

function formatBirthDate(value) {
  if (!value) return '–'
  return new Date(value).toLocaleDateString('de-DE')
}

function PatientCard({ patient, onOpen }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(patient.id)}
      className="w-full text-left rounded-2xl border border-slate-200 bg-white p-4 active:scale-[0.99] transition"
    >
      <p className="text-lg font-semibold text-slate-900">{patient.lastName}</p>
      <p className="text-base text-slate-700">{patient.firstName}</p>
      <p className="text-sm text-slate-500 mt-1">Geburtsdatum: {formatBirthDate(patient.birthDate)}</p>
    </button>
  )
}

export default function App() {
  const [view, setView] = useState('list')
  const [patients, setPatients] = useState([])
  const [recentPatients, setRecentPatients] = useState([])
  const [query, setQuery] = useState('')
  const [form, setForm] = useState(EMPTY_FORM)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const filteredPatients = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    if (!normalized) return patients
    return patients.filter(patient =>
      `${patient.lastName} ${patient.firstName}`.toLowerCase().includes(normalized),
    )
  }, [patients, query])

  async function loadData() {
    setLoading(true)
    setError('')
    try {
      const [all, recents] = await Promise.all([getAllPatients(), getRecentlyOpenedPatients()])
      setPatients(all)
      setRecentPatients(recents)
    } catch (loadError) {
      setError(loadError.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  function startCreate() {
    setForm(EMPTY_FORM)
    setError('')
    setView('edit')
  }

  async function openEdit(patientId) {
    setError('')
    try {
      const patient = await getPatientById(patientId)
      if (!patient) {
        setError('Patient wurde nicht gefunden.')
        return
      }
      setForm(patient)
      setView('edit')
      await markPatientAsRecentlyOpened(patientId)
      const recents = await getRecentlyOpenedPatients()
      setRecentPatients(recents)
    } catch (openError) {
      setError(openError.message)
    }
  }

  async function handleSave(event) {
    event.preventDefault()
    setSaving(true)
    setError('')

    try {
      if (!form.lastName.trim() || !form.firstName.trim() || !form.birthDate) {
        throw new Error('Bitte Name, Vorname und Geburtsdatum ausfüllen.')
      }

      const saved = await savePatient({
        ...form,
        lastName: form.lastName.trim(),
        firstName: form.firstName.trim(),
      })
      await markPatientAsRecentlyOpened(saved.id)
      await loadData()
      setView('list')
    } catch (saveError) {
      setError(saveError.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <main className="mx-auto w-full max-w-xl p-4 pb-12 space-y-4">
        <header className="sticky top-0 z-10 -mx-4 px-4 py-3 bg-slate-50/95 backdrop-blur border-b border-slate-200">
          <h1 className="text-xl font-semibold text-slate-900">Physio Doku (lokal)</h1>
          <p className="text-sm text-slate-500">Mobile-first Patientenverwaltung ohne Cloud</p>
        </header>

        {error && <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-red-700 text-sm">{error}</p>}

        {view === 'list' ? (
          <section className="space-y-4">
            <div className="flex gap-2">
              <label className="relative flex-1">
                <Search className="absolute left-3 top-3.5 h-5 w-5 text-slate-400" />
                <input
                  className="w-full rounded-xl border border-slate-200 bg-white py-3 pl-10 pr-3 text-base"
                  type="search"
                  placeholder="Patient suchen"
                  value={query}
                  onChange={event => setQuery(event.target.value)}
                />
              </label>
              <button
                type="button"
                onClick={startCreate}
                className="inline-flex items-center gap-1 rounded-xl bg-sky-600 px-4 py-3 text-white text-base font-medium"
              >
                <Plus className="h-5 w-5" /> Patient
              </button>
            </div>

            <div className="space-y-2">
              <h2 className="text-sm font-medium text-slate-500">Zuletzt geöffnet</h2>
              {recentPatients.length === 0 ? (
                <p className="text-sm text-slate-400">Noch keine zuletzt geöffneten Patienten.</p>
              ) : (
                <div className="grid gap-2">{recentPatients.map(patient => <PatientCard key={patient.id} patient={patient} onOpen={openEdit} />)}</div>
              )}
            </div>

            <div className="space-y-2">
              <h2 className="text-sm font-medium text-slate-500">Patienten</h2>
              {loading ? (
                <p className="text-sm text-slate-400">Lade Patienten...</p>
              ) : filteredPatients.length === 0 ? (
                <p className="text-sm text-slate-400">Keine Patienten gefunden.</p>
              ) : (
                <div className="grid gap-2">{filteredPatients.map(patient => <PatientCard key={patient.id} patient={patient} onOpen={openEdit} />)}</div>
              )}
            </div>
          </section>
        ) : (
          <section className="rounded-2xl border border-slate-200 bg-white p-4">
            <form className="space-y-4" onSubmit={handleSave}>
              <button
                type="button"
                onClick={() => setView('list')}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-3 text-base"
              >
                <ArrowLeft className="h-5 w-5" /> Zurück zur Liste
              </button>

              <div>
                <label className="block text-sm text-slate-600 mb-1">Name</label>
                <input
                  className="w-full rounded-xl border border-slate-200 px-3 py-3 text-base"
                  value={form.lastName}
                  onChange={event => setForm(prev => ({ ...prev, lastName: event.target.value }))}
                />
              </div>

              <div>
                <label className="block text-sm text-slate-600 mb-1">Vorname</label>
                <input
                  className="w-full rounded-xl border border-slate-200 px-3 py-3 text-base"
                  value={form.firstName}
                  onChange={event => setForm(prev => ({ ...prev, firstName: event.target.value }))}
                />
              </div>

              <div>
                <label className="block text-sm text-slate-600 mb-1">Geburtsdatum</label>
                <input
                  type="date"
                  className="w-full rounded-xl border border-slate-200 px-3 py-3 text-base"
                  value={form.birthDate}
                  onChange={event => setForm(prev => ({ ...prev, birthDate: event.target.value }))}
                />
              </div>

              <button
                type="submit"
                disabled={saving}
                className="w-full inline-flex justify-center items-center gap-2 rounded-xl bg-emerald-600 px-4 py-4 text-white text-base font-semibold disabled:opacity-70"
              >
                <Save className="h-5 w-5" /> {saving ? 'Speichern...' : 'Speichern'}
              </button>
            </form>
          </section>
        )}
      </main>
    </div>
  )
}