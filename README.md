# 🧠 Memoir — Voice-Driven Connected Thought Vault

[![License: MIT](https://img.shields.io/badge/License-MIT-purple.svg)](https://opensource.org/licenses/MIT)
[![Obsidian Compatible](https://img.shields.io/badge/Obsidian-Compatible-7c3aed.svg)](https://obsidian.md)
[![Python 3.10+](https://img.shields.io/badge/Python-3.10%2B-blue.svg)](https://www.python.org/)
[![Local Voice STT](https://img.shields.io/badge/Voice%20STT-Zero%20Latency%20Local-emerald.svg)]()

**Memoir** is a local voice transcription application and connected knowledge graph vault inspired by **Obsidian**. It captures your stream of consciousness in real time hands-free, automatically parsing structural voice commands to build an interconnected Markdown knowledge base of **Chapters**, **Topics**, and **Thoughts**.

---

## 📸 Interface Preview

![Memoir Interface Screenshot](assets/screenshot.png)

---

## 🏗️ System Architecture

Memoir operates entirely on your local machine with zero external cloud dependencies. Below is the end-to-end data flow and structural topology:

### 1. Voice Processing & Intent Recognition Pipeline

```mermaid
flowchart TD
    A["🎙️ User Speech Input"] --> B["Web Audio API Analyser"]
    B -->|"Real-time Audio Data"| C["Waveform Visualizer"]
    A --> D["Speech Recognition Engine"]
    D -->|"Continuous Text Stream"| E["Natural Language Intent Parser"]
    
    E -->|"Chapter title"| F["📖 Chapter Engine"]
    E -->|"Topic title"| G["🌿 Topic Engine"]
    E -->|"Thought text"| H["💡 Thought Engine"]
    E -->|"Link to note"| I["🔗 Wikilink Injector"]
    E -->|"Tag keyword"| J["🏷️ Tag Injector"]
    E -->|"Regular dictation"| K["📝 Active Note Stream"]
    
    F -->|"Write .md"| L[("Vault File System")]
    G -->|"Link Chapter & Write .md"| L
    H -->|"Link Topic & Discover Related"| L
    I -->|"Insert Wikilink"| L
    J -->|"Insert Tag"| L
    K -->|"Append Text"| L
```

---

### 2. Knowledge Graph Topology & Relational Hierarchy

```mermaid
graph TD
    subgraph Chapters ["🟣 Chapter Layer (Top-Level)"]
        C1["📖 Chapter 1: The Architecture of Mind"]
        C2["📖 Chapter 2: Neural Synchrony"]
    end

    subgraph Topics ["🟢 Topic Layer (Structural Context)"]
        T1["🌿 Topic: Spatial Cognition & Graph Thinking"]
        T2["🌿 Topic: Stream of Consciousness"]
        T3["🌿 Topic: Gamma Waves & Binding"]
    end

    subgraph Thoughts ["🟠 Thought Layer (Atomic Insights)"]
        TH1["💡 Associative Memory & Resonance"]
        TH2["💡 Bi-directional Wikilinks"]
        TH3["💡 Zero Latency Voice Dictation"]
        TH4["💡 40Hz Resonance in Memory"]
    end

    C1 -->|"Contains"| T1
    C1 -->|"Contains"| T2
    C2 -->|"Contains"| T3

    T1 -->|"Context for"| TH1
    T1 -->|"Context for"| TH2
    T2 -->|"Context for"| TH3
    T3 -->|"Context for"| TH4

    TH1 -.->|"Similarity Match"| TH2
    TH1 -.->|"Cross Link"| TH4
    TH3 -.->|"Related"| TH1

    classDef chapterStyle fill:#8b5cf6,stroke:#a855f7,stroke-width:2px,color:#fff;
    classDef topicStyle fill:#059669,stroke:#10b981,stroke-width:2px,color:#fff;
    classDef thoughtStyle fill:#d97706,stroke:#f59e0b,stroke-width:2px,color:#fff;

    class C1,C2 chapterStyle;
    class T1,T2,T3 topicStyle;
    class TH1,TH2,TH3,TH4 thoughtStyle;
```

---

### 3. Application Stack & Component Breakdown

| Layer | Component | Implementation |
| :--- | :--- | :--- |
| **Frontend UI** | Obsidian-Style Layout | Semantic HTML5, Glassmorphism, CSS Custom Properties |
| **Voice Engine** | Speech-to-Text & Audio | Web Speech API, Web Audio API Analyzer, Synthesizer Chimes |
| **Graph Simulation** | Interactive Knowledge Graph | 2D HTML5 Canvas, 60fps N-Body Repulsion, Hooke Spring Physics |
| **Editor & Live Preview** | Markdown & Backlinks | Regex Parser, Wikilink Autocomplete `[[]]`, Frontmatter YAML |
| **Similarity Engine** | Related Thoughts Discovery | Jaccard Token Resonance & Tag Overlap Heuristics |
| **Backend & Storage** | Local REST API & Vault | Python 3 Standard Library HTTP Server, Pure Markdown (`.md`) |

---

## ✨ Key Features

- **🎙️ Live Transcription Review & Save / Discard Console**:
  - Review transcribed speech in real-time before committing it to your notes.
  - **Save to Note** (or <kbd>Ctrl</kbd>+<kbd>Enter</kbd>): Appends the reviewed text directly to the active note.
  - **Save as Thought / Topic / Chapter**: 1-click conversion of spoken text into structured knowledge nodes.
  - **Discard** (or <kbd>Esc</kbd>): Immediately clears the transcription buffer without altering files.
  - **Review Mode vs Auto-Stream Toggle**: Switch between explicit confirmation or direct auto-dictation.
- **🗣️ Natural Voice Commands**:
  - Say **"Chapter [Title]"** to start a new Chapter document.
  - Say **"Topic [Title]"** to create a Topic linked to the active Chapter.
  - Say **"Thought [Text]"** to create an atomic Thought note linked to topics and related thoughts.
  - Say **"Link to [Note]"** to insert `[[Note Name]]` wikilinks.
  - Say **"Tag [Keyword]"** to add `#keyword` tags.
  - Say **"Save transcription" / "Accept"** to save current speech into the active note hands-free.
  - Say **"Discard" / "Cancel"** to clear the transcription buffer hands-free.
- **🌐 Obsidian-Grade Interactive Knowledge Graph**:
  - Color-coded glowing halos (🟣 Chapters, 🟢 Topics, 🟠 Thoughts).
  - Hover tooltip cards showing word count, connection statistics, and note excerpts.
  - Drag, zoom, pan, search filtering, and node click-to-edit.
- **📝 Markdown Editor & Live Preview**:
  - Split view with live syntax styling, checklists, and code formatting.
  - Interactive `[[wikilinks]]` with auto-complete dropdown when typing `[[`.
  - Automatic note title renaming with global wikilink refactoring.
- **🔍 Semantic Related Thoughts Inspector**:
  - Discovers unexpected connections between thoughts across the vault.
  - 1-click **"+ Link in Note"** button.
- **📁 100% Local & Obsidian-Compatible**:
  - All notes are saved directly as `.md` files in `~/memoir/vault/`.
  - Open `vault/` directly in Obsidian, Logseq, or Foam.
  - 1-click **Export Vault as .zip**.

---

## 🚀 Quick Start

### 1. Launch Memoir
Run the launcher script:
```bash
/home/tomg/memoir/run.sh
```

Or start the server directly:
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
| **"Save transcription"** / **"Accept"** | Saves current speech to note | Inserts reviewed transcription buffer into note |
| **"Discard"** / **"Cancel"** | Discards current speech | Clears transcription review buffer |
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
| <kbd>Ctrl</kbd> + <kbd>Enter</kbd> | Save transcription buffer into active note |
| <kbd>Esc</kbd> | Discard transcription buffer |
| <kbd>Ctrl</kbd> + <kbd>1</kbd> | Switch to Full Knowledge Graph View |
| <kbd>Ctrl</kbd> + <kbd>2</kbd> | Switch to Markdown Editor View |
| <kbd>Ctrl</kbd> + <kbd>3</kbd> | Switch to Split View (Editor + Graph) |
| <kbd>Ctrl</kbd> + <kbd>I</kbd> | Toggle Inspector & Local Graph Right Panel |
| <kbd>Ctrl</kbd> + <kbd>S</kbd> | Save Current Note |
| <kbd>?</kbd> | Open Voice Command Reference Modal |

---

## 📂 Vault Directory Structure

```
memoir/
├── app.py                 # Python backend REST server & vault manager
├── run.sh                 # 1-click startup script
├── memoir.desktop         # Linux desktop entry
├── assets/                # Screenshot and UI assets
│   └── screenshot.png     # Application screenshot
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
