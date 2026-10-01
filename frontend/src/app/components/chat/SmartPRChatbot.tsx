"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MessageCircle, Send, X } from "lucide-react";
import { OPEN_CHAT_EVENT } from "./openChat";

interface ChatProfile {
  name?: string | null;
  business_type?: string | null;
  industry?: string | null;
  municipality?: string | null;
  business_structure?: string | null;
  location_type?: string | null;
}

interface ChatRequirement {
  code: string;
  name: string;
  status?: string;
  mandatory?: boolean;
  agency?: string;
}

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface Props {
  profile: ChatProfile;
  requirements: ChatRequirement[];
  language: "en" | "es";
}

/** Starters are drawn from this filing's own requirements, so the first tap
 *  already asks something specific rather than opening an empty box. */
function starters(requirements: ChatRequirement[], es: boolean): string[] {
  const pending = requirements.filter((r) => r.status !== "passed");
  const first = pending.find((r) => r.mandatory) ?? pending[0] ?? requirements[0];
  const list = [
    es ? "¿Qué debo hacer primero?" : "What should I do first?",
    first && (es ? `¿Por qué necesito ${first.name}?` : `Why do I need ${first.name}?`),
    es ? "¿Qué me falta todavía?" : "What am I still missing?",
  ].filter((value): value is string => Boolean(value));
  return list.slice(0, 3);
}

export function SmartPRChatbot({ profile, requirements, language }: Props) {
  const es = language === "es";
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  const panelRef = useRef<HTMLDivElement>(null);
  const fabRef = useRef<HTMLButtonElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    fabRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target) || fabRef.current?.contains(target)) return;
      close();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open, close]);

  useEffect(() => {
    if (open) window.setTimeout(() => inputRef.current?.focus(), 120);
  }, [open]);

  useEffect(() => {
    const onOpen = (e: Event) => {
      const question = (e as CustomEvent<{ question?: string | null }>).detail?.question;
      if (question) setInput(question);
      setOpen(true);
    };
    window.addEventListener(OPEN_CHAT_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_CHAT_EVENT, onOpen);
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: messages.length > 1 ? "smooth" : "auto", block: "end" });
  }, [messages, loading]);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 112)}px`;
  }, [input]);

  const send = useCallback(async (text: string) => {
    const question = text.trim();
    if (!question || loading) return;
    const next: Message[] = [...messages, { role: "user", content: question }];
    setMessages(next);
    setInput("");
    setLoading(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next, context: { profile, requirements, language } }),
      });
      const data = (await res.json()) as { reply?: string };
      setMessages((prev) => [...prev, { role: "assistant", content: data.reply || (es ? "Sin respuesta." : "No response.") }]);
    } catch {
      setMessages((prev) => [...prev, {
        role: "assistant",
        content: es ? "No pude responder ahora mismo. Inténtalo de nuevo." : "I couldn't answer just now. Please try again.",
      }]);
    } finally {
      setLoading(false);
    }
  }, [messages, loading, profile, requirements, language, es]);

  const chips = useMemo(() => starters(requirements, es), [requirements, es]);
  const subtitle = profile.name?.trim()
    || (es ? "Tu radicación en Puerto Rico" : "Your Puerto Rico filing");

  const toggle = useCallback(() => setOpen((prev) => !prev), []);

  return (
    <>
      <button
        ref={fabRef}
        type="button"
        className={`rq-floating-help${open ? " active" : ""}`}
        title={es ? "Chatear con SmartPR" : "Chat with SmartPR"}
        aria-label={es ? "Chatear con SmartPR" : "Chat with SmartPR"}
        aria-expanded={open}
        onClick={toggle}
      >
        <MessageCircle className="spr-fab-icon open" size={22} />
        <X className="spr-fab-icon close" size={22} />
      </button>

      {open && (
        <div
          ref={panelRef}
          className="spr-chat-panel open"
          role="dialog"
          aria-label={es ? "Asistente SmartPR" : "SmartPR Assistant"}
        >
          <header className="spr-chat-header">
            <span className="spr-chat-mark" aria-hidden="true" />
            <div className="spr-chat-heading">
              <strong>{es ? "Asistente SmartPR" : "SmartPR Assistant"}</strong>
              <span>{subtitle}</span>
            </div>
            <button type="button" className="spr-chat-close" onClick={close} aria-label={es ? "Cerrar" : "Close"}>
              <X size={16} strokeWidth={2.2} />
            </button>
          </header>

          <div className="spr-chat-body">
            <p className="spr-chat-intro">
              {es
                ? "Puedo responder sobre los requisitos de esta radicación: qué son, por qué aparecen y qué sigue."
                : "I can answer questions about this filing's requirements — what they are, why they appeared, and what comes next."}
            </p>

            {messages.map((m, i) => (
              <div key={i} className={`spr-chat-bubble ${m.role}`}>{m.content}</div>
            ))}

            {loading && (
              <div className="spr-chat-bubble assistant">
                <span className="spr-chat-typing" aria-label={es ? "Escribiendo" : "Typing"}>
                  <span /><span /><span />
                </span>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {messages.length === 0 && !loading && chips.length > 0 && (
            <div className="spr-chat-chips">
              {chips.map((chip) => (
                <button key={chip} type="button" className="spr-chat-chip" onClick={() => void send(chip)}>
                  {chip}
                </button>
              ))}
            </div>
          )}

          <div className="spr-chat-composer">
            <textarea
              ref={inputRef}
              rows={1}
              className="spr-chat-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(input); }
              }}
              placeholder={es ? "Escribe una pregunta…" : "Ask a question…"}
              maxLength={500}
              aria-label={es ? "Tu pregunta" : "Your question"}
            />
            <button
              type="button"
              className="spr-chat-send"
              onClick={() => void send(input)}
              disabled={loading || !input.trim()}
              aria-label={es ? "Enviar" : "Send"}
            >
              <Send size={15} strokeWidth={2.2} />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
