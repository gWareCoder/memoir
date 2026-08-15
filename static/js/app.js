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

    this.speechHistory = [];
  }

  async init() {
    // 1. Initialize Submodules
    this.graph = new MemoirGraph("graph-canvas", "graph-tooltip");
    this.editor = new MemoirEditor("note-textarea", "note-preview", "note-title-input");
    this.linkEngine = new LinkEngine();

    // 2. Attach Graph Callbacks
    this.graph.onNodeClick = (node) => {
      this.openNoteById(node.id);
      if (this.currentView === "graph") {
        this.switchView("editor");
      }
    };

    // 3. Attach Editor Callbacks
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

    // 4. Attach Voice Engine Callbacks
    this.setupVoiceInteractions();

    // 5. Setup UI Event Listeners
    this.setupUIEvents();
    this.setupKeyboardShortcuts();

    // 6. Load Initial Vault Data
    await this.refreshVaultData(true);

    // Auto select first note or chapter
    if (this.vaultData.notes && this.vaultData.notes.length > 0) {
      const chapter = this.vaultData.notes.find((n) => n.type === "chapter") || this.vaultData.notes[0];
      this.openNote(chapter);
    }

    // Check server status
    const status = await this.storage.getStatus();
    const statusEl = document.getElementById("server-status-pill");
    if (statusEl) {
      statusEl.textContent = status.status === "online" ? "Vault Connected" : "Local Mode";
    }

    // Default to Split View if on large screen, otherwise Graph
    if (window.innerWidth > 1024) {
      this.switchView("split");
    } else {
      this.switchView("graph");
    }
  }

  setupVoiceInteractions() {
    const micToggleBtn = document.getElementById("mic-toggle-btn");
    const voicePill = document.getElementById("voice-capture-pill");
    const voiceStatusText = document.getElementById("voice-status-text");
    const transcriptPreview = document.getElementById("voice-transcript-preview");
    const waveformCanvas = document.getElementById("waveform-canvas");
    const liveBanner = document.getElementById("voice-live-banner");
    const liveText = document.getElementById("voice-live-text");
    const liveCue = document.getElementById("voice-live-cue");

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
      if (voiceStatusText) {
        voiceStatusText.textContent = isListening ? "Listening..." : "Mic Idle";
      }
      if (transcriptPreview && !isListening) {
        transcriptPreview.textContent = 'Say "Chapter", "Topic", or "Thought" to dictate...';
      }
      if (liveBanner) {
        liveBanner.classList.toggle("visible", isListening);
      }
    };

    this.voice.onTranscription = (text, isFinal) => {
      if (transcriptPreview) {
        transcriptPreview.textContent = text;
      }
      if (liveText) {
        liveText.textContent = text;
      }
      if (liveCue) {
        liveCue.style.display = "none";
      }

      if (isFinal) {
        // Append text to currently open note
        if (this.activeNote) {
          this.editor.appendSpeechText(text);
        }
      }
    };

    // Process Voice Commands ("chapter", "topic", "thought", "link", "tag")
    this.voice.onCommand = async (type, payload) => {
      if (liveCue) {
        liveCue.style.display = "inline-block";
        liveCue.textContent = `Command: ${type.toUpperCase()}`;
      }

      if (type === "chapter") {
        await this.handleVoiceCreateChapter(payload);
      } else if (type === "topic") {
        await this.handleVoiceCreateTopic(payload);
      } else if (type === "thought") {
        await this.handleVoiceCreateThought(payload);
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
      if (this.speechHistory.length > 20) this.speechHistory.pop();
      this.renderSpeechLog();
    };
  }

  async handleVoiceCreateChapter(title) {
    const rawTitle = title || `Chapter ${this.vaultData.stats.chapters + 1 || 1}`;
    const cleanTitle = rawTitle.toLowerCase().startsWith("chapter") ? rawTitle : `Chapter - ${rawTitle}`;

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
    const rawTitle = title || `Topic ${this.vaultData.stats.topics + 1 || 1}`;
    const cleanTitle = rawTitle.toLowerCase().startsWith("topic") ? rawTitle : `Topic - ${rawTitle}`;

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
    let title = "";
    let body = "";

    if (!textOrTitle) {
      title = `Thought - ${new Date().toLocaleTimeString()}`;
      body = `# ${title}\n\n`;
    } else if (textOrTitle.length > 50) {
      // It's a full thought phrase
      const words = textOrTitle.split(" ");
      title = `Thought - ${words.slice(0, 5).join(" ")}...`;
      body = `# ${title}\n\n${textOrTitle}\n\n`;
    } else {
      title = textOrTitle.toLowerCase().startsWith("thought") ? textOrTitle : `Thought - ${textOrTitle}`;
      body = `# ${title}\n\n`;
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

    const chapters = notes.filter((n) => n.type === "chapter");
    const topics = notes.filter((n) => n.type === "topic");
    const thoughts = notes.filter((n) => n.type === "thought");

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
      .slice(0, 6)
      .map(
        (entry) => `
      <li style="padding: 4px 0; border-bottom: 1px solid var(--border-subtle); font-size: 11px;">
        <span style="color: var(--text-muted);">${entry.time}:</span>
        <span style="color: var(--text-secondary);">${entry.text}</span>
      </li>
    `
      )
      .join("");
  }

  switchView(viewName) {
    this.currentView = viewName;
    const graphPanel = document.getElementById("graph-view-panel");
    const editorPanel = document.getElementById("editor-view-panel");
    const splitContainer = document.getElementById("split-view-container");

    const tabGraph = document.getElementById("tab-btn-graph");
    const tabEditor = document.getElementById("tab-btn-editor");
    const tabSplit = document.getElementById("tab-btn-split");

    [tabGraph, tabEditor, tabSplit].forEach((btn) => btn && btn.classList.remove("active"));

    if (graphPanel) graphPanel.classList.remove("active");
    if (editorPanel) editorPanel.classList.remove("active");
    if (splitContainer) splitContainer.classList.remove("active");

    const graphContainer = document.getElementById("graph-wrapper");
    const editorWrapper = document.getElementById("note-editor-wrapper");

    if (viewName === "graph") {
      if (tabGraph) tabGraph.classList.add("active");
      if (graphPanel) {
        graphPanel.classList.add("active");
        if (graphContainer) graphPanel.appendChild(graphContainer);
      }
      setTimeout(() => this.graph && this.graph.resize(), 50);
    } else if (viewName === "editor") {
      if (tabEditor) tabEditor.classList.add("active");
      if (editorPanel) {
        editorPanel.classList.add("active");
        if (editorWrapper) editorPanel.appendChild(editorWrapper);
      }
    } else if (viewName === "split") {
      if (tabSplit) tabSplit.classList.add("active");
      if (splitContainer) {
        splitContainer.classList.add("active");
        const left = document.getElementById("split-left-pane");
        const right = document.getElementById("split-right-pane");
        if (left && editorWrapper) left.appendChild(editorWrapper);
        if (right && graphContainer) right.appendChild(graphContainer);
      }
      setTimeout(() => this.graph && this.graph.resize(), 50);
    }
  }

  setupUIEvents() {
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

document.addEventListener("DOMContentLoaded", () => {
  window.app = new MemoirApp();
  window.app.init();
});
