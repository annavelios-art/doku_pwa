import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'

const LOGIN_AT_KEY = 'physiooptima-v2-login-at'
const TEN_DAYS_MS = 10 * 24 * 60 * 60 * 1000

function sortPatients(items) {
  return [...items].sort((a, b) =>
    (a.last_name || '').localeCompare(b.last_name || '') ||
    (a.first_name || '').localeCompare(b.first_name || '')
  )
}

export default function V2Test() {
  const [session, setSession] = useState(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [patients, setPatients] = useState([])
  const [status, setStatus] = useState('Bereit')

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
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => {
      active = false
      data.subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!session) return
    loadPatients()
    const channel = supabase.channel('v2-patients-test')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'patients' }, payload => {
        setPatients(current => {
          if (payload.eventType === 'DELETE') {
            return current.filter(item => item.id !== payload.old?.id)
          }

          const incoming = payload.new
          if (!incoming?.id) return current
          if (incoming.deleted_at) {
            return current.filter(item => item.id !== incoming.id)
          }

          const exists = current.some(item => item.id === incoming.id)
          const next = exists
            ? current.map(item => item.id === incoming.id ? { ...item, ...incoming } : item)
            : [...current, incoming]

          return sortPatients(next)
        })
        setStatus('Realtime: Änderung empfangen ✓')
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [session])

  async function loadPatients(message) {
    const { data, error } = await supabase.from('patients')
      .select('id,first_name,last_name,updated_at,deleted_at')
      .is('deleted_at', null)
      .order('last_name')
    if (error) return setStatus(error.message)
    setPatients(data || [])
    if (message) setStatus(message)
  }

  async function login(e) {
    e.preventDefault()
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) return setStatus('Login fehlgeschlagen: ' + error.message)
    localStorage.setItem(LOGIN_AT_KEY, String(Date.now()))
    setSession(data.session)
    setPassword('')
    setStatus('Angemeldet ✓')
  }

  async function logout() {
    await supabase.auth.signOut()
    localStorage.removeItem(LOGIN_AT_KEY)
    setPatients([])
    setStatus('Abgemeldet')
  }

  async function addPatient() {
    const patient = {
      id: crypto.randomUUID(),
      first_name: 'Max',
      last_name: 'Mustermann',
      created_by: session.user.id,
    }
    const { error } = await supabase.from('patients').insert(patient)
    if (error) return setStatus('Speichern fehlgeschlagen: ' + error.message)
    setPatients(current => sortPatients([...current, patient]))
    setStatus('Max Mustermann gespeichert ✓')
  }

  async function rename(patient) {
    const next = window.prompt('Neuer Vorname:', patient.first_name)
    if (!next || next === patient.first_name) return
    const updatedAt = new Date().toISOString()
    const { error } = await supabase.from('patients')
      .update({ first_name: next, updated_at: updatedAt })
      .eq('id', patient.id)
    if (error) return setStatus('Ändern fehlgeschlagen: ' + error.message)

    setPatients(current => sortPatients(
      current.map(item => item.id === patient.id
        ? { ...item, first_name: next, updated_at: updatedAt }
        : item)
    ))
    setStatus('Änderung gespeichert ✓')
  }

  if (!session) return <main className="v2-page">
    <section className="v2-card">
      <h1>PhysioOptima · V2 Test</h1>
      <p>Login + einzelne Supabase-Datensätze + Realtime ohne Seitenreload.</p>
      <form onSubmit={login} className="v2-stack">
        <input type="email" placeholder="E-Mail" value={email} onChange={e => setEmail(e.target.value)} required />
        <input type="password" placeholder="Passwort" value={password} onChange={e => setPassword(e.target.value)} required />
        <button>Anmelden</button>
      </form>
      <p>{status}</p>
    </section>
  </main>

  return <main className="v2-page">
    <section className="v2-card">
      <h1>V2 Teststation</h1>
      <p>Angemeldet: {session.user.email}</p>
      <p><b>{status}</b></p>
      <button onClick={addPatient}>Max Mustermann anlegen</button>
      <button onClick={logout}>Abmelden</button>
      <h2>Neue Supabase-Patienten</h2>
      {patients.map(p => <div key={p.id} className="v2-row">
        <span>{p.last_name}, {p.first_name}</span>
        <button onClick={() => rename(p)}>Vorname ändern</button>
      </div>)}
      {patients.length === 0 && <p>Noch leer.</p>}
      <small>Realtime aktualisiert die Liste direkt aus dem empfangenen Datensatz. Kein Seitenreload. Anmeldung bleibt maximal 10 Tage bestehen.</small>
    </section>
  </main>
}
