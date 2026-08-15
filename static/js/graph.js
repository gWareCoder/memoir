/**
 * Memoir - Obsidian-Grade Force-Directed Knowledge Graph Engine
 * High-performance 60fps 2D Canvas physics simulation for Chapters, Topics, and Thoughts.
 */

class MemoirGraph {
  constructor(canvasId, tooltipId) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas ? this.canvas.getContext("2d") : null;
    this.tooltip = document.getElementById(tooltipId);

    this.nodes = [];
    this.edges = [];
    this.nodeMap = new Map();

    // Physics parameters
    this.repulsion = 400;
    this.linkDistance = 90;
    this.gravity = 0.05;
    this.damping = 0.88;

    // Viewport transform
    this.zoom = 1.0;
    this.panX = 0;
    this.panY = 0;

    // Interaction state
    this.isDragging = false;
    this.draggedNode = null;
    this.hoveredNode = null;
    this.activeNoteId = null;
    this.lastMousePos = { x: 0, y: 0 };
    this.isPanning = false;

    // Filters
    this.filterTypes = {
      chapter: true,
      topic: true,
      thought: true,
    };
    this.searchQuery = "";

    this.animationFrameId = null;
    this.onNodeClick = null; // (node) => void

    if (this.canvas) {
      this.initEvents();
      this.resize();
      window.addEventListener("resize", () => this.resize());
    }
  }

  resize() {
    if (!this.canvas) return;
    const rect = this.canvas.parentElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.width = rect.width;
    this.height = rect.height;
    this.canvas.width = this.width * dpr;
    this.canvas.height = this.height * dpr;
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;
    this.ctx.scale(dpr, dpr);

    if (this.panX === 0 && this.panY === 0) {
      this.centerView();
    }
  }

  centerView() {
    this.panX = this.width / 2;
    this.panY = this.height / 2;
    this.zoom = 1.0;
  }

  setData(graphData, activeNoteId = null) {
    this.activeNoteId = activeNoteId;
    const rawNodes = graphData.nodes || [];
    const rawEdges = graphData.edges || [];

    // Preserve existing node positions if available
    const oldPositions = new Map();
    this.nodes.forEach((n) => oldPositions.set(n.id, { x: n.x, y: n.y, vx: n.vx, vy: n.vy }));

    this.nodeMap.clear();
    this.nodes = rawNodes.map((n) => {
      const old = oldPositions.get(n.id);
      const angle = Math.random() * Math.PI * 2;
      const radius = 60 + Math.random() * 140;

      let baseRadius = 11;
      let color = "#f59e0b"; // thought default
      let glowColor = "rgba(245, 158, 11, 0.4)";

      if (n.type === "chapter") {
        baseRadius = 20;
        color = "#a855f7";
        glowColor = "rgba(168, 85, 247, 0.5)";
      } else if (n.type === "topic") {
        baseRadius = 15;
        color = "#10b981";
        glowColor = "rgba(16, 185, 129, 0.5)";
      }

      const nodeObj = {
        id: n.id,
        title: n.title,
        type: n.type,
        tags: n.tags || [],
        wordCount: n.wordCount || 0,
        connections: n.connections || 0,
        x: old ? old.x : Math.cos(angle) * radius,
        y: old ? old.y : Math.sin(angle) * radius,
        vx: old ? old.vx : (Math.random() - 0.5) * 2,
        vy: old ? old.vy : (Math.random() - 0.5) * 2,
        radius: baseRadius,
        color: color,
        glowColor: glowColor,
        isPinned: false,
      };

      this.nodeMap.set(n.id, nodeObj);
      return nodeObj;
    });

    // Edges
    this.edges = rawEdges
      .map((e) => {
        const sourceNode = this.nodeMap.get(e.source);
        const targetNode = this.nodeMap.get(e.target);
        if (sourceNode && targetNode) {
          return {
            source: sourceNode,
            target: targetNode,
            type: e.type || "structural",
          };
        }
        return null;
      })
      .filter(Boolean);

    this.startSimulation();
  }

  setActiveNote(noteId) {
    this.activeNoteId = noteId;
  }

  startSimulation() {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
    }

    const step = () => {
      this.updatePhysics();
      this.draw();
      this.animationFrameId = requestAnimationFrame(step);
    };
    this.animationFrameId = requestAnimationFrame(step);
  }

  updatePhysics() {
    const visibleNodes = this.nodes.filter((n) => this.filterTypes[n.type]);

    // 1. Repulsion between visible nodes
    for (let i = 0; i < visibleNodes.length; i++) {
      const n1 = visibleNodes[i];
      for (let j = i + 1; j < visibleNodes.length; j++) {
        const n2 = visibleNodes[j];
        const dx = n2.x - n1.x;
        const dy = n2.y - n1.y;
        let distSq = dx * dx + dy * dy;
        if (distSq < 1) distSq = 1;
        const dist = Math.sqrt(distSq);

        const force = (this.repulsion * 100) / distSq;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;

        if (!n1.isPinned) {
          n1.vx -= fx;
          n1.vy -= fy;
        }
        if (!n2.isPinned) {
          n2.vx += fx;
          n2.vy += fy;
        }
      }
    }

    // 2. Spring force along edges
    for (let i = 0; i < this.edges.length; i++) {
      const edge = this.edges[i];
      if (!this.filterTypes[edge.source.type] || !this.filterTypes[edge.target.type]) continue;

      const dx = edge.target.x - edge.source.x;
      const dy = edge.target.y - edge.source.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const diff = dist - this.linkDistance;
      const force = diff * 0.04;

      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;

      if (!edge.source.isPinned) {
        edge.source.vx += fx;
        edge.source.vy += fy;
      }
      if (!edge.target.isPinned) {
        edge.target.vx -= fx;
        edge.target.vy -= fy;
      }
    }

    // 3. Center gravity & update position
    for (let i = 0; i < visibleNodes.length; i++) {
      const n = visibleNodes[i];
      if (n.isPinned) continue;

      // Pull toward origin (0, 0)
      n.vx -= n.x * this.gravity * 0.02;
      n.vy -= n.y * this.gravity * 0.02;

      // Apply damping
      n.vx *= this.damping;
      n.vy *= this.damping;

      // Cap speed
      const speed = Math.sqrt(n.vx * n.vx + n.vy * n.vy);
      if (speed > 15) {
        n.vx = (n.vx / speed) * 15;
        n.vy = (n.vy / speed) * 15;
      }

      n.x += n.vx;
      n.y += n.vy;
    }
  }

  draw() {
    if (!this.ctx) return;
    this.ctx.clearRect(0, 0, this.width, this.height);

    this.ctx.save();
    // Apply pan & zoom
    this.ctx.translate(this.panX, this.panY);
    this.ctx.scale(this.zoom, this.zoom);

    // Compute neighbors for hover highlighting
    const neighborIds = new Set();
    if (this.hoveredNode) {
      neighborIds.add(this.hoveredNode.id);
      this.edges.forEach((e) => {
        if (e.source.id === this.hoveredNode.id) neighborIds.add(e.target.id);
        if (e.target.id === this.hoveredNode.id) neighborIds.add(e.source.id);
      });
    }

    // 1. Draw Edges
    for (let i = 0; i < this.edges.length; i++) {
      const edge = this.edges[i];
      if (!this.filterTypes[edge.source.type] || !this.filterTypes[edge.target.type]) continue;

      const isConnectedToHover = this.hoveredNode && (edge.source.id === this.hoveredNode.id || edge.target.id === this.hoveredNode.id);
      const isDimmed = this.hoveredNode && !isConnectedToHover;

      this.ctx.beginPath();
      this.ctx.moveTo(edge.source.x, edge.source.y);
      this.ctx.lineTo(edge.target.x, edge.target.y);

      if (edge.type === "structural") {
        this.ctx.strokeStyle = isConnectedToHover
          ? "rgba(168, 85, 247, 0.9)"
          : isDimmed
          ? "rgba(75, 79, 110, 0.12)"
          : "rgba(75, 79, 110, 0.4)";
        this.ctx.lineWidth = isConnectedToHover ? 2.5 : 1.2;
        this.ctx.setLineDash([]);
      } else {
        // Wikilink / Cross-thought link (dashed)
        this.ctx.strokeStyle = isConnectedToHover
          ? "rgba(56, 189, 248, 0.9)"
          : isDimmed
          ? "rgba(56, 189, 248, 0.1)"
          : "rgba(56, 189, 248, 0.35)";
        this.ctx.lineWidth = isConnectedToHover ? 2 : 1;
        this.ctx.setLineDash([4, 4]);
      }

      this.ctx.stroke();
      this.ctx.setLineDash([]);
    }

    // 2. Draw Nodes
    const visibleNodes = this.nodes.filter((n) => this.filterTypes[n.type]);

    for (let i = 0; i < visibleNodes.length; i++) {
      const node = visibleNodes[i];
      const isHovered = this.hoveredNode && this.hoveredNode.id === node.id;
      const isNeighbor = neighborIds.has(node.id);
      const isActive = this.activeNoteId === node.id;
      const isDimmed = this.hoveredNode && !isNeighbor;
      const matchesSearch = !this.searchQuery || node.title.toLowerCase().includes(this.searchQuery.toLowerCase());

      const alpha = isDimmed || !matchesSearch ? 0.18 : 1.0;
      const r = node.radius * (isHovered ? 1.25 : 1.0);

      // Glowing Halo
      if (!isDimmed && (isActive || isHovered || node.type === "chapter")) {
        this.ctx.beginPath();
        this.ctx.arc(node.x, node.y, r + (isActive ? 8 : 5), 0, Math.PI * 2);
        this.ctx.fillStyle = isActive ? "rgba(99, 102, 241, 0.4)" : node.glowColor;
        this.ctx.fill();
      }

      // Main Node Circle
      this.ctx.beginPath();
      this.ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
      this.ctx.fillStyle = node.color;
      this.ctx.globalAlpha = alpha;
      this.ctx.fill();

      // Node Border
      this.ctx.strokeStyle = isActive ? "#ffffff" : isHovered ? "#ffffff" : "rgba(255, 255, 255, 0.3)";
      this.ctx.lineWidth = isActive ? 2.5 : isHovered ? 2 : 1;
      this.ctx.stroke();
      this.ctx.globalAlpha = 1.0;

      // Label (Show if zoom > 0.6 or if hovered/active)
      if (this.zoom > 0.55 || isHovered || isActive || node.type === "chapter") {
        this.ctx.font = `${node.type === "chapter" ? "600 12px" : "500 11px"} Inter, sans-serif`;
        this.ctx.textAlign = "center";
        this.ctx.textBaseline = "top";

        const text = node.title.length > 24 ? node.title.slice(0, 22) + "..." : node.title;

        // Label Background Pill
        const metrics = this.ctx.measureText(text);
        const padX = 5;
        const padY = 2;
        const labelY = node.y + r + 4;

        this.ctx.fillStyle = isHovered ? "rgba(21, 22, 30, 0.95)" : "rgba(15, 16, 21, 0.75)";
        this.ctx.globalAlpha = alpha;
        this.ctx.beginPath();
        this.ctx.roundRect(
          node.x - metrics.width / 2 - padX,
          labelY - padY,
          metrics.width + padX * 2,
          14 + padY * 2,
          4
        );
        this.ctx.fill();

        this.ctx.fillStyle = isHovered ? "#ffffff" : "#d1d5db";
        this.ctx.fillText(text, node.x, labelY);
        this.ctx.globalAlpha = 1.0;
      }
    }

    this.ctx.restore();
  }

  screenToWorld(screenX, screenY) {
    return {
      x: (screenX - this.panX) / this.zoom,
      y: (screenY - this.panY) / this.zoom,
    };
  }

  getNodeAt(worldX, worldY) {
    for (let i = this.nodes.length - 1; i >= 0; i--) {
      const node = this.nodes[i];
      if (!this.filterTypes[node.type]) continue;
      const dx = worldX - node.x;
      const dy = worldY - node.y;
      if (dx * dx + dy * dy <= (node.radius + 6) * (node.radius + 6)) {
        return node;
      }
    }
    return null;
  }

  initEvents() {
    this.canvas.addEventListener("mousedown", (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      const world = this.screenToWorld(mouseX, mouseY);
      const clicked = this.getNodeAt(world.x, world.y);

      if (clicked) {
        this.isDragging = true;
        this.draggedNode = clicked;
        clicked.isPinned = true;
      } else {
        this.isPanning = true;
      }
      this.lastMousePos = { x: mouseX, y: mouseY };
    });

    window.addEventListener("mousemove", (e) => {
      if (!this.canvas) return;
      const rect = this.canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      if (this.isDragging && this.draggedNode) {
        const world = this.screenToWorld(mouseX, mouseY);
        this.draggedNode.x = world.x;
        this.draggedNode.y = world.y;
        this.draggedNode.vx = 0;
        this.draggedNode.vy = 0;
      } else if (this.isPanning) {
        const dx = mouseX - this.lastMousePos.x;
        const dy = mouseY - this.lastMousePos.y;
        this.panX += dx;
        this.panY += dy;
        this.lastMousePos = { x: mouseX, y: mouseY };
      } else {
        // Hover detection
        if (mouseX >= 0 && mouseX <= this.width && mouseY >= 0 && mouseY <= this.height) {
          const world = this.screenToWorld(mouseX, mouseY);
          const found = this.getNodeAt(world.x, world.y);
          if (found !== this.hoveredNode) {
            this.hoveredNode = found;
            this.updateTooltip(found, e.clientX, e.clientY);
          } else if (found) {
            this.positionTooltip(e.clientX, e.clientY);
          }
        } else if (this.hoveredNode) {
          this.hoveredNode = null;
          this.hideTooltip();
        }
      }
    });

    window.addEventListener("mouseup", (e) => {
      if (this.isDragging && this.draggedNode) {
        this.draggedNode.isPinned = false;
      }
      this.isDragging = false;
      this.draggedNode = null;
      this.isPanning = false;
    });

    this.canvas.addEventListener("click", (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      const world = this.screenToWorld(mouseX, mouseY);
      const clicked = this.getNodeAt(world.x, world.y);

      if (clicked && this.onNodeClick) {
        this.onNodeClick(clicked);
      }
    });

    this.canvas.addEventListener("wheel", (e) => {
      e.preventDefault();
      const zoomFactor = e.deltaY < 0 ? 1.12 : 0.89;
      const rect = this.canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const newZoom = Math.max(0.2, Math.min(3.5, this.zoom * zoomFactor));

      // Zoom towards mouse pointer
      this.panX = mouseX - (mouseX - this.panX) * (newZoom / this.zoom);
      this.panY = mouseY - (mouseY - this.panY) * (newZoom / this.zoom);
      this.zoom = newZoom;
    }, { passive: false });
  }

  updateTooltip(node, clientX, clientY) {
    if (!this.tooltip) return;
    if (!node) {
      this.hideTooltip();
      return;
    }

    const typeIcons = { chapter: "📖", topic: "🌿", thought: "💡" };
    const typeIcon = typeIcons[node.type] || "📄";

    this.tooltip.innerHTML = `
      <div class="tooltip-title">${typeIcon} ${node.title}</div>
      <div class="tooltip-meta">
        <span class="type-pill ${node.type}">${node.type}</span>
        <span>${node.wordCount} words</span>
      </div>
      <div class="tooltip-connections">🔗 ${node.connections} connected link${node.connections === 1 ? "" : "s"}</div>
    `;

    this.tooltip.style.display = "block";
    this.positionTooltip(clientX, clientY);
  }

  positionTooltip(clientX, clientY) {
    if (!this.tooltip) return;
    this.tooltip.style.left = `${clientX + 14}px`;
    this.tooltip.style.top = `${clientY + 14}px`;
  }

  hideTooltip() {
    if (this.tooltip) {
      this.tooltip.style.display = "none";
    }
  }

  zoomIn() {
    this.zoom = Math.min(3.5, this.zoom * 1.25);
  }

  zoomOut() {
    this.zoom = Math.max(0.2, this.zoom * 0.8);
  }
}

window.MemoirGraph = MemoirGraph;
