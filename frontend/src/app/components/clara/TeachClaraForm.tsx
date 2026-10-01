"use client";

// Teach Clara — "describe it" (v1). The person tells Clara how a filing is
// done: the portal address, the steps in their own words, optional
// screenshots / a screen recording, and which business detail goes into
// which portal field. Saved per requirement + portal (POST
// /api/clara-playbooks); Clara's runs on that portal read it as guidance.
// Signed out: kept on this device until they sign in.
//
// Used in the requirement rows' Teach Clara dialog (light) and on the
// /businesses/[id]/teach page next to the live walkthrough (dark).

import { useEffect, useState } from "react";
import { CheckCircle2, GraduationCap, Loader2, Plus, Trash2, Upload } from "lucide-react";
import { PASSPORT_CATALOG } from "../../../lib/agency-runs/teach/passportCatalog";

type Language = "en" | "es";

export interface TeachTarget {
  requirementKey: string;
  requirementName: string;
  agency?: string | null;
  portalUrl?: string | null;
}

interface Attachment { name: string; type: string; size: number; data_url: string | null }
interface SavedPlaybook { id: string; version: number; updated_at: string; steps: string[]; portal_url: string; bindings: { label: string; path: string | null; source: string }[]; notes: string | null; attachments: { name: string; type: string; size: number }[] }

const MAX_FILE = 4 * 1024 * 1024;
const localKey = (k: string) => `smartpr.teach.v1.${k}`;

function readFile(f: File): Promise<Attachment> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve({ name: f.name, type: f.type, size: f.size, data_url: typeof r.result === "string" ? r.result : null });
    r.onerror = () => reject(r.error);
    r.readAsDataURL(f);
  });
}

export function TeachClaraForm({
  target,
  language,
  tone = "light",
  liveHref,
  onSaved,
  initialSteps,
  variant = "describe",
}: {
  target: TeachTarget;
  language: Language;
  tone?: "light" | "dark";
  liveHref?: string | null;
  onSaved?: () => void;
  /** Draft steps (e.g. read from an uploaded screen recording). */
  initialSteps?: string[];
  /** "edit" = the secondary typed-steps view (record-first Teach is the entry point). */
  variant?: "describe" | "edit";
}) {
  const es = language === "es";
  const T = (en: string, sp: string) => (es ? sp : en);
  // A description kept on this device (signed out) comes back too.
  const [local] = useState<{ portal_url: string; steps: string[]; bindings: { label: string; path: string | null }[]; notes: string | null } | null>(() => {
    try {
      const raw = typeof window !== "undefined" ? window.localStorage.getItem(localKey(target.requirementKey)) : null;
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  });
  const [portalUrl, setPortalUrl] = useState(target.portalUrl || local?.portal_url || "");
  const hasInitialSteps = Boolean(initialSteps?.length);
  const [steps, setSteps] = useState<string[]>(initialSteps?.length ? initialSteps : local?.steps?.length ? local.steps : ["", "", ""]);
  const [bindings, setBindings] = useState<{ label: string; path: string }[]>(local?.bindings?.length ? local.bindings.map((x) => ({ label: x.label, path: x.path ?? "" })) : [{ label: "", path: "" }]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [notes, setNotes] = useState(local?.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ where: "account" | "device"; version?: number } | null>(null);
  const [known, setKnown] = useState<SavedPlaybook | null>(null);
  const [liveAvailable, setLiveAvailable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const q = new URLSearchParams({ requirement_key: target.requirementKey });
    if (target.portalUrl) q.set("portal_url", target.portalUrl);
    fetch(`/api/clara-playbooks?${q}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { live_recorder?: boolean; playbooks?: SavedPlaybook[] } | null) => {
        if (cancelled || !body) return;
        setLiveAvailable(Boolean(body.live_recorder));
        const pb = body.playbooks?.[0];
        if (pb) {
          setKnown(pb);
          if (hasInitialSteps) return;
          setPortalUrl(pb.portal_url);
          setSteps(pb.steps.length ? pb.steps : ["", "", ""]);
          setBindings(pb.bindings.length ? pb.bindings.map((b) => ({ label: b.label, path: b.path ?? "" })) : [{ label: "", path: "" }]);
          setNotes(pb.notes ?? "");
        }
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [target.requirementKey, target.portalUrl, hasInitialSteps]);

  const addFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setError(null);
    const next: Attachment[] = [];
    for (const f of Array.from(files).slice(0, 6 - attachments.length)) {
      if (!/^(image\/(png|jpeg|webp|gif)|video\/(mp4|webm|quicktime))$/.test(f.type)) {
        setError(T("Screenshots (PNG/JPEG) or a screen recording (MP4/WebM/MOV) only.", "Solo capturas (PNG/JPEG) o una grabación de pantalla (MP4/WebM/MOV)."));
        continue;
      }
      if (f.size > MAX_FILE) {
        setError(T(`${f.name} is over 4 MB — trim the recording or use screenshots.`, `${f.name} pasa de 4 MB — recorta la grabación o usa capturas.`));
        continue;
      }
      next.push(await readFile(f));
    }
    setAttachments((a) => [...a, ...next]);
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    const body = {
      requirement_key: target.requirementKey,
      requirement_name: target.requirementName,
      agency: target.agency ?? null,
      portal_url: portalUrl.trim(),
      steps: steps.map((s) => s.trim()).filter(Boolean),
      bindings: bindings.filter((b) => b.label.trim()).map((b) => ({ label: b.label.trim(), path: b.path || null })),
      attachments,
      notes: notes.trim() || null,
    };
    try {
      const res = await fetch("/api/clara-playbooks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const out = await res.json().catch(() => ({}));
      if (res.status === 401) {
        if (!/^https?:\/\//i.test(body.portal_url)) throw new Error(T("Add the portal address (https://…).", "Añade la dirección del portal (https://…)."));
        if (!body.steps.length) throw new Error(T("Describe at least one step.", "Describe al menos un paso."));
        window.localStorage.setItem(localKey(target.requirementKey), JSON.stringify({ ...body, attachments: [] }));
        setResult({ where: "device" });
      } else if (!res.ok) {
        const m = (out as { message?: string | { en: string; es: string } }).message;
        throw new Error(typeof m === "string" ? m : m ? (es ? m.es : m.en) : T("Could not save. Try again.", "No se pudo guardar. Intenta otra vez."));
      } else {
        window.localStorage.removeItem(localKey(target.requirementKey));
        setResult({ where: "account", version: (out as { playbook?: { version: number } }).playbook?.version });
      }
      onSaved?.();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (result) {
    return (
      <div className={`tc tc-${tone} tc-done`} data-testid="teach-saved">
        <CheckCircle2 size={28} aria-hidden="true" />
        <p className="tc-title">{T("Clara learned it.", "Clara se lo aprendió.")}</p>
        <p>
          {result.where === "account"
            ? T(`Saved${result.version ? ` (version ${result.version})` : ""}. Next time Clara files this on ${portalUrl.replace(/^https?:\/\//, "").split("/")[0]}, she follows your steps and stops wherever you're needed.`,
                `Guardado${result.version ? ` (versión ${result.version})` : ""}. La próxima vez que Clara radique esto en ${portalUrl.replace(/^https?:\/\//, "").split("/")[0]}, sigue tus pasos y se detiene donde te necesite.`)
            : T("Saved on this device. Sign in so Clara can use it when she files for you.", "Guardado en este dispositivo. Entra a tu cuenta para que Clara lo use cuando radique por ti.")}
        </p>
      </div>
    );
  }

  return (
    <div className={`tc tc-${tone}`} data-testid="teach-form">
      <p className="tc-intro">
        <GraduationCap size={18} aria-hidden="true" />
        <span>
          {variant === "edit" && !known
            ? T("Typed steps are a guide: Clara follows them toward the goal and stops for sign-in, uploads, payment and the final submit. For an exact routine she repeats step by step, record it once on a computer.",
                "Los pasos escritos son una guía: Clara los sigue hacia la meta y se detiene para entrar, subir documentos, pagar y el envío final. Para una rutina exacta que repite paso a paso, grábala una vez en una computadora.")
            : known
            ? T(`Clara already has your steps (version ${known.version}). Change anything and save a new version.`, `Clara ya tiene tus pasos (versión ${known.version}). Cambia lo que quieras y guarda una versión nueva.`)
            : T("Clara hasn't learned this portal yet. Tell her how it's done once — she'll follow it next time, fill in the business's info, and stop for sign-in, uploads, payment and the final submit.",
                "Clara todavía no conoce este portal. Explícale una vez cómo se hace — la próxima vez lo sigue, llena la información del negocio y se detiene para entrar a la cuenta, subir documentos, pagar y el envío final.")}
        </span>
      </p>

      <label className="tc-field">
        <span>{T("Portal address", "Dirección del portal")}</span>
        <input value={portalUrl} onChange={(e) => setPortalUrl(e.target.value)} placeholder="https://…pr.gov" data-testid="teach-portal" />
      </label>

      <div className="tc-field">
        <span>{T("The steps, in your words", "Los pasos, en tus palabras")}</span>
        <ol className="tc-steps">
          {steps.map((s, i) => (
            <li key={i}>
              <textarea
                rows={2}
                value={s}
                onChange={(e) => setSteps((all) => all.map((x, j) => (j === i ? e.target.value : x)))}
                placeholder={[
                  T("e.g. Sign in with the business account", "p. ej. Entra con la cuenta del negocio"),
                  T("e.g. New application → choose the permit type", "p. ej. Nueva solicitud → escoge el tipo de permiso"),
                  T("e.g. Upload the site plan on the Documents tab", "p. ej. Sube el plano del lugar en la pestaña Documentos"),
                ][i] ?? ""}
                aria-label={T(`Step ${i + 1}`, `Paso ${i + 1}`)}
                data-testid="teach-step"
              />
              {steps.length > 1 && (
                <button type="button" className="tc-icon" onClick={() => setSteps((all) => all.filter((_, j) => j !== i))} aria-label={T("Remove step", "Quitar paso")}>
                  <Trash2 size={15} aria-hidden="true" />
                </button>
              )}
            </li>
          ))}
        </ol>
        <button type="button" className="tc-add" onClick={() => setSteps((s) => [...s, ""])}><Plus size={15} aria-hidden="true" /> {T("Add a step", "Añadir paso")}</button>
      </div>

      <div className="tc-field">
        <span>{T("Which business detail goes where (optional)", "Qué dato del negocio va dónde (opcional)")}</span>
        {bindings.map((b, i) => (
          <div key={i} className="tc-binding">
            <input value={b.label} onChange={(e) => setBindings((all) => all.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} placeholder={T("Field name on the portal", "Nombre del campo en el portal")} aria-label={T("Portal field", "Campo del portal")} />
            <select value={b.path} onChange={(e) => setBindings((all) => all.map((x, j) => (j === i ? { ...x, path: e.target.value } : x)))} aria-label={T("Business detail", "Dato del negocio")}>
              <option value="">{T("Ask me each time", "Pregúntame cada vez")}</option>
              {PASSPORT_CATALOG.map((e) => <option key={e.path} value={e.path}>{es ? e.es : e.en}</option>)}
            </select>
          </div>
        ))}
        <button type="button" className="tc-add" onClick={() => setBindings((b) => [...b, { label: "", path: "" }])}><Plus size={15} aria-hidden="true" /> {T("Add a field", "Añadir campo")}</button>
      </div>

      <div className="tc-field">
        <span>{T("Screenshots or a screen recording (optional)", "Capturas o una grabación de pantalla (opcional)")}</span>
        <label className="tc-upload">
          <Upload size={15} aria-hidden="true" /> {T("Add files", "Añadir archivos")}
          <input type="file" multiple accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm,video/quicktime" onChange={(e) => { void addFiles(e.target.files); e.target.value = ""; }} data-testid="teach-files" />
        </label>
        {attachments.length > 0 && (
          <ul className="tc-files">
            {attachments.map((a, i) => (
              <li key={`${a.name}-${i}`}>
                {a.name} <span className="tc-muted">({Math.ceil(a.size / 1024)} KB)</span>
                <button type="button" className="tc-icon" onClick={() => setAttachments((all) => all.filter((_, j) => j !== i))} aria-label={T("Remove", "Quitar")}><Trash2 size={14} aria-hidden="true" /></button>
              </li>
            ))}
          </ul>
        )}
        {known && known.attachments.length > 0 && attachments.length === 0 && (
          <p className="tc-muted">{T(`${known.attachments.length} file(s) from the last version are kept only if you add them again.`, `${known.attachments.length} archivo(s) de la versión anterior se guardan solo si los vuelves a añadir.`)}</p>
        )}
      </div>

      <label className="tc-field">
        <span>{T("Anything else Clara should know (optional)", "Algo más que Clara deba saber (opcional)")}</span>
        <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>

      <p className="tc-muted">{T("Never type passwords, SSNs or codes here — Clara always asks you for those on the spot.", "Nunca escribas contraseñas, seguros sociales ni códigos aquí — Clara siempre te los pide en el momento.")}</p>
      {error && <p className="tc-error" role="alert">{error}</p>}

      <div className="tc-actions">
        <button type="button" className="tc-primary" onClick={save} disabled={busy} data-testid="teach-save">
          {busy ? <Loader2 size={15} className="tc-spin" aria-hidden="true" /> : <GraduationCap size={15} aria-hidden="true" />}
          {T("Save what Clara learned", "Guardar lo que Clara aprendió")}
        </button>
        {liveHref && (
          <a className="tc-secondary" href={liveHref} data-testid="teach-live">
            {liveAvailable ? T("Or show her live in the browser", "O muéstraselo en vivo en el navegador") : T("Live walkthrough (needs Clara's browser)", "Recorrido en vivo (requiere el navegador de Clara)")}
          </a>
        )}
      </div>
    </div>
  );
}
