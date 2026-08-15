# 🧠 Memoir — Voice-Driven Connected Thought Vault

[![License: MIT](https://img.shields.io/badge/License-MIT-purple.svg)](https://opensource.org/licenses/MIT)
[![Obsidian Compatible](https://img.shields.io/badge/Obsidian-Compatible-7c3aed.svg)](https://obsidian.md)
[![Python 3.10+](https://img.shields.io/badge/Python-3.10%2B-blue.svg)](https://www.python.org/)
[![Local Voice STT](https://img.shields.io/badge/Voice%20STT-Zero%20Latency%20Local-emerald.svg)]()

**Memoir** is a local voice transcription application and connected knowledge graph vault inspired by **Obsidian**. It captures your stream of consciousness in real time hands-free, automatically parsing structural voice commands to build an interconnected Markdown knowledge base of **Chapters**, **Topics**, and **Thoughts**.

---

## 🌟 Core Architecture & Topology

```
                  ┌───────────────────────────────┐
                  │ 🎙️ Continuous Voice Capture   │
                  │ (Live STT + Web Audio Canvas) │
                  └───────────────┬───────────────┘
                                  │
                  ┌───────────────▼───────────────┐
                  │   Natural Language Parser     │
                  │   ("chapter", "topic", etc.)  │
                  └───────────────┬───────────────┘
                                  │
         ┌────────────────────────┼────────────────────────┐
         │                        │                        │
         ▼                        ▼                        ▼
┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐
│  🟣 CHAPTER      │    │  🟢 TOPIC        │    │  🟠 THOUGHT      │
│  "Chapter 1..."  ├────►  "Topic A..."    ├────►  "Thought X..."  │
│  Top-level Note  │    │  [[Chapter Link]]│    │  [[Topic Link]]  │
└──────────────────┘    └──────────────────┘    └────────┬─────────┘
                                                         │
                                               Auto-Discovered Links
                                                         ▼
                                                [[Related Thought Y]]
```

---

## ✨ Key Features

### 1. 🎙️ Continuous Local Voice Transcription
- Real-time speech recognition with zero cloud dependency.
- Live audio waveform visualizer and speech confidence indicators.
- Hands-free dictation that streams transcribed sentences directly into the active note.
- Subtle Web Audio harmonic synthesizer chimes on command recognition.

### 2. 🗣️ Smart Voice Triggers & Intent Parsing
- 📖 **"Chapter [Title]"** or **"New Chapter [Title]"**: Starts a new top-level Chapter markdown note (`.md`) and establishes active chapter context.
- 🌿 **"Topic [Title]"** or **"New Topic [Title]"**: Creates a Topic note automatically linked to the active Chapter with `[[Chapter Name]]`.
- 💡 **"Thought [Text/Idea]"** or **"New Thought [Text]"**: Creates an atomic Thought note linked to the active Topic & Chapter, and scans the vault to find and link related thoughts.
- 🔗 **"Link to [Note Name]"**: Dynamically inserts a bi-directional `[[Note Name]]` wikilink.
- 🏷️ **"Tag [Keyword]"**: Adds a `#keyword` tag to the document.
- ⏸️ **"Pause recording" / "Stop transcription"**: Toggles off listening hands-free.

### 3. 🌐 Obsidian-Grade Interactive Knowledge Graph
- 60 FPS 2D Canvas force-directed physics simulation with particle repulsion, link tension, and gravitational centering.
- Color-coded glowing halos:
  - 🟣 **Chapters** (Violet / Amethyst nodes)
  - 🟢 **Topics** (Emerald / Teal nodes)
  - 🟠 **Thoughts** (Amber / Coral nodes)
- Dynamic hover preview cards showing note summary, word count, and connection counts.
- Interactive zoom, pan, drag-to-pin, search filtering, and node click-to-edit.
- Right-sidebar **Local Graph Mini-Map** showing the 1-hop neighborhood of the active note.

### 4. 📝 Bi-directional Markdown Editor & Live Preview
- Real-time preview with syntax highlighting, blockquotes, code blocks, lists, and tags.
- Full Obsidian-compatible `[[wikilinks]]` with click-to-navigate and autocomplete popup when typing `[[`.
- Live word count and estimated reading time.
- Automatic note renaming with global wikilink refactoring across all notes.

### 5. ⚡ Semantic Related Thoughts Engine
- Algorithmic keyword and concept similarity analysis that detects serendipitous connections between thoughts across your vault.
- 1-click **"+ Link in Note"** suggestions in the inspector sidebar.

### 6. 📁 100% Local & Obsidian Compatible
- Notes are stored directly as standard `.md` Markdown files in `~/memoir/vault/`.
- You can open the `vault/` folder directly in Obsidian, Logseq, or Foam.
- 1-click **Export Vault as .zip** backup.

---

## 🚀 Quick Start

### 1. Launch Memoir
Run the launcher script:
```bash
/home/tomg/memoir/run.sh
```

Or start the Python backend server directly:
```bash
python3 /home/tomg/memoir/app.py
```

Open your browser at:
```
http://localhost:5432
```

---

## 🎙️ Voice Command Cheat Sheet

| Voice Phrase | Action | Resulting Markdown |
| :--- | :--- | :--- |
| **"Chapter The Quantum Mind"** | Starts a new Chapter | `vault/chapters/Chapter - The Quantum Mind.md` |
| **"Topic Wave Function Collapse"** | Creates a Topic linked to Chapter | `vault/topics/Topic - Wave Function Collapse.md`<br>`chapter: "[[Chapter - The Quantum Mind]]"` |
| **"Thought Superposition in biology"** | Creates an atomic Thought | `vault/thoughts/Thought - Superposition in biology.md`<br>`[[Topic - Wave Function Collapse]]` + Related Thoughts |
| **"Link to Associative Memory"** | Inserts a wikilink | `[[Thought - Associative Memory]]` |
| **"Tag neuroscience"** | Adds a tag | `#neuroscience` |
| **"New line"** / **"New paragraph"** | Formatting | Inserts `\n` or `\n\n` |
| **"Bullet point key observation"** | List item | `- key observation` |
| **"Stop recording"** | Microphone control | Stops voice listening |

---

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
| :--- | :--- |
| <kbd>Ctrl</kbd> + <kbd>M</kbd> | Toggle Voice Recording / Transcription |
| <kbd>Ctrl</kbd> + <kbd>1</kbd> | Switch to Full Knowledge Graph View |
| <kbd>Ctrl</kbd> + <kbd>2</kbd> | Switch to Markdown Editor View |
| <kbd>Ctrl</kbd> + <kbd>3</kbd> | Switch to Split View (Editor + Graph) |
| <kbd>Ctrl</kbd> + <kbd>S</kbd> | Save Current Note |
| <kbd>?</kbd> | Open Voice Command Reference Modal |

---

## 📂 Vault Directory Structure

```
memoir/
├── app.py                 # Python backend REST server & vault manager
├── run.sh                 # 1-click startup script
├── memoir.desktop         # Linux desktop entry
├── static/                # Obsidian-style web app (HTML, CSS, JS)
│   ├── css/
│   │   ├── style.css      # Core design system & Obsidian dark theme
│   │   └── graph.css      # Knowledge graph canvas & controls
│   ├── js/
│   │   ├── app.js         # Main application controller
│   │   ├── editor.js      # Markdown editor & wikilink autocomplete
│   │   ├── graph.js       # 2D Canvas force-directed graph simulation
│   │   ├── link_engine.js # Semantic similarity & inspector engine
│   │   ├── storage.js     # REST API client & cache sync
│   │   ├── voice.js       # Web Speech API & voice command parser
│   │   └── exporter.js    # Vault export as zip & markdown downloader
│   └── index.html         # Single-page application shell
└── vault/                 # Real Markdown Knowledge Vault
    ├── chapters/          # 📖 Top-level Chapter notes (.md)
    ├── topics/            # 🌿 Connected Topic notes (.md)
    └── thoughts/          # 💡 Atomic Thought notes (.md)
```

---

## 🛡️ License

MIT License — free to use, modify, and distribute.
