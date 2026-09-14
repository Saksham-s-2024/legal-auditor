"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import {
  Upload,
  FileText,
  CheckCircle,
  AlertCircle,
  Loader2,
  Send,
  Shield,
  Trash2,
  Scale,
  Edit,
  X,
  Copy,
} from "lucide-react";
import DOMPurify from "dompurify";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const DEFAULT_WORKSPACE = "00000000-0000-0000-0000-000000000001";

// ── Types ──────────────────────────────────────────────────────────────────────
type IngestionPhase =
  | "idle"
  | "uploading"
  | "parsing"
  | "ocr_check"
  | "pii_scrub"
  | "embedding"
  | "done"
  | "error"
  | "duplicate";

interface UploadedFile {
  name: string;
  contractId: string;
  hash: string;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  isStreaming?: boolean;
}

interface StudyNote {
  id: string;
  text: string;
  timestamp: string;
}

const PHASE_LABELS: Record<IngestionPhase, string> = {
  idle: "Ready to upload",
  uploading: "Uploading file...",
  parsing: "Phase 1 — Docling layout parsing...",
  ocr_check: "Phase 2 — OCR density check...",
  pii_scrub: "Phase 3 — PII scrubbing via Presidio...",
  embedding: "Phase 4 — Generating embeddings & indexing...",
  done: "Ingestion complete",
  error: "Ingestion failed",
  duplicate: "Document already indexed",
};

// ── Sanitize helper — strips all HTML/script before render ────────────────────
function sanitize(raw: string): string {
  if (typeof window === "undefined") return raw;
  return DOMPurify.sanitize(raw, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] });
}

// ── Legal Text Highlighter Component/Helper ───────────────────────────────────
function renderHighlightedText(text: string, animate: boolean = false): React.ReactNode[] {
  if (!text) return [];

  // Match:
  // Group 1: Section Headers & Clauses (Zinc-100 Light Grey border badge)
  // Group 2: Core Legal Terms (Zinc-300 Medium Grey border badge)
  // Group 3: Financial Values & Notice Periods (Zinc-400 Dark Grey border badge)
  const combinedRegex = /(\b(?:Clause|Section|Article|Paragraph)\s+\d+(?:\.\d+)*\b)|(\b(?:Indemn(?:ity|ification)|Liabilit(?:y|ies)|Limitation\s+of\s+Liability|Confidentiality|Termination|Warrant(?:y|ies)|Intellectual\s+Property|Governing\s+Law|Severability|Force\s+Majeure|Jurisdiction|Compliance|Arbitration|Non-disclosure|NDA|Material\s+Adverse\s+Effect|Solvency)\b)|(\$\d+(?:,\d{3})*(?:\.\d+)?|\b\d+(?:\.\d+)?%|\b\d+\s+(?:days|months|years|weeks|hours)\b)/gi;

  const elements: React.ReactNode[] = [];
  let lastIndex = 0;
  let match;

  combinedRegex.lastIndex = 0;
  let elementIndex = 0;

  while ((match = combinedRegex.exec(text)) !== null) {
    const matchIndex = match.index;
    const matchedText = match[0];

    // Push plain text before match
    if (matchIndex > lastIndex) {
      const plainText = text.slice(lastIndex, matchIndex);
      if (animate) {
        const words = plainText.split(/(\s+)/);
        words.forEach((word) => {
          if (word.trim() === "") {
            elements.push(<span key={`space-${elementIndex++}`}>{word}</span>);
          } else {
            elements.push(
              <span
                key={`word-${elementIndex++}-${word}`}
                className="token-anim inline-block"
              >
                {word}
              </span>
            );
          }
        });
      } else {
        elements.push(plainText);
      }
    }

    const key = `match-${elementIndex++}-${matchedText}`;
    if (match[1]) {
      // Group 1: Clause/Section
      elements.push(
        <span
          key={key}
          className={`highlight-clause inline-block ${animate ? "token-anim" : ""}`}
        >
          {matchedText}
        </span>
      );
    } else if (match[2]) {
      // Group 2: Core Legal Term
      elements.push(
        <span
          key={key}
          className={`highlight-legal-term inline-block ${animate ? "token-anim" : ""}`}
        >
          {matchedText}
        </span>
      );
    } else if (match[3]) {
      // Group 3: Values / Durations
      elements.push(
        <span
          key={key}
          className={`highlight-value inline-block ${animate ? "token-anim" : ""}`}
        >
          {matchedText}
        </span>
      );
    }

    lastIndex = combinedRegex.lastIndex;
  }

  // Remaining text
  if (lastIndex < text.length) {
    const plainText = text.slice(lastIndex);
    if (animate) {
      const words = plainText.split(/(\s+)/);
      words.forEach((word) => {
        if (word.trim() === "") {
          elements.push(<span key={`space-${elementIndex++}`}>{word}</span>);
        } else {
          elements.push(
            <span
              key={`word-${elementIndex++}-${word}`}
              className="token-anim inline-block"
            >
              {word}
            </span>
          );
        }
      });
    } else {
      elements.push(plainText);
    }
  }

  return elements;
}

// ── Root Page ──────────────────────────────────────────────────────────────────
export default function Home() {
  // Files state
  const [files, setFiles] = useState<UploadedFile[]>([]);
  
  // Ingestion state
  const [phase, setPhase] = useState<IngestionPhase>("idle");
  const [errorMsg, setErrorMsg] = useState<string>("");

  // Chat state
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isQuerying, setIsQuerying] = useState(false);

  // Notes state
  const [isNotesOpen, setIsNotesOpen] = useState(false);
  const [notes, setNotes] = useState<StudyNote[]>([]);
  const [noteInput, setNoteInput] = useState("");

  const [isLoaded, setIsLoaded] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load from local storage
  useEffect(() => {
    const savedFiles = localStorage.getItem("sovereign_files");
    if (savedFiles) {
      try {
        setFiles(JSON.parse(savedFiles));
      } catch (e) {
        console.error(e);
      }
    }

    const savedNotes = localStorage.getItem("sovereign_study_notes");
    if (savedNotes) {
      try {
        setNotes(JSON.parse(savedNotes));
      } catch (e) {
        console.error(e);
      }
    }

    setIsLoaded(true);
  }, []);

  // Scroll to bottom of chat
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // File Ingestion Handler
  const handleUpload = useCallback(async (file: File) => {
    if (!file) return;
    setPhase("uploading");
    setErrorMsg("");

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("workspace_id", DEFAULT_WORKSPACE);

      // Simulate progressive phase feedback
      const phases: IngestionPhase[] = ["parsing", "ocr_check", "pii_scrub", "embedding"];
      let phaseIdx = 0;
      const ticker = setInterval(() => {
        if (phaseIdx < phases.length) {
          setPhase(phases[phaseIdx++]);
        } else {
          clearInterval(ticker);
        }
      }, 2200);

      const res = await fetch(`${API_URL}/api/v1/upload`, {
        method: "POST",
        body: formData,
      });

      clearInterval(ticker);

      if (!res.ok) {
        throw new Error(`Server returned ${res.status}`);
      }

      const data = await res.json();

      if (data.status === "duplicate") {
        setPhase("duplicate");
        const ingested: UploadedFile = {
          name: file.name,
          contractId: data.contract_id ?? `fallback-${data.hash.slice(0, 12)}`,
          hash: data.hash.slice(0, 12),
        };
        setFiles((prev) => {
          if (prev.some((f) => f.hash === ingested.hash)) return prev;
          const next = [...prev, ingested];
          localStorage.setItem("sovereign_files", JSON.stringify(next));
          return next;
        });
        return;
      }

      const ingested: UploadedFile = {
        name: file.name,
        contractId: data.contract_id,
        hash: data.hash.slice(0, 12),
      };
      
      setPhase("done");
      setFiles((prev) => {
        const next = [...prev, ingested];
        localStorage.setItem("sovereign_files", JSON.stringify(next));
        return next;
      });
    } catch (err) {
      setPhase("error");
      setErrorMsg(err instanceof Error ? err.message : "Unknown error");
    }
  }, []);

  const handleFileRemoved = (contractId: string) => {
    setFiles((prev) => {
      const next = prev.filter((f) => f.contractId !== contractId);
      localStorage.setItem("sovereign_files", JSON.stringify(next));
      return next;
    });
  };

  const handleClearAllFiles = () => {
    setFiles([]);
    localStorage.removeItem("sovereign_files");
  };

  // Send Query Handler
  const sendQuery = useCallback(async () => {
    const query = input.trim();
    if (!query || isQuerying) return;
    if (query.length > 500) {
      alert("Query exceeds maximum length of 500 characters.");
      return;
    }

    setInput("");
    setIsQuerying(true);

    const userMsg: ChatMessage = { role: "user", content: query };
    setMessages((prev) => [...prev, userMsg]);

    const assistantMsg: ChatMessage = {
      role: "assistant",
      content: "",
      isStreaming: true,
    };
    setMessages((prev) => [...prev, assistantMsg]);

    try {
      const res = await fetch(`${API_URL}/api/v1/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query,
          workspace_id: DEFAULT_WORKSPACE,
        }),
      });

      if (!res.ok || !res.body) throw new Error("Stream failed");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const payload = JSON.parse(line.slice(6));
            const token: string = payload.token ?? "";

            if (token === "[DONE]" || token === "[ERROR] An internal error occurred. Please try again.") {
              setMessages((prev) =>
                prev.map((m, i) =>
                  i === prev.length - 1 ? { ...m, isStreaming: false } : m
                )
              );
              break;
            }

            const safe = sanitize(token);
            setMessages((prev) =>
              prev.map((m, i) =>
                i === prev.length - 1
                  ? { ...m, content: m.content + safe }
                  : m
              )
            );
          } catch {
            // ignore
          }
        }
      }
    } catch {
      setMessages((prev) =>
        prev.map((m, i) =>
          i === prev.length - 1
            ? { ...m, content: "Connection error. Please try again.", isStreaming: false }
            : m
        )
      );
    } finally {
      setIsQuerying(false);
    }
  }, [input, isQuerying]);

  const clearChat = () => setMessages([]);

  // Study Note Handlers
  const addNote = () => {
    if (!noteInput.trim()) return;
    const newNote: StudyNote = {
      id: Date.now().toString(),
      text: noteInput.trim(),
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    };
    setNotes((prev) => {
      const next = [newNote, ...prev];
      localStorage.setItem("sovereign_study_notes", JSON.stringify(next));
      return next;
    });
    setNoteInput("");
  };

  const deleteNote = (id: string) => {
    setNotes((prev) => {
      const next = prev.filter((n) => n.id !== id);
      localStorage.setItem("sovereign_study_notes", JSON.stringify(next));
      return next;
    });
  };

  const copyAllNotes = () => {
    const text = notes.map((n) => `[${n.timestamp}] ${n.text}`).join("\n");
    navigator.clipboard.writeText(text);
    alert("Study notes copied to clipboard!");
  };

  const hasDocuments = files.length > 0;

  if (!isLoaded) {
    return (
      <div className="min-h-screen bg-[#09090b] flex items-center justify-center">
        <Loader2 className="animate-spin text-zinc-400" size={24} />
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-[#09090b] text-zinc-100 flex flex-col font-sans relative overflow-x-hidden selection:bg-zinc-800 selection:text-zinc-200">
      {/* Decorative gradient backdrops */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[300px] bg-zinc-800/[0.02] rounded-full blur-[120px] pointer-events-none" />

      {/* Main Container */}
      <div className="w-full max-w-5xl mx-auto px-4 py-6 md:py-8 flex-1 flex flex-col z-10 h-screen max-h-screen overflow-hidden">
        
        {/* Top Header */}
        <header className="flex items-center justify-between pb-4 mb-4 border-b border-zinc-800/40 shrink-0">
          <div className="flex items-center gap-2">
            <Shield className="text-zinc-400" size={18} />
            <h1 className="text-sm font-semibold tracking-wide text-zinc-200">Legal-Auditor</h1>
          </div>
        </header>

        {/* Dual-Pane Layout: Left Sidebar + Right Chat */}
        <div className="flex-1 grid grid-cols-1 md:grid-cols-[240px_1fr] gap-6 min-h-0 overflow-hidden mb-2">
          
          {/* Left Sidebar — Document Manager */}
          <aside className="glass-panel rounded-2xl p-4 flex flex-col min-h-0 h-full border border-zinc-800/40">
            <div className="flex items-center gap-2 pb-3 mb-4 border-b border-zinc-800/40 shrink-0">
              <FileText size={15} className="text-zinc-400" />
              <span className="text-xs font-semibold uppercase tracking-wider text-zinc-200">Documents</span>
            </div>

            {/* Upload Area */}
            <div
              onDrop={(e) => {
                e.preventDefault();
                const file = e.dataTransfer.files[0];
                if (file) handleUpload(file);
              }}
              onDragOver={(e) => e.preventDefault()}
              onClick={() => fileInputRef.current?.click()}
              className="border border-dashed border-zinc-800 hover:border-zinc-700 bg-zinc-950/40 rounded-xl p-4 text-center cursor-pointer transition-all duration-200 flex flex-col items-center justify-center min-h-[90px] shrink-0"
              title="Click or drag PDF here to upload"
            >
              <Upload className="text-zinc-500 mb-1" size={18} />
              <p className="text-[10px] text-zinc-300 font-medium">Add contract PDF</p>
              <p className="text-[8px] text-zinc-650 mt-0.5">Click or drag here</p>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.docx,.txt"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleUpload(f);
                e.target.value = "";
              }}
            />

            {/* Ingestion Phase Status Inside Sidebar */}
            {phase !== "idle" && phase !== "done" && phase !== "duplicate" && phase !== "error" && (
              <div className="mt-3 p-2 bg-zinc-950/60 border border-zinc-855 rounded-lg text-[10px] text-zinc-400 flex items-center gap-1.5 shrink-0 animate-pulse">
                <Loader2 size={11} className="animate-spin text-zinc-500" />
                <span className="truncate">{PHASE_LABELS[phase]}</span>
              </div>
            )}

            {phase === "error" && (
              <div className="mt-3 p-2 bg-red-950/20 border border-red-900/30 rounded-lg text-[10px] text-red-400 flex flex-col gap-1 shrink-0">
                <span className="font-medium break-words">Error: {sanitize(errorMsg).slice(0, 100)}...</span>
                <button onClick={() => setPhase("idle")} className="text-[8px] uppercase font-bold tracking-wider hover:text-red-300 self-end mt-1">Dismiss</button>
              </div>
            )}

            {phase === "duplicate" && (
              <div className="mt-3 p-2 bg-zinc-950/60 border border-zinc-850 rounded-lg text-[10px] text-zinc-400 flex items-center justify-between shrink-0">
                <span>Already indexed.</span>
                <button onClick={() => setPhase("idle")} className="text-[8px] uppercase font-bold tracking-wider hover:text-zinc-200">Dismiss</button>
              </div>
            )}

            {phase === "done" && (
              <div className="mt-3 p-2 bg-zinc-950/60 border border-zinc-850 rounded-lg text-[10px] text-zinc-400 flex items-center justify-between shrink-0">
                <span className="flex items-center gap-1 font-medium text-zinc-300">
                  <CheckCircle size={11} className="text-zinc-450" />
                  Processed
                </span>
                <button onClick={() => setPhase("idle")} className="text-[8px] uppercase font-bold tracking-wider hover:text-zinc-200">Dismiss</button>
              </div>
            )}

            {/* List of files in Sidebar */}
            <div className="flex-1 flex flex-col min-h-0 mt-4 overflow-hidden">
              <div className="flex items-center justify-between mb-2 px-1 shrink-0">
                <span className="text-[9px] text-zinc-500 uppercase font-bold tracking-wider">Indexed ({files.length})</span>
                {files.length > 0 && (
                  <button
                    onClick={handleClearAllFiles}
                    className="text-[9px] text-zinc-650 hover:text-red-400 font-bold uppercase tracking-wider transition-colors"
                  >
                    Clear All
                  </button>
                )}
              </div>

              <div className="flex-1 overflow-y-auto space-y-2 pr-1 min-h-0">
                {files.length === 0 ? (
                  <p className="text-[10px] text-zinc-600 italic text-center py-4">No documents uploaded.</p>
                ) : (
                  files.map((f) => (
                    <div
                      key={f.contractId}
                      className="bg-zinc-950/30 border border-zinc-900 hover:border-zinc-850 rounded-lg p-2.5 flex items-start justify-between gap-2 group transition-all duration-200"
                    >
                      <div className="flex items-start gap-1.5 min-w-0">
                        <FileText size={13} className="text-zinc-500 mt-0.5 shrink-0" />
                        <div className="min-w-0">
                          <p className="text-[11px] text-zinc-300 font-medium truncate" title={f.name}>{sanitize(f.name)}</p>
                          <p className="text-[8px] text-zinc-600 font-mono mt-0.5">sha: {f.hash}</p>
                        </div>
                      </div>
                      <button
                        onClick={() => handleFileRemoved(f.contractId)}
                        className="text-zinc-600 hover:text-red-400 p-0.5 rounded transition-colors"
                        aria-label="Remove contract"
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          </aside>

          {/* Right Main Panel — Chat Box */}
          <section className="glass-panel flex-1 flex flex-col rounded-2xl overflow-hidden shadow-2xl border border-zinc-800/40 min-h-0 relative">
            
            {/* Header info bar */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800/40 bg-zinc-900/10 shrink-0">
              <div className="flex items-center gap-1.5 text-xs text-zinc-400 font-medium">
                <Scale size={13} className="text-zinc-550" />
                <span>Audit Query Engine</span>
              </div>
              {messages.length > 0 && (
                <button
                  onClick={clearChat}
                  className="text-[10px] text-zinc-500 hover:text-zinc-300 flex items-center gap-1 transition-colors uppercase tracking-wider font-semibold"
                >
                  <Trash2 size={11} /> Clear Chat
                </button>
              )}
            </div>

            {/* Messages body */}
            <div className="flex-1 overflow-y-auto p-4 md:p-5 space-y-4 min-h-0 flex flex-col">
              {messages.length === 0 && (
                <div className="flex-1 flex flex-col items-center justify-center text-center p-6 space-y-3">
                  <Scale className="text-zinc-650 animate-pulse" size={28} />
                  <h3 className="text-xs font-medium text-zinc-400">Compliance Audit Chat</h3>
                  <p className="text-[11px] text-zinc-500 max-w-sm leading-relaxed">
                    Ask questions about your uploaded agreements. The RAG engine will extract matches and give direct, blunt opinions.
                  </p>
                </div>
              )}

              <div className="space-y-4">
                {messages.map((msg, idx) => (
                  <div
                    key={idx}
                    className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`max-w-[85%] rounded-2xl px-4 py-3 text-[13px] leading-relaxed shadow-md whitespace-pre-wrap ${
                        msg.role === "user"
                          ? "bg-zinc-800/95 border border-zinc-700/40 text-zinc-100 rounded-tr-none"
                          : "glass-panel text-zinc-200 rounded-tl-none border border-zinc-800/80"
                      }`}
                    >
                      {msg.role === "assistant" && (
                        <div className="flex items-center gap-1.5 mb-1.5 text-[9px] text-zinc-500 font-bold tracking-wider uppercase">
                          <Shield size={10} className="shrink-0" />
                          Audit Analysis
                        </div>
                      )}
                      <div className={msg.isStreaming ? "streaming-cursor" : ""}>
                        {renderHighlightedText(msg.content, msg.isStreaming)}
                        {!msg.content && msg.isStreaming && <span className="text-zinc-550 italic">Analyzing contract embeddings...</span>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <div ref={bottomRef} />
            </div>

            {/* Input Form */}
            <div className="border-t border-zinc-800/50 p-4 bg-zinc-900/20 flex gap-2 items-end shrink-0">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value.slice(0, 500))}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    sendQuery();
                  }
                }}
                placeholder={
                  hasDocuments
                    ? "Ask compliance questions or request opinions on the contract…"
                    : "Upload a contract document in the sidebar first…"
                }
                disabled={!hasDocuments || isQuerying}
                rows={2}
                className="flex-1 bg-zinc-900/60 border border-zinc-800 rounded-xl px-4 py-3 text-xs text-zinc-100 placeholder-zinc-500 resize-none focus:outline-none focus:border-zinc-700 focus:ring-1 focus:ring-zinc-700/20 disabled:opacity-50 transition-all"
              />
              
              <button
                onClick={() => sendQuery()}
                disabled={!hasDocuments || isQuerying || !input.trim()}
                className="bg-zinc-100 hover:bg-zinc-200 disabled:opacity-25 text-zinc-900 rounded-xl p-3 shadow-lg hover:scale-105 active:scale-95 transition-all shrink-0 duration-200"
                aria-label="Send Query"
              >
                {isQuerying ? (
                  <Loader2 size={16} className="animate-spin text-zinc-900" />
                ) : (
                  <Send size={16} />
                )}
              </button>
            </div>
          </section>
        </div>

        {/* Clear chat indicator */}
        {messages.length > 0 && (
          <p className="text-[10px] text-zinc-650 mt-1 text-right font-mono">
            {input.length}/500 chars.
          </p>
        )}
      </div>

      {/* Floating Action Button (FAB) for Note-taking */}
      <button
        onClick={() => setIsNotesOpen(!isNotesOpen)}
        className="fixed bottom-6 right-6 z-40 bg-zinc-100 hover:bg-zinc-200 text-zinc-900 rounded-full p-4 shadow-2xl hover:scale-105 active:scale-95 transition-all duration-200 border border-zinc-300"
        title="Open Study Notes"
        aria-label="Toggle notes drawer"
      >
        <Edit size={20} />
      </button>

      {/* Slide-over Note Taking Panel */}
      {isNotesOpen && (
        <div className="fixed inset-y-0 right-0 w-80 sm:w-96 bg-zinc-900 border-l border-zinc-800 shadow-2xl p-5 flex flex-col z-50 transition-all duration-300 animate-slide-in">
          <div className="flex items-center justify-between border-b border-zinc-800 pb-3 mb-4 shrink-0">
            <div className="flex items-center gap-2">
              <Edit size={16} className="text-zinc-400" />
              <h2 className="text-sm font-semibold text-zinc-200">Study Notes</h2>
            </div>
            <button
              onClick={() => setIsNotesOpen(false)}
              className="text-zinc-500 hover:text-zinc-200 transition-colors"
              aria-label="Close notes drawer"
            >
              <X size={18} />
            </button>
          </div>

          <p className="text-[11px] text-zinc-500 mb-4 leading-relaxed shrink-0">
            Record key findings, section citations, or high-risk clauses. Notes are auto-saved to your local session cache.
          </p>

          {/* Notes input form */}
          <div className="space-y-2 mb-4 shrink-0">
            <textarea
              value={noteInput}
              onChange={(e) => setNoteInput(e.target.value)}
              placeholder="Jot down a note..."
              rows={3}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-zinc-200 placeholder-zinc-650 resize-none focus:outline-none focus:border-zinc-700 focus:ring-1 focus:ring-zinc-700/20"
            />
            <button
              onClick={addNote}
              disabled={!noteInput.trim()}
              className="w-full bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 disabled:opacity-40 text-zinc-200 font-medium rounded-xl py-2 text-xs transition-colors shadow-sm"
            >
              Save Note
            </button>
          </div>

          {/* Notes List */}
          <div className="flex-1 overflow-y-auto space-y-3 pr-1 min-h-0">
            {notes.length === 0 ? (
              <p className="text-[11px] text-zinc-600 italic text-center py-6">No notes recorded yet.</p>
            ) : (
              notes.map((note) => (
                <div
                  key={note.id}
                  className="bg-zinc-950/60 border border-zinc-850 hover:border-zinc-800 rounded-xl p-3 flex flex-col justify-between gap-2 transition-colors relative group"
                >
                  <p className="text-xs text-zinc-300 leading-relaxed break-words whitespace-pre-wrap">{note.text}</p>
                  <div className="flex items-center justify-between border-t border-zinc-850 pt-2 mt-1 shrink-0">
                    <span className="text-[9px] text-zinc-650 font-mono">{note.timestamp}</span>
                    <button
                      onClick={() => deleteNote(note.id)}
                      className="text-zinc-600 hover:text-red-400 p-0.5 rounded transition-colors"
                      aria-label="Delete note"
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Copy and Export action */}
          {notes.length > 0 && (
            <div className="border-t border-zinc-800 pt-4 mt-4 shrink-0">
              <button
                onClick={copyAllNotes}
                className="w-full bg-zinc-900 hover:bg-zinc-850 border border-zinc-800 text-zinc-300 text-xs py-2 rounded-xl flex items-center justify-center gap-1.5 transition-colors font-medium shadow-sm"
              >
                <Copy size={13} />
                <span>Copy All Notes</span>
              </button>
            </div>
          )}
        </div>
      )}
    </main>
  );
}
