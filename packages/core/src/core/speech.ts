/** Recognition publishes the current transcript, including provisional words. */
export interface SpeechAdapter {
  isSupported(): boolean
  start(callbacks: SpeechCallbacks): SpeechSession
}

export interface SpeechCallbacks {
  onTranscript: (transcript: string) => void
  onEnd: (error?: string) => void
}

export interface SpeechSession {
  stop(): void
  abort(): void
}

interface RecognitionResult {
  readonly isFinal: boolean
  readonly 0: { transcript: string }
}

interface Recognition {
  continuous: boolean
  interimResults: boolean
  lang: string
  onresult: ((event: { results: ArrayLike<RecognitionResult> }) => void) | null
  onerror: ((event: { error: string }) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
  abort(): void
}

function recognitionConstructor(): (new () => Recognition) | undefined {
  const browser = globalThis as {
    SpeechRecognition?: new () => Recognition
    webkitSpeechRecognition?: new () => Recognition
  }
  return browser.SpeechRecognition ?? browser.webkitSpeechRecognition
}

export class WebSpeechAdapter implements SpeechAdapter {
  constructor(private language?: string) {}

  isSupported(): boolean {
    return !!recognitionConstructor()
  }

  start(callbacks: SpeechCallbacks): SpeechSession {
    const Recognition = recognitionConstructor()
    if (!Recognition) throw new Error('Speech recognition is unavailable in this browser')
    const recognition = new Recognition()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = this.language ?? document.documentElement.lang
    const detach = (): void => {
      recognition.onresult = null
      recognition.onerror = null
      recognition.onend = null
    }

    recognition.onresult = ({ results }) => {
      const transcript = Array.from(results, (entry) => entry[0].transcript.trim()).filter(Boolean).join(' ')
      if (transcript) callbacks.onTranscript(transcript)
    }
    let error: string | undefined
    recognition.onerror = (event) => { error = event.error }
    recognition.onend = () => {
      detach()
      callbacks.onEnd(error)
    }
    try {
      recognition.start()
    } catch (err) {
      detach()
      throw err
    }
    return {
      stop: () => recognition.stop(),
      abort: () => {
        detach()
        recognition.abort()
      },
    }
  }
}
