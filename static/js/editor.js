/**
 * Memoir - Markdown Editor, Live Preview & Wikilink Resolver Engine
 * Supports bi-directional wikilinks, syntax highlighting, autocompletion, and live voice text streaming.
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

    // Callbacks
    this.onNoteSaved = null;      // (noteData) => void
    this.onWikilinkClicked = null; // (targetTitle) => void
    this.onTitleRenamed = null;   // (oldPath, newTitle) => void

    this.initAutocomplete();
    this.initEvents();
  }

  setVaultNotes(notes) {
    this.allVaultNotes = notes || [];
  }

  loadNote(note) {
    this.activeNote = note;
    if (!note) {
      if (this.titleInput) this.titleInput.value = "";
      if (this.textarea) this.textarea.value = "";
      if (this.preview) this.preview.innerHTML = `<div style="color: var(--text-muted); font-style: italic; padding: 40px; text-align: center;">No note selected. Select a note from the sidebar or click the graph.</div>`;
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
  }

  parseMarkdown(md) {
    let text = md;

    // Escape basic HTML
    text = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

    // Code blocks ```code```
    text = text.replace(/```([\s\S]*?)```/g, (match, code) => {
      return `<pre><code>${code.trim()}</code></pre>`;
    });

    // Inline code `code`
    text = text.replace(/`([^`]+)`/g, "<code>$1</code>");

    // Headers
    text = text.replace(/^### (.*$)/gim, "<h3>$1</h3>");
    text = text.replace(/^## (.*$)/gim, "<h2>$1</h2>");
    text = text.replace(/^# (.*$)/gim, "<h1>$1</h1>");

    // Blockquotes
    text = text.replace(/^\> (.*$)/gim, "<blockquote>$1</blockquote>");

    // Bold & Italic
    text = text.replace(/\*\*\*(.*?)\*\*\*/g, "<strong><em>$1</em></strong>");
    text = text.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
    text = text.replace(/\*(.*?)\*/g, "<em>$1</em>");

    // Wikilinks [[Target]] or [[Target|Alias]]
    text = text.replace(/\[\[(.*?)\]\]/g, (match, inner) => {
      const parts = inner.split("|");
      const target = parts[0].trim();
      const alias = parts[1] ? parts[1].trim() : target;
      return `<span class="wikilink-chip" data-target="${target}">🔗 ${alias}</span>`;
    });

    // Tags #tag
    text = text.replace(/(?<!\w)#([a-zA-Z0-9_\-]+)/g, '<span class="tag-chip">#$1</span>');

    // Bullet lists
    text = text.replace(/^\s*-\s+(.*$)/gim, "<li>$1</li>");
    text = text.replace(/(<li>.*<\/li>)/s, "<ul>$1</ul>");

    // Paragraphs
    const lines = text.split("\n\n");
    const formatted = lines
      .map((block) => {
        block = block.trim();
        if (!block) return "";
        if (block.startsWith("<h") || block.startsWith("<pre") || block.startsWith("<ul") || block.startsWith("<blockquote")) {
          return block;
        }
        return `<p>${block.replace(/\n/g, "<br>")}</p>`;
      })
      .join("\n");

    return formatted;
  }

  insertFormat(prefix, suffix = "") {
    if (!this.textarea) return;
    const start = this.textarea.selectionStart;
    const end = this.textarea.selectionEnd;
    const val = this.textarea.value;
    const selected = val.substring(start, end);

    const replacement = prefix + selected + suffix;
    this.textarea.value = val.substring(0, start) + replacement + val.substring(end);
    this.textarea.focus();
    this.textarea.selectionStart = start + prefix.length;
    this.textarea.selectionEnd = start + prefix.length + selected.length;

    this.onContentChanged();
  }

  appendSpeechText(speechText) {
    if (!this.textarea || !speechText) return;
    const val = this.textarea.value;
    const trimmed = speechText.trim();

    // Check if we append at end or at cursor
    const start = this.textarea.selectionStart;
    const end = this.textarea.selectionEnd;

    let insertion = trimmed;
    if (val.length > 0 && !val.endsWith("\n") && !val.endsWith(" ")) {
      insertion = " " + insertion;
    }

    if (start !== end || start < val.length) {
      this.textarea.value = val.substring(0, start) + insertion + val.substring(end);
      this.textarea.selectionStart = this.textarea.selectionEnd = start + insertion.length;
    } else {
      this.textarea.value = val + (val.endsWith("\n") ? "" : " ") + trimmed;
      this.textarea.selectionStart = this.textarea.selectionEnd = this.textarea.value.length;
    }

    this.onContentChanged();
    this.textarea.scrollTop = this.textarea.scrollHeight;
  }

  onContentChanged() {
    this.isDirty = true;
    const content = this.textarea.value;
    this.renderPreview(content);
    this.updateStats(content);

    // Debounced Auto-Save
    clearTimeout(this.saveTimeout);
    this.saveTimeout = setTimeout(() => {
      this.saveCurrentNote();
    }, 800);
  }

  updateStats(content) {
    const wordCountEl = document.getElementById("note-word-count");
    const readTimeEl = document.getElementById("note-read-time");
    const words = (content.match(/\b\w+\b/g) || []).length;
    const readTime = Math.ceil(words / 180);

    if (wordCountEl) wordCountEl.textContent = `${words} words`;
    if (readTimeEl) readTimeEl.textContent = `${readTime} min read`;
  }

  async saveCurrentNote() {
    if (!this.activeNote || !this.isDirty) return;
    const content = this.textarea.value;
    const title = this.titleInput ? this.titleInput.value.trim() : this.activeNote.title;

    const payload = {
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

  initAutocomplete() {
    this.autocompletePopup = document.createElement("div");
    this.autocompletePopup.className = "wikilink-autocomplete";
    document.body.appendChild(this.autocompletePopup);
  }

  initEvents() {
    if (this.textarea) {
      this.textarea.addEventListener("input", (e) => {
        this.onContentChanged();
        this.checkWikilinkTrigger();
      });

      this.textarea.addEventListener("keydown", (e) => {
        if (this.autocompletePopup && this.autocompletePopup.style.display === "block") {
          if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === "Escape") {
            this.handleAutocompleteKey(e);
          }
        }
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
      const query = linkMatch[1].toLowerCase();
      const matches = this.allVaultNotes.filter((n) => n.title.toLowerCase().includes(query)).slice(0, 6);

      if (matches.length > 0) {
        this.showAutocomplete(matches);
      } else {
        this.hideAutocomplete();
      }
    } else {
      this.hideAutocomplete();
    }
  }

  showAutocomplete(notes) {
    if (!this.autocompletePopup || !this.textarea) return;
    const rect = this.textarea.getBoundingClientRect();

    this.autocompletePopup.innerHTML = notes
      .map(
        (n, idx) => `
        <div class="wikilink-option ${idx === 0 ? "active" : ""}" data-title="${n.title}">
          <span class="tree-dot ${n.type}"></span>
          <span>${n.title}</span>
        </div>
      `
      )
      .join("");

    this.autocompletePopup.style.left = `${rect.left + 40}px`;
    this.autocompletePopup.style.top = `${rect.top + 60}px`;
    this.autocompletePopup.style.display = "block";

    this.autocompletePopup.querySelectorAll(".wikilink-option").forEach((opt) => {
      opt.addEventListener("click", () => {
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
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const prevIdx = (activeIdx - 1 + options.length) % options.length;
      options.forEach((o, i) => o.classList.toggle("active", i === prevIdx));
    } else if (e.key === "Enter") {
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
