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

        setStatus('Aktuell ✓')
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [session])

  async function loadPatients() {
    const { data, error } = await supabase
      .from('patients')
      .select('id,first_name,last_name,updated_at,deleted_at')
      .is('deleted_at', null)
      .order('last_name')

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
    setStatus('Abgemeldet')
  }

  if (!session) {
    return (
      <main className="v2-page">
        <section className="v2-card">
          <h1>PhysioOptima · V2</h1>
          <p>Supabase-Login</p>

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
            <button>Anmelden</button>
          </form>

          <p>{status}</p>
        </section>
      </main>
    )
  }

  return (
    <main className="v2-page">
      <section className="v2-card">
        <h1>PhysioOptima · V2 Basis</h1>

        <p>Angemeldet: {session.user.email}</p>
        <p><b>{status}</b></p>

        <button onClick={logout}>Abmelden</button>

        <h2>Supabase-Patienten</h2>

        {patients.map(patient => (
          <div key={patient.id} className="v2-row">
            <span>{patient.last_name}, {patient.first_name}</span>
          </div>
        ))}

        {patients.length === 0 && <p>Noch keine Patienten in der V2-Datenbank.</p>}

        <small>
          Realtime-Grundlage aktiv · kein Seitenreload · Anmeldung maximal 10 Tage.
        </small>
      </section>
    </main>
  )
}
