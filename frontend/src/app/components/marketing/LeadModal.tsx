"use client";

import { useState } from "react";
import styles from "./marketing.module.css";
import type { Language } from "./MarketingChrome";

const copy = {
  EN: {
    title: "Before you start",
    body: "Leave your name and email so we can save your progress and follow up. That's it — no spam, ever.",
    name: "Name",
    email: "Email",
    phone: "Phone (optional)",
    invalidEmail: "Enter a valid email to continue.",
    cancel: "Cancel",
    submit: "Start my application",
    thanksTitle: "You're on the list.",
    thanksBody: "Thanks — we'll be in touch to set up your firm's pilot workspace.",
    done: "Done",
  },
  ES: {
    title: "Antes de empezar",
    body: "Déjanos tu nombre y tu email para guardarte el progreso y darte seguimiento. Eso es todo — cero spam.",
    name: "Nombre",
    email: "Email",
    phone: "Teléfono (opcional)",
    invalidEmail: "Escribe un email válido para continuar.",
    cancel: "Cancelar",
    submit: "Comenzar mi solicitud",
    thanksTitle: "Ya estás en la lista.",
    thanksBody: "Gracias — nos comunicaremos para montar el espacio piloto de su firma.",
    done: "Listo",
  },
} as const;

/** Lead-capture dialog used by every "start" entry point. Posts to /api/leads
 * with the given source; capture failures never block the flow. */
export default function LeadModal({
  language,
  open,
  source,
  onClose,
  onDone,
  successMode,
}: {
  language: Language;
  open: boolean;
  /** Lead source recorded in /api/leads, e.g. "landing_start_assessment". */
  source: string;
  onClose: () => void;
  /** Called after a successful capture when successMode is "close". */
  onDone: () => void;
  /** "close": close and call onDone. "confirm": show a thanks message. */
  successMode: "close" | "confirm";
}) {
  const c = copy[language];
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [succeeded, setSucceeded] = useState(false);

  if (!open) return null;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const trimmedEmail = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setError(c.invalidEmail);
      return;
    }
    setBusy(true);
    try {
      await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          email: trimmedEmail,
          phone: phone.trim() || undefined,
          source,
          language: language.toLowerCase(),
        }),
      });
    } catch {
      // A failed capture must never block the flow.
    } finally {
      setBusy(false);
    }
    if (successMode === "confirm") {
      setSucceeded(true);
    } else {
      onClose();
      onDone();
    }
  }

  function close() {
    if (busy) return;
    setSucceeded(false);
    setError(null);
    onClose();
  }

  return (
    <div className={styles.leadOverlay} onClick={close}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={c.title}
        className={styles.leadDialog}
        onClick={(event) => event.stopPropagation()}
      >
        {succeeded ? (
          <>
            <h2 className={styles.leadTitle}>{c.thanksTitle}</h2>
            <p className={styles.leadBody}>{c.thanksBody}</p>
            <div className={styles.leadActions}>
              <button type="button" className={styles.primary} onClick={close}>
                {c.done}
              </button>
            </div>
          </>
        ) : (
          <>
            <h2 className={styles.leadTitle}>{c.title}</h2>
            <p className={styles.leadBody}>{c.body}</p>
            <form onSubmit={submit}>
              <label className={styles.leadField}>
                {c.name}
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder={c.name}
                  autoComplete="name"
                  maxLength={120}
                  enterKeyHint="next"
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      event.currentTarget.form?.requestSubmit();
                    }
                  }}
                />
              </label>
              <label className={styles.leadField}>
                {c.email}
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="tu@email.com"
                  autoComplete="email"
                  maxLength={160}
                  required
                  enterKeyHint="next"
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      event.currentTarget.form?.requestSubmit();
                    }
                  }}
                />
              </label>
              <label className={styles.leadField}>
                {c.phone}
                <input
                  type="tel"
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  autoComplete="tel"
                  maxLength={40}
                  enterKeyHint="go"
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      event.currentTarget.form?.requestSubmit();
                    }
                  }}
                />
              </label>
              {error && <p className={styles.leadError}>{error}</p>}
              <div className={styles.leadActions}>
                <button type="button" className={styles.leadCancel} disabled={busy} onClick={close}>
                  {c.cancel}
                </button>
                <button type="submit" className={styles.primary} disabled={busy}>
                  {busy ? "…" : c.submit}
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
