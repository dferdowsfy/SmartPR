"use client";

// ============================================================================
// GovernmentFormModal — self-contained worksheet modal for a single government
// form (Parts 13–14). Encapsulates the renderer, review/preview toggle, action
// bar, completion validation, canonical write-back, and preparation-PDF export
// so the host page only manages "which form is open" and the prepared-app list.
//
// Completing the form (after the review step) finalizes everything in one
// action: the application is recorded, the finished PDF is handed to the host,
// and the modal closes. The host marks its requirement row complete; reopening
// the form shows the prepared document (view it, download the official PDF,
// edit the answers, or mark it submitted to the agency).
// ============================================================================

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GovernmentFormRenderer } from "./GovernmentFormRenderer.tsx";
import { GovernmentFormPreview } from "./GovernmentFormPreview.tsx";
import { GovernmentFormActions } from "./GovernmentFormActions.tsx";
import { GovernmentSubmissionPanel } from "../submission/GovernmentSubmissionPanel.tsx";
import { governmentFeeText } from "../submission/pr.ts";
import { validateForm, type FieldError } from "./formValidation.ts";
import { prefillFromCanonical, writeBackToCanonical } from "./canonicalMapping.ts";
import { persistableFormData } from "./formDataPrivacy.ts";
import { buildGeneratedApplication } from "./application.ts";
import { generatePreparationPdf } from "./pdfGenerator.ts";
import { getTemplate, isOfficialArtifact } from "../artifacts/catalog.ts";
import type {
  ApplicationStatus,
  CanonicalApplicationData,
  DigitalFormDefinition,
  FormData,
  GeneratedApplication,
  Lang,
} from "./types.ts";
import { localize } from "./types.ts";

/** The official government PDF as the populate route returns it. */
interface PopulatedArtifact {
  blob: Blob;
  populated: number;
  unanswered: number;
}

export interface GovernmentFormModalProps {
  definition: DigitalFormDefinition;
  requirementCode: string;
  canonical: CanonicalApplicationData;
  lang: Lang;
  initialData?: FormData;
  initialMode?: "edit" | "view";
  existingApplicationId?: string;
  /** Status of the already-prepared application, when one exists. */
  applicationStatus?: ApplicationStatus;
  onClose: () => void;
  onSaveDraft: (formId: string, data: FormData) => void;
  onCanonicalChange: (canonical: CanonicalApplicationData, changedKeys: string[]) => void;
  onComplete: (app: GeneratedApplication, data: FormData) => void;
  /** Applicant's own confirmation that they filed with the agency. */
  onMarkSubmitted?: (formId: string) => void;
  /**
   * Optional hook for hosts (e.g. the business profile page) that want the
   * finished PDF bytes instead of just a download. When provided, completing
   * the document awaits this callback with the populated official PDF (or the
   * SmartPR preparation worksheet when no official artifact exists) before the
   * application is recorded and the modal closes. A rejection keeps the modal
   * open and surfaces the error.
   */
  onPdfReady?: (pdf: { blob: Blob; filename: string }) => Promise<void>;
  /**
   * Optional [en, es] override for the final "Complete" button, for hosts
   * whose save destination isn't the intake's deliverables list.
   */
  completeLabels?: [string, string];
  /**
   * When the host already knows the workspace can't use deliverables (e.g.
   * from /api/billing/entitlements), open the modal directly on the upgrade
   * panel instead of the form. The server-side /populate gate remains the
   * source of truth; this only controls what the user sees first.
   */
  initialPaywallCode?: "auth_required" | "plan_deliverables_locked";
}

export function GovernmentFormModal(props: GovernmentFormModalProps) {
  const { definition, canonical, lang, initialData, initialMode, existingApplicationId, applicationStatus, onClose, onSaveDraft, onCanonicalChange, onComplete, onMarkSubmitted, onPdfReady, completeLabels, initialPaywallCode } = props;
  const L = (en: string, es: string) => (lang === "es" ? es : en);
  const completeLabel = completeLabels ? (lang === "es" ? completeLabels[1] : completeLabels[0]) : L("Complete and add", "Completar y añadir");

  const [data, setData] = useState<FormData>(() => prefillFromCanonical(definition, canonical, initialData ?? {}));
  const [mode, setMode] = useState<"edit" | "review" | "view">(initialMode ?? "edit");
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  // Finalize-step state: completing runs validation, the host PDF handoff, and
  // the close. A failure keeps the modal open with the error — the
  // applicant's answers are never lost.
  const [completing, setCompleting] = useState(false);
  const [completeError, setCompleteError] = useState<string | null>(null);

  const fee = useMemo(() => governmentFeeText(definition.id, canonical, lang), [definition.id, canonical, lang]);

  // Whether SmartPR actually holds this agency's official PDF and can
  // populate it directly. Pure catalog lookup (no filesystem access), safe to
  // run in the browser.
  const hasRealArtifact = useMemo(() => {
    const template = getTemplate(definition.officialFormNumber);
    return Boolean(template && isOfficialArtifact(template));
  }, [definition.officialFormNumber]);

  // Every mode whose footer renders the download button. Kept next to that
  // footer condition so the two cannot drift apart.
  const offersDownload = mode === "review" || mode === "view";

  // The literal government PDF, populated server-side (population reads the
  // source file from disk, so this has to be a request, not a client render).
  // Not reset when a new request starts: while a refetch (e.g. after "Back to
  // edit" → complete again) is in flight, the previous result stays on screen
  // rather than flashing a loading state, and is replaced once the new one lands.
  const [realArtifact, setRealArtifact] = useState<PopulatedArtifact | null>(null);
  const [realArtifactError, setRealArtifactError] = useState<string | null>(null);
  // Set when /populate answers 402, or upfront via initialPaywallCode: the
  // completed document sits behind the paywall. No download, no confirm, no
  // worksheet fallback while set — the upgrade panel is the only action.
  const [paywallCode, setPaywallCode] = useState<string | null>(() => initialPaywallCode ?? null);
  // Host already knew the workspace was locked: open directly on the upgrade
  // panel instead of making the user fill the form first.
  const upfrontLocked = initialPaywallCode != null;

  // One in-flight population per (form, profile), shared by the preview below
  // and the download button. Without this the download would either fire its
  // own duplicate request or — worse — proceed with no official PDF at all.
  const pendingPopulation = useRef<{ key: string; promise: Promise<PopulatedArtifact> } | null>(null);
  const populationKey = `${definition.officialFormNumber}:${JSON.stringify(canonical)}:${JSON.stringify(data)}`;

  const requestOfficialPdf = useCallback((): Promise<PopulatedArtifact> => {
    const cached = pendingPopulation.current;
    if (cached?.key === populationKey) return cached.promise;
    const promise = (async () => {
      const res = await fetch(`/api/forms/artifacts/${definition.officialFormNumber}/populate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ profile: canonical, formData: data }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}) as { error?: string; code?: string });
        const err = new Error(errBody.error ?? `HTTP ${res.status}`) as Error & {
          status?: number;
          code?: string;
        };
        err.status = res.status;
        err.code = errBody.code;
        throw err;
      }
      return {
        blob: await res.blob(),
        populated: Number(res.headers.get("x-smartpr-populated-fields") ?? 0),
        unanswered: Number(res.headers.get("x-smartpr-unanswered-fields") ?? 0),
      };
    })();
    // A rejected promise must not be cached, or every later retry replays the
    // same failure instead of actually asking again.
    promise.catch(() => {
      if (pendingPopulation.current?.promise === promise) pendingPopulation.current = null;
    });
    pendingPopulation.current = { key: populationKey, promise };
    return promise;
  }, [populationKey, definition.officialFormNumber, canonical, data]);

  // Warmed for every mode that offers a download — including "review", where
  // the download button is on screen but no preview is. Fetching only in
  // "view" is what used to leave the download with nothing official to
  // hand over, so it silently produced the SmartPR worksheet instead.
  const wantsRealArtifact = offersDownload && hasRealArtifact;
  // Derived, not stored: loading is exactly "expecting a real artifact but
  // don't have one or a failure yet".
  const realArtifactLoading = wantsRealArtifact && !realArtifact && !realArtifactError && !paywallCode;

  useEffect(() => {
    if (!wantsRealArtifact) return;
    // A superseded request (deps changed again before this one resolved) must
    // never overwrite a fresher result — `cancelled` guards every setState.
    let cancelled = false;
    void requestOfficialPdf().then(
      (artifact) => { if (!cancelled) { setRealArtifact(artifact); setRealArtifactError(null); setPaywallCode(null); } },
      (err: unknown) => {
        if (cancelled) return;
        const code = err instanceof Error ? (err as Error & { code?: string }).code ?? null : null;
        const status = err instanceof Error ? (err as Error & { status?: number }).status ?? null : null;
        if (status === 402 && (code === "plan_deliverables_locked" || code === "auth_required")) {
          setPaywallCode(code);
          setRealArtifactError(null);
        } else {
          setPaywallCode(null);
          setRealArtifactError(err instanceof Error ? err.message : String(err));
        }
      }
    );
    return () => {
      cancelled = true;
    };
  }, [wantsRealArtifact, requestOfficialPdf]);

  const realArtifactUrl = useMemo(() => (realArtifact ? URL.createObjectURL(realArtifact.blob) : null), [realArtifact]);
  useEffect(() => {
    return () => {
      if (realArtifactUrl) URL.revokeObjectURL(realArtifactUrl);
    };
  }, [realArtifactUrl]);

  // What the "view" step shows when reopening a prepared application: the
  // real government PDF when it loaded, nothing otherwise.
  const showingRealArtifact = hasRealArtifact && !!realArtifactUrl;
  const displayedPreviewUrl = realArtifactUrl;
  // Paywall: completed documents (official populated PDFs and preparation
  // worksheets alike) require a plan with deliverables.
  const paywalled = paywallCode !== null;

  // The submission step belongs to a prepared application: when its owner
  // reopens it in "view" mode.
  const showSubmissionPanel = mode === "view" && !!existingApplicationId;

  const setField = (fieldId: string, value: unknown) => {
    draftDirty.current = true;
    setData((prev) => ({ ...prev, [fieldId]: value as never }));
  };

  const persistCanonical = useCallback(() => {
    const { canonical: updated, changedKeys } = writeBackToCanonical(definition, data, canonical);
    if (changedKeys.length > 0) onCanonicalChange(updated, changedKeys);
    return updated;
  }, [definition, data, canonical, onCanonicalChange]);

  const draftDirty = useRef(false);
  const saveDraft = useCallback(() => {
    draftDirty.current = false;
    persistCanonical();
    onSaveDraft(definition.id, persistableFormData(definition, data));
  }, [persistCanonical, onSaveDraft, definition, data]);

  // All worksheet answers autosave. Transient taxpayer identifiers are
  // removed before this callback reaches the workflow snapshot.
  useEffect(() => {
    if (!draftDirty.current || mode === "view") return;
    const timer = window.setTimeout(saveDraft, 650);
    return () => window.clearTimeout(timer);
  }, [data, mode, saveDraft]);

  const handleClose = () => {
    if (draftDirty.current && mode !== "view") saveDraft();
    onClose();
  };

  // Completing the form finalizes everything in one action: the built
  // application is handed to the host (and the finished PDF to onPdfReady,
  // when the host consumes it), then the modal closes. The host marks its
  // requirement row complete; the applicant can reopen the form any time to
  // view the PDF, edit the answers, or mark it submitted.
  const bodyRef = useRef<HTMLDivElement>(null);
  const scrollToField = (fieldId: string) => {
    document.getElementById(`govfield-${fieldId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  };
  const handleComplete = async () => {
    if (completing) return;
    const found = validateForm(definition, data, canonical);
    if (found.length > 0) {
      setErrors(found);
      setMode("edit");
      // Bring the error summary into view so the user knows exactly what
      // is missing — without it the form just sits there silently.
      requestAnimationFrame(() => bodyRef.current?.scrollTo({ top: 0, behavior: "smooth" }));
      return;
    }
    setErrors([]);
    // Belt and suspenders: the footer hides the complete button when
    // paywalled, but never let a locked session produce a document.
    if (paywalled) return;
    setCompleting(true);
    setCompleteError(null);
    try {
      const updated = persistCanonical();
      const durableData = persistableFormData(definition, data);
      const app = buildGeneratedApplication(definition, durableData, updated, { id: existingApplicationId, status: "prepared", lang });
      if (onPdfReady) {
        // Hand the finished PDF to the host (upload, attach, …) before the
        // application is recorded and the modal closes.
        const filename = `${definition.officialFormNumber}_${localize(definition.title, lang).replace(/\s+/g, "_")}.pdf`;
        let blob: Blob;
        if (hasRealArtifact) {
          try {
            blob = (await requestOfficialPdf()).blob;
          } catch {
            blob = generatePreparationPdf(definition, durableData, canonical, lang);
          }
        } else {
          blob = generatePreparationPdf(definition, durableData, canonical, lang);
        }
        await onPdfReady({ blob, filename });
      }
      onComplete(app, durableData);
      onClose();
    } catch (err) {
      // Stay open: the applicant's work is safe, only the handoff failed.
      setCompleteError(err instanceof Error ? err.message : String(err));
      setCompleting(false);
    }
  };

  const saveBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const downloadPdf = async () => {
    // Locked sessions get no document at all — not even the client-generated
    // preparation worksheet. The button is hidden when paywalled; this is the
    // backstop.
    if (paywalled) return;
    const filename = `${definition.officialFormNumber}_${localize(definition.title, lang).replace(/\s+/g, "_")}.pdf`;

    // No official file in the template library for this form: the SmartPR
    // preparation worksheet is genuinely the deliverable, and the button says so.
    if (!hasRealArtifact) {
      saveBlob(generatePreparationPdf(definition, data, canonical, lang), filename);
      return;
    }

    // SmartPR holds the agency's own PDF, so the download is that PDF —
    // waiting for the population to finish if it is still in flight. It must
    // never quietly substitute the SmartPR-drafted worksheet: the applicant
    // asked for the official form and would file whatever this hands them.
    setDownloading(true);
    setDownloadError(null);
    try {
      const artifact = await requestOfficialPdf();
      setRealArtifact(artifact);
      saveBlob(artifact.blob, filename);
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : String(err));
    } finally {
      setDownloading(false);
    }
  };

  const readOnly = mode === "view";

  // The upgrade panel, shared by the upfront-locked open and the 402-after-
  // confirm case. Rendered as a function (not a component) so it stays inside
  // the modal's closure over L and paywallCode.
  const renderPaywallPanel = () => (
    <div
      style={{
        border: "1px solid #e2e8f0",
        borderRadius: 12,
        background: "#f8fafc",
        padding: "32px 24px",
        textAlign: "center",
      }}
    >
      <div style={{ fontSize: 17, fontWeight: 700, color: "#0f2a43", marginBottom: 8 }}>
        {L("Filled government forms are a paid feature", "Los formularios oficiales completados son una función paga")}
      </div>
      <div style={{ fontSize: 13.5, color: "#475569", lineHeight: 1.65, maxWidth: 420, margin: "0 auto 20px" }}>
        {paywallCode === "auth_required"
          ? L(
              "Create your free account, then choose a plan to generate the official filled PDF — ready to file. Your assessment and requirements checklist stay free.",
              "Cree su cuenta gratis y elija un plan para generar el PDF oficial completado — listo para radicar. Su evaluación y lista de requisitos siguen siendo gratis."
            )
          : L(
              "Your free plan covers the assessment and your requirements checklist. Upgrade to generate the official filled PDF — ready to file.",
              "Su plan gratis cubre la evaluación y su lista de requisitos. Suba de plan para generar el PDF oficial completado — listo para radicar."
            )}
      </div>
      <a
        href="/pricing"
        style={{
          display: "inline-block",
          background: "#0f2a43",
          color: "#ffffff",
          fontSize: 15,
          fontWeight: 600,
          textDecoration: "none",
          padding: "12px 28px",
          borderRadius: 8,
        }}
      >
        {L("See plans", "Ver planes")}
      </a>
    </div>
  );

  return (
    <div role="dialog" aria-modal="true" data-requirement={props.requirementCode} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.55)", zIndex: 1000, display: "flex", alignItems: "flex-start", justifyContent: "center", overflowY: "auto", padding: "24px 12px" }}>
      <div style={{ background: "var(--surface, white)", borderRadius: 12, maxWidth: 820, width: "100%", boxShadow: "0 20px 60px rgba(0,0,0,0.3)", display: "flex", flexDirection: "column" }}>
        {/* Header */}
        <div style={{ padding: "16px 20px", borderBottom: "1px solid #e2e8f0" }}>
          <div style={{ fontSize: 12.5, textTransform: "uppercase", letterSpacing: 1, color: "#64748b" }}>{definition.agency} · {definition.officialFormNumber}</div>
          <h2 style={{ fontSize: 20, margin: "3px 0" }}>{localize(definition.title, lang)}</h2>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 4 }}>
            {hasRealArtifact ? (
              <span style={{ fontSize: 12, background: "#ecfdf5", color: "#047857", border: "1px solid #a7f3d0", borderRadius: 999, padding: "2px 8px" }}>
                ✓ {L("Populated directly into the official government PDF", "Completado directamente en el PDF oficial del gobierno")}
              </span>
            ) : (
              <span style={{ fontSize: 12, background: "#fffbeb", color: "#92400e", border: "1px solid #fde68a", borderRadius: 999, padding: "2px 8px" }}>
                {L("Preparation worksheet — official PDF not yet in SmartPR's library", "Hoja de preparación — el PDF oficial aún no está en la biblioteca de SmartPR")}
              </span>
            )}
            {fee !== null && (
              <span style={{ fontSize: 12.5, color: "#475569" }}>
                {L("Government filing fee", "Tarifa gubernamental de radicación")}: {fee} · {L("paid to the agency at submission", "se paga a la agencia al presentar")}
              </span>
            )}
          </div>
          <p style={{ fontSize: 13, color: "#64748b", margin: "6px 0 0", lineHeight: 1.55 }}>
            {L(
              "SmartPR prepares this application from your shared business information. A prepared application is not an approved permit, license, certificate, or government-issued document.",
              "SmartPR prepara esta solicitud con su información comercial compartida. Una solicitud preparada no es un permiso, licencia, certificado ni documento emitido por el gobierno."
            )}
          </p>
        </div>

        {/* Body */}
        <div ref={bodyRef} style={{ padding: 20, maxHeight: "62vh", overflowY: "auto" }}>
          {upfrontLocked ? renderPaywallPanel() : (
          <>
          {errors.length > 0 && mode === "edit" && (
            <div style={{ marginBottom: 16, background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "12px 14px", fontSize: 14, color: "#991b1b" }}>
              <strong>
                {L(
                  `Complete ${errors.length} required ${errors.length === 1 ? "field" : "fields"} before continuing:`,
                  `Complete ${errors.length} ${errors.length === 1 ? "campo obligatorio" : "campos obligatorios"} antes de continuar:`
                )}
              </strong>
              <ul style={{ margin: "8px 0 0 18px", display: "grid", gap: 4 }}>
                {errors.slice(0, 10).map((e, i) => (
                  <li key={i}>
                    <button
                      type="button"
                      onClick={() => scrollToField(e.fieldId)}
                      style={{ background: "none", border: "none", padding: 0, color: "#b91c1c", textDecoration: "underline", cursor: "pointer", fontSize: 14, textAlign: "left" }}
                    >
                      {localize(e.message, lang)}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {(mode === "view" && wantsRealArtifact) && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 13.5, color: "#475569", marginBottom: 6, lineHeight: 1.55 }}>
                {paywalled
                  ? L(
                        "The official filled PDF is a paid deliverable.",
                        "El PDF oficial completado es un entregable pago."
                      )
                  : showingRealArtifact
                  ? L(
                        "This is the official government PDF for the application you prepared.",
                        "Este es el PDF oficial del gobierno de la solicitud que preparó."
                      )
                  : hasRealArtifact && realArtifactError
                    ? L("Couldn't load the official PDF right now.", "No se pudo cargar el PDF oficial en este momento.")
                    : L(
                        "This is the exact document that was added to your deliverables.",
                        "Este es el documento exacto que se añadió a sus entregables."
                      )}
              </div>
              {paywalled ? renderPaywallPanel() : hasRealArtifact && realArtifactLoading && !realArtifactUrl ? (
                <div style={{ padding: 24, textAlign: "center", color: "#64748b", fontSize: 14 }}>
                  {L("Populating the official government PDF…", "Completando el PDF oficial del gobierno…")}
                </div>
              ) : displayedPreviewUrl ? (
                <iframe
                  src={displayedPreviewUrl}
                  title={L("Document preview", "Vista previa del documento")}
                  style={{ width: "100%", height: "50vh", border: "1px solid #e2e8f0", borderRadius: 8, background: "white" }}
                />
              ) : (
                <div style={{ padding: 24, textAlign: "center", color: "#64748b", fontSize: 14 }}>
                  {realArtifactError
                    ? L("The official PDF isn't available right now — try again shortly.", "El PDF oficial no está disponible en este momento — inténtelo de nuevo en breve.")
                    : L("Generating preview…", "Generando vista previa…")}
                </div>
              )}
              {showingRealArtifact && realArtifact && (
                <div style={{ fontSize: 12.5, color: "#64748b", marginTop: 6 }}>
                  {L(
                    `${realArtifact.populated} field(s) populated · ${realArtifact.unanswered} still required · original government PDF preserved`,
                    `${realArtifact.populated} campo(s) completados · ${realArtifact.unanswered} pendientes · PDF oficial del gobierno preservado`
                  )}
                </div>
              )}
            </div>
          )}
          {showSubmissionPanel && (
            <div style={{ marginBottom: 16 }}>
              <GovernmentSubmissionPanel
                formId={definition.id}
                canonical={canonical}
                lang={lang}
                submitted={applicationStatus === "submitted"}
                onMarkSubmitted={onMarkSubmitted ? () => onMarkSubmitted(definition.id) : undefined}
              />
            </div>
          )}
          {mode === "review" || mode === "view" ? (
            <GovernmentFormPreview definition={definition} formData={data} canonical={canonical} lang={lang} />
          ) : (
            <GovernmentFormRenderer definition={definition} formData={data} canonical={canonical} lang={lang} errors={errors} onChange={setField} />
          )}
          </>
          )}
        </div>

        {/* Footer actions */}
        <div style={{ padding: "14px 20px", borderTop: "1px solid #e2e8f0", display: "flex", flexDirection: "column", gap: 8 }}>
          {paywalled ? (
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button type="button" onClick={handleClose} style={{ fontSize: 14, padding: "9px 16px", borderRadius: 8, border: "1px solid #cbd5e1", background: "white", cursor: "pointer" }}>{L("Close", "Cerrar")}</button>
            </div>
          ) : (
          <>
          {offersDownload && (
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-start", alignItems: "center", flexWrap: "wrap" }}>
              <button type="button" onClick={() => void downloadPdf()} disabled={downloading} style={{ fontSize: 13, padding: "8px 14px", borderRadius: 6, border: "1px solid #cbd5e1", background: "white", cursor: downloading ? "default" : "pointer", opacity: downloading ? 0.6 : 1 }}>
                {downloading
                  ? L("Populating the official PDF…", "Completando el PDF oficial…")
                  : hasRealArtifact
                    ? L("Download populated official form", "Descargar formulario oficial completado")
                    : L("Download preparation PDF", "Descargar PDF de preparación")}
              </button>
              {downloadError && (
                <span style={{ fontSize: 13, color: "#991b1b" }}>
                  {L(
                    "Couldn't produce the official PDF — nothing was downloaded. Try again.",
                    "No se pudo generar el PDF oficial — no se descargó nada. Inténtelo de nuevo."
                  )}
                </span>
              )}
            </div>
          )}
          {completeError && !readOnly && (
            <div style={{ fontSize: 13.5, color: "#991b1b", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "10px 12px" }}>
              {L("Couldn't save the completed document — your answers are safe. Try again.", "No se pudo guardar el documento completado — sus respuestas están a salvo. Inténtelo de nuevo.")}{" "}
              <span style={{ color: "#b91c1c" }}>{completeError}</span>
            </div>
          )}
          {readOnly ? (
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button type="button" onClick={handleClose} style={{ fontSize: 14, padding: "9px 16px", borderRadius: 8, border: "1px solid #cbd5e1", background: "white", cursor: "pointer" }}>{L("Close", "Cerrar")}</button>
              <button type="button" onClick={() => setMode("edit")} style={{ fontSize: 14, padding: "9px 16px", borderRadius: 8, border: "none", background: "var(--brand-1, #0a2540)", color: "white", cursor: "pointer" }}>{L("Edit Form", "Editar formulario")}</button>
            </div>
          ) : (
            <GovernmentFormActions
              lang={lang}
              mode={mode === "review" ? "review" : "edit"}
              onReview={() => setMode("review")}
              onBackToEdit={() => setMode("edit")}
              onComplete={() => void handleComplete()}
              onClose={handleClose}
              completing={completing}
              completeLabel={completeLabel}
            />
          )}
          </>
          )}
        </div>
      </div>
    </div>
  );
}
