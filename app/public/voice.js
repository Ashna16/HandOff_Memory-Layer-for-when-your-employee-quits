/**
 * Voice.
 *
 * Browser Web Speech API for both directions: the agent speaks the question,
 * she answers out loud. No API key, nothing to provision, nothing to rate-limit
 * — which is exactly why it is the default. If speech recognition is missing or
 * the venue blocks it, everything falls through to typing and the demo does not
 * notice.
 */

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

export class Voice {
  constructor() {
    this.recognition = null;
    this.listening = false;
    this.finalText = '';
    this.voice = null;
    this.#pickVoice();
    speechSynthesis?.addEventListener?.('voiceschanged', () => this.#pickVoice());
  }

  get sttSupported() { return Boolean(SR); }
  get ttsSupported() { return typeof speechSynthesis !== 'undefined'; }

  #pickVoice() {
    if (!this.ttsSupported) return;
    const voices = speechSynthesis.getVoices();
    if (!voices.length) return;
    // Prefer a natural en-US voice; these are the ones that do not sound like
    // a 1998 screen reader, which matters when the room is listening.
    const ranked = ['Samantha', 'Ava', 'Allison', 'Serena', 'Google US English', 'Karen'];
    for (const name of ranked) {
      const v = voices.find((x) => x.name.includes(name));
      if (v) { this.voice = v; return; }
    }
    this.voice = voices.find((v) => v.lang?.startsWith('en')) || voices[0];
  }

  /**
   * Speak, and resolve when finished so the interview can wait its turn.
   *
   * Serialised on purpose. Two overlapping utterances is the "echo" — it
   * happens whenever anything asks a second question before the first has
   * finished, and once you hear it in a room you cannot unhear it. Every call
   * cancels whatever is in flight and waits a beat before starting: Chrome
   * needs that gap or `cancel()` lands after `speak()` and the old utterance
   * survives.
   */
  speak(text) {
    this.speakToken = (this.speakToken || 0) + 1;
    const token = this.speakToken;

    return new Promise((resolve) => {
      if (!this.ttsSupported || !text) return resolve();
      speechSynthesis.cancel();

      setTimeout(() => {
        // Superseded while we waited — stay silent rather than pile on.
        if (token !== this.speakToken) return resolve();

        const u = new SpeechSynthesisUtterance(text);
        if (this.voice) u.voice = this.voice;
        u.rate = 1.0; u.pitch = 1.0; u.volume = 1;

        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          clearTimeout(guard);
          this.speaking = false;
          resolve();
        };
        u.onend = finish;
        u.onerror = finish;

        // Some browsers never fire onend on a long utterance.
        const guard = setTimeout(finish, Math.min(18000, 1200 + text.length * 68));

        this.speaking = true;
        speechSynthesis.speak(u);
      }, 90);
    });
  }

  shutUp() {
    this.speakToken = (this.speakToken || 0) + 1;   // invalidate anything pending
    this.speaking = false;
    if (this.ttsSupported) speechSynthesis.cancel();
  }

  /**
   * Start listening. `onUpdate(finalText, interimText)` fires continuously so
   * the transcript fills in as she talks — the audience needs to see the words
   * land, not wait for a result at the end.
   */
  start(onUpdate, onError) {
    if (!SR) { onError?.(new Error('speech recognition unavailable')); return false; }
    // Never listen while the agent is still talking, or the mic transcribes the
    // agent's own question into her answer — the other half of the echo.
    this.shutUp();
    this.stop();
    this.finalText = '';

    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = 'en-US';
    rec.maxAlternatives = 1;

    rec.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const chunk = event.results[i][0].transcript;
        if (event.results[i].isFinal) this.finalText += chunk + ' ';
        else interim += chunk;
      }
      onUpdate?.(this.finalText.trim(), interim.trim());
    };
    rec.onerror = (e) => {
      // 'no-speech' and 'aborted' are normal in a live room; never surface them.
      if (e.error !== 'no-speech' && e.error !== 'aborted') onError?.(e);
    };
    rec.onend = () => {
      // Chrome stops on its own after a pause. Restart while the user still
      // holds the floor, so a thoughtful silence does not end her answer.
      if (this.listening) { try { rec.start(); } catch { /* already starting */ } }
    };

    this.recognition = rec;
    this.listening = true;
    try { rec.start(); } catch { /* already started */ }
    return true;
  }

  stop() {
    this.listening = false;
    if (this.recognition) {
      try { this.recognition.stop(); } catch { /* not running */ }
      this.recognition = null;
    }
    return this.finalText.trim();
  }
}
