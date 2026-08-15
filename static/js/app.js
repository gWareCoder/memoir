/**
 * Memoir - Main Application Controller
 * Coordinates voice recognition, knowledge graph, markdown editor, and vault state.
 */

class MemoirApp {
  constructor() {
    this.vaultData = { notes: [], graph: { nodes: [], edges: [] }, stats: {} };
    this.activeNote = null;
    this.activeChapter = null; // Active chapter context for topic creation
    this.activeTopic = null;   // Active topic context for thought creation
    this.currentView = "graph"; // 'graph' | 'editor' | 'split'

    // Submodules
    this.graph = null;
    this.editor = null;
    this.linkEngine = null;
    this.voice = window.voiceEngine;
    this.storage = window.storageService;

    this.transcriptionBuffer = "";
    this.isReviewMode = localStorage.getItem("memoir_review_mode") !== "false"; // default true

    this.speechHistory = [];
  }

  async init() {
    console.log("[Memoir] Initializing application...");

    // 1. Setup UI Event Listeners & Shortcuts first so all buttons are active immediately
    try {
      this.setupUIEvents();
      this.setupKeyboardShortcuts();
    } catch (e) {
      console.error("[Memoir] Error during setupUIEvents:", e);
    }

    // 2. Initialize Submodules
    try {
      this.graph = new MemoirGraph("graph-canvas", "graph-tooltip");
      this.editor = new MemoirEditor("note-textarea", "note-preview", "note-title-input");
      this.linkEngine = new LinkEngine();

      this.graph.onNodeClick = (node) => {
        this.openNoteById(node.id);
        if (this.currentView === "graph") {
          this.switchView("editor");
        }
      };

      this.editor.onNoteSaved = (savedNote) => {
        this.refreshVaultData(false);
        this.showToast(`Saved ${savedNote.title}`, "info");
      };

      this.editor.onWikilinkClicked = (targetTitle) => {
        this.openNoteById(targetTitle);
      };

      this.editor.onTitleRenamed = async (oldPath, newTitle) => {
        const res = await this.storage.renameNote(oldPath, newTitle);
        if (res && res.success) {
          this.showToast(`Renamed to "${newTitle}"`, "info");
          await this.refreshVaultData(true);
          this.openNoteById(res.newId);
        }
      };
    } catch (e) {
      console.error("[Memoir] Error initializing submodules:", e);
    }

    // 3. Attach Voice Engine Callbacks
    try {
      if (!this.voice && window.voiceEngine) {
        this.voice = window.voiceEngine;
      }
      this.setupVoiceInteractions();
    } catch (e) {
      console.error("[Memoir] Error during setupVoiceInteractions:", e);
    }

    // 4. Load Initial Vault Data
    try {
      await this.refreshVaultData(true);

      if (this.vaultData.notes && this.vaultData.notes.length > 0) {
        const chapter = this.vaultData.notes.find((n) => n.type === "chapter") || this.vaultData.notes[0];
        this.openNote(chapter);
      }

      const status = await this.storage.getStatus();
      const statusEl = document.getElementById("server-status-pill");
      if (statusEl) {
        statusEl.textContent = status.status === "online" ? "Vault Connected" : "Local Mode";
      }
    } catch (e) {
      console.error("[Memoir] Error loading vault data:", e);
    }

    // 5. Default to Split View
    this.switchView("split");
  }

  setupVoiceInteractions() {
    const micToggleBtn = document.getElementById("mic-toggle-btn");
    const voicePill = document.getElementById("voice-capture-pill");
    const voiceStatusText = document.getElementById("voice-status-text");
    const transcriptPreview = document.getElementById("voice-transcript-preview");
    const waveformCanvas = document.getElementById("waveform-canvas");
    const reviewDock = document.getElementById("transcription-review-dock");
    const bufferInput = document.getElementById("transcription-buffer-input");
    const liveInterimText = document.getElementById("live-interim-text");
    const wordBadge = document.getElementById("review-word-badge");
    const reviewModeToggle = document.getElementById("review-mode-toggle");
    const liveCue = document.getElementById("voice-live-cue");

    // Initialize Review Mode toggle
    if (reviewModeToggle) {
      reviewModeToggle.checked = this.isReviewMode;
      reviewModeToggle.addEventListener("change", (e) => {
        this.isReviewMode = e.target.checked;
        localStorage.setItem("memoir_review_mode", this.isReviewMode);
        this.showToast(this.isReviewMode ? "Review Mode enabled (Confirm before saving)" : "Stream Mode enabled (Instant auto-append)", "info");
      });
    }

    // Init Audio visualizer
    if (waveformCanvas) {
      this.voice.startAudioVisualizer(waveformCanvas);
    }

    if (micToggleBtn) {
      micToggleBtn.addEventListener("click", () => {
        this.voice.toggleListening();
      });
    }

    this.voice.onStatusChange = (isListening) => {
      if (voicePill) {
        voicePill.classList.toggle("recording", isListening);
      }
      if (reviewDock) {
        reviewDock.classList.toggle("recording-active", isListening);
      }
      if (voiceStatusText) {
        voiceStatusText.textContent = isListening ? "Listening..." : "Mic Idle";
      }
      if (liveInterimText) {
        if (isListening) {
          liveInterimText.textContent = "Listening... Speak now";
          liveInterimText.classList.add("active");
        } else {
          liveInterimText.textContent = "Click mic or press Ctrl+M to speak";
          liveInterimText.classList.remove("active");
        }
      }
      if (transcriptPreview && !isListening) {
        transcriptPreview.textContent = this.transcriptionBuffer
          ? `Buffer: "${this.transcriptionBuffer.slice(0, 35)}..."`
          : 'Say "Chapter", "Topic", or "Thought" to dictate...';
      }

      if (!isListening) {
        setTimeout(() => {
          this.processBufferIntentOnMicStop();
        }, 120);
      }
    };

    this.voice.onTranscription = (text, isFinal) => {
      if (transcriptPreview) {
        transcriptPreview.textContent = text;
      }
      if (liveInterimText) {
        liveInterimText.textContent = text;
        liveInterimText.classList.toggle("active", !isFinal);
      }
      if (liveCue) {
        liveCue.style.display = "none";
      }

      if (isFinal) {
        if (this.isReviewMode) {
          // Accumulate in buffer for user review
          if (this.transcriptionBuffer) {
            this.transcriptionBuffer += " " + text;
          } else {
            this.transcriptionBuffer = text;
          }
          if (bufferInput) {
            bufferInput.value = this.transcriptionBuffer;
            bufferInput.scrollTop = bufferInput.scrollHeight;
          }
          this.updateBufferStats();
        } else {
          // Instant Stream Mode
          if (this.activeNote) {
            this.editor.appendSpeechText(text);
          }
          if (bufferInput) {
            bufferInput.value = text;
          }
          this.updateBufferStats();
        }
      } else {
        // Show interim live words directly in the review dock
        if (bufferInput && !this.transcriptionBuffer) {
          bufferInput.value = text;
        }
      }
    };

    // User manual edits in the review dock textarea
    if (bufferInput) {
      bufferInput.addEventListener("input", (e) => {
        this.transcriptionBuffer = e.target.value;
        this.updateBufferStats();
      });

      bufferInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey || !e.shiftKey)) {
          e.preventDefault();
          this.saveTranscriptionToNote();
        } else if (e.key === "Escape") {
          e.preventDefault();
          this.discardTranscription();
        }
      });
    }

    // Save to Note Button
    document.getElementById("btn-save-transcript-note")?.addEventListener("click", () => {
      this.saveTranscriptionToNote();
    });

    // Append to Chapter Button
    document.getElementById("btn-append-transcript-chapter")?.addEventListener("click", () => {
      const text = this.getBufferText();
      if (!text) {
        this.showToast("Transcription buffer is empty", "info");
        return;
      }
      this.handleVoiceAppend("chapter", text);
    });

    // Append to Topic Button
    document.getElementById("btn-append-transcript-topic")?.addEventListener("click", () => {
      const text = this.getBufferText();
      if (!text) {
        this.showToast("Transcription buffer is empty", "info");
        return;
      }
      this.handleVoiceAppend("topic", text);
    });

    // Save as Thought Button
    document.getElementById("btn-save-transcript-thought")?.addEventListener("click", () => {
      const text = this.getBufferText();
      if (!text) {
        this.showToast("Transcription buffer is empty", "info");
        return;
      }
      this.handleVoiceCreateThought(text);
      this.clearBuffer();
    });

    // Save as Topic Button
    document.getElementById("btn-save-transcript-topic")?.addEventListener("click", () => {
      const text = this.getBufferText();
      if (!text) {
        this.showToast("Transcription buffer is empty", "info");
        return;
      }
      this.handleVoiceCreateTopic(text);
      this.clearBuffer();
    });

    // Save as Chapter Button
    document.getElementById("btn-save-transcript-chapter")?.addEventListener("click", () => {
      const text = this.getBufferText();
      if (!text) {
        this.showToast("Transcription buffer is empty", "info");
        return;
      }
      this.handleVoiceCreateChapter(text);
      this.clearBuffer();
    });

    // Discard Button
    document.getElementById("btn-discard-transcript")?.addEventListener("click", () => {
      this.discardTranscription();
    });

    // Process Voice Commands ("chapter", "topic", "thought", "link", "tag", "save", "discard")
    this.voice.onCommand = async (type, payload) => {
      if (liveCue) {
        liveCue.style.display = "inline-block";
        liveCue.textContent = `Command: ${type.toUpperCase()}`;
      }

      if (type === "save") {
        this.saveTranscriptionToNote();
      } else if (type === "discard") {
        this.discardTranscription();
      } else if (type === "append_chapter") {
        await this.handleVoiceAppend("chapter", payload);
      } else if (type === "append_topic") {
        await this.handleVoiceAppend("topic", payload);
      } else if (type === "append_thought") {
        await this.handleVoiceAppend("thought", payload);
      } else if (type === "append_note") {
        await this.handleVoiceAppend("active", payload);
      } else if (type === "chapter") {
        await this.handleVoiceCreateChapter(payload || this.getBufferText());
        this.clearBuffer();
      } else if (type === "topic") {
        await this.handleVoiceCreateTopic(payload || this.getBufferText());
        this.clearBuffer();
      } else if (type === "thought") {
        await this.handleVoiceCreateThought(payload || this.getBufferText());
        this.clearBuffer();
      } else if (type === "link") {
        if (this.activeNote) {
          this.editor.appendSpeechText(` [[${payload}]]`);
          this.showToast(`Linked [[${payload}]]`, "info");
        }
      } else if (type === "tag") {
        if (this.activeNote) {
          this.editor.appendSpeechText(` #${payload}`);
          this.showToast(`Added #${payload}`, "info");
        }
      }
    };

    // Log speech in history
    this.voice.onSpeechLog = (entry) => {
      this.speechHistory.unshift(entry);
      if (this.speechHistory.length > 25) this.speechHistory.pop();
      this.renderSpeechLog();
    };
  }

  processBufferIntentOnMicStop() {
    const bufferText = this.getBufferText();
    if (!bufferText) return;

    // Check for "append to chapter ..."
    const appendChapMatch = bufferText.match(/^(?:please\s+)?(?:append|add)(?:\s+this)?(?:\s+to)?(?:\s+(?:the|my))?\s+chapter(?:\s*[:-]?\s*(.*))?$/is);
    if (appendChapMatch) {
      this.handleVoiceAppend("chapter", appendChapMatch[1] || "");
      return;
    }

    // Check for "append to topic ..."
    const appendTopicMatch = bufferText.match(/^(?:please\s+)?(?:append|add)(?:\s+this)?(?:\s+to)?(?:\s+(?:the|my))?\s+topic(?:\s*[:-]?\s*(.*))?$/is);
    if (appendTopicMatch) {
      this.handleVoiceAppend("topic", appendTopicMatch[1] || "");
      return;
    }

    // Check for "append to thought ..."
    const appendThoughtMatch = bufferText.match(/^(?:please\s+)?(?:append|add)(?:\s+this)?(?:\s+to)?(?:\s+(?:the|my))?\s+thought(?:\s*[:-]?\s*(.*))?$/is);
    if (appendThoughtMatch) {
      this.handleVoiceAppend("thought", appendThoughtMatch[1] || "");
      return;
    }

    // Check for "append to note ..."
    const appendNoteMatch = bufferText.match(/^(?:please\s+)?(?:append|add)(?:\s+this)?(?:\s+to)?(?:\s+(?:the|my|active|current))?\s+note(?:\s*[:-]?\s*(.*))?$/is);
    if (appendNoteMatch) {
      this.handleVoiceAppend("active", appendNoteMatch[1] || "");
      return;
    }

    // Check for "chapter ..."
    const chapMatch = bufferText.match(/^(?:create\s+)?(?:new\s+)?chapter(?:\s*[:-]?\s*(.*))?$/is);
    if (chapMatch) {
      this.handleVoiceCreateChapter(chapMatch[1] || "");
      this.clearBuffer();
      return;
    }

    // Check for "topic ..."
    const topMatch = bufferText.match(/^(?:create\s+)?(?:new\s+)?topic(?:\s*[:-]?\s*(.*))?$/is);
    if (topMatch) {
      this.handleVoiceCreateTopic(topMatch[1] || "");
      this.clearBuffer();
      return;
    }

    // Check for "thought ..."
    const thMatch = bufferText.match(/^(?:create\s+)?(?:new\s+)?thought(?:\s*[:-]?\s*(.*))?$/is);
    if (thMatch) {
      this.handleVoiceCreateThought(thMatch[1] || "");
      this.clearBuffer();
      return;
    }

    // Check for save/discard
    if (/^(?:save|save transcription|save to note|accept|insert|confirm)$/i.test(bufferText.trim())) {
      this.saveTranscriptionToNote();
      return;
    }
    if (/^(?:discard|discard transcription|cancel|clear)$/i.test(bufferText.trim())) {
      this.discardTranscription();
      return;
    }
  }

  getBufferText() {
    const bufferInput = document.getElementById("transcription-buffer-input");
    return bufferInput ? bufferInput.value.trim() : (this.transcriptionBuffer || "").trim();
  }

  clearBuffer() {
    this.transcriptionBuffer = "";
    const bufferInput = document.getElementById("transcription-buffer-input");
    if (bufferInput) {
      bufferInput.value = "";
      bufferInput.placeholder = "Spoken words will appear here. Edit or click Save / Discard...";
    }
    this.updateBufferStats();
  }

  updateBufferStats() {
    const text = this.getBufferText();
    const wordBadge = document.getElementById("review-word-badge");
    const words = text ? (text.match(/\b\w+\b/g) || []).length : 0;
    if (wordBadge) {
      wordBadge.textContent = `${words} word${words === 1 ? "" : "s"}`;
    }
  }

  saveTranscriptionToNote() {
    const text = this.getBufferText();
    if (!text) {
      this.showToast("Transcription buffer is empty. Speak to dictate first.", "info");
      return;
    }

    if (this.activeNote) {
      this.editor.appendSpeechText(text, true);
      this.editor.saveCurrentNote();
      this.showToast(`Saved to ${this.activeNote.title}`, "info");
      this.clearBuffer();
    } else {
      // If no active note is open, append to active chapter or create a new Thought
      if (this.activeChapter) {
        this.handleVoiceAppend("chapter", text);
      } else {
        this.handleVoiceCreateThought(text);
        this.clearBuffer();
      }
    }
  }

  discardTranscription() {
    const text = this.getBufferText();
    if (!text) {
      this.clearBuffer();
      return;
    }
    this.clearBuffer();
    this.showToast("Transcription discarded", "info");
  }

  async handleVoiceAppend(targetType, payload) {
    const rawText = (payload || this.getBufferText() || "").trim();
    if (!rawText) {
      this.showToast(`No content specified to append to ${targetType}. Speak your text first.`, "info");
      return;
    }

    const converted = window.convertSpokenNumbersToDigits ? window.convertSpokenNumbersToDigits(rawText).trim() : rawText;
    const notes = this.vaultData?.notes || [];

    let targetNote = null;
    let textToAppend = converted;

    // 1. Try to extract specific chapter/topic number or title from converted string
    // e.g. "1 then a bunch of text..." or "1: a bunch of text" or "The Quantum Mind: a bunch of text"
    if (targetType === "chapter") {
      const numMatch = converted.match(/^(\d+)(?:\s*[:-]?\s*|\s+(?:then|that|where|is|and)\s+|\s+)(.*)$/is);
      if (numMatch) {
        const num = numMatch[1];
        textToAppend = (numMatch[2] || "").trim();
        targetNote = notes.find(
          (n) => n.type === "chapter" && (
            n.title.toLowerCase() === `chapter ${num}`.toLowerCase() ||
            n.title.toLowerCase() === `chapter - ${num}`.toLowerCase() ||
            n.title.toLowerCase().startsWith(`chapter ${num} `) ||
            n.title.toLowerCase().startsWith(`chapter ${num} -`) ||
            n.title.toLowerCase().startsWith(`chapter - ${num} `) ||
            n.id.toLowerCase() === `chapter ${num}`.toLowerCase() ||
            n.filename.toLowerCase() === `chapter ${num}.md`.toLowerCase() ||
            n.filename.toLowerCase() === `chapter - ${num}.md`.toLowerCase()
          )
        );
      } else if (converted.match(/^(\d+)$/)) {
        // Just the number was spoken (e.g. user had text in buffer and said "append to chapter 1")
        const num = converted.match(/^(\d+)$/)[1];
        textToAppend = this.getBufferText() !== converted ? this.getBufferText() : "";
        targetNote = notes.find((n) => n.type === "chapter" && (n.title.toLowerCase() === `chapter ${num}`.toLowerCase() || n.title.toLowerCase() === `chapter - ${num}`.toLowerCase()));
      }
    } else if (targetType === "topic") {
      const numMatch = converted.match(/^(\d+)(?:\s*[:-]?\s*|\s+(?:then|that|where|is|and)\s+|\s+)(.*)$/is);
      if (numMatch) {
        const num = numMatch[1];
        textToAppend = (numMatch[2] || "").trim();
        targetNote = notes.find((n) => n.type === "topic" && (n.title.toLowerCase() === `topic ${num}`.toLowerCase() || n.title.toLowerCase() === `topic - ${num}`.toLowerCase()));
      }
    } else if (targetType === "thought") {
      const numMatch = converted.match(/^(\d+)(?:\s*[:-]?\s*|\s+(?:then|that|where|is|and)\s+|\s+)(.*)$/is);
      if (numMatch) {
        const num = numMatch[1];
        textToAppend = (numMatch[2] || "").trim();
        targetNote = notes.find((n) => n.type === "thought" && (n.title.toLowerCase() === `thought ${num}`.toLowerCase() || n.title.toLowerCase() === `thought - ${num}`.toLowerCase()));
      }
    }

    // 2. If targetNote was not resolved by number, fallback to active or latest note of that category
    if (!targetNote) {
      if (targetType === "chapter") {
        if (this.activeNote && this.activeNote.type === "chapter") {
          targetNote = this.activeNote;
        } else if (this.activeChapter) {
          targetNote = notes.find((n) => n.type === "chapter" && (n.title.toLowerCase() === this.activeChapter.toLowerCase() || n.id.toLowerCase() === this.activeChapter.toLowerCase()));
        }
        if (!targetNote) {
          targetNote = notes.filter((n) => n.type === "chapter")[0];
        }
      } else if (targetType === "topic") {
        if (this.activeNote && this.activeNote.type === "topic") {
          targetNote = this.activeNote;
        } else if (this.activeTopic) {
          targetNote = notes.find((n) => n.type === "topic" && (n.title.toLowerCase() === this.activeTopic.toLowerCase() || n.id.toLowerCase() === this.activeTopic.toLowerCase()));
        }
        if (!targetNote) {
          targetNote = notes.filter((n) => n.type === "topic")[0];
        }
      } else if (targetType === "thought") {
        if (this.activeNote && this.activeNote.type === "thought") {
          targetNote = this.activeNote;
        } else {
          targetNote = notes.filter((n) => n.type === "thought")[0];
        }
      } else {
        targetNote = this.activeNote;
      }
    }

    // If textToAppend is empty, use the full transcription buffer
    if (!textToAppend) {
      textToAppend = this.getBufferText();
    }

    // Clean up any remaining leading "then ", "that ", "is "
    textToAppend = textToAppend.replace(/^(?:then|that|is)\s+/i, "").trim();

    if (!textToAppend) {
      this.showToast(`No content found to append to ${targetType}.`, "info");
      return;
    }

    // 3. If no note exists yet for this category, auto-create one!
    if (!targetNote) {
      if (targetType === "chapter") {
        await this.handleVoiceCreateChapter(textToAppend);
      } else if (targetType === "topic") {
        await this.handleVoiceCreateTopic(textToAppend);
      } else if (targetType === "thought") {
        await this.handleVoiceCreateThought(textToAppend);
      }
      this.clearBuffer();
      return;
    }

    // 4. Open note in editor if not already active
    if (!this.activeNote || this.activeNote.id !== targetNote.id) {
      await this.openNote(targetNote);
    }

    // 5. Append text to editor as a clean paragraph and auto-save
    this.editor.appendSpeechText(textToAppend, true);
    await this.editor.saveCurrentNote();
    this.clearBuffer();
    this.showToast(`📥 Appended to ${targetNote.title}`, targetNote.type);
  }

  async handleVoiceCreateChapter(title) {
    const raw = (title || "").trim();
    const converted = window.convertSpokenNumbersToDigits ? window.convertSpokenNumbersToDigits(raw).trim() : raw;
    const defaultNum = this.vaultData?.stats?.chapters + 1 || 1;

    let cleanTitle = "";
    if (!converted) {
      cleanTitle = `Chapter ${defaultNum}`;
    } else if (/^chapter\b/i.test(converted)) {
      const rest = converted.replace(/^chapter\s*[:-]?\s*/i, "").trim();
      if (/^\d+\b/.test(rest)) {
        const match = rest.match(/^(\d+)(?:\s*[:-]?\s*(.*))?$/);
        const num = match[1];
        const sub = (match[2] || "").trim();
        cleanTitle = sub ? `Chapter ${num} - ${sub}` : `Chapter ${num}`;
      } else {
        cleanTitle = rest ? `Chapter - ${rest}` : `Chapter ${defaultNum}`;
      }
    } else if (/^\d+\b/.test(converted)) {
      const match = converted.match(/^(\d+)(?:\s*[:-]?\s*(.*))?$/);
      const num = match[1];
      const sub = (match[2] || "").trim();
      cleanTitle = sub ? `Chapter ${num} - ${sub}` : `Chapter ${num}`;
    } else {
      cleanTitle = `Chapter - ${converted}`;
    }

    const res = await this.storage.saveNote({
      type: "chapter",
      title: cleanTitle,
      body: `# ${cleanTitle}\n\n`,
    });

    if (res && res.success) {
      this.showToast(`📖 New Chapter Created: "${cleanTitle}"`, "chapter");
      await this.refreshVaultData(false);
      this.openNoteById(res.id);
      this.activeChapter = cleanTitle;
    }
  }

  async handleVoiceCreateTopic(title) {
    const raw = (title || "").trim();
    const converted = window.convertSpokenNumbersToDigits ? window.convertSpokenNumbersToDigits(raw).trim() : raw;
    const defaultNum = this.vaultData?.stats?.topics + 1 || 1;

    let cleanTitle = "";
    if (!converted) {
      cleanTitle = `Topic ${defaultNum}`;
    } else if (/^topic\b/i.test(converted)) {
      const rest = converted.replace(/^topic\s*[:-]?\s*/i, "").trim();
      if (/^\d+\b/.test(rest)) {
        const match = rest.match(/^(\d+)(?:\s*[:-]?\s*(.*))?$/);
        const num = match[1];
        const sub = (match[2] || "").trim();
        cleanTitle = sub ? `Topic ${num} - ${sub}` : `Topic ${num}`;
      } else {
        cleanTitle = rest ? `Topic - ${rest}` : `Topic ${defaultNum}`;
      }
    } else if (/^\d+\b/.test(converted)) {
      const match = converted.match(/^(\d+)(?:\s*[:-]?\s*(.*))?$/);
      const num = match[1];
      const sub = (match[2] || "").trim();
      cleanTitle = sub ? `Topic ${num} - ${sub}` : `Topic ${num}`;
    } else {
      cleanTitle = `Topic - ${converted}`;
    }

    // Link to active chapter context
    let chapterLink = this.activeChapter;
    if (!chapterLink && this.activeNote) {
      if (this.activeNote.type === "chapter") {
        chapterLink = this.activeNote.title;
      } else if (this.activeNote.frontmatter && this.activeNote.frontmatter.chapter) {
        chapterLink = this.activeNote.frontmatter.chapter.replace(/\[\[|\]\]/g, "");
      }
    }

    const bodyContent = chapterLink
      ? `# ${cleanTitle}\n\nPart of [[${chapterLink}]].\n\n`
      : `# ${cleanTitle}\n\n`;

    const res = await this.storage.saveNote({
      type: "topic",
      title: cleanTitle,
      chapter: chapterLink,
      body: bodyContent,
    });

    if (res && res.success) {
      this.showToast(`🌿 New Topic Created: "${cleanTitle}"`, "topic");
      await this.refreshVaultData(false);
      this.openNoteById(res.id);
      this.activeTopic = cleanTitle;
    }
  }

  async handleVoiceCreateThought(textOrTitle) {
    const raw = (textOrTitle || "").trim();
    const converted = window.convertSpokenNumbersToDigits ? window.convertSpokenNumbersToDigits(raw).trim() : raw;
    let title = "";
    let body = "";

    if (!converted) {
      title = `Thought ${this.vaultData?.stats?.thoughts + 1 || 1}`;
      body = `# ${title}\n\n`;
    } else if (/^thought\b/i.test(converted)) {
      const rest = converted.replace(/^thought\s*[:-]?\s*/i, "").trim();
      if (/^\d+\b/.test(rest)) {
        title = `Thought ${rest}`;
      } else {
        title = rest ? `Thought - ${rest}` : `Thought ${this.vaultData?.stats?.thoughts + 1 || 1}`;
      }
      body = `# ${title}\n\n`;
    } else if (converted.length > 50) {
      const words = converted.split(" ");
      title = `Thought - ${words.slice(0, 5).join(" ")}...`;
      body = `# ${title}\n\n${converted}\n\n`;
    } else {
      title = `Thought - ${converted}`;
      body = `# ${title}\n\n${converted}\n\n`;
    }

    // Link to active topic / chapter
    const currentTopic = this.activeTopic || (this.activeNote && this.activeNote.type === "topic" ? this.activeNote.title : null);
    const currentChapter = this.activeChapter || (this.activeNote && this.activeNote.type === "chapter" ? this.activeNote.title : null);

    // Find related thoughts automatically
    const related = await this.storage.findRelatedThoughts(textOrTitle || title);
    const relatedTitles = related.slice(0, 3).map((r) => r.title);

    const res = await this.storage.saveNote({
      type: "thought",
      title: title,
      topic: currentTopic,
      chapter: currentChapter,
      relatedThoughts: relatedTitles,
      body: body,
    });

    if (res && res.success) {
      const relMsg = relatedTitles.length > 0 ? ` (Auto-linked ${relatedTitles.length} related thoughts)` : "";
      this.showToast(`💡 New Thought: "${title}"${relMsg}`, "thought");
      await this.refreshVaultData(false);
      this.openNoteById(res.id);
    }
  }

  async refreshVaultData(reloadGraph = true) {
    const data = await this.storage.fetchVault();
    this.vaultData = data;

    // Update Explorer Tree & Stats
    this.renderFileTree();
    this.renderStats();

    // Update Editor note list for wikilink autocomplete
    this.editor.setVaultNotes(data.notes);

    // Update Graph Simulation
    if (reloadGraph && this.graph) {
      this.graph.setData(data.graph, this.activeNote ? this.activeNote.id : null);
    }

    // Update Link Engine
    this.linkEngine.init(data);
    if (this.activeNote) {
      const updated = data.notes.find((n) => n.id === this.activeNote.id);
      if (updated) {
        this.activeNote = updated;
        this.linkEngine.updateActiveNote(updated, data);
      }
    }
  }

  openNote(note) {
    if (!note) return;
    this.activeNote = note;

    if (note.type === "chapter") {
      this.activeChapter = note.title;
    } else if (note.type === "topic") {
      this.activeTopic = note.title;
      if (note.frontmatter && note.frontmatter.chapter) {
        this.activeChapter = note.frontmatter.chapter.replace(/\[\[|\]\]/g, "");
      }
    }

    this.editor.loadNote(note);
    if (this.graph) {
      this.graph.setActiveNote(note.id);
    }
    this.linkEngine.updateActiveNote(note, this.vaultData);

    // Highlight in file tree
    document.querySelectorAll(".tree-item").forEach((el) => {
      el.classList.toggle("active", el.getAttribute("data-id") === note.id);
    });
  }

  openNoteById(noteId) {
    const cleanId = noteId.replace(/\[\[|\]\]/g, "").trim();
    const note = this.vaultData.notes.find((n) => n.id === cleanId || n.title.toLowerCase() === cleanId.toLowerCase());

    if (note) {
      this.openNote(note);
    } else {
      // Prompt to create note if it doesn't exist
      if (confirm(`Note "[[${cleanId}]]" does not exist yet. Would you like to create it as a new Thought?`)) {
        this.handleVoiceCreateThought(cleanId);
      }
    }
  }

  renderFileTree() {
    const chaptersList = document.getElementById("tree-chapters-list");
    const topicsList = document.getElementById("tree-topics-list");
    const thoughtsList = document.getElementById("tree-thoughts-list");

    const chaptersBadge = document.getElementById("badge-chapters-count");
    const topicsBadge = document.getElementById("badge-topics-count");
    const thoughtsBadge = document.getElementById("badge-thoughts-count");

    const notes = this.vaultData.notes || [];

    const naturalSort = (a, b) => a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: "base" });
    const chapters = notes.filter((n) => n.type === "chapter").sort(naturalSort);
    const topics = notes.filter((n) => n.type === "topic").sort(naturalSort);
    const thoughts = notes.filter((n) => n.type === "thought").sort(naturalSort);

    if (chaptersBadge) chaptersBadge.textContent = chapters.length;
    if (topicsBadge) topicsBadge.textContent = topics.length;
    if (thoughtsBadge) thoughtsBadge.textContent = thoughts.length;

    const renderItems = (items, container, type) => {
      if (!container) return;
      if (items.length === 0) {
        container.innerHTML = `<li style="padding: 6px 10px; font-size: 12px; color: var(--text-muted); font-style: italic;">No ${type}s yet</li>`;
        return;
      }
      container.innerHTML = items
        .map(
          (n) => `
        <li class="tree-item ${this.activeNote && this.activeNote.id === n.id ? "active" : ""}" data-id="${n.id}">
          <div class="tree-item-label">
            <span class="tree-dot ${n.type}"></span>
            <span>${n.title}</span>
          </div>
          <div class="tree-item-actions">
            <button class="tree-mini-btn delete-note-btn" title="Delete note" data-path="${n.path}">✕</button>
          </div>
        </li>
      `
        )
        .join("");

      container.querySelectorAll(".tree-item").forEach((el) => {
        el.addEventListener("click", (e) => {
          if (e.target.classList.contains("delete-note-btn")) return;
          const id = el.getAttribute("data-id");
          this.openNoteById(id);
          if (this.currentView === "graph") {
            this.switchView("editor");
          }
        });
      });

      container.querySelectorAll(".delete-note-btn").forEach((btn) => {
        btn.addEventListener("click", async (e) => {
          e.stopPropagation();
          const path = btn.getAttribute("data-path");
          if (confirm(`Are you sure you want to delete this note (${path})?`)) {
            const res = await this.storage.deleteNote(path);
            if (res && res.success) {
              this.showToast("Note deleted", "info");
              await this.refreshVaultData(true);
            }
          }
        });
      });
    };

    renderItems(chapters, chaptersList, "chapter");
    renderItems(topics, topicsList, "topic");
    renderItems(thoughts, thoughtsList, "thought");
  }

  renderStats() {
    const stats = this.vaultData.stats || {};
    const totalNotesEl = document.getElementById("stat-total-notes");
    const totalLinksEl = document.getElementById("stat-total-links");

    if (totalNotesEl) totalNotesEl.textContent = `${stats.totalNotes || 0} notes`;
    if (totalLinksEl) totalLinksEl.textContent = `${stats.totalEdges || 0} links`;
  }

  renderSpeechLog() {
    const logContainer = document.getElementById("voice-log-list");
    if (!logContainer) return;

    if (this.speechHistory.length === 0) {
      logContainer.innerHTML = `<li style="color: var(--text-muted); font-size: 11px; font-style: italic;">No recent voice events</li>`;
      return;
    }

    logContainer.innerHTML = this.speechHistory
      .slice(0, 8)
      .map(
        (entry, idx) => `
      <li class="voice-capture-item" data-idx="${idx}">
        <div class="voice-capture-header">
          <span>🎙️ Voice Capture</span>
          <span>${entry.time}</span>
        </div>
        <div class="voice-capture-text">${entry.text}</div>
        <div class="voice-capture-actions">
          <button class="mini-action-btn insert-log-btn" title="Insert into active note">+ Insert</button>
          <button class="mini-action-btn thought-log-btn" title="Create Thought">💡 Thought</button>
          <button class="mini-action-btn discard discard-log-btn" title="Discard">✕</button>
        </div>
      </li>
    `
      )
      .join("");

    logContainer.querySelectorAll(".insert-log-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const item = btn.closest(".voice-capture-item");
        const idx = Number(item.getAttribute("data-idx"));
        const entry = this.speechHistory[idx];
        if (entry && this.activeNote) {
          this.editor.appendSpeechText(entry.text);
          this.showToast(`Inserted "${entry.text.slice(0, 20)}..."`, "info");
        }
      });
    });

    logContainer.querySelectorAll(".thought-log-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const item = btn.closest(".voice-capture-item");
        const idx = Number(item.getAttribute("data-idx"));
        const entry = this.speechHistory[idx];
        if (entry) {
          this.handleVoiceCreateThought(entry.text);
        }
      });
    });

    logContainer.querySelectorAll(".discard-log-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const item = btn.closest(".voice-capture-item");
        const idx = Number(item.getAttribute("data-idx"));
        this.speechHistory.splice(idx, 1);
        this.renderSpeechLog();
        this.showToast("Voice capture discarded", "info");
      });
    });
  }

  switchView(viewName) {
    this.currentView = viewName;
    const splitContainer = document.getElementById("split-view-container");
    const tabGraph = document.getElementById("tab-btn-graph");
    const tabEditor = document.getElementById("tab-btn-editor");
    const tabSplit = document.getElementById("tab-btn-split");

    [tabGraph, tabEditor, tabSplit].forEach((btn) => btn && btn.classList.remove("active"));

    if (splitContainer) {
      splitContainer.classList.remove("mode-graph", "mode-editor", "mode-split");
      splitContainer.classList.add(`mode-${viewName}`);
    }

    if (viewName === "graph" && tabGraph) {
      tabGraph.classList.add("active");
    } else if (viewName === "editor" && tabEditor) {
      tabEditor.classList.add("active");
    } else if (viewName === "split" && tabSplit) {
      tabSplit.classList.add("active");
    }

    setTimeout(() => {
      if (this.graph) this.graph.resize();
    }, 60);
  }

  toggleLeftSidebar() {
    const sidebar = document.querySelector(".sidebar-left");
    if (!sidebar) return;
    const isCollapsed = sidebar.classList.toggle("collapsed");
    sidebar.classList.toggle("open", !isCollapsed);
    setTimeout(() => {
      if (this.graph) this.graph.resize();
    }, 250);
  }

  toggleRightSidebar() {
    const sidebar = document.getElementById("sidebar-right");
    const toggleBtn = document.getElementById("btn-toggle-inspector");
    if (!sidebar) return;

    const isCollapsed = sidebar.classList.toggle("collapsed");
    if (toggleBtn) {
      toggleBtn.classList.toggle("active", !isCollapsed);
    }
    localStorage.setItem("memoir_right_sidebar_hidden", isCollapsed ? "true" : "false");

    setTimeout(() => {
      if (this.graph) this.graph.resize();
    }, 250);

    this.showToast(isCollapsed ? "Inspector & Local Graph hidden (Ctrl+I to restore)" : "Inspector & Local Graph visible", "info");
  }

  setupUIEvents() {
    // Toggle Left Sidebar
    document.getElementById("btn-toggle-left-sidebar")?.addEventListener("click", () => this.toggleLeftSidebar());

    // Toggle Right Sidebar (Inspector / Local Graph)
    document.getElementById("btn-toggle-inspector")?.addEventListener("click", () => this.toggleRightSidebar());
    document.getElementById("btn-close-inspector")?.addEventListener("click", () => this.toggleRightSidebar());

    // Restore saved right sidebar collapsed state
    if (localStorage.getItem("memoir_right_sidebar_hidden") === "true") {
      const sidebar = document.getElementById("sidebar-right");
      const toggleBtn = document.getElementById("btn-toggle-inspector");
      if (sidebar) sidebar.classList.add("collapsed");
      if (toggleBtn) toggleBtn.classList.remove("active");
    }

    // View Switcher Buttons
    document.getElementById("tab-btn-graph")?.addEventListener("click", () => this.switchView("graph"));
    document.getElementById("tab-btn-editor")?.addEventListener("click", () => this.switchView("editor"));
    document.getElementById("tab-btn-split")?.addEventListener("click", () => this.switchView("split"));

    // Quick creation buttons
    document.getElementById("btn-quick-chapter")?.addEventListener("click", () => this.handleVoiceCreateChapter());
    document.getElementById("btn-quick-topic")?.addEventListener("click", () => this.handleVoiceCreateTopic());
    document.getElementById("btn-quick-thought")?.addEventListener("click", () => this.handleVoiceCreateThought());

    // Search bar filter
    const searchInput = document.getElementById("vault-search-input");
    if (searchInput) {
      searchInput.addEventListener("input", (e) => {
        const query = e.target.value.toLowerCase();
        document.querySelectorAll(".tree-item").forEach((item) => {
          const label = item.querySelector(".tree-item-label span:last-child")?.textContent.toLowerCase() || "";
          item.style.display = label.includes(query) ? "flex" : "none";
        });
        if (this.graph) {
          this.graph.searchQuery = query;
        }
      });
    }

    // Graph Filters
    document.querySelectorAll(".filter-chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        const type = chip.getAttribute("data-type");
        chip.classList.toggle("active");
        if (this.graph) {
          this.graph.filterTypes[type] = chip.classList.contains("active");
        }
      });
    });

    // Graph Physics Sliders
    document.getElementById("slider-repulsion")?.addEventListener("input", (e) => {
      if (this.graph) this.graph.repulsion = Number(e.target.value);
    });
    document.getElementById("slider-distance")?.addEventListener("input", (e) => {
      if (this.graph) this.graph.linkDistance = Number(e.target.value);
    });
    document.getElementById("slider-gravity")?.addEventListener("input", (e) => {
      if (this.graph) this.graph.gravity = Number(e.target.value);
    });

    document.getElementById("btn-graph-center")?.addEventListener("click", () => {
      if (this.graph) this.graph.centerView();
    });
    document.getElementById("btn-graph-zoomin")?.addEventListener("click", () => {
      if (this.graph) this.graph.zoomIn();
    });
    document.getElementById("btn-graph-zoomout")?.addEventListener("click", () => {
      if (this.graph) this.graph.zoomOut();
    });

    // Formatting Toolbar Buttons
    document.getElementById("tool-h1")?.addEventListener("click", () => this.editor.insertFormat("# "));
    document.getElementById("tool-h2")?.addEventListener("click", () => this.editor.insertFormat("## "));
    document.getElementById("tool-bold")?.addEventListener("click", () => this.editor.insertFormat("**", "**"));
    document.getElementById("tool-italic")?.addEventListener("click", () => this.editor.insertFormat("*", "*"));
    document.getElementById("tool-link")?.addEventListener("click", () => this.editor.insertFormat("[[", "]]"));
    document.getElementById("tool-tag")?.addEventListener("click", () => this.editor.insertFormat("#"));
    document.getElementById("tool-list")?.addEventListener("click", () => this.editor.insertFormat("- "));
    document.getElementById("tool-quote")?.addEventListener("click", () => this.editor.insertFormat("> "));
    document.getElementById("tool-code")?.addEventListener("click", () => this.editor.insertFormat("`", "`"));

    // Modals
    const voiceGuideModal = document.getElementById("modal-voice-guide");
    const settingsModal = document.getElementById("modal-settings");

    document.getElementById("btn-open-voice-guide")?.addEventListener("click", () => {
      voiceGuideModal?.classList.add("active");
    });
    document.getElementById("btn-close-voice-guide")?.addEventListener("click", () => {
      voiceGuideModal?.classList.remove("active");
    });

    document.getElementById("btn-open-settings")?.addEventListener("click", () => {
      settingsModal?.classList.add("active");
    });
    document.getElementById("btn-close-settings")?.addEventListener("click", () => {
      settingsModal?.classList.remove("active");
    });

    document.getElementById("btn-export-vault")?.addEventListener("click", () => {
      window.exporter.downloadFullVaultZip();
      this.showToast("Exporting full Vault as .zip...", "info");
    });

    // Language selection
    const langSelect = document.getElementById("setting-voice-lang");
    if (langSelect) {
      langSelect.value = this.voice.language;
      langSelect.addEventListener("change", (e) => {
        this.voice.language = e.target.value;
        localStorage.setItem("memoir_voice_lang", e.target.value);
        this.showToast(`Voice language set to ${e.target.value}`, "info");
      });
    }

    // Sound effects toggle
    const chimeCheckbox = document.getElementById("setting-chimes");
    if (chimeCheckbox) {
      chimeCheckbox.checked = this.voice.soundEffects;
      chimeCheckbox.addEventListener("change", (e) => {
        this.voice.soundEffects = e.target.checked;
      });
    }

    // Diagnostics buttons
    const diagMicStatus = document.getElementById("diag-mic-status");

    document.getElementById("btn-test-mic")?.addEventListener("click", async () => {
      try {
        if (diagMicStatus) diagMicStatus.textContent = "Requesting mic...";
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          throw new Error("Microphone API not available. Use http://localhost:5432 or http://127.0.0.1:5432");
        }
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (diagMicStatus) diagMicStatus.textContent = "🎤 Mic Connected! Listening for 4s...";
        this.showToast("Microphone connected! Say something...", "info");

        // Measure live volume for 4 seconds
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        const ctx = new AudioCtx();
        const src = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 64;
        src.connect(analyser);

        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        let maxLevel = 0;
        const checkInterval = setInterval(() => {
          analyser.getByteFrequencyData(dataArray);
          const sum = dataArray.reduce((a, b) => a + b, 0);
          const avg = sum / dataArray.length;
          const pct = Math.min(100, Math.round((avg / 255) * 100));
          if (pct > maxLevel) maxLevel = pct;
          if (diagMicStatus) diagMicStatus.textContent = `🎤 Live Mic Level: ${pct}% (Peak: ${maxLevel}%)`;
        }, 100);

        setTimeout(() => {
          clearInterval(checkInterval);
          stream.getTracks().forEach((t) => t.stop());
          ctx.close();
          if (diagMicStatus) {
            diagMicStatus.textContent = maxLevel > 2
              ? `✓ Mic Working! Peak Level: ${maxLevel}%`
              : `✓ Mic Connected (Low/quiet input: ${maxLevel}%)`;
          }
          this.showToast(`Mic test complete (Peak: ${maxLevel}%)`, "info");
        }, 4000);

      } catch (err) {
        console.error("Mic test error:", err);
        if (diagMicStatus) diagMicStatus.textContent = "✕ Mic Blocked: " + err.message;
        this.showToast("Mic failed: " + err.message, "info");
      }
    });

    document.getElementById("btn-test-server-stt")?.addEventListener("click", async () => {
      try {
        if (diagMicStatus) diagMicStatus.textContent = "Testing Vosk STT Engine...";
        const res = await fetch("/api/stream_stt", {
          method: "POST",
          headers: {
            "Content-Type": "application/octet-stream",
            "X-Session-ID": "diag_test",
            "X-Reset": "true",
          },
          body: new Uint8Array(3200), // 100ms test PCM chunk
        });
        if (res.ok) {
          const data = await res.json();
          if (diagMicStatus) diagMicStatus.textContent = "✓ Vosk STT Engine Online & Ready!";
          this.showToast("Local Vosk STT engine is online and decoding 16kHz audio!", "info");
        } else {
          if (diagMicStatus) diagMicStatus.textContent = "✕ STT Error: HTTP " + res.status;
        }
      } catch (e) {
        console.error("STT test error:", e);
        if (diagMicStatus) diagMicStatus.textContent = "✕ STT Connection Error";
        this.showToast("STT connection error", "info");
      }
    });

    document.getElementById("btn-simulate-voice")?.addEventListener("click", () => {
      const phrases = [
        "Chapter Introduction to Autonomous Agents",
        "Topic Perception and Knowledge Graphs",
        "Thought Voice dictation combined with local graph links removes creative friction",
      ];
      const phrase = phrases[Math.floor(Math.random() * phrases.length)];
      this.showToast(`Simulating spoken phrase: "${phrase}"`, "thought");
      if (diagMicStatus) diagMicStatus.textContent = `🗣️ Simulating: "${phrase.slice(0, 25)}..."`;
      this.voice.processFinalSpeech(phrase);
    });
  }

  setupKeyboardShortcuts() {
    window.addEventListener("keydown", (e) => {
      // Toggle Voice Recognition: Ctrl+M or Space (when not typing in textarea)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "m") {
        e.preventDefault();
        this.voice.toggleListening();
        return;
      }

      // View shortcuts: Ctrl+1 (Graph), Ctrl+2 (Editor), Ctrl+3 (Split)
      if ((e.ctrlKey || e.metaKey) && e.key === "1") {
        e.preventDefault();
        this.switchView("graph");
      } else if ((e.ctrlKey || e.metaKey) && e.key === "2") {
        e.preventDefault();
        this.switchView("editor");
      } else if ((e.ctrlKey || e.metaKey) && e.key === "3") {
        e.preventDefault();
        this.switchView("split");
      }

      // Save: Ctrl+S
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        this.editor.saveCurrentNote();
        this.showToast("Note saved", "info");
        return;
      }

      // Toggle Right Sidebar (Inspector & Local Graph): Ctrl+I or Ctrl+B
      if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === "i" || e.key.toLowerCase() === "b")) {
        e.preventDefault();
        this.toggleRightSidebar();
        return;
      }

      // Help: ?
      if (e.key === "?" && document.activeElement.tagName !== "TEXTAREA" && document.activeElement.tagName !== "INPUT") {
        e.preventDefault();
        document.getElementById("modal-voice-guide")?.classList.toggle("active");
      }
    });
  }

  showToast(message, type = "info") {
    const container = document.getElementById("toast-container");
    if (!container) return;

    const toast = document.createElement("div");
    toast.className = `toast ${type}`;

    const icons = {
      chapter: "📖",
      topic: "🌿",
      thought: "💡",
      info: "✨",
    };
    const icon = icons[type] || "✨";

    toast.innerHTML = `<span>${icon}</span> <span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = "0";
      toast.style.transform = "translateX(100%)";
      toast.style.transition = "all 0.3s ease";
      setTimeout(() => toast.remove(), 300);
    }, 3200);
  }
}

function launchApp() {
  if (!window.app) {
    window.app = new MemoirApp();
    window.app.init();
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", launchApp);
} else {
  launchApp();
}
