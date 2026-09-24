"use client";

/**
 * Mita (agency assistant) — CHAT-PRIMARY run page.
 *
 * The chat thread (AgencyChat) is the primary surface for the whole run:
 * filing picker → pre-flight card → goal brief → milestone messages → one
 * transient status indicator → intervention cards → review card. The live
 * browser (AgencyBrowser) is a static, always-visible panel while a run is
 * active: beside the chat on desktop, stacked above it on mobile. It is
 * never a modal sheet and never starts hidden — the user can hide it, but
 * it reopens with every new run.
 *
 * Filing-first: the picker lists the specific filings SmartPR identified
 * for this business (GET /api/agency-actions/filings). SmartPR decides what
 * needs to be filed — the browser agent only executes the selected filing,
 * via pre-flight (GET /api/agency-actions/preflight) and run creation
 * (POST /api/agency-actions, requires obligation_id).
 *
 * Preserved behaviors and API contracts from the previous browser-centric page:
 * - GET /api/agency-runs/[id] polled every 900ms while queued/running/paused.
 * - Pending-field values live in local state only and are POSTed to
 *   /api/agency-runs/[id]/resume as `{ fields }` — never rendered into chat
 *   text, events, or logs.
 * - Uploads POST to /api/evidence (5 MB cap).
 * - Takeover mode, reconnect preview, stop, provider badge.
 * - Mock provider timelines flow through the same chat components.
 */
import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Cloud, Eye, EyeOff, KeyRound, Server, Shield,
} from "lucide-react";
import { TopNav } from "../../../history/ui";
import { useLang } from "../../../useLang";
import type { Lang } from "../../../forms/engine/types";
import type {
  AgencyPendingField,
  AgencyRunPublic,
  AgencyRunStatus,
} from "../../../../lib/agency-runs/types";
import { getFilingConfig, AGENCY_FILING_CONFIGS } from "../../../../lib/agency-runs/filingTypes";
import {
  DEFAULT_LOGIN_PENDING_FIELDS,
  askedAgainWithValues,
} from "../../../../lib/agency-runs/pendingFields";
import { sealSensitiveValue } from "../../../../lib/agency-runs/sensitiveCrypto";
import {
  fieldValuePresent,
  isSensitiveField,
  sealFieldEntries,
  unsealFieldEntries,
  type FieldValue,
} from "../../../../lib/agency-runs/sensitiveFields";
import { mergeFieldsWithPassportPrefill } from "../../../../lib/agency-runs/prefillFromPassport";
import { AgencyBrowser } from "./AgencyBrowser";
import { AgencyChat, type SessionMsg } from "./AgencyChat";
import { OTHER_AGENCY_ID, type FilingGroup, type FilingOption } from "../../../../lib/agency-runs/agencyActions";
import {
  buildChatMilestones,
  chatScrollKey,
  failureReason,
  humanizeValidationError,
  isTerminalWorkflowState,
  workflowStateForRun,
  workflowStatusLine,
  type AgencyAction,
  type GoalBrief,
} from "./chatContracts";

const L = (en: string, es: string, lang: Lang) => (lang === "es" ? es : en);

const STATUS_STYLES: Record<AgencyRunStatus, string> = {
  queued: "border-slate-300 bg-slate-100 text-slate-700",
  running: "border-sky-300 bg-sky-50 text-sky-800",
  paused: "border-amber-300 bg-amber-50 text-amber-900",
  review: "border-emerald-300 bg-emerald-50 text-emerald-800",
  submitted: "border-emerald-400 bg-emerald-100 text-emerald-900",
  stopped: "border-slate-400 bg-slate-200 text-slate-800",
  failed: "border-rose-300 bg-rose-50 text-rose-800",
};

function statusLabel(status: AgencyRunStatus, lang: Lang): string {
  const map: Record<AgencyRunStatus, [string, string]> = {
    queued: ["Queued", "En cola"],
    running: ["Running", "En curso"],
    paused: ["Paused", "Pausado"],
    review: ["Review", "Revisión"],
    submitted: ["Submitted", "Enviado"],
    stopped: ["Stopped", "Detenido"],
    failed: ["Failed", "Falló"],
  };
  const [en, es] = map[status];
  return L(en, es, lang);
}

function StatusPill({ status, lang }: { status: AgencyRunStatus; lang: Lang }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-bold tracking-wide ${STATUS_STYLES[status]}`}>
      {statusLabel(status, lang)}
    </span>
  );
}

/**
 * Segmented passport-progress bar from the Mita design: filled segments in
 * deep forest green, remaining segments in gold.
 */
function SegmentedBar({ known, total }: { known: number; total: number }) {
  const n = Math.max(total, 1);
  const segs = Math.min(n, 16);
  const filledCount = Math.round((Math.min(known, n) / n) * segs);
  return (
    <span className="inline-flex items-center gap-[3px]" aria-hidden="true">
      {Array.from({ length: segs }).map((_, i) => (
        <span
          key={i}
          className={`h-1.5 w-3.5 rounded-full ${i < filledCount ? "bg-[#1e4d38]" : "bg-[#c99509]"}`}
        />
      ))}
    </span>
  );
}

export default function AgencyRunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: businessId } = use(params);
  const lang = useLang();

  const [run, setRun] = useState<AgencyRunPublic | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);
  const [previewKey, setPreviewKey] = useState(0);
  const [reconnectBusy, setReconnectBusy] = useState(false);
  const [takeover, setTakeover] = useState(false);
  /** Pending-field values (intervention card only — never mirrored into
   * chat text or events; only POSTed to resume as `{ fields }`).
   * Sensitive values are sealed (AES-GCM, session key) the moment they rest
   * here — plaintext exists only inside the input while typing. */
  const [fieldValues, setFieldValues] = useState<Record<string, FieldValue>>({});
  const [revealedFields, setRevealedFields] = useState<Record<string, boolean>>({});
  /** Field values the human already submitted once, keyed by run id.
   * In-memory only (never persisted) — used to prefill the intervention
   * card when the agent asks for the same fields again, so the user
   * confirms instead of re-typing. Sensitive entries stay sealed. */
  const lastSubmittedRef = useRef<{ runId: string | null; values: Record<string, FieldValue> }>({
    runId: null,
    values: {},
  });
  const [previewLoaded, setPreviewLoaded] = useState(false);
  /**
   * The live browser is a static, always-visible panel while a run is
   * active — never a modal sheet, never starting hidden. The user can
   * hide it; starting a new run (or taking over) reopens it.
   */
  const [browserHidden, setBrowserHidden] = useState(false);
  const browserOpen = Boolean(run) && !browserHidden;
  /** Fictional rehearsal portal — admin-only or ?demo=1. Never for real users. */
  const [demoVisible, setDemoVisible] = useState(false);
  useEffect(() => {
    if (typeof window !== "undefined") {
      const qp = new URLSearchParams(window.location.search);
      if (qp.get("demo") === "1") {
        setDemoVisible(true);
        return;
      }
    }
    fetch("/api/admin/me")
      .then((r) => r.json())
      .then((j) => {
        if (j?.admin) setDemoVisible(true);
      })
      .catch(() => {});
  }, []);

  /* Chat-first session state */
  const [msgs, setMsgs] = useState<SessionMsg[]>([
    { id: "filing-picker", type: "filing-picker", groups: [], loading: true, error: null },
  ]);
  const [filingBusyId, setFilingBusyId] = useState<string | null>(null);
  const [goalBrief, setGoalBrief] = useState<GoalBrief | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  /** Business name + municipality for the workspace sub-header. */
  const [bizHeader, setBizHeader] = useState<{ name: string; municipality: string } | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/businesses/${businessId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (cancelled || !j?.business) return;
        const name = String(j.business.legal_name || j.business.name || "").trim();
        const municipality = String(j.business.municipality || "").trim();
        if (name) setBizHeader({ name, municipality });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [businessId]);

  /** Portal-fields progress for the Mita chat header ("Portal fields 11 of 12"). */
  const portalFieldsProgress = useMemo(() => {
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i];
      if (m.type === "preflight" && m.action) {
        return { known: m.action.known, total: m.action.total };
      }
    }
    if (goalBrief) {
      const known = goalBrief.known_fields?.length ?? 0;
      const total = known + (goalBrief.user_input_expected?.length ?? 0);
      if (total > 0) return { known, total };
    }
    return null;
  }, [msgs, goalBrief]);

  /** Filing label for the sub-header subtitle (latest pre-flight / goal brief). */
  const activeFilingLabel = useMemo(() => {
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i];
      if (m.type === "preflight" || m.type === "goal-brief") {
        return L(m.filingLabelEn, m.filingLabelEs, lang);
      }
    }
    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [msgs, lang]);

  const pushMsg = useCallback((msg: SessionMsg) => {
    setMsgs((prev) => [...prev, msg]);
  }, []);

  /**
   * Load the filing picker: every SmartPR obligation for this business
   * joined to its browser filing (when one exists). The picker's
   * obligation_ids are the only run-start capability — no generic fallback.
   */
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setMsgs((prev) =>
        prev.map((m) =>
          m.type === "filing-picker" ? { ...m, loading: true, error: null } : m
        )
      );
      try {
        const response = await fetch(
          `/api/agency-actions/filings?business_id=${encodeURIComponent(businessId)}${demoVisible ? "&demo=1" : ""}`
        );
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || "filings failed");
        if (cancelled) return;
        setMsgs((prev) =>
          prev.map((m) =>
            m.type === "filing-picker"
              ? {
                  ...m,
                  loading: false,
                  // The run page conducts one filing — hide the "other
                  // requirements" group (obligations with no browser
                  // filing), which is not something the human can start.
                  groups: ((result.groups ?? []) as FilingGroup[]).filter(
                    (g) => g.agency_id !== OTHER_AGENCY_ID
                  ),
                }
              : m
          )
        );
      } catch (e) {
        if (cancelled) return;
        setMsgs((prev) =>
          prev.map((m) =>
            m.type === "filing-picker"
              ? {
                  ...m,
                  loading: false,
                  error:
                    e instanceof Error
                      ? e.message
                      : L("Could not load your filings.", "No se pudieron cargar tus trámites.", lang),
                }
              : m
          )
        );
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [businessId, demoVisible, lang]);

  const poll = useCallback(async (runId: string) => {
    const response = await fetch(`/api/agency-runs/${runId}`);
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError(result.error || L("Could not load run.", "No se pudo cargar la ejecución.", lang));
      return;
    }
    setRun(result.run as AgencyRunPublic);
  }, [lang]);

  useEffect(() => {
    if (!run?.id) return;
    if (run.status === "stopped" || run.status === "failed" || run.status === "review" || run.status === "submitted") return;
    // Keep polling while queued/running/paused so mock advances / Browser Use syncs.
    const handle = window.setInterval(() => {
      void poll(run.id);
    }, 900);
    return () => window.clearInterval(handle);
  }, [run?.id, run?.status, poll]);

  /** "File it for me" state — declared before the run-reset block below. */
  const [authorizeBusy, setAuthorizeBusy] = useState(false);
  const [authorizeError, setAuthorizeError] = useState<string | null>(null);

  // Leaving takeover mode whenever a different run loads (adjust state during
  // render — the React-endorsed pattern for previous-render resets).
  const [prevRunId, setPrevRunId] = useState<string | null>(null);
  if ((run?.id ?? null) !== prevRunId) {
    setPrevRunId(run?.id ?? null);
    setTakeover(false);
    setFieldValues({});
    setRevealedFields({});
    setValidationError(null);
    setAuthorizeError(null);
  }

  // Reset the preview loading animation whenever the stream is (re)created.
  const streamKey = `${previewKey}:${run?.id ?? ""}:${run?.live_url ?? ""}`;
  const [prevStreamKey, setPrevStreamKey] = useState(streamKey);
  if (prevStreamKey !== streamKey) {
    setPrevStreamKey(streamKey);
    setPreviewLoaded(false);
  }

  /* ---------------- filing picker → pre-flight → start ---------------- */

  /**
   * Step 1 of start: fetch the pre-flight model (passport items + at most 3
   * questions) for the SPECIFIC SmartPR filing the human picked, and show
   * it in chat. The run launches only after the human confirms in the
   * pre-flight card (Start filing) — possibly answering nothing. The
   * obligation_id threads through so the run is always tied to the
   * SmartPR requirement that identified it.
   */
  const startFiling = async (filing: FilingOption) => {
    const action = filing.action;
    if (!action) return;
    const busyKey = `${filing.id}:${filing.obligation_id}:${action.objective_en ?? ""}`;
    setFilingBusyId(busyKey);
    setError(null);
    try {
      const params = new URLSearchParams({
        business_id: businessId,
        action_id: action.filing_type,
        obligation_id: filing.obligation_id,
      });
      if (action.objective_en) params.set("objective_en", action.objective_en);
      const response = await fetch(`/api/agency-actions/preflight?${params.toString()}`);
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(result.error || L("Could not load the pre-flight check.", "No se pudo cargar la revisión previa.", lang));
        return;
      }
      let uploadsEn = "";
      let uploadsEs = "";
      const cfg = AGENCY_FILING_CONFIGS.find((c) => c.id === action.id);
      if (cfg) {
        uploadsEn = cfg.uploadsEn;
        uploadsEs = cfg.uploadsEs;
      }
      pushMsg({
        id: `preflight-${Date.now()}`,
        type: "preflight",
        preflight: result.preflight,
        action,
        filingLabelEn: result.filing_label_en ?? action.title_en,
        filingLabelEs: result.filing_label_es ?? action.title_es,
        uploadsEn,
        uploadsEs,
      });
    } finally {
      setFilingBusyId(null);
    }
  };

  /**
   * Step 2 of start: the human confirmed the pre-flight card. Launch the run
   * with the answers baked into the goal brief (portal-account line) and the
   * up-front sensitive fields into the prompt's FIELDS FILL block.
   */
  const confirmPreflightStart = async (
    msg: Extract<SessionMsg, { type: "preflight" }>,
    answers: { account_status?: "has_account" | "no_account"; fields?: Record<string, string> }
  ): Promise<void> => {
    const action = msg.action;
    const response = await fetch("/api/agency-actions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // obligation_id ties the run to the specific SmartPR filing
      // requirement the human picked (server-validated — the client can
      // never invent an objective). objective_en selects the
      // server-resolved variant the human picked (e.g. Dept. of State
      // new-entity vs annual report); the server only honors objectives
      // it resolved itself.
      body: JSON.stringify({
        business_id: businessId,
        action_id: action.id,
        obligation_id: action.obligation_id ?? null,
        objective_en: action.objective_en ?? null,
        objective_es: action.objective_es ?? null,
        preflight_answers: {
          ...(answers.account_status ? { account_status: answers.account_status } : {}),
          ...(answers.fields ? { fields: answers.fields } : {}),
        },
      }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(result.error || L("Could not start run.", "No se pudo iniciar la ejecución.", lang));
    }
    const started = result.run as AgencyRunPublic;
    const brief = (result.brief ?? null) as GoalBrief | null;
    setRun(started);
    setBrowserHidden(false);
    setGoalBrief(brief);
    // Retain pre-flight field values in-memory (never persisted) so that a
    // later re-ask of the same fields pre-fills from this session and the
    // "asking again" banner only renders when a value was actually provided.
    // Pre-flight answers are sensitive fields — seal them before retaining.
    if (answers.fields && typeof answers.fields === "object") {
      const prefilled: Record<string, string> = {};
      for (const [id, v] of Object.entries(answers.fields)) {
        const val = typeof v === "string" ? v.trim() : "";
        if (id && val) prefilled[id] = val;
      }
      if (Object.keys(prefilled).length > 0) {
        const sealed = await sealFieldEntries(prefilled, () => true);
        lastSubmittedRef.current = { runId: started.id, values: sealed };
      }
    }
    if (brief) {
      pushMsg({
        id: `brief-${Date.now()}`,
        type: "goal-brief",
        brief,
        filingLabelEn: action.title_en,
        filingLabelEs: action.title_es,
      });
    }
  };

  /* ---------------- run controls (contracts preserved) ---------------- */

  const resume = async (fields?: Record<string, string>) => {
    if (!run) return false;
    setBusy(true);
    setError(null);
    try {
      const cleaned: Record<string, string> = {};
      if (fields) {
        for (const [id, value] of Object.entries(fields)) {
          const v = typeof value === "string" ? value.trim() : "";
          if (id && v) cleaned[id] = v;
        }
      }
      const hasFields = Object.keys(cleaned).length > 0;
      const response = await fetch(`/api/agency-runs/${run.id}/resume`, {
        method: "POST",
        headers: hasFields ? { "Content-Type": "application/json" } : undefined,
        body: hasFields ? JSON.stringify({ fields: cleaned }) : undefined,
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        // Surface validation errors in the intervention card in human
        // language; keep the typed values so the user can fix and retry.
        setValidationError(
          humanizeValidationError(result.error, lang) ??
            L("Could not resume.", "No se pudo reanudar.", lang)
        );
        return false;
      }
      setRun(result.run as AgencyRunPublic);
      if (hasFields) {
        // Remember what was submitted (in-memory only) so a later re-ask of
        // the same fields becomes a confirm card instead of blank re-entry.
        // Sensitive entries are re-sealed — the retained map never holds
        // sensitive plaintext.
        const mem = lastSubmittedRef.current;
        const sealed = await sealFieldEntries(cleaned, (id) =>
          sensitiveIds.has(id)
        );
        lastSubmittedRef.current = {
          runId: run.id,
          values: { ...(mem.runId === run.id ? mem.values : {}), ...sealed },
        };
        setFieldValues({});
      }
      setValidationError(null);
      setTakeover(false);
      return true;
    } finally {
      setBusy(false);
    }
  };

  /**
   * Store a field value. Sensitive fields are sealed (AES-GCM) before they
   * rest in state — the await is guarded per field id so rapid typing keeps
   * only the latest value.
   */
  const sealSeqRef = useRef<Record<string, number>>({});
  const setFieldValue = (id: string, value: string) => {
    if (!sensitiveIds.has(id)) {
      setFieldValues((prev) => ({ ...prev, [id]: value }));
      return;
    }
    const seq = (sealSeqRef.current[id] ?? 0) + 1;
    sealSeqRef.current[id] = seq;
    if (!value.trim()) {
      setFieldValues((prev) => ({ ...prev, [id]: "" }));
      return;
    }
    void sealSensitiveValue(value)
      .then((sealed) => {
        if (sealSeqRef.current[id] !== seq) return; // stale keystroke
        setFieldValues((prev) => ({ ...prev, [id]: sealed }));
      })
      .catch(() => {
        // Sealing failed (should not happen) — keep the previous value
        // rather than storing sensitive plaintext.
      });
  };

  const toggleRevealField = (id: string) => {
    setRevealedFields((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const stop = async () => {
    if (!run) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/agency-runs/${run.id}/stop`, { method: "POST" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(result.error || L("Could not stop.", "No se pudo detener.", lang));
        return;
      }
      setRun(result.run as AgencyRunPublic);
    } finally {
      setBusy(false);
    }
  };

  /**
   * "File it for me" — the owner authorizes SmartPR to click final submit.
   * The ReviewCard only calls this after the attestation checkbox is
   * checked; the API re-validates attestation server-side.
   */
  const authorize = async () => {
    if (!run || run.status !== "review") return;
    setAuthorizeBusy(true);
    setAuthorizeError(null);
    try {
      const response = await fetch(`/api/agency-runs/${run.id}/authorize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attestation: true }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        setAuthorizeError(
          result.error === "attestation_required"
            ? L(
                "Please check the authorization box first.",
                "Marca la casilla de autorización primero.",
                lang
              )
            : result.error === "not_in_review"
              ? L(
                  "This filing is no longer at the review step.",
                  "Este trámite ya no está en el paso de revisión.",
                  lang
                )
              : result.error ||
                L("Could not authorize.", "No se pudo autorizar.", lang)
        );
        return;
      }
      setRun(result.run as AgencyRunPublic);
    } finally {
      setAuthorizeBusy(false);
    }
  };

  const reconnectPreview = async () => {
    if (!run?.live_url) return;
    setReconnectBusy(true);
    try {
      await poll(run.id);
    } finally {
      setPreviewKey((k) => k + 1);
      setReconnectBusy(false);
    }
  };

  const enterTakeover = async () => {
    setTakeover(true);
    setBrowserHidden(false);
    if (!run) return;
    try {
      const response = await fetch(`/api/agency-runs/${run.id}/takeover`, { method: "POST" });
      const result = await response.json().catch(() => ({}));
      if (response.ok && result.run) setRun(result.run as AgencyRunPublic);
    } catch {
      // Best-effort logging only — takeover itself never depends on it.
    }
  };

  /** "I'm done" — exit takeover mode AND hand control back to the agent in one tap. */
  const handBackToAgent = async () => {
    setTakeover(false);
    await resume();
  };

  const uploadToLocker = async (file: File, tags?: string[]) => {
    setUploadBusy(true);
    setUploadMsg(null);
    try {
      if (file.size > 5 * 1024 * 1024) {
        setUploadMsg(
          L(
            "Portal attachments max 5 MB — compress or crop before upload.",
            "Adjuntos del portal máx. 5 MB — comprima o recorte antes de subir.",
            lang
          )
        );
        return;
      }
      const form = new FormData();
      form.append("file", file);
      form.append("business_id", businessId);
      form.append("requirement_tags", (tags ?? activeConfig.evidenceTags).join(","));
      const response = await fetch("/api/evidence", { method: "POST", body: form });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        setUploadMsg(result.error || L("Upload failed.", "La subida falló.", lang));
        return;
      }
      setUploadMsg(
        L(
          "Saved to Evidence Locker. Resume when all required docs are ready.",
          "Guardado en el Casillero de evidencia. Reanude cuando tenga todos los documentos.",
          lang
        )
      );
    } catch {
      setUploadMsg(L("Upload failed.", "La subida falló.", lang));
    } finally {
      setUploadBusy(false);
    }
  };

  /* ---------------- derived chat state ---------------- */

  const activeConfig = getFilingConfig(
    run ? run.filing_type : "SURI_REGISTER_TAXPAYER"
  );
  const portalName = L(activeConfig.portalEn, activeConfig.portalEs, lang);

  const milestones = useMemo(() => {
    if (!run) return [];
    const cfg = getFilingConfig(run.filing_type);
    const built = buildChatMilestones(run.events, {
      portalEn: cfg.portalEn,
      portalEs: cfg.portalEs,
    });
    // The goal-brief message already announces the start ("I'm starting your
    // …") — skip the generic "I'm starting your … filing" milestone so the
    // run doesn't open with two start bubbles.
    const hasGoalBriefMsg = msgs.some((m) => m.type === "goal-brief");
    if (hasGoalBriefMsg && built.length > 0) {
      const firstIdx = run.events[0]?.index;
      if (firstIdx != null && built[0]?.id === `m-${firstIdx}`) {
        return built.slice(1);
      }
    }
    return built;
  }, [run, msgs]);

  const wfState = run
    ? workflowStateForRun({
        status: run.status,
        pauseReason: run.pause_reason,
        pauseStreak: run.pause_streak ?? 0,
        filingAuthorized: run.filing_authorized ?? false,
      })
    : null;
  const terminal = wfState ? isTerminalWorkflowState(wfState) : true;

  /**
   * "I'm stuck" → take-over popup. Shown once per stuck episode (run +
   * pause streak) when the agent is BLOCKED and the live browser is
   * available; "Not now" dismisses it until the agent gets stuck again.
   */
  const stuckKey = run ? `${run.id}:${run.pause_streak ?? 0}` : "";
  const [stuckDismissedKey, setStuckDismissedKey] = useState<string | null>(null);
  const stuckPrompt =
    wfState === "BLOCKED" &&
    Boolean(run?.live_url) &&
    !takeover &&
    stuckDismissedKey !== stuckKey;

  const pendingFields: AgencyPendingField[] = useMemo(() => {
    if (!run || run.status !== "paused") return [];
    if (run.pending_fields?.length) return run.pending_fields;
    if (run.pause_reason === "USER_LOGIN") return DEFAULT_LOGIN_PENDING_FIELDS;
    return [];
  }, [run]);

  /** Ids of pending fields treated as sensitive (masked + sealed). */
  const sensitiveIds = useMemo(() => {
    const s = new Set<string>();
    for (const f of pendingFields) if (isSensitiveField(f)) s.add(f.id);
    return s;
  }, [pendingFields]);

  /** Text-field pause: the chat card is the only place to type; live browser is view-only. */
  const fieldsPause =
    Boolean(run && run.status === "paused") &&
    (pendingFields.length > 0 || run?.pause_reason === "USER_LOGIN");

  /**
   * "Asking again" prefill: when the agent re-requests fields the human
   * already supplied once (tracked server-side by id only), refill the
   * inputs from this session's last-submitted values (in-memory only) so
   * the user confirms instead of re-typing. Sensitive fields stay masked
   * by the card's password inputs; empty slots stay editable.
   */
  const suppliedFieldIds: string[] = run?.supplied_field_ids ?? [];
  const suppliedSig = suppliedFieldIds.join(",");
  const pendingSig = pendingFields.map((f) => f.id).join(",");
  /**
   * Value-backed "asking again" set for the banner: the banner (and its
   * pre-filled value) renders ONLY when we actually retain a
   * previously-submitted non-empty value for the field id in this run.
   * An id marked supplied without a retained value (e.g. seeded from
   * pre-flight before the client ever saw the value) renders the normal
   * empty prompt instead of a misfiring banner.
   */
  const askedAgainFields = useMemo(() => {
    const mem = lastSubmittedRef.current;
    if (mem.runId !== run?.id) return [];
    return askedAgainWithValues(pendingFields, suppliedFieldIds, mem.values);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run?.id, pendingSig, suppliedSig]);
  useEffect(() => {
    if (pendingFields.length === 0 || suppliedFieldIds.length === 0) return;
    const mem = lastSubmittedRef.current;
    if (mem.runId !== run?.id) return;
    const supplied = new Set(suppliedFieldIds);
    setFieldValues((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const f of pendingFields) {
        if (supplied.has(f.id) && !fieldValuePresent(next[f.id])) {
          const v = mem.values[f.id];
          if (v !== undefined) {
            next[f.id] = v;
            changed = true;
          }
        }
      }
      return changed ? next : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run?.id, pendingSig, suppliedSig]);

  const fillAndContinue = async () => {
    if (!run) return;
    // Unseal sensitive entries transiently for this single fill POST — the
    // plaintext map is dropped as soon as resume() resolves.
    const plain = await unsealFieldEntries(fieldValues);
    const merged = mergeFieldsWithPassportPrefill(
      pendingFields,
      plain,
      run.passport_snapshot
    );
    await resume(merged);
  };

  const canFillFields =
    pendingFields.some((f) => {
      if (f.optional) return false;
      return fieldValuePresent(fieldValues[f.id]);
    }) || pendingFields.some((f) => fieldValuePresent(fieldValues[f.id]));

  // Detail line for the transient "waiting on you" status.
  const waitingDetail =
    wfState === "WAITING_FOR_USER"
      ? run?.pause_reason === "USER_UPLOAD"
        ? L("Waiting on you: upload the documents", "Esperando por ti: sube los documentos", lang)
        : run?.pause_reason === "USER_LOGIN"
          ? // Name what the page actually asks for — USER_LOGIN also covers
            // SSN / other human-typed fields, not just a sign-in.
            pendingFields.length > 0 &&
            !pendingFields.some((f) => /^(email|password|mfa|username)$/.test(f.id))
            ? L(
                `Waiting on you: ${pendingFields.map((f) => f.label).join(", ")}`,
                `Esperando por ti: ${pendingFields.map((f) => f.label).join(", ")}`,
                lang
              )
            : L("Waiting on you: your portal login", "Esperando por ti: tu inicio de sesión", lang)
          : run?.pause_reason === "CAPTCHA"
            ? L("Waiting on you: complete the captcha", "Esperando por ti: completa el captcha", lang)
            : run?.pause_reason === "PAYMENT"
              ? L("Waiting on you: complete the payment", "Esperando por ti: completa el pago", lang)
              : undefined
      : undefined;

  const transientLabel =
    run && wfState && !terminal && run.status !== "stopped"
      ? workflowStatusLine(wfState, lang, portalName, waitingDetail)
      : null;

  // Keep the last few agent status updates visible instead of replacing a
  // single in-place line — fast status changes can actually be read.
  const [transientHistory, setTransientHistory] = useState<string[]>([]);
  const lastTransientRef = useRef<string | null>(null);
  useEffect(() => {
    if (transientLabel && transientLabel !== lastTransientRef.current) {
      lastTransientRef.current = transientLabel;
      setTransientHistory((h) => [...h.slice(-3), transientLabel]);
    }
  }, [transientLabel]);
  // A new run starts with a fresh status history.
  useEffect(() => {
    lastTransientRef.current = null;
    setTransientHistory([]);
  }, [run?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const terminalNote =
    run?.status === "stopped"
      ? {
          textEn: "You stopped the run — nothing was submitted.",
          textEs: "Detuviste la ejecución — nada se envió.",
          tone: "info" as const,
        }
      : run?.status === "failed"
        ? (() => {
            // Surface the actual underlying reason (humanized) instead of a
            // generic "hit a problem" — otherwise failures can't be diagnosed.
            const reason = failureReason(run.events, lang);
            return {
              textEn: reason
                ? `The run hit a problem. ${reason} You can try again or start a new run.`
                : "The run hit a problem. You can try again or start a new run.",
              textEs: reason
                ? `La ejecución tuvo un problema. ${reason} Puedes intentarlo de nuevo o empezar otra.`
                : "La ejecución tuvo un problema. Puedes intentarlo de nuevo o empezar otra.",
              tone: "warn" as const,
            };
          })()
        : null;

  const intervention =
    run && run.status === "paused"
      ? {
          lang,
          run,
          pendingFields,
          suppliedFieldIds,
          askedAgainFields,
          fieldValues,
          onFieldChange: setFieldValue,
          revealedFields,
          onToggleReveal: toggleRevealField,
          onFillContinue: () => void fillAndContinue(),
          canFillFields,
          validationError,
          uploadsText: L(activeConfig.uploadsEn, activeConfig.uploadsEs, lang),
          onResume: () => void resume(),
          onStop: () => void stop(),
          onTakeover: () => void enterTakeover(),
          hasLiveUrl: Boolean(run.live_url),
          takeover,
          onUpload: (file: File) => void uploadToLocker(file),
          uploadBusy,
          uploadMsg,
          busy,
        }
      : null;

  const review =
    run && run.status === "review"
      ? {
          knownCount: goalBrief ? goalBrief.known_fields.length : null,
          onReviewInBrowser: () => {
            setBrowserHidden(false);
            if (run.live_url) void enterTakeover();
          },
          onClose: () => void stop(),
          onAuthorize: () => void authorize(),
          authorizeBusy,
          authorizeError,
          busy,
        }
      : null;

  const submitted =
    run && run.status === "submitted"
      ? {
          confirmation: run.filing_confirmation,
          onDone: () => newRun(),
          busy,
        }
      : null;

  const scrollKey = chatScrollKey({
    runId: run?.id ?? null,
    milestoneCount: milestones.length,
    transient: transientLabel ?? "",
    cardOpen: run?.status === "paused" || run?.status === "review",
    msgCount: msgs.length,
  });

  const newRun = () => {
    setRun(null);
    setGoalBrief(null);
    setError(null);
    setUploadMsg(null);
    setBrowserHidden(false);
    // Keep the filing picker (already loaded) and drop everything after it.
    setMsgs((prev) => prev.filter((m) => m.type === "filing-picker"));
  };

  /**
   * Workspace mode starts the moment the human presses Start on a filing
   * (a pre-flight card exists) and lasts through the run. In workspace mode
   * the page is locked to exactly the viewport: the header compacts, the
   * chat and the browser panel are both anchored full-height side by side
   * (stacked on mobile), and only the chat's message list scrolls. Before
   * Start (just the filing picker) the page is a normal scrolling page.
   */
  const inWorkspace = Boolean(run) || msgs.some((m) => m.type === "preflight");
  /** Pre-run the browser panel is a placeholder so the layout doesn't jump when the run starts. */
  const showBrowserPanel = inWorkspace && !browserHidden;

  return (
    // Workspace mode locks the page to exactly the viewport (see
    // inWorkspace): every flex ancestor between here and the chat's message
    // list carries min-h-0, so the list, not the page, is what scrolls, and
    // the browser panel stays anchored beside it. Before Start, the page
    // scrolls normally.
    <div
      className={`flex flex-col bg-[#2b2721] ${
        inWorkspace ? "h-dvh overflow-hidden" : "min-h-dvh"
      }`}
    >
      <TopNav active="businesses" />
      <main className="mx-auto flex min-h-0 w-full max-w-7xl flex-1 flex-col px-5 py-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link href={`/businesses/${businessId}`} className="text-sm font-semibold text-[#cfc6b4] hover:text-white">
            ← {L("Business profile", "Perfil del negocio", lang)}
          </Link>
          {run && !inWorkspace && <StatusPill status={run.status} lang={lang} />}
        </div>

        {/* Business sub-header + step tracker (Mita design) */}
        <div className="mt-4 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <div className="min-w-0">
            {bizHeader && (
              <p className="truncate text-[11px] font-bold uppercase tracking-[0.18em] text-[#9a917f]">
                {bizHeader.municipality
                  ? `${bizHeader.name} · ${bizHeader.municipality}`
                  : bizHeader.name}
              </p>
            )}
            <p className="mt-1 truncate font-[family-name:var(--font-display)] text-xl text-[#f4efe2]">
              {activeFilingLabel ?? L("Assisted filing", "Radicación asistida", lang)}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-4">
            {run?.provider && run.provider !== "mock" && (
              <p className="hidden items-center gap-1.5 text-[11px] font-semibold text-[#8a8272] sm:inline-flex">
                {run.provider === "browser_use_cloud" ? (
                  <Cloud className="h-3.5 w-3.5 text-sky-400" />
                ) : (
                  <Server className="h-3.5 w-3.5 text-violet-400" />
                )}
                {run.provider === "browser_use_cloud"
                  ? L("Powered by Browser Use Cloud", "Con tecnología de Browser Use Cloud", lang)
                  : L("Powered by self-hosted agent (Grok)", "Con tecnología de agente propio (Grok)", lang)}
              </p>
            )}
            <ol
              className="flex items-center gap-2.5 text-[11px] font-bold"
              aria-label={L("Filing progress", "Progreso del trámite", lang)}
            >
              <li className="flex items-center gap-1.5 text-[#8f8674]">
                <span className="flex h-4 w-4 items-center justify-center rounded-full bg-[#dcefe2] text-[9px] font-black text-[#1e4d38]">✓</span>
                Intake
              </li>
              <li className="flex items-center gap-1.5 text-[#8f8674]">
                <span className="flex h-4 w-4 items-center justify-center rounded-full bg-[#dcefe2] text-[9px] font-black text-[#1e4d38]">✓</span>
                {L("Requirements", "Requisitos", lang)}
              </li>
              <li className="flex items-center gap-1.5 text-[#f4efe2]">
                <span className="flex h-4 w-4 items-center justify-center rounded-full bg-[#1e4d38] text-[9px] font-black text-white">3</span>
                {L("File", "Radicación", lang)}
              </li>
            </ol>
          </div>
        </div>

        {/* Mita hero — pre-run only. In the workspace it compacts to one
            slim row so the chat + browser keep the viewport. */}
        {!inWorkspace ? (
          <header className="mt-8 max-w-3xl">
            <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-[#c9a227]">
              {L("Mita · Assisted filing", "Mita · Radicación asistida", lang)}
            </p>
            <h1 className="mt-3 font-[family-name:var(--font-display)] text-4xl font-medium tracking-tight text-[#f7f2e4] md:text-5xl">
              {L("Let Mita file this for you.", "Deja que Mita radique por ti.", lang)}
            </h1>
            <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-[#b9b0a0]">
              {L(
                "Mita opens the portal, fills it from your Business Passport, and asks you for anything missing. It never submits without your approval.",
                "Mita abre el portal, lo llena desde tu Pasaporte de Negocio y te pregunta lo que falte. Nunca envía nada sin tu aprobación.",
                lang
              )}
            </p>
          </header>
        ) : (
          // The chat window has no header bar of its own — Mita's identity,
          // run status, portal-field progress and the browser toggle live in
          // this one row above the window.
          <div className="mt-3 flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#1e4d38] font-[family-name:var(--font-display)] text-base text-white">
                M
              </span>
              <p className="font-[family-name:var(--font-display)] text-xl text-[#f4efe2]">
                Mita
              </p>
              {run && <StatusPill status={run.status} lang={lang} />}
              {intervention && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-2.5 py-1 text-[11px] font-bold text-amber-900">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                  {L("Needs you", "Te necesita", lang)}
                </span>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-4">
              {portalFieldsProgress && (
                <span className="hidden items-center gap-2 md:inline-flex">
                  <span className="whitespace-nowrap text-[11px] font-semibold text-[#b9b0a0]">
                    {L("Portal fields", "Campos del portal", lang)} ·{" "}
                    {portalFieldsProgress.known} {L("of", "de", lang)}{" "}
                    {portalFieldsProgress.total}
                  </span>
                  <SegmentedBar
                    known={portalFieldsProgress.known}
                    total={portalFieldsProgress.total}
                  />
                </span>
              )}
              <button
                type="button"
                onClick={() => setBrowserHidden((h) => !h)}
                aria-pressed={!showBrowserPanel}
                className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-semibold text-[#e8e1d0] hover:bg-white/10"
              >
                {showBrowserPanel ? (
                  <EyeOff className="h-3.5 w-3.5" />
                ) : (
                  <Eye className="h-3.5 w-3.5" />
                )}
                {showBrowserPanel
                  ? L("Hide browser", "Ocultar navegador", lang)
                  : L("View browser", "Ver navegador", lang)}
              </button>
            </div>
          </div>
        )}

        {error && (
          <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
            {error}
          </div>
        )}

        {/* The window — one seamless container on the darkened page. The chat
            and the browser lock side by side (chat ~40%, browser ~60%) at a
            single locked height, and only the chat's message list scrolls.
            Flex (not grid): a grid row sizes to its content, which let the
            chat grow past the viewport instead of scrolling. */}
        <div className={`flex min-h-0 flex-col ${inWorkspace ? "mt-4 flex-1" : "mt-8"}`}>
          <div
            className={`flex min-h-0 flex-col overflow-hidden rounded-3xl bg-[#fbf8f2] shadow-2xl shadow-black/50 lg:flex-row ${
              inWorkspace ? "flex-1" : ""
            }`}
          >
          {/* Chat: the primary surface. Its message list is the only thing
              that scrolls in the workspace. */}
          {/* The chat column keeps a hard minimum width and clips its own
              overflow, so the browser beside it can never cover its buttons. */}
          <section
            className={`flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden ${
              showBrowserPanel
                ? "lg:w-[38%] lg:min-w-[360px] lg:max-w-[480px] lg:flex-none lg:border-r lg:border-[#161616]/10"
                : "lg:mx-auto lg:w-full lg:max-w-3xl"
            }`}
            aria-label={L("Mita chat", "Chat de Mita", lang)}
          >
            <AgencyChat
              lang={lang}
              businessId={businessId}
              msgs={msgs}
              milestones={milestones}
              run={run}
              runActive={Boolean(run)}
              transientHistory={transientHistory}
              scrollKey={scrollKey}
              onStartFiling={(filing) => void startFiling(filing)}
              filingBusyId={filingBusyId}
              onConfirmPreflight={(msg, answers) => confirmPreflightStart(msg, answers)}
              onUploadEvidence={(file, tags) => void uploadToLocker(file, tags)}
              uploadBusy={uploadBusy}
              intervention={intervention}
              review={review}
              submitted={submitted}
              terminalNote={terminalNote}
              onStop={() => void stop()}
              busy={busy}
              stoppedOrFailed={Boolean(run && (run.status === "stopped" || run.status === "failed"))}
              onNewRun={newRun}
              runFailed={run?.status === "failed"}
            />
          </section>

          {/* Browser — fills the rest of the window at the same locked height
              (above the chat on mobile, beside it on desktop). The panel stays
              mounted (hidden via CSS) so the session survives view switches.
              Not rendered at all before Start: an empty wrapper would paint a
              dead pane beside the chat (the chat section centers itself when
              the browser panel is absent). */}
          {(run || showBrowserPanel) && (
          <div className="order-first flex min-h-0 min-w-0 flex-1 flex-col lg:order-none">
          {run && (
            <AgencyBrowser
              lang={lang}
              run={run}
              open={browserOpen}
              onClose={() => setBrowserHidden(true)}
              portalName={portalName}
              uploadsText={L(activeConfig.uploadsEn, activeConfig.uploadsEs, lang)}
              domainsLabel={activeConfig.domains[0] ?? ""}
              isMock={run.provider === "mock"}
              takeover={takeover}
              busy={busy}
              previewKey={previewKey}
              previewLoaded={previewLoaded}
              onPreviewLoaded={() => setPreviewLoaded(true)}
              reconnectBusy={reconnectBusy}
              onReconnect={() => void reconnectPreview()}
              onTakeover={() => void enterTakeover()}
              onHandBack={() => void handBackToAgent()}
              onResume={() => void resume()}
              onStop={() => void stop()}
              fieldsPause={fieldsPause}
              uploadBusy={uploadBusy}
              uploadMsg={uploadMsg}
              onUpload={(file) => void uploadToLocker(file)}
            />
          )}

          {/* Pre-run placeholder (desktop only; on mobile the chat keeps the room): holds the browser's place from the moment
              Start is pressed, so the layout is already anchored and doesn't
              jump when the run begins. */}
          {!run && showBrowserPanel && (
            <div
              className="hidden min-h-0 flex-1 flex-col items-center justify-center gap-3 p-6 text-center lg:flex"
              aria-label={L("Live browser", "Navegador en vivo", lang)}
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#1e4d38]/10">
                <Shield className="h-5 w-5 text-[#1e4d38]" />
              </span>
              <p className="max-w-sm text-sm font-semibold text-[#23211c]">
                {L(
                  "The agency portal opens here when you confirm.",
                  "El portal de la agencia se abre aquí cuando confirmes.",
                  lang
                )}
              </p>
              <p className="max-w-sm text-xs text-[#6b675e]">
                {L(
                  "You'll watch every field fill in. Nothing is submitted without your approval.",
                  "Verás cada campo llenarse. Nada se envía sin tu aprobación.",
                  lang
                )}
              </p>
            </div>
          )}
          </div>
          )}
          </div>
        </div>
      </main>

      {stuckPrompt && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="mita-stuck-title"
        >
          <div className="w-full max-w-md rounded-3xl bg-[#fbf8f2] p-6 shadow-2xl shadow-black/40">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-100">
              <KeyRound className="h-5 w-5 text-amber-700" />
            </span>
            <h2
              id="mita-stuck-title"
              className="mt-3 font-[family-name:var(--font-display)] text-xl text-[#23211c]"
            >
              {L("Mita is stuck on this step", "Mita se trancó en este paso", lang)}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-[#6b675e]">
              {L(
                "I've tried this step a few times without getting past it. Take over the browser, finish this one step on the portal page, then press “I'm done” and I'll continue from there.",
                "Intenté este paso varias veces sin pasarlo. Toma el control del navegador, completa este paso en la página del portal y luego pulsa “Terminé” y sigo desde ahí.",
                lang
              )}
            </p>
            <div className="mt-5 flex flex-col gap-2 sm:flex-row-reverse">
              <button
                type="button"
                autoFocus
                onClick={() => {
                  setStuckDismissedKey(stuckKey);
                  void enterTakeover();
                }}
                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-full bg-[#1e4d38] px-4 py-2.5 text-sm font-bold text-white hover:bg-[#16382a]"
              >
                <KeyRound className="h-4 w-4" />
                {L("Take over the browser", "Tomar el control", lang)}
              </button>
              <button
                type="button"
                onClick={() => setStuckDismissedKey(stuckKey)}
                className="inline-flex flex-1 items-center justify-center rounded-full border border-[#161616]/15 px-4 py-2.5 text-sm font-semibold text-[#23211c] hover:bg-black/5"
              >
                {L("Not now", "Ahora no", lang)}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
