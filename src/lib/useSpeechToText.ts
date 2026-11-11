import { useCallback, useEffect, useRef, useState } from 'react'

// Minimal typings for the Web Speech API (not in TS's DOM lib everywhere).
type SpeechRecognitionResultLike = { isFinal: boolean; 0: { transcript: string } }
type SpeechRecognitionEventLike = { resultIndex: number; results: ArrayLike<SpeechRecognitionResultLike> }
type SpeechRecognitionLike = {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((e: SpeechRecognitionEventLike) => void) | null
  onerror: ((e: { error: string }) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
  abort: () => void
}

function getRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export const speechToTextSupported = () => getRecognitionCtor() !== null

const ERROR_TEXT: Record<string, string> = {
  'not-allowed': 'Microphone access is blocked — allow it in the browser’s site settings.',
  'service-not-allowed': 'Microphone access is blocked — allow it in the browser’s site settings.',
  'audio-capture': 'No microphone was found.',
  network: 'Speech recognition needs an internet connection.',
}

// Browser speech-to-text (Chrome, Edge, Safari). Each finished phrase is
// handed to `onFinal`; `interim` holds the words still being recognised so
// the UI can show them live. Only one dictation runs at a time on a page —
// starting a new one stops whichever was running.
let activeStop: (() => void) | null = null

export function useSpeechToText(onFinal: (text: string) => void, lang = 'en-IN') {
  const [listening, setListening] = useState(false)
  const [interim, setInterim] = useState('')
  const [error, setError] = useState('')
  const recRef = useRef<SpeechRecognitionLike | null>(null)
  const onFinalRef = useRef(onFinal)
  onFinalRef.current = onFinal
  const wantRef = useRef(false)

  const stop = useCallback(() => {
    wantRef.current = false
    recRef.current?.stop()
    setListening(false)
    setInterim('')
  }, [])

  const start = useCallback(() => {
    const Ctor = getRecognitionCtor()
    if (!Ctor) {
      setError('Voice typing isn’t supported in this browser — try Chrome or Edge.')
      return
    }
    if (activeStop && activeStop !== stop) activeStop()
    activeStop = stop
    setError('')
    const rec = new Ctor()
    rec.lang = lang
    rec.continuous = true
    rec.interimResults = true
    rec.onresult = (e) => {
      let live = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]
        const text = r[0].transcript
        if (r.isFinal) {
          if (text.trim()) onFinalRef.current(text.trim())
        } else live += text
      }
      setInterim(live)
    }
    rec.onerror = (e) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return
      setError(ERROR_TEXT[e.error] ?? 'Voice typing stopped unexpectedly — try again.')
      wantRef.current = false
    }
    // Browsers end a session after a pause; keep going until the user stops.
    rec.onend = () => {
      if (wantRef.current) {
        try {
          rec.start()
          return
        } catch {
          /* fall through */
        }
      }
      setListening(false)
      setInterim('')
    }
    recRef.current = rec
    wantRef.current = true
    try {
      rec.start()
      setListening(true)
    } catch {
      setError('Couldn’t start the microphone — try again.')
    }
  }, [lang, stop])

  useEffect(
    () => () => {
      wantRef.current = false
      recRef.current?.abort()
      if (activeStop === stop) activeStop = null
    },
    [stop],
  )

  return { listening, interim, error, start, stop, toggle: () => (listening ? stop() : start()) }
}

// Joins dictated text onto existing plain text: a space between, and a
// capital letter when starting a new sentence.
export function appendDictation(prev: string, text: string): string {
  const base = prev.replace(/\s+$/, '')
  const startsSentence = base === '' || /[.!?]$/.test(base)
  const piece = startsSentence ? text.charAt(0).toUpperCase() + text.slice(1) : text
  return base ? `${base} ${piece}` : piece
}
