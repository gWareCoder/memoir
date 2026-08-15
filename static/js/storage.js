/**
 * Memoir - Storage & API Synchronization Engine
 * Handles REST communication with Python backend and fallback offline storage.
 */

class StorageService {
  constructor() {
    this.apiBase = window.location.origin;
    this.isOnline = true;
    this.localCache = null;
  }

  async getStatus() {
    try {
      const res = await fetch(`${this.apiBase}/api/status`);
      if (res.ok) {
        this.isOnline = true;
        return await res.json();
      }
    } catch (e) {
      this.isOnline = false;
    }
    return { status: "offline", app: "Memoir" };
  }

  async fetchVault() {
    try {
      const res = await fetch(`${this.apiBase}/api/vault`);
      if (res.ok) {
        const data = await res.json();
        this.localCache = data;
        localStorage.setItem("memoir_vault_cache", JSON.stringify(data));
        return data;
      }
    } catch (e) {
      console.warn("Using cached vault due to network error:", e);
    }

    // Fallback from localStorage
    const cached = localStorage.getItem("memoir_vault_cache");
    if (cached) {
      return JSON.parse(cached);
    }

    return { notes: [], graph: { nodes: [], edges: [] }, stats: {} };
  }

  async fetchNote(folder, filename) {
    try {
      const res = await fetch(`${this.apiBase}/api/note/${folder}/${encodeURIComponent(filename)}`);
      if (res.ok) {
        return await res.json();
      }
    } catch (e) {
      console.error("Error fetching note:", e);
    }
    return null;
  }

  async saveNote(noteData) {
    try {
      const res = await fetch(`${this.apiBase}/api/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(noteData),
      });
      if (res.ok) {
        return await res.json();
      }
    } catch (e) {
      console.error("Error saving note:", e);
    }
    return { success: false, error: "Network or Server error" };
  }

  async appendToNote(path, text) {
    try {
      const res = await fetch(`${this.apiBase}/api/notes/append`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path, text }),
      });
      if (res.ok) {
        return await res.json();
      }
    } catch (e) {
      console.error("Error appending to note:", e);
    }
    return { success: false };
  }

  async findRelatedThoughts(text, excludeId = "") {
    try {
      const res = await fetch(`${this.apiBase}/api/find_related`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, excludeId }),
      });
      if (res.ok) {
        const data = await res.json();
        return data.related || [];
      }
    } catch (e) {
      console.error("Error finding related thoughts:", e);
    }
    return [];
  }

  async renameNote(oldPath, newTitle) {
    try {
      const res = await fetch(`${this.apiBase}/api/notes/rename`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ oldPath, newTitle }),
      });
      if (res.ok) {
        return await res.json();
      }
    } catch (e) {
      console.error("Error renaming note:", e);
    }
    return { success: false };
  }

  async deleteNote(path) {
    try {
      const res = await fetch(`${this.apiBase}/api/notes/delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path }),
      });
      if (res.ok) {
        return await res.json();
      }
    } catch (e) {
      console.error("Error deleting note:", e);
    }
    return { success: false };
  }

  getExportUrl() {
    return `${this.apiBase}/api/export`;
  }
}

window.storageService = new StorageService();
