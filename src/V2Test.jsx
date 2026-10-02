import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from './lib/supabase'

const LOGIN_AT_KEY = 'physiooptima-v2-login-at'
const TEN_DAYS_MS = 10 * 24 * 60 * 60 * 1000
const EMPTY_FORM = { firstName: '', lastName: '', birthDate: '' }

function sortPatients(items) {
  return [...items].sort((a, b) =>
    (a.last_name || '').localeCompare(b.last_name || '', 'de') ||
    (a.first_name || '').localeCompare(b.first_name || '', 'de')
  )
}

function patientToForm(patient) {
  return {
    firstName: patient?.first_name || '',
    lastName: patient?.last_name || '',
    birthDate: patient?.birth_date || '',
  }
}

function sameFormAsPatient(form, patient) {
  if (!patient) return false
  return (
    form.firstName === (patient.first_name || '') &&
    form.lastName === (patient.last_name || '') &&
    form.birthDate === (patient.birth_date || '')
  )
}

function formatBirthDate(value) {
  if (!value) return '–'
  const [year, month, day] = value.split('-')
  return year && month && day ? `${day}.${month}.${year}` : value
}

function putPatient(items, incoming) {
  const exists = items.some(item => item.id === incoming.id)
  const next = exists
    ? items.map(item => item.id === incoming.id ? { ...item, ...incoming } : item)
    : [...items, incoming]
  return sortPatients(next)
}

export default function V2Test() {
  const [session, setSession] = useState(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [patients, setPatients] = useState([])
  const [status, setStatus] = useState('Bereit')
  const [view, setView] = useState('list')
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [basePatient, setBasePatient] = useState(null)
  const [conflict, setConflict] = useState(null)
  const [saving, setSaving] = useState(false)

  const editorRef = useRef({ view: 'list', editingId: null, form: EMPTY_FORM, basePatient: null })
  const savingRef = useRef(false)

  const dirty = useMemo(() => {
    if (view !== 'edit') return false
    if (!editingId) {
      return Boolean(form.firstName || form.lastName || form.birthDate)
    }
    return !sameFormAsPatient(form, basePatient)
  }, [view, editingId, form, basePatient])

  useEffect(() => {
    editorRef.current = { view, editingId, form, basePatient }
  }, [view, editingId, form, basePatient])

  useEffect(() => {
    let active = true

    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return
      const loginAt = Number(localStorage.getItem(LOGIN_AT_KEY) || 0)

      if (data.session && loginAt && Date.now() - loginAt > TEN_DAYS_MS) {
        await supabase.auth.signOut()
        localStorage.removeItem(LOGIN_AT_KEY)
        setSession(null)
        setStatus('10 Tage abgelaufen – bitte erneut anmelden.')
        return
      }

      setSession(data.session || null)
    })

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
    })

    return () => {
      active = false
      data.subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!session) return

    loadPatients()

    const channel = supabase
      .channel('v2-patients')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'patients' }, payload => {
        if (payload.eventType === 'DELETE') {
          const removedId = payload.old?.id
          if (removedId) {
            setPatients(current => current.filter(item => item.id !== removedId))
          }
          return
        }

        const incoming = payload.new
        if (!incoming?.id) return

        if (incoming.deleted_at) {
          setPatients(current => current.filter(item => item.id !== incoming.id))
        } else {
          setPatients(current => putPatient(current, incoming))
        }

        const editor = editorRef.current
        if (
          editor.view === 'edit' &&
          editor.editingId === incoming.id &&
          !savingRef.current
        ) {
          const hasUnsavedChanges = !sameFormAsPatient(editor.form, editor.basePatient)

          if (
            hasUnsavedChanges &&
            editor.basePatient?.updated_at &&
            incoming.updated_at !== editor.basePatient.updated_at
          ) {
            setConflict(incoming)
            setStatus('Konflikt erkannt – deine Eingaben wurden nicht überschrieben.')
          } else if (!hasUnsavedChanges) {
            setForm(patientToForm(incoming))
            setBasePatient(incoming)
            setConflict(null)
            setStatus('Aktuell ✓')
          }
        } else {
          setStatus('Aktuell ✓')
        }
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [session])

  async function loadPatients() {
    const { data, error } = await supabase
      .from('patients')
      .select('id,first_name,last_name,birth_date,created_at,updated_at,deleted_at')
      .is('deleted_at', null)
      .order('last_name')
      .order('first_name')

    if (error) {
      setStatus('Fehler: ' + error.message)
      return
    }

    setPatients(data || [])
    setStatus('Aktuell ✓')
  }

  async function login(event) {
    event.preventDefault()

    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      setStatus('Login fehlgeschlagen: ' + error.message)
      return
    }

    localStorage.setItem(LOGIN_AT_KEY, String(Date.now()))
    setSession(data.session)
    setPassword('')
    setStatus('Angemeldet ✓')
  }

  async function logout() {
    await supabase.auth.signOut()
    localStorage.removeItem(LOGIN_AT_KEY)
    setPatients([])
    setView('list')
    setEditingId(null)
    setConflict(null)
    setStatus('Abgemeldet')
  }

  function openNewPatient() {
    setEditingId(null)
    setBasePatient(null)
    setConflict(null)
    setForm(EMPTY_FORM)
    setView('edit')
    setStatus('Neuer Patient')
  }

  function openPatient(patient) {
    setEditingId(patient.id)
    setBasePatient(patient)
    setConflict(null)
    setForm(patientToForm(patient))
    setView('edit')
    setStatus('Patient geöffnet')
  }

  function backToList() {
    if (dirty && !window.confirm('Ungespeicherte Änderungen verwerfen?')) return
    setView('list')
    setEditingId(null)
    setBasePatient(null)
    setConflict(null)
    setForm(EMPTY_FORM)
    setStatus('Aktuell ✓')
  }

  function loadConflictVersion() {
    if (!conflict) return
    setForm(patientToForm(conflict))
    setBasePatient(conflict)
    setConflict(null)
    setStatus('Aktueller Stand geladen.')
  }

  async function savePatient(event) {
    event.preventDefault()

    const firstName = form.firstName.trim()
    const lastName = form.lastName.trim()

    if (!firstName || !lastName) {
      setStatus('Bitte Vorname und Nachname ausfüllen.')
      return
    }

    if (conflict) {
      setStatus('Bitte zuerst den Konflikt klären.')
      return
    }

    setSaving(true)
    savingRef.current = true

    try {
      if (!editingId) {
        const { data, error } = await supabase
          .from('patients')
          .insert({
            id: crypto.randomUUID(),
            first_name: firstName,
            last_name: lastName,
            birth_date: form.birthDate || null,
            created_by: session.user.id,
          })
          .select('id,first_name,last_name,birth_date,created_at,updated_at,deleted_at')
          .single()

        if (error) throw error

        setPatients(current => putPatient(current, data))
        setStatus('Patient gespeichert ✓')
        setView('list')
        setForm(EMPTY_FORM)
        return
      }

      const updatedAt = new Date().toISOString()
      const query = supabase
        .from('patients')
        .update({
          first_name: firstName,
          last_name: lastName,
          birth_date: form.birthDate || null,
          updated_at: updatedAt,
        })
        .eq('id', editingId)
        .eq('updated_at', basePatient.updated_at)
        .select('id,first_name,last_name,birth_date,created_at,updated_at,deleted_at')
        .maybeSingle()

      const { data, error } = await query
      if (error) throw error

      if (!data) {
        const { data: current, error: currentError } = await supabase
          .from('patients')
          .select('id,first_name,last_name,birth_date,created_at,updated_at,deleted_at')
          .eq('id', editingId)
          .single()

        if (currentError) throw currentError

        setConflict(current)
        setPatients(items => putPatient(items, current))
        setStatus('Konflikt erkannt – auf einem anderen Gerät wurde inzwischen gespeichert.')
        return
      }

      setPatients(current => putPatient(current, data))
      setBasePatient(data)
      setForm(patientToForm(data))
      setStatus('Patient gespeichert ✓')
      setView('list')
      setEditingId(null)
      setConflict(null)
    } catch (error) {
      setStatus('Speichern fehlgeschlagen: ' + error.message)
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  if (!session) {
    return (
      <main className="v2-page">
        <section className="v2-card v2-login-card">
          <h1>PhysioOptima · V2</h1>
          <p className="v2-muted">Anmeldung zur Behandlungsdokumentation</p>

          <form onSubmit={login} className="v2-stack">
            <input
              type="email"
              placeholder="E-Mail"
              value={email}
              onChange={event => setEmail(event.target.value)}
              required
            />
            <input
              type="password"
              placeholder="Passwort"
              value={password}
              onChange={event => setPassword(event.target.value)}
              required
            />
            <button className="v2-primary">Anmelden</button>
          </form>

          <p className="v2-status">{status}</p>
        </section>
      </main>
    )
  }

  if (view === 'edit') {
    return (
      <main className="v2-page">
        <section className="v2-card">
          <div className="v2-toolbar">
            <button type="button" onClick={backToList}>← Patienten</button>
            <button type="button" onClick={logout}>Abmelden</button>
          </div>

          <h1>{editingId ? 'Patient bearbeiten' : 'Neuer Patient'}</h1>
          <p className="v2-status">{status}</p>

          {conflict && (
            <div className="v2-conflict">
              <strong>Dieser Patient wurde inzwischen auf einem anderen Gerät geändert.</strong>
              <p>Deine Eingaben bleiben stehen und werden nicht automatisch überschrieben.</p>
              <p>
                Aktueller Stand: {conflict.last_name}, {conflict.first_name}
                {conflict.birth_date ? ` · ${formatBirthDate(conflict.birth_date)}` : ''}
              </p>
              <button type="button" onClick={loadConflictVersion}>Aktuellen Stand laden</button>
            </div>
          )}

          <form onSubmit={savePatient} className="v2-stack">
            <label>
              <span>Vorname</span>
              <input
                value={form.firstName}
                onChange={event => setForm(current => ({ ...current, firstName: event.target.value }))}
                required
              />
            </label>

            <label>
              <span>Nachname</span>
              <input
                value={form.lastName}
                onChange={event => setForm(current => ({ ...current, lastName: event.target.value }))}
                required
              />
            </label>

            <label>
              <span>Geburtsdatum</span>
              <input
                type="date"
                value={form.birthDate}
                onChange={event => setForm(current => ({ ...current, birthDate: event.target.value }))}
              />
            </label>

            <button className="v2-primary" disabled={saving || Boolean(conflict)}>
              {saving ? 'Speichert …' : 'Speichern'}
            </button>
          </form>
        </section>
      </main>
    )
  }

  return (
    <main className="v2-page">
      <section className="v2-card">
        <div className="v2-toolbar">
          <div>
            <h1>Patienten</h1>
            <p className="v2-muted">Angemeldet als {session.user.email}</p>
          </div>
          <button type="button" onClick={logout}>Abmelden</button>
        </div>

        <p className="v2-status">{status}</p>

        <button className="v2-primary v2-new-button" onClick={openNewPatient}>
          + Neuer Patient
        </button>

        <div className="v2-patient-list">
          {patients.map(patient => (
            <button
              type="button"
              key={patient.id}
              className="v2-patient-row"
              onClick={() => openPatient(patient)}
            >
              <strong>{patient.last_name}, {patient.first_name}</strong>
              <span>{formatBirthDate(patient.birth_date)}</span>
            </button>
          ))}
        </div>

        {patients.length === 0 && (
          <p className="v2-empty">Noch keine Patienten in der V2-Datenbank.</p>
        )}

        <small className="v2-footnote">
          Änderungen werden pro Datensatz gespeichert und per Realtime an andere Geräte übertragen.
        </small>
      </section>
    </main>
  )
}
