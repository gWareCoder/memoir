#!/usr/bin/env python3
"""
Memoir - Voice Transcription & Connected Thought Vault Server
An Obsidian-like local voice transcription, markdown vault, and connected graph engine.
"""

import os
import sys

# Ensure local and system packages (vosk, speech_recognition, tqdm, cffi) are discoverable
for p in [
    "/home/tomg/.local/lib/python3.11/site-packages",
    "/usr/local/lib/python3.11/dist-packages",
    "/usr/lib/python3/dist-packages",
]:
    if p not in sys.path:
        sys.path.insert(0, p)

import json
import re
import io
import time
import zipfile
import mimetypes
import urllib.parse
from datetime import datetime
from pathlib import Path
from http.server import HTTPServer, BaseHTTPRequestHandler
from socketserver import ThreadingMixIn

# Base paths
BASE_DIR = Path(__file__).resolve().parent
VAULT_DIR = BASE_DIR / "vault"
STATIC_DIR = BASE_DIR / "static"

CHAPTERS_DIR = VAULT_DIR / "chapters"
TOPICS_DIR = VAULT_DIR / "topics"
THOUGHTS_DIR = VAULT_DIR / "thoughts"
ATTACHMENTS_DIR = VAULT_DIR / "attachments"

# Ensure directories exist
for folder in [CHAPTERS_DIR, TOPICS_DIR, THOUGHTS_DIR, ATTACHMENTS_DIR, STATIC_DIR]:
    folder.mkdir(parents=True, exist_ok=True)

# Vosk Real-Time Offline Speech Model
VOSK_MODEL_PATH = BASE_DIR / "model" / "vosk-model-small-en-us-0.15"
vosk_model = None

def ensure_vosk_model():
    global vosk_model
    if vosk_model is not None:
        return vosk_model
    model_dir = BASE_DIR / "model"
    model_dir.mkdir(parents=True, exist_ok=True)
    target_path = model_dir / "vosk-model-small-en-us-0.15"
    if not target_path.exists():
        try:
            print("📥 Downloading lightweight offline speech recognition model (40MB)...")
            import urllib.request, zipfile
            zip_path = model_dir / "model.zip"
            urllib.request.urlretrieve("https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip", zip_path)
            with zipfile.ZipFile(zip_path, "r") as zip_ref:
                zip_ref.extractall(model_dir)
            if zip_path.exists():
                zip_path.unlink()
            print("✓ Offline speech model downloaded and ready.")
        except Exception as err:
            print("Notice on downloading Vosk model:", err)

    if target_path.exists():
        try:
            from vosk import Model
            vosk_model = Model(str(target_path))
            print("✓ Vosk Real-Time Offline Speech Model loaded successfully!")
        except Exception as e:
            print("Vosk model initialization notice:", e)
    return vosk_model

try:
    ensure_vosk_model()
except Exception:
    pass

# Active streaming recognizers per client session
active_sessions = {}


def parse_frontmatter(content: str):
    """Extract YAML frontmatter and body from markdown content."""
    frontmatter = {}
    body = content

    if content.startswith("---"):
        parts = content.split("---", 2)
        if len(parts) >= 3:
            fm_text = parts[1]
            body = parts[2].strip()
            # Simple key-value YAML parser
            for line in fm_text.strip().split("\n"):
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                if ":" in line:
                    key, val = line.split(":", 1)
                    key = key.strip()
                    val = val.strip()
                    # Parse booleans/numbers/lists/strings
                    if val.lower() == "true":
                        val = True
                    elif val.lower() == "false":
                        val = False
                    elif (val.startswith("[") and val.endswith("]")):
                        items = val[1:-1].split(",")
                        val = [item.strip().strip("'\"") for item in items if item.strip()]
                    elif (val.startswith('"') and val.endswith('"')) or (val.startswith("'") and val.endswith("'")):
                        val = val[1:-1]
                    frontmatter[key] = val

    return frontmatter, body


def format_frontmatter(fm: dict) -> str:
    """Format dictionary to YAML frontmatter string."""
    if not fm:
        return ""
    lines = ["---"]
    for k, v in fm.items():
        if isinstance(v, list):
            items_str = ", ".join(f'"{item}"' for item in v)
            lines.append(f"{k}: [{items_str}]")
        elif isinstance(v, bool):
            lines.append(f"{k}: {'true' if v else 'false'}")
        elif isinstance(v, (int, float)):
            lines.append(f"{k}: {v}")
        else:
            lines.append(f'{k}: "{v}"')
    lines.append("---\n\n")
    return "\n".join(lines)


def extract_wikilinks(text: str):
    """Extract all [[Note Name]] or [[Note Name|Alias]] wikilinks."""
    pattern = r"\[\[(.*?)\]\]"
    matches = re.findall(pattern, text)
    links = []
    for match in matches:
        target = match.split("|")[0].strip()
        if target:
            links.append(target)
    return list(dict.fromkeys(links))  # Unique preserve order


def extract_tags(text: str):
    """Extract #tags from text."""
    pattern = r"(?<!\w)#([a-zA-Z0-9_\-]+)"
    matches = re.findall(pattern, text)
    return list(dict.fromkeys(matches))


def sanitize_filename(name: str) -> str:
    """Create a safe filesystem filename."""
    name = re.sub(r'[\\/*?:"<>|]', "", name).strip()
    name = re.sub(r"\s+", " ", name)
    return name if name else "Untitled"


def compute_keyword_similarity(text1: str, text2: str) -> float:
    """Compute simple Jaccard similarity over word tokens."""
    stop_words = {
        "the", "and", "is", "in", "to", "of", "a", "that", "it", "with",
        "as", "for", "on", "was", "at", "by", "an", "be", "this", "which",
        "from", "or", "you", "my", "we", "they", "i", "me", "our", "are"
    }
    words1 = set(re.findall(r"\b[a-zA-Z]{3,}\b", text1.lower())) - stop_words
    words2 = set(re.findall(r"\b[a-zA-Z]{3,}\b", text2.lower())) - stop_words
    if not words1 or not words2:
        return 0.0
    intersection = len(words1 & words2)
    union = len(words1 | words2)
    return intersection / union if union > 0 else 0.0


def initialize_starter_vault():
    """Populate vault with rich starter notes if empty."""
    existing = list(CHAPTERS_DIR.glob("*.md")) + list(TOPICS_DIR.glob("*.md")) + list(THOUGHTS_DIR.glob("*.md"))
    if existing:
        return

    now_iso = datetime.now().isoformat()

    # 1. Chapter 1
    c1_title = "Chapter 1 - The Architecture of Mind"
    c1_content = f"""---
title: "{c1_title}"
type: "chapter"
created: "{now_iso}"
tags: ["neuroscience", "cognition", "philosophy"]
---

# {c1_title}

Welcome to **Memoir**, your voice-driven connected thought vault.

Memoir allows you to speak your stream of consciousness and automatically builds a structured, interconnected Obsidian-compatible knowledge graph of **Chapters**, **Topics**, and **Thoughts**.

## Overview
In this chapter, we explore how speech transcription bridges rapid human thought and structured markdown notes. Speaking at 150 words per minute allows unfiltered idea capture, while automatic entity linking preserves the relational topology.

### Connected Topics
- [[Topic - Spatial Cognition & Graph Thinking]]
- [[Topic - Stream of Consciousness Voice Capture]]
"""
    (CHAPTERS_DIR / f"{c1_title}.md").write_text(c1_content, encoding="utf-8")

    # 2. Topics
    t1_title = "Topic - Spatial Cognition & Graph Thinking"
    t1_content = f"""---
title: "{t1_title}"
type: "topic"
chapter: "[[{c1_title}]]"
created: "{now_iso}"
tags: ["visual-thinking", "network-theory"]
---

# {t1_title}

Part of [[{c1_title}]].

Human cognition is inherently non-linear. Hierarchical folders force thoughts into artificial buckets, whereas graph networks reflect the associative nature of neural pathways.

### Key Concepts
- Networked thought versus linear outlines
- Force-directed physics for cognitive clusters
- Cross-pollination between disparate topics

### Related Thoughts
- [[Thought - Associative Memory & Node Resonance]]
- [[Thought - The Power of Bi-directional Wikilinks]]
"""
    (TOPICS_DIR / f"{t1_title}.md").write_text(t1_content, encoding="utf-8")

    t2_title = "Topic - Stream of Consciousness Voice Capture"
    t2_content = f"""---
title: "{t2_title}"
type: "topic"
chapter: "[[{c1_title}]]"
created: "{now_iso}"
tags: ["voice-ai", "flow-state", "productivity"]
---

# {t2_title}

Part of [[{c1_title}]].

When voice transcription happens with zero latency, the friction between having an insight and recording it drops to zero. 

### Voice Command Syntax:
1. Say **"Chapter [Title]"** -> Instantly starts a new Chapter document.
2. Say **"Topic [Title]"** -> Creates a Topic note connected to the current chapter.
3. Say **"Thought [Title or text]"** -> Creates an atomic Thought note linked to topics and related thoughts.

### Related Thoughts
- [[Thought - Zero Latency Voice Dictation]]
- [[Thought - Continuous Flow State in Creative Writing]]
"""
    (TOPICS_DIR / f"{t2_title}.md").write_text(t2_content, encoding="utf-8")

    # 3. Thoughts
    th1_title = "Thought - Associative Memory & Node Resonance"
    th1_content = f"""---
title: "{th1_title}"
type: "thought"
topic: "[[{t1_title}]]"
chapter: "[[{c1_title}]]"
created: "{now_iso}"
tags: ["memory", "heuristics"]
---

# {th1_title}

Connected to [[{t1_title}]].

Whenever a new thought is voiced, scanning the vault for semantic word overlap allows us to discover serendipitous connections that the conscious mind may have overlooked.

Related to: [[Thought - The Power of Bi-directional Wikilinks]]
"""
    (THOUGHTS_DIR / f"{th1_title}.md").write_text(th1_content, encoding="utf-8")

    th2_title = "Thought - The Power of Bi-directional Wikilinks"
    th2_content = f"""---
title: "{th2_title}"
type: "thought"
topic: "[[{t1_title}]]"
chapter: "[[{c1_title}]]"
created: "{now_iso}"
tags: ["wikilinks", "knowledge-base"]
---

# {th2_title}

Connected to [[{t1_title}]].

Bi-directional links turn every note into both an author and a reader of other notes. If Note A links to Note B, Note B automatically indexes Note A in its backlinks inspector.
"""
    (THOUGHTS_DIR / f"{th2_title}.md").write_text(th2_content, encoding="utf-8")

    th3_title = "Thought - Zero Latency Voice Dictation"
    th3_content = f"""---
title: "{th3_title}"
type: "thought"
topic: "[[{t2_title}]]"
chapter: "[[{c1_title}]]"
created: "{now_iso}"
tags: ["speech-to-text", "ergonomics"]
---

# {th3_title}

Connected to [[{t2_title}]].

Speaking naturally activates different areas of Broca's area than typing on a physical keyboard. Voice capture produces richer narrative cadences and emotional nuance.

Related to: [[Thought - Continuous Flow State in Creative Writing]]
"""
    (THOUGHTS_DIR / f"{th3_title}.md").write_text(th3_content, encoding="utf-8")

    th4_title = "Thought - Continuous Flow State in Creative Writing"
    th4_content = f"""---
title: "{th4_title}"
type: "thought"
topic: "[[{t2_title}]]"
chapter: "[[{c1_title}]]"
created: "{now_iso}"
tags: ["flow-state", "creativity"]
---

# {th4_title}

Connected to [[{t2_title}]].

Hands-free thought recording removes visual micro-editing hesitation. You voice your draft entirely before revising, unlocking continuous psychological flow.
"""
    (THOUGHTS_DIR / f"{th4_title}.md").write_text(th4_content, encoding="utf-8")


class ThreadedHTTPServer(ThreadingMixIn, HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


class MemoirHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        # Keep logs tidy
        pass

    def send_cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_cors_headers()
        self.end_headers()

    def send_json(self, data, status=200):
        body = json.dumps(data, indent=2).encode("utf-8")
        self.send_response(status)
        self.send_cors_headers()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_error_json(self, message, status=400):
        self.send_json({"error": True, "message": message}, status=status)

    def serve_file(self, filepath: Path):
        if not filepath.exists() or not filepath.is_file():
            self.send_error_json(f"File not found: {filepath.name}", 404)
            return

        mime_type, _ = mimetypes.guess_type(str(filepath))
        if not mime_type:
            mime_type = "application/octet-stream"

        content = filepath.read_bytes()
        self.send_response(200)
        self.send_cors_headers()
        self.send_header("Content-Type", mime_type)
        self.send_header("Content-Length", str(len(content)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(content)

    def scan_vault(self):
        """Scans vault and returns notes, backlinks, and graph elements."""
        notes = []
        node_map = {}
        links_list = []

        types_dirs = [
            ("chapter", CHAPTERS_DIR),
            ("topic", TOPICS_DIR),
            ("thought", THOUGHTS_DIR),
        ]

        for note_type, folder in types_dirs:
            for filepath in folder.glob("*.md"):
                try:
                    content = filepath.read_text(encoding="utf-8")
                    fm, body = parse_frontmatter(content)
                    raw_title = filepath.stem
                    display_title = fm.get("title", raw_title)
                    tags = fm.get("tags", [])
                    if isinstance(tags, str):
                        tags = [tags]
                    
                    # Extract tags from body too
                    body_tags = extract_tags(body)
                    all_tags = list(dict.fromkeys(tags + body_tags))

                    wikilinks = extract_wikilinks(content)
                    mtime = filepath.stat().st_mtime
                    word_count = len(re.findall(r"\b\w+\b", body))
                    excerpt = body[:200] + ("..." if len(body) > 200 else "")

                    note_obj = {
                        "id": raw_title,
                        "title": display_title,
                        "filename": filepath.name,
                        "type": note_type,
                        "folder": note_type + "s",
                        "path": f"{note_type}s/{filepath.name}",
                        "frontmatter": fm,
                        "body": body,
                        "content": content,
                        "tags": all_tags,
                        "wikilinks": wikilinks,
                        "backlinks": [],  # Filled in next pass
                        "wordCount": word_count,
                        "excerpt": excerpt,
                        "updatedAt": datetime.fromtimestamp(mtime).isoformat(),
                    }
                    notes.append(note_obj)
                    node_map[raw_title] = note_obj
                    node_map[display_title] = note_obj
                except Exception as e:
                    print(f"Error reading {filepath}: {e}")

        # Compute backlinks & graph edges
        edges = []
        edge_set = set()

        for note in notes:
            # Check explicit frontmatter relations
            parent_chapter = note["frontmatter"].get("chapter")
            if parent_chapter:
                for link in extract_wikilinks(str(parent_chapter)):
                    if link in node_map and link != note["id"]:
                        edge_key = tuple(sorted([note["id"], link]))
                        if edge_key not in edge_set:
                            edges.append({"source": note["id"], "target": link, "type": "structural"})
                            edge_set.add(edge_key)

            parent_topic = note["frontmatter"].get("topic")
            if parent_topic:
                for link in extract_wikilinks(str(parent_topic)):
                    if link in node_map and link != note["id"]:
                        edge_key = tuple(sorted([note["id"], link]))
                        if edge_key not in edge_set:
                            edges.append({"source": note["id"], "target": link, "type": "structural"})
                            edge_set.add(edge_key)

            # Check wikilinks
            for target in note["wikilinks"]:
                target_key = target
                if target_key in node_map:
                    target_note = node_map[target_key]
                    if note["id"] not in target_note["backlinks"]:
                        target_note["backlinks"].append({
                            "id": note["id"],
                            "title": note["title"],
                            "type": note["type"],
                        })
                    edge_key = tuple(sorted([note["id"], target_note["id"]]))
                    if edge_key not in edge_set:
                        edges.append({"source": note["id"], "target": target_note["id"], "type": "wikilink"})
                        edge_set.add(edge_key)

        # Graph node list
        graph_nodes = []
        for note in notes:
            graph_nodes.append({
                "id": note["id"],
                "title": note["title"],
                "type": note["type"],
                "tags": note["tags"],
                "wordCount": note["wordCount"],
                "connections": sum(1 for e in edges if e["source"] == note["id"] or e["target"] == note["id"]),
            })

        return {
            "notes": notes,
            "graph": {
                "nodes": graph_nodes,
                "edges": edges,
            },
            "stats": {
                "totalNotes": len(notes),
                "chapters": sum(1 for n in notes if n["type"] == "chapter"),
                "topics": sum(1 for n in notes if n["type"] == "topic"),
                "thoughts": sum(1 for n in notes if n["type"] == "thought"),
                "totalEdges": len(edges),
            }
        }

    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        query = urllib.parse.parse_qs(parsed.query)

        # Static assets
        if path == "/" or path == "/index.html":
            self.serve_file(STATIC_DIR / "index.html")
            return
        elif path.startswith("/static/"):
            rel_path = path.replace("/static/", "", 1)
            file_target = STATIC_DIR / rel_path
            self.serve_file(file_target)
            return

        # API Endpoints
        if path == "/api/status":
            self.send_json({
                "status": "online",
                "app": "Memoir",
                "version": "1.0.0",
                "vaultPath": str(VAULT_DIR),
                "timestamp": datetime.now().isoformat(),
            })
            return

        if path == "/api/vault":
            data = self.scan_vault()
            self.send_json(data)
            return

        if path == "/api/export":
            # Create zip in-memory
            zip_buffer = io.BytesIO()
            with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zip_file:
                for root, _, files in os.walk(VAULT_DIR):
                    for file in files:
                        full_p = Path(root) / file
                        rel_p = full_p.relative_to(VAULT_DIR)
                        zip_file.write(full_p, arcname=str(rel_p))
            zip_data = zip_buffer.getvalue()

            self.send_response(200)
            self.send_cors_headers()
            self.send_header("Content-Type", "application/zip")
            self.send_header("Content-Disposition", f'attachment; filename="memoir_vault_{int(time.time())}.zip"')
            self.send_header("Content-Length", str(len(zip_data)))
            self.end_headers()
            self.wfile.write(zip_data)
            return

        if path.startswith("/api/note/"):
            # Format: /api/note/<folder>/<filename>
            parts = path.replace("/api/note/", "").split("/", 1)
            if len(parts) == 2:
                folder, filename = parts
                target_file = VAULT_DIR / folder / urllib.parse.unquote(filename)
                if target_file.exists():
                    content = target_file.read_text(encoding="utf-8")
                    fm, body = parse_frontmatter(content)
                    self.send_json({
                        "id": target_file.stem,
                        "title": fm.get("title", target_file.stem),
                        "type": folder.rstrip("s"),
                        "frontmatter": fm,
                        "body": body,
                        "content": content,
                        "path": f"{folder}/{target_file.name}",
                    })
                    return
            self.send_error_json("Note not found", 404)
            return

        self.send_error_json("Endpoint not found", 404)

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        content_length = int(self.headers.get("Content-Length", 0))
        post_bytes = self.rfile.read(content_length) if content_length > 0 else b""
        
        # Audio Transcription Endpoint
        if path == "/api/transcribe":
            try:
                import base64
                import subprocess
                import tempfile
                import speech_recognition as sr

                audio_data = b""
                try:
                    data = json.loads(post_bytes.decode("utf-8"))
                    if "audio" in data:
                        raw_b64 = data["audio"]
                        if "," in raw_b64:
                            raw_b64 = raw_b64.split(",", 1)[1]
                        audio_data = base64.b64decode(raw_b64)
                except Exception:
                    audio_data = post_bytes

                if not audio_data:
                    self.send_error_json("No audio payload received")
                    return

                with tempfile.NamedTemporaryFile(suffix=".input", delete=False) as in_f:
                    in_f.write(audio_data)
                    in_path = in_f.name

                out_path = in_path + ".wav"
                try:
                    cmd = ["/usr/bin/ffmpeg", "-y", "-i", in_path, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", out_path]
                    subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)

                    r = sr.Recognizer()
                    with sr.AudioFile(out_path) as source:
                        recorded = r.record(source)
                        try:
                            text = r.recognize_google(recorded)
                            self.send_json({"success": True, "text": text})
                            return
                        except sr.UnknownValueError:
                            self.send_json({"success": True, "text": "", "message": "No speech detected in audio"})
                            return
                        except Exception as err:
                            self.send_json({"success": False, "error": str(err)})
                            return
                finally:
                    for p in [in_path, out_path]:
                        if os.path.exists(p):
                            try: os.unlink(p)
                            except Exception: pass

            except Exception as e:
                self.send_json({"success": False, "error": str(e)}, status=500)
                return

        # Real-time Streaming STT with Vosk
        if path == "/api/stream_stt":
            global vosk_model, active_sessions
            if vosk_model is None:
                if VOSK_MODEL_PATH.exists():
                    try:
                        from vosk import Model
                        vosk_model = Model(str(VOSK_MODEL_PATH))
                    except Exception as e:
                        self.send_json({"final": False, "text": "", "error": str(e)})
                        return
                else:
                    self.send_json({"final": False, "text": "", "error": "Vosk model not found"})
                    return

            session_id = self.headers.get("X-Session-ID", "default")
            reset_flag = self.headers.get("X-Reset", "false").lower() == "true"

            if reset_flag or session_id not in active_sessions:
                from vosk import KaldiRecognizer
                active_sessions[session_id] = KaldiRecognizer(vosk_model, 16000)

            rec = active_sessions[session_id]

            if not post_bytes:
                self.send_json({"final": False, "text": ""})
                return

            if rec.AcceptWaveform(post_bytes):
                res = json.loads(rec.Result())
                text = res.get("text", "").strip()
                self.send_json({"final": True, "text": text})
            else:
                part = json.loads(rec.PartialResult())
                text = part.get("partial", "").strip()
                self.send_json({"final": False, "text": text})
            return

        if path == "/api/reset_stt":
            session_id = self.headers.get("X-Session-ID", "default")
            text = ""
            if session_id in active_sessions:
                rec = active_sessions[session_id]
                res = json.loads(rec.FinalResult())
                text = res.get("text", "").strip()
                del active_sessions[session_id]
            self.send_json({"final": True, "text": text})
            return

        try:
            data = json.loads(post_bytes.decode("utf-8"))
        except Exception:
            data = {}

        # 1. Create or Update Note
        if path == "/api/notes":
            note_type = data.get("type", "thought").lower()
            raw_title = data.get("title", "").strip()
            body = data.get("body", "").strip()
            tags = data.get("tags", [])
            parent_chapter = data.get("chapter")
            parent_topic = data.get("topic")
            related_thoughts = data.get("relatedThoughts", [])
            custom_frontmatter = data.get("frontmatter", {})

            if not raw_title:
                timestamp_str = datetime.now().strftime("%Y-%m-%d %H%M%S")
                raw_title = f"{note_type.capitalize()} - {timestamp_str}"

            # Format standardized title prefix if user did not include it
            clean_title = raw_title
            prefix = note_type.capitalize()
            if not clean_title.lower().startswith(prefix.lower()):
                clean_title = f"{prefix} - {clean_title}"

            safe_name = sanitize_filename(clean_title)
            filename = f"{safe_name}.md"

            # Determine target folder
            if note_type == "chapter":
                target_folder = CHAPTERS_DIR
            elif note_type == "topic":
                target_folder = TOPICS_DIR
            else:
                target_folder = THOUGHTS_DIR

            target_file = target_folder / filename

            # Build YAML frontmatter
            fm = {
                "title": clean_title,
                "type": note_type,
                "created": custom_frontmatter.get("created", datetime.now().isoformat()),
                "updated": datetime.now().isoformat(),
            }
            if tags:
                fm["tags"] = tags
            if parent_chapter:
                fm["chapter"] = f"[[{parent_chapter}]]" if not parent_chapter.startswith("[[") else parent_chapter
            if parent_topic:
                fm["topic"] = f"[[{parent_topic}]]" if not parent_topic.startswith("[[") else parent_topic

            # If existing file, preserve any existing frontmatter properties
            if target_file.exists():
                existing_content = target_file.read_text(encoding="utf-8")
                old_fm, _ = parse_frontmatter(existing_content)
                old_fm.update(fm)
                fm = old_fm

            # Construct markdown body
            fm_text = format_frontmatter(fm)
            
            # If body does not have heading, add one
            full_content = fm_text
            if body:
                full_content += body
            else:
                full_content += f"# {clean_title}\n\n"
                if parent_chapter and note_type != "chapter":
                    full_content += f"Part of {fm.get('chapter', '')}\n\n"
                if parent_topic and note_type == "thought":
                    full_content += f"Related to Topic: {fm.get('topic', '')}\n\n"

            # If related thoughts are supplied, append them if not present
            if related_thoughts:
                rel_links_str = ", ".join([f"[[{t}]]" for t in related_thoughts])
                if "Related Thoughts" not in full_content:
                    full_content += f"\n\n### Related Thoughts\n{rel_links_str}\n"

            target_file.write_text(full_content, encoding="utf-8")

            self.send_json({
                "success": True,
                "id": target_file.stem,
                "title": clean_title,
                "filename": filename,
                "type": note_type,
                "path": f"{note_type}s/{filename}",
                "content": full_content,
            })
            return

        # 2. Append text to active note (Voice Stream Appender)
        if path == "/api/notes/append":
            note_path = data.get("path")
            text_to_append = data.get("text", "").strip()

            if not note_path or not text_to_append:
                self.send_error_json("Missing path or text")
                return

            target_file = VAULT_DIR / note_path
            if not target_file.exists():
                self.send_error_json("Note not found", 404)
                return

            content = target_file.read_text(encoding="utf-8")
            # Append cleanly with newline
            if not content.endswith("\n"):
                content += "\n"
            content += text_to_append + "\n"

            target_file.write_text(content, encoding="utf-8")
            self.send_json({"success": True, "path": note_path, "content": content})
            return

        # 3. Find Related Thoughts Algorithm
        if path == "/api/find_related":
            query_text = data.get("text", "")
            exclude_id = data.get("excludeId", "")

            all_notes = self.scan_vault()["notes"]
            candidates = [n for n in all_notes if n["id"] != exclude_id]

            ranked = []
            for item in candidates:
                sim = compute_keyword_similarity(query_text, item["body"])
                # Boost if in same topic or chapter
                if sim > 0.05 or any(tag in item["tags"] for tag in extract_tags(query_text)):
                    ranked.append({
                        "id": item["id"],
                        "title": item["title"],
                        "type": item["type"],
                        "score": round(sim, 3),
                        "excerpt": item["excerpt"],
                    })

            ranked.sort(key=lambda x: x["score"], reverse=True)
            self.send_json({"related": ranked[:6]})
            return

        # 4. Rename Note & Refactor Links
        if path == "/api/notes/rename":
            old_path = data.get("oldPath")
            new_title = data.get("newTitle", "").strip()

            if not old_path or not new_title:
                self.send_error_json("Missing oldPath or newTitle")
                return

            old_file = VAULT_DIR / old_path
            if not old_file.exists():
                self.send_error_json("Source file not found", 404)
                return

            folder = old_file.parent
            old_stem = old_file.stem
            new_safe_name = sanitize_filename(new_title)
            new_file = folder / f"{new_safe_name}.md"

            if new_file.exists() and new_file != old_file:
                self.send_error_json("A note with that name already exists")
                return

            # Rename file
            content = old_file.read_text(encoding="utf-8")
            fm, body = parse_frontmatter(content)
            fm["title"] = new_title
            fm["updated"] = datetime.now().isoformat()
            updated_content = format_frontmatter(fm) + body
            new_file.write_text(updated_content, encoding="utf-8")
            if old_file != new_file:
                old_file.unlink()

            # Global Wikilink Refactoring across all vault files
            old_link = f"[[{old_stem}]]"
            new_link = f"[[{new_safe_name}]]"

            for md_path in VAULT_DIR.rglob("*.md"):
                if md_path == new_file:
                    continue
                file_txt = md_path.read_text(encoding="utf-8")
                if old_link in file_txt:
                    refactored = file_txt.replace(old_link, new_link)
                    md_path.write_text(refactored, encoding="utf-8")

            self.send_json({
                "success": True,
                "oldId": old_stem,
                "newId": new_safe_name,
                "newPath": f"{folder.name}/{new_file.name}",
            })
            return

        # 5. Delete Note
        if path == "/api/notes/delete":
            note_path = data.get("path")
            if not note_path:
                self.send_error_json("Missing path")
                return

            target_file = VAULT_DIR / note_path
            if target_file.exists():
                target_file.unlink()
                self.send_json({"success": True, "deleted": note_path})
                return
            self.send_error_json("File not found", 404)
            return

        self.send_error_json("Endpoint not found", 404)


def start_server(port=5432):
    initialize_starter_vault()
    
    server_address = ("0.0.0.0", port)
    try:
        httpd = ThreadedHTTPServer(server_address, MemoirHandler)
    except OSError:
        # Fallback to alternate port if busy
        port = port + 1
        server_address = ("0.0.0.0", port)
        httpd = ThreadedHTTPServer(server_address, MemoirHandler)

    print("=" * 60)
    print(" 🧠 MEMOIR - Connected Voice Transcription Vault")
    print(f" 🚀 Server running at: http://localhost:{port}")
    print(f" 📂 Vault directory:   {VAULT_DIR}")
    print("=" * 60)
    
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nMemoir server stopping...")
        httpd.server_close()


if __name__ == "__main__":
    port = 5432
    if len(sys.argv) > 1:
        try:
            port = int(sys.argv[1])
        except ValueError:
            pass
    start_server(port)
