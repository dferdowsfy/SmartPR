"use client";

/**
 * Clara (agency assistant) — CHAT-PRIMARY run page.
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
import { useRouter } from "next/navigation";
import {
  ArrowLeft, Eye, EyeOff, KeyRound, Shield,
} from "lucide-react";
import { useLang, setLang } from "../../../useLang";
import type { Lang } from "../../../forms/engine/types";
import type {
  AgencyPendingField,
  AgencyRunPublic,
  AgencyRunStatus,
} from "../../../../lib/agency-runs/types";
import { getFilingConfig, AGENCY_FILING_CONFIGS } from "../../../../lib/agency-runs/filingTypes";
import {
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
import { AgencyChat, filingBusyKey, type SessionMsg } from "./AgencyChat";
import { type FilingGroup, type FilingOption } from "../../../../lib/agency-runs/agencyActions";
import { filingReadinessKey, type FilingReadinessSummary } from "../../../../lib/agency-runs/filingReadiness";
import { CLARA_HANDOFF_INTRO_EN, CLARA_HANDOFF_INTRO_ES, planClaraHandoff } from "./claraHandoff";
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
    <span className={`inline-flex items-center rounded-full border px-3 py-1 text-[13px] font-bold tracking-wide ${STATUS_STYLES[status]}`}>
      {statusLabel(status, lang)}
    </span>
  );
}

/**
 * Segmented passport-progress bar from the Clara design: filled segments in
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
  const router = useRouter();
  /** Back returns to the previous screen (intake, requirements, business
   * page) with its state intact via the router history — never a hard jump
   * to /businesses that drops the user's work. Direct arrivals with no
   * history fall back to the businesses list. */
  const goBack = useCallback(() => {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
    } else {
      router.push("/businesses");
    }
  }, [router]);

  const [run, setRun] = useState<AgencyRunPublic | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);
  const [previewKey, setPreviewKey] = useState(0);
  const [reconnectBusy, setReconnectBusy] = useState(false);
  const [takeover, setTakeover] = useState(false);
  /** Bumped when an action outside the chat should jump it to the newest activity. */
  const [scrollToLatest, setScrollToLatest] = useState(0);
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
  /** Small screens show one pane at a time; desktop ignores this. */
  const [mobilePane, setMobilePane] = useState<"chat" | "browser">("chat");
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
    // A local intake draft id is not a saved business — nothing to load.
    if (businessId.startsWith("local-")) return;
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

  /** Portal-fields progress for the Clara chat header ("Portal fields 11 of 12"). */
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

  /* Chat input → SmartPR's general assistant (/api/chat). It answers
     questions about requirements; it never drives the browser. */
  const [askBusy, setAskBusy] = useState(false);
  const askHistory = useRef<{ role: "user" | "assistant"; content: string }[]>([]);
  const onAsk = useCallback(
    async (text: string) => {
      const stamp = Date.now();
      pushMsg({ id: `user-${stamp}`, type: "user", text });
      askHistory.current = [...askHistory.current, { role: "user" as const, content: text }].slice(-12);
      setAskBusy(true);
      const picker = msgs.find((m) => m.type === "filing-picker");
      const filings = picker?.type === "filing-picker" ? picker.groups.flatMap((g) => g.filings) : [];
      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: askHistory.current,
            context: {
              profile: { name: bizHeader?.name ?? null, municipality: bizHeader?.municipality ?? null },
              requirements: filings.slice(0, 25).map((f) => ({
                code: f.requirement_id ?? f.obligation_id,
                name: `${f.obligation_name} — ${f.title_en}`,
                agency: f.agency_en,
                mandatory: true,
                status: f.filing_status === "submitted" ? "passed" : "pending",
              })),
              language: lang,
            },
          }),
        });
        const data = (await res.json().catch(() => ({}))) as { reply?: string };
        const reply =
          data.reply ||
          L(
            "I couldn't answer that right now. Try again in a moment.",
            "No pude responder en este momento. Inténtalo de nuevo en un momento.",
            lang
          );
        askHistory.current = [...askHistory.current, { role: "assistant" as const, content: reply }].slice(-12);
        pushMsg({ id: `reply-${stamp}`, type: "text", textEn: reply, textEs: reply, tone: "info" });
      } catch {
        pushMsg({
          id: `reply-${stamp}`,
          type: "text",
          textEn: "I couldn't reach the SmartPR assistant. Check your connection and try again.",
          textEs: "No pude conectar con el asistente de SmartPR. Revisa tu conexión e inténtalo de nuevo.",
          tone: "warn",
        });
      } finally {
        setAskBusy(false);
      }
    },
    [msgs, bizHeader, lang, pushMsg]
  );

  /** "Show missing items": what each openable filing still needs (from real records). */
  const onShowMissing = useCallback(() => {
    const picker = msgs.find((m) => m.type === "filing-picker");
    if (picker?.type !== "filing-picker") return;
    const lines: { en: string; es: string }[] = [];
    for (const f of picker.groups.flatMap((g) => g.filings)) {
      if (!f.supported) continue;
      const r = picker.readiness?.filings.find((x) => x.key === filingReadinessKey(f));
      const missing = r ? r.items.filter((i) => !i.ready) : (f.action?.missing_items ?? []).filter((m) => !m.sensitive);
      if (missing.length === 0) continue;
      lines.push({
        en: `${f.agency_en} — ${f.title_en}: ${missing.map((m) => m.label_en).join(", ")}`,
        es: `${f.agency_es} — ${f.title_es}: ${missing.map((m) => m.label_es).join(", ")}`,
      });
    }
    const stamp = Date.now();
    pushMsg(
      lines.length === 0
        ? {
            id: `missing-${stamp}`,
            type: "text",
            textEn: "Nothing is missing for the filings you can open here — everything SmartPR tracks for them is in place.",
            textEs: "No falta nada para los trámites que puedes abrir aquí — todo lo que SmartPR controla está listo.",
            tone: "success",
          }
        : {
            id: `missing-${stamp}`,
            type: "text",
            textEn: `Still needed before you submit:\n${lines.map((l) => `• ${l.en}`).join("\n")}`,
            textEs: `Falta antes de radicar:\n${lines.map((l) => `• ${l.es}`).join("\n")}`,
            tone: "warn",
          }
    );
  }, [msgs, pushMsg]);

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
                  // Every SmartPR requirement stays visible — including ones
                  // with no browser filing ("Other SmartPR requirements") and
                  // variants that can't start yet. Only supported filings
                  // get a Start button (the run API enforces the same).
                  groups: (result.groups ?? []) as FilingGroup[],
                  readiness: (result.readiness ?? null) as FilingReadinessSummary | null,
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

  /**
   * Session continuity: leaving for the dashboard never discards a Clara
   * session. The active run id (never field values) is remembered per
   * business, and reopening the route restores that run and jumps the
   * conversation to where the user left off. The run itself lives
   * server-side and keeps its state while nobody is watching.
   */
  const sessionKey = `smartpr-mita-session:${businessId}`;
  useEffect(() => {
    if (!run?.id) return;
    try {
      window.localStorage.setItem(
        sessionKey,
        JSON.stringify({ runId: run.id, filing_type: run.filing_type })
      );
    } catch {
      // Private mode / blocked storage — the in-progress filing card's
      // Resume button still reopens the run.
    }
  }, [run?.id, run?.filing_type, sessionKey]);

  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    let saved: { runId?: string } | null = null;
    try {
      saved = JSON.parse(window.localStorage.getItem(sessionKey) || "null");
    } catch {
      saved = null;
    }
    const runId = saved?.runId;
    if (!runId) return;
    let cancelled = false;
    (async () => {
      const response = await fetch(`/api/agency-runs/${runId}`).catch(() => null);
      const result = response ? await response.json().catch(() => ({})) : {};
      if (cancelled) return;
      if (!response?.ok || !result.run) {
        try {
          window.localStorage.removeItem(sessionKey);
        } catch {}
        return;
      }
      const restored = result.run as AgencyRunPublic;
      const cfg = getFilingConfig(restored.filing_type);
      setRun(restored);
      if (restored.goal_brief) {
        setGoalBrief(restored.goal_brief);
        setMsgs((prev) =>
          prev.some((m) => m.type === "goal-brief")
            ? prev
            : [
                ...prev,
                {
                  id: `brief-restored-${restored.id}`,
                  type: "goal-brief",
                  brief: restored.goal_brief as GoalBrief,
                  filingLabelEn: cfg.labelEn,
                  filingLabelEs: cfg.labelEs,
                },
              ]
        );
      }
      // Reopened mid-session: show the newest activity, not the top.
      setScrollToLatest((n) => n + 1);
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionKey]);

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

  // Leaving takeover mode whenever a different run loads (adjust state during
  // render — the React-endorsed pattern for previous-render resets).
  const [prevRunId, setPrevRunId] = useState<string | null>(null);
  if ((run?.id ?? null) !== prevRunId) {
    setPrevRunId(run?.id ?? null);
    setTakeover(false);
    setFieldValues({});
    setRevealedFields({});
    setValidationError(null);
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
   * Resume an in-progress filing: reopen its existing run in the workspace
   * instead of starting over. poll() loads the run and the existing poll
   * loop keeps it syncing while queued/running/paused.
   */
  const resumeFiling = async (filing: FilingOption) => {
    const runId = filing.active_run_id;
    if (!runId) return;
    setFilingBusyId(filingBusyKey(filing));
    setError(null);
    try {
      await poll(runId);
    } finally {
      setFilingBusyId(null);
    }
  };

  // Requirements → Clara handoff (?requirement=<DOC_ID>): once the filings
  // load, open that requirement's filing — Clara says what she already has
  // and shows the pre-flight card; nothing starts until the user confirms.
  const handoffDoneRef = useRef(false);
  const pickerState = msgs.find((m) => m.type === "filing-picker");
  useEffect(() => {
    if (handoffDoneRef.current || !pickerState || pickerState.type !== "filing-picker" || pickerState.loading) return;
    // ?filing=<document_id> (requirement cards) or ?requirement=<document_id>.
    const params = new URLSearchParams(window.location.search);
    const requirementId = params.get("filing") ?? params.get("requirement");
    if (!requirementId) return;
    handoffDoneRef.current = true;
    const plan = planClaraHandoff(pickerState.groups, requirementId);
    if (plan.kind === "start" || plan.kind === "resume") {
      pushMsg({ id: `handoff-${Date.now()}`, type: "text", textEn: CLARA_HANDOFF_INTRO_EN, textEs: CLARA_HANDOFF_INTRO_ES, tone: "info" });
      if (plan.kind === "start") void startFiling(plan.filing);
      else void resumeFiling(plan.filing);
    } else {
      pushMsg({ id: `handoff-${Date.now()}`, type: "text", textEn: plan.textEn, textEs: plan.textEs, tone: plan.kind === "missing" ? "warn" : "info" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot, when the filings first load
  }, [pickerState]);

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
    setMobilePane("browser");
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
    setMobilePane("chat");
    setScrollToLatest((n) => n + 1);
    await resume();
    setScrollToLatest((n) => n + 1);
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
    // Exactly what the server resolved for the visible portal step — never
    // a substituted login form.
    return run.pending_fields ?? [];
  }, [run]);

  /** Ids of pending fields treated as sensitive (masked + sealed). */
  const sensitiveIds = useMemo(() => {
    const s = new Set<string>();
    for (const f of pendingFields) if (isSensitiveField(f)) s.add(f.id);
    return s;
  }, [pendingFields]);

  /** Text-field pause: the chat card is the only place to type; live browser is view-only. */
  const stepKind = run?.portal_step?.kind ?? null;
  const fieldsPause =
    Boolean(run && run.status === "paused") &&
    pendingFields.length > 0 &&
    (stepKind === null || stepKind === "form" || stepKind === "identity");

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
    // Keep the newest activity in view after an inline answer.
    setScrollToLatest((n) => n + 1);
    const ok = await resume(merged);
    if (ok) setScrollToLatest((n) => n + 1);
  };

  const canFillFields =
    pendingFields.some((f) => {
      if (f.optional) return false;
      return fieldValuePresent(fieldValues[f.id]);
    }) || pendingFields.some((f) => fieldValuePresent(fieldValues[f.id]));

  // Detail line for the transient "waiting on you" status — named from the
  // visible portal step so it matches what the browser shows.
  const waitingDetail = (() => {
    if (wfState !== "WAITING_FOR_USER") return undefined;
    if (fieldsPause) {
      const labels = pendingFields.map((f) => f.label).join(", ");
      return L(`Waiting on you: ${labels}`, `Esperando por ti: ${labels}`, lang);
    }
    switch (stepKind) {
      case "login":
      case "mfa":
        return L("Waiting on you: sign in on the portal", "Esperando por ti: inicia sesión en el portal", lang);
      case "certification":
      case "signature":
        return L("Waiting on you: review and sign the certification", "Esperando por ti: revisa y firma la certificación", lang);
      case "payment":
        return L("Waiting on you: complete the payment", "Esperando por ti: completa el pago", lang);
      case "captcha":
        return L("Waiting on you: complete the captcha", "Esperando por ti: completa el captcha", lang);
      case "upload":
        return L("Waiting on you: upload the documents", "Esperando por ti: sube los documentos", lang);
      case "review":
      case "submission":
        return L("Waiting on you: final review", "Esperando por ti: revisión final", lang);
      default:
        return L("Waiting on you: take over this step", "Esperando por ti: toma el control en este paso", lang);
    }
  })();

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

  // Small screens: when Clara needs the user (fields, review, done), bring
  // the conversation forward — unless they are driving the browser.
  const needsChatKey =
    run && (run.status === "paused" || run.status === "review" || run.status === "submitted")
      ? `${run.id}:${run.status}:${pendingSig}`
      : null;
  const [prevNeedsChatKey, setPrevNeedsChatKey] = useState<string | null>(null);
  if (needsChatKey !== prevNeedsChatKey) {
    setPrevNeedsChatKey(needsChatKey);
    if (needsChatKey && !takeover) setMobilePane("chat");
  }

  const scrollKey = chatScrollKey({
    runId: run?.id ?? null,
    milestoneCount: milestones.length,
    transient: transientLabel ?? "",
    cardOpen: run?.status === "paused" || run?.status === "review",
    msgCount: msgs.length,
  });

  const newRun = () => {
    try {
      window.localStorage.removeItem(sessionKey);
    } catch {}
    setRun(null);
    setGoalBrief(null);
    setError(null);
    setUploadMsg(null);
    setBrowserHidden(false);
    // Keep the filing picker (already loaded) and drop everything after it.
    setMsgs((prev) => prev.filter((m) => m.type === "filing-picker"));
  };

  /**
   * The Clara route is always a viewport-locked workspace: one compact
   * persistent header, then the conversation and the agency browser filling
   * the rest of the screen. Every flex ancestor between the page and each
   * panel's own scroller carries min-h-0, so the panels — never the page —
   * scroll, and nothing hides behind a fixed bar. The entry explanation lives
   * in the first chat message, not a hero above the window.
   */
  /** Before a run the browser pane is a placeholder (desktop), so the layout doesn't jump. */
  const showBrowserPanel = !browserHidden;
  const workflowLabel = activeFilingLabel ?? L("Assisted filing", "Radicación asistida", lang);

  return (
    // No global app header on this route (see headerVisibility.ts) — the
    // workspace takes the full viewport height. TopNavMount publishes
    // --topnav-h as 0px here, so the calc below resolves to 100dvh; the
    // h-* class is the fallback where dvh is unsupported (some webviews
    // ignore dvh). overscroll-none stops rubber-band chaining.
    <div
      className="flex h-[calc(100vh-var(--topnav-h,0px))] flex-col overflow-hidden overscroll-none bg-[#161616]"
      style={{ height: "calc(100dvh - var(--topnav-h, 0px))" }}
    >
      <main className="mx-auto flex min-h-0 w-full max-w-7xl flex-1 flex-col px-3 pb-3 pt-2.5 sm:px-5">
        {/* Compact persistent workspace header */}
        <header className="shrink-0 rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2 sm:px-4">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={goBack}
              className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full border border-white/15 px-2.5 py-1.5 text-[13px] font-semibold text-[#e8e1d0] hover:bg-white/10"
              title={
                run && !terminal
                  ? L(
                      "Clara keeps your place — reopen this filing to pick up where you left off.",
                      "Clara guarda tu lugar — vuelve a abrir este trámite para seguir donde lo dejaste.",
                      lang
                    )
                  : undefined
              }
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{L("Back", "Atrás", lang)}</span>
            </button>
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#1e4d38] font-[family-name:var(--font-display)] text-[15px] text-white">
              M
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12px] font-bold uppercase tracking-[0.14em] text-[#9a917f]">
                {bizHeader
                  ? bizHeader.municipality
                    ? `${bizHeader.name} · ${bizHeader.municipality}`
                    : bizHeader.name
                  : L("Clara · Assisted filing", "Clara · Radicación asistida", lang)}
              </p>
              <p className="truncate font-[family-name:var(--font-display)] text-[17px] leading-tight text-[#f4efe2]">
                {workflowLabel}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {run && <StatusPill status={run.status} lang={lang} />}
              {intervention && (
                <span className="hidden items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-2.5 py-1 text-[13px] font-bold text-amber-900 sm:inline-flex">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                  {L("Needs you", "Te necesita", lang)}
                </span>
              )}
            </div>
            {/* Filing progress: portal fields (what Clara still needs) on
                md+, the SmartPR workflow step on xl. */}
            {portalFieldsProgress && (
              <span
                className="hidden shrink-0 items-center gap-2 md:inline-flex"
                aria-label={L("Filing progress", "Progreso del trámite", lang)}
              >
                <span className="whitespace-nowrap text-[13px] font-semibold text-[#b9b0a0]">
                  {L("Portal fields", "Campos del portal", lang)} · {portalFieldsProgress.known}/
                  {portalFieldsProgress.total}
                </span>
                <SegmentedBar known={portalFieldsProgress.known} total={portalFieldsProgress.total} />
              </span>
            )}
            <ol
              className="hidden shrink-0 items-center gap-2 text-[13px] font-bold xl:flex"
              aria-label={L("SmartPR steps", "Pasos de SmartPR", lang)}
            >
              <li className="flex items-center gap-1 text-[#8f8674]">
                <span className="flex h-4 w-4 items-center justify-center rounded-full bg-[#dcefe2] text-[9px] font-black text-[#1e4d38]">✓</span>
                {L("Requirements", "Requisitos", lang)}
              </li>
              <li className="flex items-center gap-1 text-[#f4efe2]">
                <span className="flex h-4 w-4 items-center justify-center rounded-full bg-[#1e4d38] text-[9px] font-black text-white">3</span>
                {L("File", "Radicación", lang)}
              </li>
            </ol>
            {/* Language toggle lives here now that the global nav (which
                used to carry it) is removed on this route. */}
            <div
              className="hidden shrink-0 items-center gap-0.5 rounded-full border border-white/15 bg-white/5 p-1 lg:inline-flex"
              role="group"
              aria-label={L("Language", "Idioma", lang)}
            >
              {(["en", "es"] as const).map((l) => (
                <button
                  key={l}
                  type="button"
                  aria-pressed={lang === l}
                  onClick={() => setLang(l)}
                  className={`rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider transition ${
                    lang === l
                      ? "bg-[#fbf8f2] text-[#161616]"
                      : "text-[#b9b0a0] hover:text-white"
                  }`}
                >
                  {l.toUpperCase()}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setBrowserHidden((h) => !h)}
              aria-pressed={!showBrowserPanel}
              className="hidden shrink-0 items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-[13px] font-semibold text-[#e8e1d0] hover:bg-white/10 lg:inline-flex"
            >
              {showBrowserPanel ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              {showBrowserPanel
                ? L("Hide browser", "Ocultar navegador", lang)
                : L("Show browser", "Ver navegador", lang)}
            </button>
          </div>

          {/* Small screens: one pane at a time, with an explicit switch. */}
          <div
            className="mt-2 grid grid-cols-2 gap-1 rounded-full bg-black/30 p-1 lg:hidden"
            role="tablist"
            aria-label={L("Workspace view", "Vista del espacio", lang)}
          >
            {(
              [
                ["chat", L("Conversation", "Conversación", lang)],
                ["browser", L("Browser", "Navegador", lang)],
              ] as const
            ).map(([pane, label]) => (
              <button
                key={pane}
                type="button"
                role="tab"
                aria-selected={mobilePane === pane}
                onClick={() => setMobilePane(pane)}
                className={`relative rounded-full px-3 py-1.5 text-[13px] font-semibold transition ${
                  mobilePane === pane ? "bg-[#fbf8f2] text-[#161616]" : "text-[#cfc6b4] hover:text-white"
                }`}
              >
                {label}
                {pane === "chat" && intervention && mobilePane !== "chat" && (
                  <span className="absolute right-3 top-1/2 h-2 w-2 -translate-y-1/2 rounded-full bg-amber-400" aria-label={L("Needs you", "Te necesita", lang)} />
                )}
              </button>
            ))}
          </div>
        </header>

        {error && (
          <div className="mt-2 shrink-0 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-[15px] text-rose-800">
            {error}
          </div>
        )}

        {/* The window — chat and browser side by side on desktop, one at a
            time on small screens. Flex (not grid): a grid row sizes to its
            content, which let the chat grow past the viewport. */}
        <div className="mt-2.5 flex min-h-0 flex-1 flex-col overflow-hidden rounded-3xl bg-[#fbf8f2] shadow-2xl shadow-black/50 lg:flex-row">
          <section
            className={`min-h-0 min-w-0 flex-1 flex-col overflow-hidden lg:flex ${
              mobilePane === "chat" ? "flex" : "hidden"
            } ${
              showBrowserPanel
                ? "lg:w-[38%] lg:min-w-[360px] lg:max-w-[480px] lg:flex-none lg:border-r lg:border-[#161616]/10"
                : "lg:mx-auto lg:w-full lg:max-w-3xl"
            }`}
            aria-label={L("Clara chat", "Chat de Clara", lang)}
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
              scrollToLatestSignal={scrollToLatest}
              onStartFiling={(filing) => void startFiling(filing)}
              onResumeFiling={(filing) => void resumeFiling(filing)}
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
              projectName={bizHeader?.name ?? null}
              onAsk={onAsk}
              askBusy={askBusy}
              onShowMissing={onShowMissing}
              prepareHref={`/businesses/${businessId}#all-requirements`}
            />
          </section>

          {/* Browser — stays mounted (hidden via CSS) so the live session
              survives view switches. */}
          <div
            className={`min-h-0 min-w-0 flex-1 flex-col ${
              mobilePane === "browser" ? "flex" : "hidden"
            } ${showBrowserPanel ? "lg:flex" : "lg:hidden"}`}
          >
            {run ? (
              <AgencyBrowser
                lang={lang}
                run={run}
                open
                onClose={() => {
                  setBrowserHidden(true);
                  setMobilePane("chat");
                }}
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
            ) : (
              <div
                className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-6 text-center"
                aria-label={L("Live browser", "Navegador en vivo", lang)}
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#1e4d38]/10">
                  <Shield className="h-5 w-5 text-[#1e4d38]" />
                </span>
                <p className="max-w-sm text-[15px] font-semibold text-[#23211c]">
                  {L(
                    "The agency portal opens here once you start a filing.",
                    "El portal de la agencia se abre aquí cuando empieces un trámite.",
                    lang
                  )}
                </p>
                <p className="max-w-sm text-[13px] text-[#6b675e]">
                  {L(
                    "You'll watch Clara fill every field. You review and submit — nothing is sent without your approval.",
                    "Verás a Clara llenar cada campo. Tú revisas y envías — nada se envía sin tu aprobación.",
                    lang
                  )}
                </p>
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
              {L("Clara is stuck on this step", "Clara se trancó en este paso", lang)}
            </h2>
            <p className="mt-2 text-[15px] leading-relaxed text-[#6b675e]">
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
                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-full bg-[#1e4d38] px-4 py-2.5 text-[15px] font-bold text-white hover:bg-[#16382a]"
              >
                <KeyRound className="h-4 w-4" />
                {L("Take over the browser", "Tomar el control", lang)}
              </button>
              <button
                type="button"
                onClick={() => setStuckDismissedKey(stuckKey)}
                className="inline-flex flex-1 items-center justify-center rounded-full border border-[#161616]/15 px-4 py-2.5 text-[15px] font-semibold text-[#23211c] hover:bg-black/5"
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
