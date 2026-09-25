"use client";

// ============================================================================
// NaturalLanguageIntake — an optional shortcut that fills in the EXISTING
// SmartPR intake fields from one sentence (typed or spoken via IntakeVoiceOrb).
//
// This is deliberately NOT a chatbot. It interprets the description into intake
// values, shows a short "We understood:" confirmation, and then hands off to the
// normal guided intake. The AI never decides requirements — once values land on
// the profile/discovery answers, the existing rules engine computes everything.
// If interpretation fails for any reason, the guided intake below still works.
// ============================================================================

import React, { useCallback, useEffect, useRef, useState } from "react";
import type { KnowledgeBase } from "../rulesEngine";
import { buildKbCandidates } from "../ai/intake/kbCandidates";
import {
  toIntakePatch,
  validateInterpretation,
  promoteSuggested,
  type IntakePatch,
  type ValidatedInterpretation,
} from "../ai/intake/validateInterpretation";
import { validateProjectContext } from "../ai/intake/projectContext";
import {
  applyScenarioToInterpretation,
  combineScenario,
  describeScenario,
  interpretScenario,
  normalizeScenario,
  type ScenarioContext,
  type ScenarioSummary,
} from "../ai/intake/scenario";
import { projectIntentLabel } from "../ai/intake/projectIntent";
import { IntakeVoiceOrb } from "./voice/IntakeVoiceOrb";
import { PassportVoiceReview, usePassportVoiceInput, type PassportInputTarget } from "./voice/PassportVoiceReview";

export interface NaturalLanguageIntakeProps {
  kb: KnowledgeBase;
  lang: "en" | "es";
  allowedIndustries?: string[];
  allowedLocationTypes?: string[];
  /** Apply the high-confidence values to the existing profile + answers.
   * `opts.fresh` marks a replacement description (the main interpret action):
   * the intake starts a new provenance session and quarantines facts the
   * previous description established instead of silently inheriting them.
   * Follow-up interpretations omit it and merge into the current session. */
  onApply: (patch: IntakePatch, validated: ValidatedInterpretation, opts?: { fresh?: boolean }) => void;
  /** Fires when the user taps Edit on the interpreted strip: the parent
   * starts replacement hygiene immediately (quarantining narrative-derived
   * facts) instead of waiting for a new description to be submitted. */
  onEdit?: () => void;
  /** When true, show the floating voice orb (intake Start). Default true. */
  showVoiceOrb?: boolean;
  /** Enabled only once discovery is complete; writes the existing canonical state. */
  passport?: PassportInputTarget;
  /**
   * The parent's live scenario summary (after Passport merge and answered
   * questions). When supplied it replaces this component's own reading so the
   * strip never goes stale.
   */
  scenarioSummary?: ScenarioSummary | null;
}

type Status = "idle" | "loading" | "done" | "error";

/**
 * Attach validated project-context facts to a validated interpretation.
 * The server already validated defensively; the client re-validates here and
 * never trusts the raw model output.
 */
function attachProjectContext(
  validated: ValidatedInterpretation,
  data: { projectContext?: unknown } | null | undefined
): void {
  const { context } = validateProjectContext(data?.projectContext);
  if (Object.keys(context).length > 0) validated.projectContext = context;
}

function scenarioHasFacts(s: ScenarioContext | undefined): boolean {
  return !!s && Object.values(s).some((section) => Object.keys(section).length > 0);
}

/**
 * The scenario for a description: the deterministic reading, combined with
 * the server's reading after re-validating it against the text. Works with
 * no server reading at all (AI unavailable).
 */
function scenarioFor(description: string, data: { scenario?: unknown } | null | undefined): ScenarioContext {
  const model = data?.scenario ? normalizeScenario(data.scenario, description).scenario : null;
  return combineScenario(interpretScenario(description), model);
}

/** True when the interpretation produced any usable fact — visible fields (at
 *  any confidence band), suggested facts, project context, or project intent. */
function hasAnyFact(patch: IntakePatch, validated: ValidatedInterpretation): boolean {
  const suggested = validated.suggested;
  return (
    scenarioHasFacts(validated.scenario) ||
    Object.keys(patch.profile).length > 0 ||
    Object.keys(patch.answers).length > 0 ||
    suggested.profileValues.length > 0 ||
    suggested.answers.length > 0 ||
    suggested.businessType != null ||
    suggested.municipality != null ||
    validated.projectIntent != null ||
    suggested.projectIntent != null ||
    Object.keys(validated.projectContext ?? {}).length > 0
  );
}

export function NaturalLanguageIntake({
  kb,
  lang,
  allowedIndustries,
  allowedLocationTypes,
  onApply,
  onEdit,
  showVoiceOrb = true,
  passport,
  scenarioSummary,
}: NaturalLanguageIntakeProps) {
  const passportReview = usePassportVoiceInput(passport, lang);
  const receivePassport = passportReview.receive;
  const L = (en: string, es: string) => (lang === "es" ? es : en);
  const [text, setText] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [chips, setChips] = useState<{ label: string }[]>([]);
  // Uncertain conclusions live apart from confirmed facts — never as ordinary chips.
  const [needsChips, setNeedsChips] = useState<{ label: string }[]>([]);
  // Business-level chips (KB business type, profile values) from the model.
  const [businessChips, setBusinessChips] = useState<{ label: string }[]>([]);
  const [businessNeeds, setBusinessNeeds] = useState<{ label: string }[]>([]);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const loadingRef = useRef(false);
  // Tracks whether the description box already has content, so the first
  // voice input becomes the description while later follow-ups are treated
  // as incremental facts (never appended to the box).
  const textRef = useRef("");

  // Grow with the text so a long description wraps into view instead of
  // scrolling sideways on one line. Capped so the field never runs away.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 190)}px`;
  }, [text]);

  /** Scenario chips: stated facts vs. facts that need confirmation. */
  const scenarioChips = useCallback((validated: ValidatedInterpretation) => {
    const d = validated.scenario ? describeScenario(validated.scenario) : { understood: [], needsConfirmation: [] };
    return { understood: d.understood.map((c) => ({ label: c.label })), needs: d.needsConfirmation.map((c) => ({ label: c.label })) };
  }, []);

  /**
   * 0.60–0.85 "suggested" business facts. They are filled by onApply and
   * listed under "Needs confirmation" — no separate "Also apply?" step.
   */
  const buildSuggestedChips = useCallback(
    (validated: ValidatedInterpretation) => {
      const promoted = toIntakePatch(promoteSuggested(validated), { kb, allowedIndustries });
      const chips = promoted.chips.map((c) => ({ ...c }));
      const intent = validated.suggested.projectIntent;
      if (intent) {
        chips.push({ label: `${L("Project intent", "Tipo de proyecto")}: ${projectIntentLabel(intent.value, lang)}` });
      }
      return chips;
    },
    [kb, lang, allowedIndustries]
  );

  /** Merge business chips and scenario chips, dropping duplicates (e.g. the municipality). */
  const dedupe = (list: { label: string }[]) => {
    const seen = new Set<string>();
    return list.filter((c) => {
      const k = c.label.toLowerCase().replace(/^(municipality|municipio):\s*/, "");
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  };

  const interpretDescription = useCallback(
    async (descriptionRaw: string) => {
      const description = descriptionRaw.trim();
      if (!description || loadingRef.current) return;
      loadingRef.current = true;
      setStatus("loading");
      setChips([]);
      try {
        if (passport) {
          const res = await fetch("/api/intake/interpret", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ description, mode: "passport", lang, candidates: buildKbCandidates(kb, description), allowedIndustries, allowedLocationTypes }),
          });
          if (!res.ok) throw new Error(`interpret ${res.status}`);
          const data = await res.json();
          await receivePassport(data.proposals, description);
          // Discovery is already complete when Passport mode is enabled. Do
          // not replay the model's parallel discovery interpretation here: a
          // loose business-type guess can rebuild the guided-question list,
          // hide the Passport fields, and make the user answer intake twice.
          // Before this point, the unchanged discovery branch below remains
          // responsible for business classification and question answers.
          setStatus("done");
          return;
        }
        // Candidates come from the ACTIVE KB — the same one the rules engine uses.
        const candidates = buildKbCandidates(kb, description);
        const res = await fetch("/api/intake/interpret", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            description,
            candidates,
            lang,
            allowedIndustries,
            allowedLocationTypes,
          }),
        });
        if (!res.ok) throw new Error(`interpret ${res.status}`);
        const data = await res.json();

        // Never trust returned ids — validate against the active KB.
        const raw = validateInterpretation(data?.interpretation, kb, {
          allowedIndustries,
          allowedLocationTypes,
        });
        attachProjectContext(raw, data);
        // The whole-scenario reading governs intent and project facts.
        const validated = applyScenarioToInterpretation(raw, scenarioFor(description, data));
        // The KB lets toIntakePatch reconcile contradictory model answers and
        // hide chips that merely restate a fact another chip already implies.
        const patch = toIntakePatch(validated, { kb, allowedIndustries });

        // A project-context-only result (rich project description, no visible
        // business fields) is a success, not an error — the facts are kept
        // and feed follow-up questions, goal briefs, and the passport.
        const nothingFound = !hasAnyFact(patch, validated);
        if (nothingFound) {
          setStatus("error");
          return;
        }

        // Fresh description (the main interpret action, including after Edit):
        // a new provenance session — facts the previous description
        // established are quarantined, never silently inherited.
        onApply(patch, validated, { fresh: true });
        // Stated facts under "We understood"; suggested (0.60–0.85) business
        // facts and scenario inferences under "Needs confirmation".
        const sc = scenarioChips(validated);
        const suggestedChips = buildSuggestedChips(validated);
        setChips(dedupe([...sc.understood, ...patch.chips]));
        setNeedsChips(dedupe([...sc.needs, ...suggestedChips]));
        setBusinessChips(patch.chips);
        setBusinessNeeds(suggestedChips);
        setStatus("done");
      } catch {
        // The AI reading failed — the deterministic scenario reading still
        // understands the situation; only the KB-id fields wait for the
        // guided questions.
        const offline = applyScenarioToInterpretation(
          validateInterpretation(null, kb, { allowedIndustries, allowedLocationTypes }),
          scenarioFor(description, null)
        );
        if (scenarioHasFacts(offline.scenario)) {
          const patch = toIntakePatch(offline, { kb, allowedIndustries });
          onApply(patch, offline, { fresh: true });
          const sc = scenarioChips(offline);
          setChips(sc.understood);
          setNeedsChips(sc.needs);
          setBusinessChips([]);
          setBusinessNeeds([]);
          setStatus("done");
        } else {
          setStatus("error");
        }
      } finally {
        loadingRef.current = false;
      }
    },
    [kb, lang, allowedIndustries, allowedLocationTypes, onApply, passport, receivePassport, buildSuggestedChips, scenarioChips]
  );

  // The parent's live summary (Passport merged, questions answered) wins;
  // business-level chips from this reading stay alongside it.
  const shownUnderstood = scenarioSummary
    ? dedupe([...scenarioSummary.understood.map((c) => ({ label: c.label })), ...businessChips])
    : chips;
  const shownNeeds = scenarioSummary
    ? dedupe([...scenarioSummary.needsConfirmation.map((c) => ({ label: c.label })), ...businessNeeds])
    : needsChips;

  const interpret = () => {
    void interpretDescription(text);
  };

  /**
   * Merge follow-up chips into the existing "We understood:" strip: a chip
   * with the same label is replaced in place (the fact was restated), new
   * chips are appended. Earlier facts never disappear.
   */
  const mergeChips = useCallback(
    (next: { label: string; detail?: string; questionId?: string }[]) => {
      setChips((current) => {
        const labels = new Set(next.map((c) => c.label));
        const kept = current.filter((c) => !labels.has(c.label));
        return [...kept, ...next];
      });
    },
    []
  );

  const interpretFollowUp = useCallback(
    async (transcript: string) => {
      if (loadingRef.current) return;
      loadingRef.current = true;
      setStatus("loading");
      try {
        const candidates = buildKbCandidates(kb, transcript);
        const res = await fetch("/api/intake/interpret", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            description: transcript,
            candidates,
            lang,
            allowedIndustries,
            allowedLocationTypes,
          }),
        });
        if (!res.ok) throw new Error(`interpret ${res.status}`);
        const data = await res.json();
        const raw = validateInterpretation(data?.interpretation, kb, {
          allowedIndustries,
          allowedLocationTypes,
        });
        attachProjectContext(raw, data);
        const validated = applyScenarioToInterpretation(raw, scenarioFor(transcript, data));
        const patch = toIntakePatch(validated, { kb, allowedIndustries });
        const nothingFound = !hasAnyFact(patch, validated);
        if (nothingFound) {
          setStatus("error");
          return;
        }
        onApply(patch, validated);
        const sc = scenarioChips(validated);
        const suggestedChips = buildSuggestedChips(validated);
        mergeChips(dedupe([...sc.understood, ...patch.chips]));
        setNeedsChips((cur) => dedupe([...cur, ...sc.needs, ...suggestedChips]));
        setBusinessChips((cur) => dedupe([...cur, ...patch.chips]));
        setBusinessNeeds((cur) => dedupe([...cur, ...suggestedChips]));
        setStatus("done");
      } catch {
        setStatus("error");
      } finally {
        loadingRef.current = false;
      }
    },
    [kb, lang, allowedIndustries, allowedLocationTypes, onApply, mergeChips, buildSuggestedChips, scenarioChips]
  );

  const handleVoiceTranscript = useCallback(
    async (transcript: string) => {
      const t = transcript.trim();
      if (!t) return;
      if (passport) {
        await interpretDescription(t);
        return;
      }
      if (!textRef.current.trim()) {
        // First voice input: it IS the business description.
        textRef.current = t;
        setText(t);
        await interpretDescription(t);
        return;
      }
      // Follow-up: an incremental fact ("It will have ten employees").
      // Interpret it on its own and merge the new facts into the existing
      // profile — the description box stays exactly as it was.
      await interpretFollowUp(t);
    },
    [interpretDescription, interpretFollowUp, passport]
  );

  const focusDescribeBox = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    window.setTimeout(() => el.focus(), 120);
  }, []);

  return (
    <div className="spr-nl">
      <label className="spr-nl-label" htmlFor="spr-nl-input">
        {L("What are you looking to open?", "¿Qué desea abrir?")}
      </label>
      <div className="spr-nl-row">
        <textarea
          id="spr-nl-input"
          className="spr-nl-input"
          ref={inputRef}
          rows={2}
          value={text}
          placeholder={L("Describe your business...", "Describa su negocio...")}
          onChange={(e) => {
            textRef.current = e.target.value;
            setText(e.target.value);
          }}
          onKeyDown={(e) => {
            // Enter submits; Shift+Enter adds a line break.
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              interpret();
            }
          }}
        />
        <button
          type="button"
          className="spr-nl-go"
          onClick={interpret}
          disabled={status === "loading" || text.trim() === ""}
          aria-label={L("Interpret description", "Interpretar descripción")}
        >
          {status === "loading" ? "…" : "→"}
        </button>
      </div>

      <p className="spr-nl-example">
        {L(
          "Example: “I want to open a restaurant in San Juan with outdoor seating.”",
          "Ejemplo: «Quiero abrir un restaurante en San Juan con área exterior»."
        )}
      </p>

      {status === "done" && (shownUnderstood.length > 0 || shownNeeds.length > 0) && (
        <div className="spr-nl-result" data-testid="scenario-understood">
          {shownUnderstood.length > 0 && (
            <>
              <span className="spr-nl-result-label">{L("We understood", "Entendimos")}</span>
              <div className="spr-nl-chips">
                {shownUnderstood.map((chip, i) => (
                  <span key={`${chip.label}-${i}`} className="spr-nl-chip">
                    {chip.label}
                  </span>
                ))}
              </div>
            </>
          )}
          {shownNeeds.length > 0 && (
            <div className="spr-nl-needs" data-testid="scenario-needs-confirmation">
              <span className="spr-nl-result-label">{L("Needs confirmation", "Necesita confirmación")}</span>
              <div className="spr-nl-chips">
                {shownNeeds.map((chip, i) => (
                  <span key={`${chip.label}-${i}`} className="spr-nl-chip spr-nl-chip-needs">
                    {chip.label}
                  </span>
                ))}
              </div>
            </div>
          )}
          <button
            type="button"
            className="spr-nl-edit"
            onClick={() => {
              setChips([]);
              setNeedsChips([]);
              setBusinessChips([]);
              setBusinessNeeds([]);
              setStatus("idle");
              // Tell the parent now: it quarantines the narrative-derived
              // facts immediately so nothing stale keeps driving requirements
              // while the user retypes the description.
              onEdit?.();
            }}
          >
            {L("Edit", "Editar")}
          </button>
        </div>
      )}

      {status === "done" && shownUnderstood.length === 0 && shownNeeds.length === 0 && (
        <p className="spr-nl-kept" role="status">
          {L(
            "Got it — I kept the project details you mentioned. A few follow-up questions will help pin down the rest.",
            "Entendido — guardé los detalles del proyecto que mencionaste. Unas preguntas de seguimiento ayudarán a completar lo demás."
          )}
        </p>
      )}

      {status === "error" && (
        <p className="spr-nl-error">
          {L(
            "We couldn't interpret that automatically. You can continue with the guided questions below.",
            "No pudimos interpretar eso automáticamente. Puede continuar con las preguntas guiadas a continuación."
          )}
        </p>
      )}

      <div className="spr-nl-divider">
        <span>{L("or", "o")}</span>
      </div>

      {showVoiceOrb && (
        <IntakeVoiceOrb
          lang={lang}
          busy={status === "loading" || passportReview.saving}
          onTranscript={handleVoiceTranscript}
          onUseTextInstead={focusDescribeBox}
          enableVoiceAnswers={!passport}
          feedback={<PassportVoiceReview review={passportReview} lang={lang} />}
        />
      )}
    </div>
  );
}
