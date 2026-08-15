/**
 * Memoir - Vault Exporter & Importer
 * Handles downloading full Obsidian vault as zip, saving individual Markdown files, and importing notes.
 */

class Exporter {
  constructor() {}

  downloadFullVaultZip() {
    const url = window.storageService.getExportUrl();
    const link = document.createElement("a");
    link.href = url;
    link.download = `memoir_vault_${Date.now()}.zip`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  downloadCurrentNote(note) {
    if (!note) return;
    const blob = new Blob([note.content || note.body || ""], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${note.title || "note"}.md`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }
}

window.exporter = new Exporter();
