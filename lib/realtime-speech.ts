interface SpeechCallbacks {
  onTranscript: (finalText: string, interimText: string) => void;
  onActive: (active: boolean) => void;
  onError: (message: string | null) => void;
}

export function createSpeechTranscriber(
  Recognition: SpeechRecognitionConstructor,
  callbacks: SpeechCallbacks,
  language: string,
) {
  let recognition: SpeechRecognition | null = null;
  let restartTimer: ReturnType<typeof setTimeout> | null = null;
  let enabled = false;
  let committedText = "";

  const stop = () => {
    enabled = false;
    if (restartTimer) clearTimeout(restartTimer);
    restartTimer = null;
    const previous = recognition;
    recognition = null;
    if (previous) {
      previous.onstart = previous.onend = previous.onerror = previous.onresult = null;
      previous.abort();
    }
    callbacks.onActive(false);
  };

  const begin = () => {
    if (!enabled) return;
    const current = new Recognition();
    recognition = current;
    current.continuous = true;
    current.interimResults = true;
    current.lang = language;
    const prefix = committedText;

    current.onstart = () => {
      if (enabled && recognition === current) callbacks.onActive(true);
    };
    current.onresult = (event) => {
      if (!enabled || recognition !== current) return;
      const final: string[] = [];
      const interim: string[] = [];
      // Results are cumulative within a recognition session. Rebuild, don't append
      // the same final result again when an interim hypothesis changes.
      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i];
        (result.isFinal ? final : interim).push(result[0].transcript.trim());
      }
      committedText = [prefix, ...final].filter(Boolean).join(" ");
      callbacks.onTranscript(committedText, interim.join(" "));
    };
    current.onerror = (event) => {
      if (!enabled || recognition !== current) return;
      callbacks.onActive(false);
      if (event.error === "no-speech") return; // Restart after the end event.
      enabled = false;
      const messages: Record<string, string> = {
        "not-allowed": "Microphone or speech recognition permission was denied. Allow access, then restart recording.",
        "service-not-allowed": "Speech recognition is blocked by this browser. Check its permissions, then restart recording.",
        "audio-capture": "Speech recognition could not access the microphone. Check your input device.",
        network: "The browser's speech recognition service could not connect. Check your connection, then restart recording.",
        "language-not-supported": "Speech recognition does not support the selected browser language.",
      };
      callbacks.onError(messages[event.error] ?? `Speech recognition stopped (${event.error}). Restart recording to try again.`);
    };
    current.onend = () => {
      if (recognition !== current) return;
      recognition = null;
      callbacks.onActive(false);
      if (enabled) restartTimer = setTimeout(begin, 500);
    };
    try {
      current.start();
    } catch {
      enabled = false;
      recognition = null;
      callbacks.onActive(false);
      callbacks.onError("Speech recognition could not start. Check microphone permissions, then restart recording.");
    }
  };

  return {
    start() {
      stop();
      committedText = "";
      callbacks.onTranscript("", "");
      callbacks.onError(null);
      enabled = true;
      begin();
    },
    stop,
  };
}
