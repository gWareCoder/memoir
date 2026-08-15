/**
 * Memoir - Semantic Link Engine & Inspector Controller
 * Computes related thought heuristics, backlink trees, and renders the right sidebar inspector.
 */

class LinkEngine {
  constructor() {
    this.activeNote = null;
    this.vaultData = null;
    this.miniGraphCanvas = null;
    this.miniGraphCtx = null;
  }

  init(vaultData) {
    this.vaultData = vaultData;
    this.miniGraphCanvas = document.getElementById("mini-graph-canvas");
    if (this.miniGraphCanvas) {
      this.miniGraphCtx = this.miniGraphCanvas.getContext("2d");
    }
  }

  updateActiveNote(note, vaultData) {
    this.activeNote = note;
    if (vaultData) this.vaultData = vaultData;
    this.renderInspector();
  }

  async renderInspector() {
    if (!this.activeNote) {
      this.clearInspector();
      return;
    }

    const note = this.activeNote;

    // 1. Parent Context
    const parentContainer = document.getElementById("parent-context-container");
    if (parentContainer) {
      const chapter = note.frontmatter ? note.frontmatter.chapter : null;
      const topic = note.frontmatter ? note.frontmatter.topic : null;

      let html = "";
      if (chapter) {
        html += `<div style="margin-bottom: 4px;">📖 <strong>Chapter:</strong> <span class="wikilink-chip" data-target="${chapter.replace(/\[\[|\]\]/g, "")}">${chapter}</span></div>`;
      }
      if (topic) {
        html += `<div>🌿 <strong>Topic:</strong> <span class="wikilink-chip" data-target="${topic.replace(/\[\[|\]\]/g, "")}">${topic}</span></div>`;
      }
      if (!chapter && !topic) {
        html = `<div style="color: var(--text-muted); font-size: 12px;">Top-level note (No parent)</div>`;
      }
      parentContainer.innerHTML = html;

      parentContainer.querySelectorAll(".wikilink-chip").forEach((el) => {
        el.addEventListener("click", () => {
          const target = el.getAttribute("data-target");
          if (window.app && target) window.app.openNoteById(target);
        });
      });
    }

    // 2. Backlinks List
    const backlinkContainer = document.getElementById("backlinks-list");
    if (backlinkContainer) {
      const backlinks = note.backlinks || [];
      if (backlinks.length === 0) {
        backlinkContainer.innerHTML = `<li style="color: var(--text-muted); font-size: 12px; font-style: italic;">No incoming backlinks</li>`;
      } else {
        backlinkContainer.innerHTML = backlinks
          .map(
            (b) => `
          <li class="backlink-item" data-id="${b.id}">
            <div style="display: flex; align-items: center; gap: 6px; font-weight: 600; font-size: 12px;">
              <span class="tree-dot ${b.type}"></span>
              <span>${b.title}</span>
            </div>
          </li>
        `
          )
          .join("");

        backlinkContainer.querySelectorAll(".backlink-item").forEach((el) => {
          el.addEventListener("click", () => {
            const id = el.getAttribute("data-id");
            if (window.app && id) window.app.openNoteById(id);
          });
        });
      }
    }

    // 3. Related Thoughts Heuristic Suggestions
    const relatedContainer = document.getElementById("related-thoughts-list");
    if (relatedContainer) {
      const related = await window.storageService.findRelatedThoughts(note.body || "", note.id);

      if (related.length === 0) {
        relatedContainer.innerHTML = `<li style="color: var(--text-muted); font-size: 12px; font-style: italic;">No related thoughts detected</li>`;
      } else {
        relatedContainer.innerHTML = related
          .map(
            (r) => `
          <li class="related-thought-item" data-id="${r.id}">
            <div class="related-header">
              <span>💡 ${r.title}</span>
              <span class="similarity-badge">${Math.round(r.score * 100)}% match</span>
            </div>
            <div class="related-snippet">${r.excerpt}</div>
            <button class="link-action-btn" data-link-target="${r.title}">+ Link in Note</button>
          </li>
        `
          )
          .join("");

        relatedContainer.querySelectorAll(".related-thought-item").forEach((el) => {
          el.addEventListener("click", (e) => {
            if (e.target.classList.contains("link-action-btn")) return;
            const id = el.getAttribute("data-id");
            if (window.app && id) window.app.openNoteById(id);
          });
        });

        relatedContainer.querySelectorAll(".link-action-btn").forEach((btn) => {
          btn.addEventListener("click", (e) => {
            e.stopPropagation();
            const target = btn.getAttribute("data-link-target");
            if (window.app && target) {
              window.app.editor.appendSpeechText(`\n- Related: [[${target}]]`);
              window.app.showToast(`Linked [[${target}]]`, "thought");
            }
          });
        });
      }
    }

    // 4. Render Local Mini-Graph
    this.renderMiniGraph();
  }

  clearInspector() {
    const parentContainer = document.getElementById("parent-context-container");
    const backlinkContainer = document.getElementById("backlinks-list");
    const relatedContainer = document.getElementById("related-thoughts-list");

    if (parentContainer) parentContainer.innerHTML = "";
    if (backlinkContainer) backlinkContainer.innerHTML = "";
    if (relatedContainer) relatedContainer.innerHTML = "";

    if (this.miniGraphCtx && this.miniGraphCanvas) {
      this.miniGraphCtx.clearRect(0, 0, this.miniGraphCanvas.width, this.miniGraphCanvas.height);
    }
  }

  renderMiniGraph() {
    if (!this.miniGraphCanvas || !this.miniGraphCtx || !this.activeNote || !this.vaultData) return;

    const canvas = this.miniGraphCanvas;
    const ctx = this.miniGraphCtx;
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);

    const w = rect.width;
    const h = rect.height;
    ctx.clearRect(0, 0, w, h);

    if (!this.activeNote || !this.vaultData) {
      ctx.font = "11px Inter, sans-serif";
      ctx.fillStyle = "#64698b";
      ctx.textAlign = "center";
      ctx.fillText("Select a note to view local graph", w / 2, h / 2);
      return;
    }

    const activeId = this.activeNote.id;
    const edges = this.vaultData.graph.edges || [];
    const nodes = this.vaultData.graph.nodes || [];

    // Filter to 1-hop neighborhood
    const connectedEdges = edges.filter((e) => e.source === activeId || e.target === activeId);
    const neighborIds = new Set([activeId]);
    connectedEdges.forEach((e) => {
      neighborIds.add(e.source);
      neighborIds.add(e.target);
    });

    const subNodes = nodes.filter((n) => neighborIds.has(n.id));

    // Place active node in center
    const positions = new Map();
    positions.set(activeId, { x: w / 2, y: h / 2, type: this.activeNote.type, title: this.activeNote.title });

    const others = subNodes.filter((n) => n.id !== activeId);
    const angleStep = (Math.PI * 2) / (others.length || 1);
    const radius = Math.min(w, h) * 0.36;

    others.forEach((n, idx) => {
      const angle = idx * angleStep;
      positions.set(n.id, {
        x: w / 2 + Math.cos(angle) * radius,
        y: h / 2 + Math.sin(angle) * radius,
        type: n.type,
        title: n.title,
      });
    });

    // Draw Edges
    connectedEdges.forEach((e) => {
      const p1 = positions.get(e.source);
      const p2 = positions.get(e.target);
      if (p1 && p2) {
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.strokeStyle = "rgba(99, 102, 241, 0.4)";
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    });

    // Draw Nodes
    positions.forEach((p, id) => {
      const isActive = id === activeId;
      const r = isActive ? 12 : 8;

      let color = "#f59e0b";
      if (p.type === "chapter") color = "#a855f7";
      if (p.type === "topic") color = "#10b981";

      if (isActive) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, r + 4, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(99, 102, 241, 0.3)";
        ctx.fill();
      }

      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = isActive ? 2 : 1;
      ctx.stroke();

      // Label
      ctx.font = "10px Inter, sans-serif";
      ctx.fillStyle = isActive ? "#ffffff" : "#9da3be";
      ctx.textAlign = "center";
      const shortTitle = p.title.length > 14 ? p.title.slice(0, 12) + ".." : p.title;
      ctx.fillText(shortTitle, p.x, p.y + r + 11);
    });
  }
}

window.LinkEngine = LinkEngine;
