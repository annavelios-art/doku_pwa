import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'

export default function V2Test() {
  const [session, setSession] = useState(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [patients, setPatients] = useState([])
  const [status, setStatus] = useState('Bereit')

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session || null))
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session) return
    loadPatients()
    const channel = supabase.channel('v2-patients-test')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'patients' }, () => loadPatients('Realtime: Änderung empfangen ✓'))
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [session])

  async function loadPatients(message) {
    const { data, error } = await supabase.from('patients')
      .select('id,first_name,last_name,updated_at')
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
    setSession(data.session)
    setPassword('')
    setStatus('Angemeldet ✓')
  }

  async function logout() {
    await supabase.auth.signOut()
    setPatients([])
    setStatus('Abgemeldet')
  }

  async function addPatient() {
    const { error } = await supabase.from('patients').insert({
      id: crypto.randomUUID(),
      first_name: 'Max',
      last_name: 'Mustermann',
      created_by: session.user.id,
    })
    if (error) return setStatus('Speichern fehlgeschlagen: ' + error.message)
    setStatus('Max Mustermann gespeichert ✓')
    await loadPatients()
  }

  async function rename(patient) {
    const next = window.prompt('Neuer Vorname:', patient.first_name)
    if (!next || next === patient.first_name) return
    const { error } = await supabase.from('patients')
      .update({ first_name: next, updated_at: new Date().toISOString() })
      .eq('id', patient.id)
    if (error) return setStatus('Ändern fehlgeschlagen: ' + error.message)
    setStatus('Änderung gespeichert ✓')
    await loadPatients()
  }

  if (!session) return <main className="v2-page">
    <section className="v2-card">
      <h1>PhysioOptima · V2 Test</h1>
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
      <small>Realtime aktualisiert nur die Liste. Kein Seitenreload.</small>
    </section>
  </main>
}
