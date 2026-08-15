/**
 * Memoir - Voice Recognition & Speech Intelligence Engine
 * Handles continuous local speech recognition, voice trigger parsing ("chapter", "topic", "thought"),
 * audio visualizer waveform rendering, and synthetic audio feedback cues.
 */

class VoiceEngine {
  constructor() {
    this.isListening = false;
    this.recognition = null;
    this.audioContext = null;
    this.analyser = null;
    this.microphoneStream = null;
    this.waveformCanvas = null;
    this.waveformCtx = null;
    this.animationFrameId = null;

    this.language = localStorage.getItem("memoir_voice_lang") || "en-US";
    this.soundEffects = true;

    // Callbacks
    this.onCommand = null;        // (type: 'chapter'|'topic'|'thought'|'link'|'tag', payload: string)
    this.onTranscription = null;  // (text: string, isFinal: boolean)
    this.onStatusChange = null;   // (isListening: boolean)
    this.onSpeechLog = null;       // (entry: { time: string, text: string, type: string })

    this.silenceTimeout = null;
    this.initSpeechRecognition();
  }

  initSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.warn("SpeechRecognition API is not supported in this browser.");
      return;
    }

    this.recognition = new SpeechRecognition();
    this.recognition.continuous = true;
    this.recognition.interimResults = true;
    this.recognition.lang = this.language;
    this.recognition.maxAlternatives = 1;

    this.recognition.onstart = () => {
      this.isListening = true;
      if (this.onStatusChange) this.onStatusChange(true);
      this.playChime("start");
    };

    this.recognition.onend = () => {
      // Auto-restart if user still wants to be listening
      if (this.isListening) {
        try {
          this.recognition.start();
        } catch (e) {
          // Might take a frame to restart
          setTimeout(() => {
            if (this.isListening) {
              try { this.recognition.start(); } catch (err) {}
            }
          }, 300);
        }
      } else {
        if (this.onStatusChange) this.onStatusChange(false);
      }
    };

    this.recognition.onerror = (event) => {
      console.warn("Speech recognition error:", event.error);
      if (event.error === "not-allowed") {
        this.isListening = false;
        if (this.onStatusChange) this.onStatusChange(false);
      }
    };

    this.recognition.onresult = (event) => {
      let interimTranscript = "";
      let finalTranscript = "";

      for (let i = event.resultIndex; i < event.results.length; ++i) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += transcript;
        } else {
          interimTranscript += transcript;
        }
      }

      if (interimTranscript && this.onTranscription) {
        this.onTranscription(interimTranscript.trim(), false);
      }

      if (finalTranscript) {
        this.processFinalSpeech(finalTranscript.trim());
      }
    };
  }

  async startAudioVisualizer(canvasElement) {
    this.waveformCanvas = canvasElement;
    if (!this.waveformCanvas) return;
    this.waveformCtx = this.waveformCanvas.getContext("2d");

    try {
      if (!this.audioContext) {
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      }
      if (this.audioContext.state === "suspended") {
        await this.audioContext.resume();
      }

      this.microphoneStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const source = this.audioContext.createMediaStreamSource(this.microphoneStream);
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 64;
      source.connect(this.analyser);

      this.drawWaveform();
    } catch (e) {
      console.warn("Microphone visualizer initialization failed:", e);
      // Fallback animated mock wave if direct stream was blocked
      this.drawMockWaveform();
    }
  }

  drawWaveform() {
    if (!this.waveformCanvas || !this.waveformCtx || !this.analyser) return;

    const bufferLength = this.analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const render = () => {
      this.animationFrameId = requestAnimationFrame(render);
      this.analyser.getByteFrequencyData(dataArray);

      const width = this.waveformCanvas.width;
      const height = this.waveformCanvas.height;
      this.waveformCtx.clearRect(0, 0, width, height);

      const barWidth = (width / bufferLength) * 1.8;
      let x = 0;

      for (let i = 0; i < bufferLength; i++) {
        const barHeight = (dataArray[i] / 255) * height * 0.9 + 2;

        const gradient = this.waveformCtx.createLinearGradient(0, height, 0, 0);
        if (this.isListening) {
          gradient.addColorStop(0, "#ef4444");
          gradient.addColorStop(1, "#f43f5e");
        } else {
          gradient.addColorStop(0, "#4b4f6e");
          gradient.addColorStop(1, "#646a88");
        }

        this.waveformCtx.fillStyle = gradient;
        this.waveformCtx.beginPath();
        this.waveformCtx.roundRect(x, height - barHeight, barWidth - 1, barHeight, [2, 2, 0, 0]);
        this.waveformCtx.fill();

        x += barWidth + 1;
      }
    };
    render();
  }

  drawMockWaveform() {
    if (!this.waveformCanvas || !this.waveformCtx) return;
    let step = 0;
    const render = () => {
      this.animationFrameId = requestAnimationFrame(render);
      const width = this.waveformCanvas.width;
      const height = this.waveformCanvas.height;
      this.waveformCtx.clearRect(0, 0, width, height);

      const bars = 16;
      const barWidth = width / bars;
      for (let i = 0; i < bars; i++) {
        let barHeight = 4;
        if (this.isListening) {
          barHeight = Math.sin(step + i * 0.5) * 8 + 10;
        }
        this.waveformCtx.fillStyle = this.isListening ? "#ef4444" : "#4b4f6e";
        this.waveformCtx.fillRect(i * barWidth, height - barHeight, barWidth - 2, barHeight);
      }
      step += 0.1;
    };
    render();
  }

  toggleListening() {
    if (this.isListening) {
      this.stopListening();
    } else {
      this.startListening();
    }
  }

  startListening() {
    if (!this.recognition) {
      this.initSpeechRecognition();
    }
    if (!this.recognition) {
      alert("Speech Recognition is not supported in this browser. Please use Chrome, Chromium, or Firefox with Web Speech API enabled.");
      return;
    }
    try {
      this.isListening = true;
      this.recognition.start();
      if (this.audioContext && this.audioContext.state === "suspended") {
        this.audioContext.resume();
      }
    } catch (e) {
      console.warn("Recognition already started or error:", e);
    }
  }

  stopListening() {
    this.isListening = false;
    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch (e) {}
    }
    if (this.onStatusChange) this.onStatusChange(false);
    this.playChime("stop");
  }

  /**
   * Natural Language Intent & Voice Command Parser
   */
  processFinalSpeech(rawText) {
    if (!rawText) return;
    const text = rawText.trim();
    const lower = text.toLowerCase();

    // Log voice event
    if (this.onSpeechLog) {
      this.onSpeechLog({
        time: new Date().toLocaleTimeString(),
        text: text,
      });
    }

    // 1. Voice Trigger: "chapter" or "new chapter" or "create chapter"
    const chapterMatch = text.match(/^(?:create\s+)?(?:new\s+)?chapter(?:\s*[:-]?\s*(.*))?$/i);
    if (chapterMatch) {
      const title = (chapterMatch[1] || "").trim();
      this.playChime("chapter");
      if (this.onCommand) this.onCommand("chapter", title);
      return;
    }

    // 2. Voice Trigger: "topic" or "new topic" or "create topic"
    const topicMatch = text.match(/^(?:create\s+)?(?:new\s+)?topic(?:\s*[:-]?\s*(.*))?$/i);
    if (topicMatch) {
      const title = (topicMatch[1] || "").trim();
      this.playChime("topic");
      if (this.onCommand) this.onCommand("topic", title);
      return;
    }

    // 3. Voice Trigger: "thought" or "new thought" or "create thought"
    const thoughtMatch = text.match(/^(?:create\s+)?(?:new\s+)?thought(?:\s*[:-]?\s*(.*))?$/i);
    if (thoughtMatch) {
      const content = (thoughtMatch[1] || "").trim();
      this.playChime("thought");
      if (this.onCommand) this.onCommand("thought", content);
      return;
    }

    // 4. Voice Trigger: "link to [note]" or "link [note]"
    const linkMatch = text.match(/^(?:create\s+)?link(?:\s+to)?\s+(.+)$/i);
    if (linkMatch) {
      const target = linkMatch[1].trim();
      this.playChime("link");
      if (this.onCommand) this.onCommand("link", target);
      return;
    }

    // 5. Voice Trigger: "tag [name]" or "add tag [name]"
    const tagMatch = text.match(/^(?:add\s+)?tag\s+([a-zA-Z0-9_\-]+)$/i);
    if (tagMatch) {
      const tag = tagMatch[1].trim();
      this.playChime("tag");
      if (this.onCommand) this.onCommand("tag", tag);
      return;
    }

    // 6. Voice Save & Discard Controls
    if (/^(?:save|save transcription|save to note|accept|insert|confirm)$/i.test(lower)) {
      this.playChime("start");
      if (this.onCommand) this.onCommand("save", text);
      return;
    }

    if (/^(?:discard|discard transcription|cancel|clear|clear transcription|delete transcription)$/i.test(lower)) {
      this.playChime("stop");
      if (this.onCommand) this.onCommand("discard", text);
      return;
    }

    // 7. Voice Control Commands: "stop recording" / "pause recording"
    if (lower === "stop recording" || lower === "pause recording" || lower === "stop transcription") {
      this.stopListening();
      return;
    }

    // 7. Text Formatting Enhancements
    let formatted = text;
    formatted = formatted.replace(/\bnew line\b/gi, "\n");
    formatted = formatted.replace(/\bnew paragraph\b/gi, "\n\n");
    formatted = formatted.replace(/\bcomma\b/gi, ",");
    formatted = formatted.replace(/\bperiod\b|\bfull stop\b/gi, ".");
    formatted = formatted.replace(/\bquestion mark\b/gi, "?");
    formatted = formatted.replace(/\bexclamation mark\b/gi, "!");
    formatted = formatted.replace(/\bbullet point\s*(.*)/gi, "- $1");

    // Capitalize first letter if needed
    if (formatted.length > 0) {
      formatted = formatted.charAt(0).toUpperCase() + formatted.slice(1);
    }

    if (this.onTranscription) {
      this.onTranscription(formatted, true);
    }
  }

  /**
   * Pleasing Harmonic Sound Feedback Synthesizer using Web Audio API
   */
  playChime(type) {
    if (!this.soundEffects) return;
    try {
      const ctx = this.audioContext || new (window.AudioContext || window.webkitAudioContext)();
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.connect(gain);
      gain.connect(ctx.destination);

      if (type === "chapter") {
        // Glorious Major Chord
        osc.type = "sine";
        osc.frequency.setValueAtTime(523.25, now); // C5
        osc.frequency.exponentialRampToValueAtTime(659.25, now + 0.15); // E5
        osc.frequency.exponentialRampToValueAtTime(783.99, now + 0.3); // G5
        gain.gain.setValueAtTime(0.15, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
        osc.start(now);
        osc.stop(now + 0.5);
      } else if (type === "topic") {
        // Emerald 2-tone Chime
        osc.type = "triangle";
        osc.frequency.setValueAtTime(440, now); // A4
        osc.frequency.exponentialRampToValueAtTime(587.33, now + 0.15); // D5
        gain.gain.setValueAtTime(0.12, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
        osc.start(now);
        osc.stop(now + 0.35);
      } else if (type === "thought") {
        // Amber Quick Ping
        osc.type = "sine";
        osc.frequency.setValueAtTime(659.25, now); // E5
        osc.frequency.exponentialRampToValueAtTime(880, now + 0.1); // A5
        gain.gain.setValueAtTime(0.12, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
        osc.start(now);
        osc.stop(now + 0.25);
      } else if (type === "start") {
        // Subtle soft blip
        osc.type = "sine";
        osc.frequency.setValueAtTime(330, now);
        osc.frequency.exponentialRampToValueAtTime(440, now + 0.08);
        gain.gain.setValueAtTime(0.08, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
        osc.start(now);
        osc.stop(now + 0.15);
      } else if (type === "stop") {
        osc.type = "sine";
        osc.frequency.setValueAtTime(440, now);
        osc.frequency.exponentialRampToValueAtTime(330, now + 0.08);
        gain.gain.setValueAtTime(0.08, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
        osc.start(now);
        osc.stop(now + 0.15);
      }
    } catch (e) {
      // Audio synthesis optional
    }
  }
}

window.voiceEngine = new VoiceEngine();
