/**
 * Memoir - Voice Recognition & Speech Intelligence Engine
 * Features hardware-independent Web Audio capture, real-time downsampling to 16kHz PCM,
 * direct streaming to local Vosk STT engine, and live audio visualizer.
 */

function downsampleTo16kPCM(inputData, inputSampleRate) {
  if (inputSampleRate === 16000) {
    const pcm16 = new Int16Array(inputData.length);
    for (let i = 0; i < inputData.length; i++) {
      let s = Math.max(-1, Math.min(1, inputData[i]));
      pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return pcm16;
  }

  const ratio = inputSampleRate / 16000;
  const newLength = Math.round(inputData.length / ratio);
  const pcm16 = new Int16Array(newLength);
  let offsetResult = 0;
  let offsetBuffer = 0;

  while (offsetResult < newLength) {
    const nextOffsetBuffer = Math.round((offsetResult + 1) * ratio);
    let accum = 0;
    let count = 0;
    for (let i = offsetBuffer; i < nextOffsetBuffer && i < inputData.length; i++) {
      accum += inputData[i];
      count++;
    }
    const avg = count > 0 ? accum / count : 0;
    const s = Math.max(-1, Math.min(1, avg));
    pcm16[offsetResult] = s < 0 ? s * 0x8000 : s * 0x7fff;
    offsetResult++;
    offsetBuffer = nextOffsetBuffer;
  }
  return pcm16;
}

class VoiceEngine {
  constructor() {
    this.isListening = false;
    this.audioContext = null;
    this.analyser = null;
    this.microphoneStream = null;
    this.scriptProcessor = null;
    this.sourceNode = null;

    this.waveformCanvas = null;
    this.waveformCtx = null;
    this.animationFrameId = null;

    this.sessionId = "session_" + Math.random().toString(36).substring(2, 9);
    this.language = localStorage.getItem("memoir_voice_lang") || "en-US";
    this.soundEffects = true;

    // Real-time audio stream buffer
    this.pcmBufferQueue = [];
    this.streamInterval = null;

    // Callbacks
    this.onCommand = null;        // (type: string, payload: string)
    this.onTranscription = null;  // (text: string, isFinal: boolean)
    this.onStatusChange = null;   // (isListening: boolean)
    this.onSpeechLog = null;       // (entry: { time: string, text: string, type: string })
    this.onAudioLevel = null;      // (level: number 0-100)
  }

  async toggleListening() {
    if (this.isListening) {
      await this.stopListening();
    } else {
      await this.startListening();
    }
  }

  async startListening() {
    try {
      this.isListening = true;
      this.sessionId = "session_" + Math.random().toString(36).substring(2, 9);

      // Check mediaDevices support
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error("Microphone API requires a secure context. Please access Memoir via http://localhost:5432 or http://127.0.0.1:5432");
      }

      // 1. Request microphone stream
      this.microphoneStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      // 2. Initialize AudioContext at native hardware rate
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) {
        throw new Error("Web Audio API is not supported in this browser");
      }

      this.audioContext = new AudioCtx();
      if (this.audioContext.state === "suspended") {
        await this.audioContext.resume();
      }

      const hardwareSampleRate = this.audioContext.sampleRate || 48000;
      console.log(`[Memoir Voice] Microphone active at ${hardwareSampleRate} Hz (streaming to Vosk 16kHz STT)`);

      this.sourceNode = this.audioContext.createMediaStreamSource(this.microphoneStream);

      // 3. Setup Analyser for visual waveform
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 64;
      this.sourceNode.connect(this.analyser);

      // 4. Setup PCM Audio Processor (downsamples to 16kHz PCM Int16)
      const bufferSize = 4096;
      this.scriptProcessor = this.audioContext.createScriptProcessor(bufferSize, 1, 1);
      this.sourceNode.connect(this.scriptProcessor);
      this.scriptProcessor.connect(this.audioContext.destination);

      this.pcmBufferQueue = [];
      this.scriptProcessor.onaudioprocess = (e) => {
        if (!this.isListening) return;
        const inputData = e.inputBuffer.getChannelData(0);

        // Volume level calculation
        let sumSquares = 0;
        for (let i = 0; i < inputData.length; i++) {
          sumSquares += inputData[i] * inputData[i];
        }
        const rms = Math.sqrt(sumSquares / inputData.length);
        const level = Math.min(100, Math.round(rms * 350));
        if (this.onAudioLevel) this.onAudioLevel(level);

        // Downsample Float32 to 16-bit PCM Int16
        const pcm16 = downsampleTo16kPCM(inputData, hardwareSampleRate);
        this.pcmBufferQueue.push(pcm16.buffer);
      };

      // 5. Start real-time PCM sender loop to server
      this.startPcmSenderLoop();

      // 6. Draw waveform
      this.drawWaveform();

      if (this.onStatusChange) this.onStatusChange(true);
      this.playChime("start");

    } catch (err) {
      console.error("[Memoir Voice] Failed to start microphone:", err);
      this.isListening = false;
      if (this.onStatusChange) this.onStatusChange(false);
      alert("Microphone Error: " + err.message);
    }
  }

  startPcmSenderLoop() {
    if (this.streamInterval) clearInterval(this.streamInterval);

    let isSending = false;
    let isFirst = true;

    this.streamInterval = setInterval(async () => {
      if (!this.isListening || isSending || this.pcmBufferQueue.length === 0) return;

      isSending = true;
      const chunks = this.pcmBufferQueue.splice(0, this.pcmBufferQueue.length);

      // Merge chunks
      const totalLength = chunks.reduce((acc, c) => acc + c.byteLength, 0);
      const merged = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        merged.set(new Uint8Array(chunk), offset);
        offset += chunk.byteLength;
      }

      try {
        const res = await fetch("/api/stream_stt", {
          method: "POST",
          headers: {
            "Content-Type": "application/octet-stream",
            "X-Session-ID": this.sessionId,
            "X-Reset": isFirst ? "true" : "false",
          },
          body: merged,
        });

        isFirst = false;

        if (res.ok) {
          const data = await res.json();
          if (data.final && data.text && data.text.trim()) {
            this.processFinalSpeech(data.text.trim());
          } else if (!data.final && data.text && data.text.trim()) {
            if (this.onTranscription) {
              this.onTranscription(data.text.trim(), false);
            }
          }
        }
      } catch (e) {
        console.warn("[Memoir Voice] Stream fetch error:", e);
      } finally {
        isSending = false;
      }
    }, 180);
  }

  async stopListening() {
    this.isListening = false;

    if (this.streamInterval) {
      clearInterval(this.streamInterval);
      this.streamInterval = null;
    }

    if (this.scriptProcessor) {
      try {
        this.scriptProcessor.disconnect();
        this.scriptProcessor = null;
      } catch (e) {}
    }

    if (this.sourceNode) {
      try {
        this.sourceNode.disconnect();
        this.sourceNode = null;
      } catch (e) {}
    }

    if (this.microphoneStream) {
      this.microphoneStream.getTracks().forEach((t) => t.stop());
      this.microphoneStream = null;
    }

    // Flush any remaining recognizer text from server
    try {
      const res = await fetch("/api/reset_stt", {
        method: "POST",
        headers: { "X-Session-ID": this.sessionId },
      });
      if (res.ok) {
        const data = await res.json();
        if (data.text && data.text.trim()) {
          this.processFinalSpeech(data.text.trim());
        }
      }
    } catch (e) {}

    if (this.onStatusChange) this.onStatusChange(false);
    this.playChime("stop");
  }

  startAudioVisualizer(canvasElement) {
    this.waveformCanvas = canvasElement;
    if (!this.waveformCanvas) return;
    this.waveformCtx = this.waveformCanvas.getContext("2d");
    this.drawWaveform();
  }

  drawWaveform() {
    if (!this.waveformCanvas || !this.waveformCtx) return;

    const render = () => {
      this.animationFrameId = requestAnimationFrame(render);
      const width = this.waveformCanvas.width;
      const height = this.waveformCanvas.height;
      this.waveformCtx.clearRect(0, 0, width, height);

      if (this.isListening && this.analyser) {
        const bufferLength = this.analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        this.analyser.getByteFrequencyData(dataArray);

        const barWidth = (width / bufferLength) * 1.8;
        let x = 0;

        for (let i = 0; i < bufferLength; i++) {
          const barHeight = (dataArray[i] / 255) * height * 0.9 + 2;
          const gradient = this.waveformCtx.createLinearGradient(0, height, 0, 0);
          gradient.addColorStop(0, "#ef4444");
          gradient.addColorStop(1, "#f43f5e");

          this.waveformCtx.fillStyle = gradient;
          this.waveformCtx.beginPath();
          this.waveformCtx.roundRect(x, height - barHeight, barWidth - 1, barHeight, [2, 2, 0, 0]);
          this.waveformCtx.fill();

          x += barWidth + 1;
        }
      } else {
        // Idle subtle waveform
        const bars = 14;
        const barWidth = width / bars;
        for (let i = 0; i < bars; i++) {
          this.waveformCtx.fillStyle = "#3b4055";
          this.waveformCtx.fillRect(i * barWidth, height - 3, barWidth - 2, 3);
        }
      }
    };
    render();
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

    // 8. Text Formatting Enhancements
    let formatted = text;
    formatted = formatted.replace(/\bnew line\b/gi, "\n");
    formatted = formatted.replace(/\bnew paragraph\b/gi, "\n\n");
    formatted = formatted.replace(/\bcomma\b/gi, ",");
    formatted = formatted.replace(/\bperiod\b|\bfull stop\b/gi, ".");
    formatted = formatted.replace(/\bquestion mark\b/gi, "?");
    formatted = formatted.replace(/\bexclamation mark\b/gi, "!");
    formatted = formatted.replace(/\bbullet point\s*(.*)/gi, "- $1");

    // Capitalize first letter
    if (formatted.length > 0) {
      formatted = formatted.charAt(0).toUpperCase() + formatted.slice(1);
    }

    if (this.onTranscription) {
      this.onTranscription(formatted, true);
    }
  }

  /**
   * Harmonic Sound Feedback Synthesizer
   */
  playChime(type) {
    if (!this.soundEffects) return;
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const ctx = this.audioContext || new AudioCtx();
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.connect(gain);
      gain.connect(ctx.destination);

      if (type === "chapter") {
        osc.type = "sine";
        osc.frequency.setValueAtTime(523.25, now);
        osc.frequency.exponentialRampToValueAtTime(659.25, now + 0.15);
        osc.frequency.exponentialRampToValueAtTime(783.99, now + 0.3);
        gain.gain.setValueAtTime(0.15, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
        osc.start(now);
        osc.stop(now + 0.5);
      } else if (type === "topic") {
        osc.type = "triangle";
        osc.frequency.setValueAtTime(440, now);
        osc.frequency.exponentialRampToValueAtTime(587.33, now + 0.15);
        gain.gain.setValueAtTime(0.12, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
        osc.start(now);
        osc.stop(now + 0.35);
      } else if (type === "thought") {
        osc.type = "sine";
        osc.frequency.setValueAtTime(659.25, now);
        osc.frequency.exponentialRampToValueAtTime(880, now + 0.1);
        gain.gain.setValueAtTime(0.12, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
        osc.start(now);
        osc.stop(now + 0.25);
      } else if (type === "start") {
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
    } catch (e) {}
  }
}

window.voiceEngine = new VoiceEngine();
