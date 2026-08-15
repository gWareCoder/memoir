/**
 * Memoir - Markdown Editor, Live Preview & Wikilink Resolver Engine
 * Supports bi-directional wikilinks, syntax highlighting, graph-aware autocompletion, and live voice text streaming.
 */

class MemoirEditor {
  constructor(textareaId, previewId, titleInputId) {
    this.textarea = document.getElementById(textareaId);
    this.preview = document.getElementById(previewId);
    this.titleInput = document.getElementById(titleInputId);

    this.activeNote = null;
    this.saveTimeout = null;
    this.isDirty = false;

    this.autocompletePopup = null;
    this.allVaultNotes = [];
    this.graphData = null;
    this.vaultData = null;

    // Callbacks
    this.onNoteSaved = null;      // (noteData) => void
    this.onWikilinkClicked = null; // (targetTitle) => void
    this.onTitleRenamed = null;   // (oldPath, newTitle) => void

    this.initAutocomplete();
    this.initEvents();
  }

  setVaultData(vaultData) {
    this.vaultData = vaultData;
    this.allVaultNotes = vaultData?.notes || [];
    this.graphData = vaultData?.graph || null;
    this.updateGraphSuggestionChips();
  }

  setVaultNotes(notes) {
    this.allVaultNotes = notes || [];
    this.updateGraphSuggestionChips();
  }

  loadNote(note) {
    this.activeNote = note;
    if (!note) {
      if (this.titleInput) this.titleInput.value = "";
      if (this.textarea) this.textarea.value = "";
      if (this.preview) this.preview.innerHTML = `<div style="color: var(--text-muted); font-style: italic; padding: 40px; text-align: center;">No note selected. Select a note from the sidebar or click the graph.</div>`;
      this.updateGraphSuggestionChips();
      return;
    }

    if (this.titleInput) {
      this.titleInput.value = note.title || note.id;
    }

    // Use full content or body
    const text = note.content || note.body || "";
    if (this.textarea) {
      this.textarea.value = text;
    }

    this.renderPreview(text);
    this.updateBreadcrumbs();
    this.updateGraphSuggestionChips();
  }

  updateBreadcrumbs() {
    const breadcrumbEl = document.getElementById("note-breadcrumbs");
    if (!breadcrumbEl || !this.activeNote) return;

    const note = this.activeNote;
    let parentInfo = "";
    if (note.frontmatter && note.frontmatter.chapter) {
      parentInfo = `<span>in</span> <span class="wikilink-chip">${note.frontmatter.chapter}</span>`;
    }
    if (note.frontmatter && note.frontmatter.topic) {
      parentInfo += ` <span>/</span> <span class="wikilink-chip">${note.frontmatter.topic}</span>`;
    }

    breadcrumbEl.innerHTML = `
      <span class="type-pill ${note.type}">${note.type}</span>
      <span>${note.path || note.id}</span>
      ${parentInfo}
    `;
  }

  renderPreview(markdown) {
    if (!this.preview) return;
    if (!markdown) {
      this.preview.innerHTML = "";
      return;
    }

    // Strip frontmatter from preview display
    let body = markdown;
    if (markdown.startsWith("---")) {
      const parts = markdown.split("---", 2);
      if (parts.length >= 2) {
        body = markdown.slice(parts[0].length + parts[1].length + 6).trim();
      }
    }

    // Convert markdown to HTML with wikilink parser
    let html = this.parseMarkdown(body);
    this.preview.innerHTML = html;

    // Attach click handlers to wikilinks in preview
    this.preview.querySelectorAll(".wikilink-chip").forEach((el) => {
      el.addEventListener("click", (e) => {
        e.preventDefault();
        const target = el.getAttribute("data-target");
        if (target && this.onWikilinkClicked) {
          this.onWikilinkClicked(target);
        }
      });
    });

    this.updateWordCount(markdown);
  }

  updateWordCount(text) {
    const wordCountEl = document.getElementById("note-word-count");
    const readTimeEl = document.getElementById("note-read-time");
    if (!wordCountEl) return;

    const words = text.trim() ? (text.match(/\b\w+\b/g) || []).length : 0;
    wordCountEl.textContent = `${words} word${words === 1 ? "" : "s"}`;

    if (readTimeEl) {
      const mins = Math.max(1, Math.ceil(words / 180));
      readTimeEl.textContent = `${mins} min read`;
    }
  }

  parseMarkdown(md) {
    if (!md) return "";

    let text = md;

    // Headings
    text = text.replace(/^# (.*$)/gim, '<h1 class="preview-h1">$1</h1>');
    text = text.replace(/^## (.*$)/gim, '<h2 class="preview-h2">$1</h2>');
    text = text.replace(/^### (.*$)/gim, '<h3 class="preview-h3">$1</h3>');

    // Bold / Italic
    text = text.replace(/\*\*\*(.*?)\*\*\*/g, "<strong><em>$1</em></strong>");
    text = text.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
    text = text.replace(/\*(.*?)\*/g, "<em>$1</em>");

    // Wikilinks [[Target]] or [[Target|Alias]]
    text = text.replace(/\[\[(.*?)\]\]/g, (match, inner) => {
      const parts = inner.split("|");
      const target = parts[0].trim();
      const alias = parts[1] ? parts[1].trim() : target;
      return `<span class="wikilink-chip" data-target="${target}"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:3px;vertical-align:-1px;"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>${alias}</span>`;
    });

    // Tags #tag
    text = text.replace(/(?<!\w)#([a-zA-Z0-9_\-]+)/g, '<span class="tag-chip">#$1</span>');

    // Bullet lists
    text = text.replace(/^\s*-\s+(.*$)/gim, "<li>$1</li>");
    text = text.replace(/(<li>.*<\/li>)/s, "<ul>$1</ul>");

    // Paragraphs
    const lines = text.split("\n\n");
    text = lines
      .map((p) => {
        p = p.trim();
        if (!p) return "";
        if (p.startsWith("<h") || p.startsWith("<ul") || p.startsWith("<li")) return p;
        return `<p>${p.replace(/\n/g, "<br>")}</p>`;
      })
      .join("\n");

    return text;
  }

  appendSpeechText(speechText, asParagraph = false) {
    if (!this.textarea || !speechText) return;

    const currentVal = this.textarea.value;
    const separator = asParagraph ? "\n\n" : (currentVal.endsWith(" ") || currentVal === "" ? "" : " ");

    this.textarea.value = currentVal + separator + speechText;
    this.onContentChanged();
    this.textarea.scrollTop = this.textarea.scrollHeight;
  }

  onContentChanged() {
    this.isDirty = true;
    const text = this.textarea.value;
    this.renderPreview(text);

    // Auto-save debounce (800ms)
    if (this.saveTimeout) clearTimeout(this.saveTimeout);
    this.saveTimeout = setTimeout(() => {
      this.saveCurrentNote();
    }, 800);
  }

  async saveCurrentNote() {
    if (!this.activeNote || !this.isDirty) return;

    const content = this.textarea.value;
    const title = this.titleInput ? this.titleInput.value : this.activeNote.title;

    const payload = {
      path: this.activeNote.path,
      type: this.activeNote.type,
      title: title,
      body: content,
      chapter: this.activeNote.frontmatter ? this.activeNote.frontmatter.chapter : null,
      topic: this.activeNote.frontmatter ? this.activeNote.frontmatter.topic : null,
    };

    const res = await window.storageService.saveNote(payload);
    this.isDirty = false;
    if (res && res.success && this.onNoteSaved) {
      this.onNoteSaved(res);
    }
  }

  // =========================================================================
  // Graph-Ranked Link Suggestion Engine
  // =========================================================================

  getRankedGraphSuggestions(query = "") {
    if (!this.allVaultNotes || this.allVaultNotes.length === 0) return [];

    const activeId = this.activeNote ? this.activeNote.id : null;
    const activeType = this.activeNote ? this.activeNote.type : null;
    const activeChapter = this.activeNote?.frontmatter?.chapter?.replace(/\[\[|\]\]/g, "") || (activeType === "chapter" ? this.activeNote.title : null);
    const activeTopic = this.activeNote?.frontmatter?.topic?.replace(/\[\[|\]\]/g, "") || (activeType === "topic" ? this.activeNote.title : null);

    const edges = this.graphData?.edges || [];
    const directNeighborIds = new Set();
    edges.forEach((e) => {
      if (e.source === activeId) directNeighborIds.add(e.target);
      if (e.target === activeId) directNeighborIds.add(e.source);
    });

    const q = (query || "").toLowerCase().trim();

    const ranked = this.allVaultNotes
      .filter((n) => n.id !== activeId)
      .map((note) => {
        let score = 0;
        let relationBadge = "";
        let badgeClass = "";

        const titleLower = note.title.toLowerCase();
        const idLower = note.id.toLowerCase();

        // 1. Query matching
        if (q) {
          if (titleLower === q || idLower === q) score += 100;
          else if (titleLower.startsWith(q)) score += 60;
          else if (titleLower.includes(q)) score += 35;
          else {
            const tagMatch = (note.tags || []).some((t) => t.toLowerCase().includes(q));
            if (tagMatch) score += 20;
            else return null; // No match for search query
          }
        }

        // 2. Direct Graph Neighbor
        if (directNeighborIds.has(note.id) || directNeighborIds.has(note.title)) {
          score += 45;
          relationBadge = "Graph Neighbor";
          badgeClass = "neighbor";
        }

        // 3. Shared Hierarchy Context
        const noteChapter = note.frontmatter?.chapter?.replace(/\[\[|\]\]/g, "");
        const noteTopic = note.frontmatter?.topic?.replace(/\[\[|\]\]/g, "");

        if (activeChapter && noteChapter && activeChapter.toLowerCase() === noteChapter.toLowerCase()) {
          score += 30;
          if (!relationBadge) {
            relationBadge = "Same Chapter";
            badgeClass = "chapter";
          }
        }
        if (activeTopic && noteTopic && activeTopic.toLowerCase() === noteTopic.toLowerCase()) {
          score += 25;
          if (!relationBadge) {
            relationBadge = "Same Topic";
            badgeClass = "neighbor";
          }
        }

        // 4. Graph connection degree bonus
        const connections = edges.filter((e) => e.source === note.id || e.target === note.id).length;
        score += Math.min(connections * 2, 12);

        return {
          note,
          score,
          relationBadge,
          badgeClass,
          connections,
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score);

    return ranked;
  }

  updateGraphSuggestionChips() {
    const chipsContainer = document.getElementById("suggested-links-chips");
    const bar = document.getElementById("editor-suggested-links-bar");
    if (!chipsContainer || !bar) return;

    const ranked = this.getRankedGraphSuggestions("");
    const topSuggestions = ranked.slice(0, 6);

    if (topSuggestions.length === 0) {
      chipsContainer.innerHTML = `<span style="color: var(--text-muted); font-style: italic; font-size: 11px;">Create more notes to discover graph suggestions</span>`;
      return;
    }

    chipsContainer.innerHTML = topSuggestions
      .map(
        (item) => `
        <button type="button" class="suggested-link-chip ${item.note.type}" data-title="${item.note.title}" title="Insert [[${item.note.title}]] (${item.relationBadge || item.connections + ' links'})">
          <span class="chip-dot"></span>
          <span>+ [[${item.note.title}]]</span>
        </button>
      `
      )
      .join("");

    chipsContainer.querySelectorAll(".suggested-link-chip").forEach((btn) => {
      btn.addEventListener("click", () => {
        const title = btn.getAttribute("data-title");
        this.insertWikilinkAtCursor(title);
      });
    });
  }

  insertWikilinkAtCursor(title) {
    if (!this.textarea) return;
    const cursorPos = this.textarea.selectionStart || this.textarea.value.length;
    const textBefore = this.textarea.value.substring(0, cursorPos);
    const textAfter = this.textarea.value.substring(cursorPos);

    const prefix = textBefore.endsWith(" ") || textBefore.endsWith("\n") || textBefore === "" ? "" : " ";
    const newText = textBefore + prefix + `[[${title}]] ` + textAfter;
    this.textarea.value = newText;
    const newCursor = cursorPos + prefix.length + title.length + 5;
    this.textarea.selectionStart = this.textarea.selectionEnd = newCursor;
    this.textarea.focus();
    this.onContentChanged();
  }

  // =========================================================================
  // Autocomplete Popup Setup & Interaction
  // =========================================================================

  initAutocomplete() {
    this.autocompletePopup = document.createElement("div");
    this.autocompletePopup.className = "wikilink-autocomplete";
    this.autocompletePopup.id = "wikilink-autocomplete-popup";
    document.body.appendChild(this.autocompletePopup);
  }

  initEvents() {
    if (this.textarea) {
      this.textarea.addEventListener("input", () => {
        this.onContentChanged();
        this.checkWikilinkTrigger();
      });

      this.textarea.addEventListener("keydown", (e) => {
        if (this.autocompletePopup && this.autocompletePopup.style.display === "block") {
          if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === "Tab" || e.key === "Escape") {
            this.handleAutocompleteKey(e);
          }
        }
      });

      this.textarea.addEventListener("blur", () => {
        // Delay to allow clicking on an option
        setTimeout(() => this.hideAutocomplete(), 200);
      });
    }

    if (this.titleInput) {
      this.titleInput.addEventListener("blur", () => {
        if (!this.activeNote) return;
        const newTitle = this.titleInput.value.trim();
        if (newTitle && newTitle !== this.activeNote.title && this.onTitleRenamed) {
          this.onTitleRenamed(this.activeNote.path, newTitle);
        }
      });
    }
  }

  checkWikilinkTrigger() {
    if (!this.textarea) return;
    const cursorPos = this.textarea.selectionStart;
    const textBefore = this.textarea.value.substring(0, cursorPos);
    const linkMatch = textBefore.match(/\[\[([^\]]*)$/);

    if (linkMatch) {
      const query = linkMatch[1];
      const ranked = this.getRankedGraphSuggestions(query).slice(0, 7);

      if (ranked.length > 0) {
        this.showAutocomplete(ranked);
      } else {
        this.hideAutocomplete();
      }
    } else {
      this.hideAutocomplete();
    }
  }

  showAutocomplete(rankedItems) {
    if (!this.autocompletePopup || !this.textarea) return;
    const rect = this.textarea.getBoundingClientRect();

    this.autocompletePopup.innerHTML = `
      <div class="wikilink-autocomplete-header">
        <span>Graph Link Suggestions</span>
        <span style="font-size: 9px; color: var(--accent-primary); font-weight: 600;">✦ GRAPH RANKED</span>
      </div>
      <div class="wikilink-autocomplete-list">
        ${rankedItems
          .map(
            (item, idx) => `
          <div class="wikilink-option ${idx === 0 ? "active" : ""}" data-title="${item.note.title}">
            <div class="wikilink-option-left">
              <span class="tree-dot ${item.note.type}"></span>
              <span style="font-weight: 500;">${item.note.title}</span>
            </div>
            <div class="wikilink-option-right">
              ${item.relationBadge ? `<span class="wikilink-rel-badge ${item.badgeClass}">✦ ${item.relationBadge}</span>` : ""}
              <span class="wikilink-conn-count">${item.connections} link${item.connections === 1 ? "" : "s"}</span>
            </div>
          </div>
        `
          )
          .join("")}
      </div>
      <div class="wikilink-autocomplete-footer">
        <span><kbd>↑↓</kbd> Select</span>
        <span><kbd>Enter</kbd> / <kbd>Tab</kbd> Link</span>
        <span><kbd>Esc</kbd> Close</span>
      </div>
    `;

    // Position popup near the editor
    const topPos = Math.min(window.innerHeight - 300, Math.max(10, rect.top + 50));
    const leftPos = Math.min(window.innerWidth - 340, Math.max(20, rect.left + 30));

    this.autocompletePopup.style.left = `${leftPos}px`;
    this.autocompletePopup.style.top = `${topPos}px`;
    this.autocompletePopup.style.display = "block";

    this.autocompletePopup.querySelectorAll(".wikilink-option").forEach((opt) => {
      opt.addEventListener("mousedown", (e) => {
        e.preventDefault();
        this.insertWikilinkOption(opt.getAttribute("data-title"));
      });
    });
  }

  hideAutocomplete() {
    if (this.autocompletePopup) {
      this.autocompletePopup.style.display = "none";
    }
  }

  handleAutocompleteKey(e) {
    const options = Array.from(this.autocompletePopup.querySelectorAll(".wikilink-option"));
    const activeIdx = options.findIndex((opt) => opt.classList.contains("active"));

    if (e.key === "ArrowDown") {
      e.preventDefault();
      const nextIdx = (activeIdx + 1) % options.length;
      options.forEach((o, i) => o.classList.toggle("active", i === nextIdx));
      options[nextIdx]?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const prevIdx = (activeIdx - 1 + options.length) % options.length;
      options.forEach((o, i) => o.classList.toggle("active", i === prevIdx));
      options[prevIdx]?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      if (options[activeIdx]) {
        this.insertWikilinkOption(options[activeIdx].getAttribute("data-title"));
      }
    } else if (e.key === "Escape") {
      this.hideAutocomplete();
    }
  }

  insertWikilinkOption(title) {
    if (!this.textarea) return;
    const cursorPos = this.textarea.selectionStart;
    const textBefore = this.textarea.value.substring(0, cursorPos);
    const textAfter = this.textarea.value.substring(cursorPos);
    const lastOpenIdx = textBefore.lastIndexOf("[[");

    if (lastOpenIdx !== -1) {
      const newText = textBefore.substring(0, lastOpenIdx) + `[[${title}]]` + textAfter;
      this.textarea.value = newText;
      const newCursor = lastOpenIdx + title.length + 4;
      this.textarea.selectionStart = this.textarea.selectionEnd = newCursor;
      this.textarea.focus();
      this.onContentChanged();
    }
    this.hideAutocomplete();
  }
}

window.MemoirEditor = MemoirEditor;
