/*
====================================================

        Sprachsystem der Praxis-PWA

        Version 1.0

App.jsx kennt niemals Whisper direkt.

Alle Kommunikation läuft über speechService.

Dadurch kann das Sprachmodell später
beliebig ausgetauscht werden.

====================================================
*/

import dictionaryText from './woerterbuch.txt?raw'
import phrasesText from './phrasen.txt?raw'

let whisperModel = null
let dictionary = []
let phrases = []

function loadDictionary() {
  dictionary = dictionaryText
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .filter(line => !line.startsWith('#'))

  console.log(`📚 Wörterbuch geladen: ${dictionary.length} Wörter`)
}

function loadPhrases() {
  phrases = phrasesText
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .filter(line => !line.startsWith('#'))

  console.log(`📝 Phrasen geladen: ${phrases.length} Sätze`)
}

export async function loadModel() {
  if (whisperModel) {
    console.log('✅ Whisper bereits geladen.')
    return whisperModel
  }

  console.log('🧠 Sprachmodell wird vorbereitet...')

  loadDictionary()
  loadPhrases()

  // Hier wird später Whisper geladen.
  whisperModel = {
    loaded: true,
    version: 'Platzhalter 1.0',
  }

  console.log('✅ Sprachmodell bereit.')

  return whisperModel
}