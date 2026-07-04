/*
====================================================

  Sprachsystem der Praxis-PWA
  Vosk-Testmotor

====================================================
*/

import * as Vosk from 'vosk-browser'
import dictionaryText from './woerterbuch.txt?raw'
import phrasesText from './phrasen.txt?raw'

const MODEL_URL = '/models/vosk-model-small-de-0.15.tar.gz'

let speechInitialized = false
let dictionary = []
let phrases = []

let voskModel = null
let recognizer = null
let mediaStream = null
let audioContext = null
let sourceNode = null
let recognizerNode = null
let silentGainNode = null
let isListening = false
let activeOptions = null

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

function emitStatus(message) {
  activeOptions?.onStatus?.(message)
  console.log(message)
}

function emitError(error) {
  activeOptions?.onError?.(error)
  console.error(error)
}

function emitText(text) {
  const cleaned = postProcessText(text)
  if (!cleaned) return
  activeOptions?.onText?.(cleaned)
}

async function loadVoskModel() {
  if (voskModel) return voskModel

  emitStatus('Vosk-Modell wird geladen...')

  voskModel = await Vosk.createModel(MODEL_URL)

  emitStatus('Vosk-Modell geladen.')
  return voskModel
}

function createRecognizer(model) {
  if (recognizer) return recognizer

  recognizer = new model.KaldiRecognizer(16000)

  recognizer.on('result', message => {
    const text = message?.result?.text || ''
    if (text) emitText(text)
  })

  recognizer.on('partialresult', message => {
    const partial = message?.result?.partial || ''
    if (partial) activeOptions?.onStatus?.(`Höre: ${partial}`)
  })

  return recognizer
}

export async function initializeSpeech() {
  if (speechInitialized) return true

  loadDictionary()
  loadPhrases()

  await loadVoskModel()

  speechInitialized = true
  emitStatus('✅ Sprachsystem vorbereitet.')

  return true
}

export async function loadModel() {
  return initializeSpeech()
}

export async function startDictation(options = {}) {
  activeOptions = options

  if (isListening) {
    emitStatus('Diktat läuft bereits.')
    return true
  }

  try {
    emitStatus('Sprachsystem wird vorbereitet...')
    await initializeSpeech()

    const model = await loadVoskModel()
    const activeRecognizer = createRecognizer(model)

    emitStatus('Mikrofon wird gestartet...')

    mediaStream = await navigator.mediaDevices.getUserMedia({
      video: false,
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        channelCount: 1,
        sampleRate: 16000,
      },
    })

    audioContext = new AudioContext({ sampleRate: 16000 })

    if (audioContext.state === 'suspended') {
      await audioContext.resume()
    }

    sourceNode = audioContext.createMediaStreamSource(mediaStream)
    recognizerNode = audioContext.createScriptProcessor(4096, 1, 1)
    silentGainNode = audioContext.createGain()
    silentGainNode.gain.value = 0

    recognizerNode.onaudioprocess = event => {
      if (!isListening) return

      try {
        activeRecognizer.acceptWaveform(event.inputBuffer)
      } catch (error) {
        emitError(error)
      }
    }

    sourceNode.connect(recognizerNode)
    recognizerNode.connect(silentGainNode)
    silentGainNode.connect(audioContext.destination)

    isListening = true
    emitStatus('Diktieren läuft...')

    return true
  } catch (error) {
    await stopDictation()
    throw error
  }
}

export async function stopDictation() {
  isListening = false

  try {
    if (recognizerNode) {
      recognizerNode.disconnect()
      recognizerNode.onaudioprocess = null
    }

    if (sourceNode) sourceNode.disconnect()
    if (silentGainNode) silentGainNode.disconnect()

    if (mediaStream) {
      mediaStream.getTracks().forEach(track => track.stop())
    }

    if (audioContext && audioContext.state !== 'closed') {
      await audioContext.close()
    }
  } catch (error) {
    console.warn('Diktat konnte nicht vollständig gestoppt werden:', error)
  } finally {
    mediaStream = null
    audioContext = null
    sourceNode = null
    recognizerNode = null
    silentGainNode = null
    activeOptions = null
    console.log('Diktat gestoppt.')
  }
}

export function postProcessText(text) {
  return (text || '')
    .replaceAll('brust wirbel säule', 'Brustwirbelsäule')
    .replaceAll('Brust Wirbel Säule', 'Brustwirbelsäule')
    .replaceAll('Brust Wirbelsäule', 'Brustwirbelsäule')
    .replaceAll('lenden wirbel säule', 'Lendenwirbelsäule')
    .replaceAll('Lenden Wirbel Säule', 'Lendenwirbelsäule')
    .replaceAll('Lenden Wirbelsäule', 'Lendenwirbelsäule')
    .replaceAll('hals wirbel säule', 'Halswirbelsäule')
    .replaceAll('Hals Wirbel Säule', 'Halswirbelsäule')
    .replaceAll('Hals Wirbelsäule', 'Halswirbelsäule')
    .replaceAll(' bws ', ' BWS ')
    .replaceAll(' lws ', ' LWS ')
    .replaceAll(' hws ', ' HWS ')
    .trim()
}