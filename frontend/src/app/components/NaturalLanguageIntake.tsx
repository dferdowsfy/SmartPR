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
  type IntakePatch,
  type ValidatedInterpretation,
} from "../ai/intake/validateInterpretation";
import { IntakeVoiceOrb } from "./voice/IntakeVoiceOrb";

export interface NaturalLanguageIntakeProps {
  kb: KnowledgeBase;
  lang: "en" | "es";
  allowedIndustries?: string[];
  allowedLocationTypes?: string[];
  /** Apply the high-confidence values to the existing profile + answers. */
  onApply: (patch: IntakePatch, validated: ValidatedInterpretation) => void;
  /** When true, show the floating voice orb (intake Start). Default true. */
  showVoiceOrb?: boolean;
}

type Status = "idle" | "loading" | "done" | "error";

export function NaturalLanguageIntake({
  kb,
  lang,
  allowedIndustries,
  allowedLocationTypes,
  onApply,
  showVoiceOrb = true,
}: NaturalLanguageIntakeProps) {
  const L = (en: string, es: string) => (lang === "es" ? es : en);
  const [text, setText] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [chips, setChips] = useState<{ label: string }[]>([]);
  const [pending, setPending] = useState<ValidatedInterpretation["suggested"] | null>(null);
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

  const interpretDescription = useCallback(
    async (descriptionRaw: string) => {
      const description = descriptionRaw.trim();
      if (!description || loadingRef.current) return;
      loadingRef.current = true;
      setStatus("loading");
      setChips([]);
      setPending(null);
      try {
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
        const validated = validateInterpretation(data?.interpretation, kb, {
          allowedIndustries,
          allowedLocationTypes,
        });
        // The KB lets toIntakePatch reconcile contradictory model answers and
        // hide chips that merely restate a fact another chip already implies.
        const patch = toIntakePatch(validated, { kb, allowedIndustries });

        const nothingFound =
          Object.keys(patch.profile).length === 0 && Object.keys(patch.answers).length === 0;
        if (nothingFound) {
          setStatus("error");
          return;
        }

        onApply(patch, validated);
        setChips(patch.chips);
        const hasSuggestions =
          validated.suggested.businessType ||
          validated.suggested.municipality ||
          validated.suggested.answers.length > 0 ||
          validated.suggested.profileValues.length > 0;
        setPending(hasSuggestions ? validated.suggested : null);
        setStatus("done");
      } catch {
        setStatus("error");
      } finally {
        loadingRef.current = false;
      }
    },
    [kb, lang, allowedIndustries, allowedLocationTypes, onApply]
  );

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
        const validated = validateInterpretation(data?.interpretation, kb, {
          allowedIndustries,
          allowedLocationTypes,
        });
        const patch = toIntakePatch(validated, { kb, allowedIndustries });
        const nothingFound =
          Object.keys(patch.profile).length === 0 && Object.keys(patch.answers).length === 0;
        if (nothingFound) {
          setStatus("error");
          return;
        }
        onApply(patch, validated);
        mergeChips(patch.chips);
        const hasSuggestions =
          validated.suggested.businessType ||
          validated.suggested.municipality ||
          validated.suggested.answers.length > 0 ||
          validated.suggested.profileValues.length > 0;
        setPending(hasSuggestions ? validated.suggested : null);
        setStatus("done");
      } catch {
        setStatus("error");
      } finally {
        loadingRef.current = false;
      }
    },
    [kb, lang, allowedIndustries, allowedLocationTypes, onApply, mergeChips]
  );

  const handleVoiceTranscript = useCallback(
    async (transcript: string) => {
      const t = transcript.trim();
      if (!t) return;
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
    [interpretDescription, interpretFollowUp]
  );

  const focusDescribeBox = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    window.setTimeout(() => el.focus(), 120);
  }, []);

  const applySuggestion = (suggested: ValidatedInterpretation["suggested"]) => {
    // Promote confirmed suggestions through the same validated -> patch path.
    const promoted: ValidatedInterpretation = {
      summary: "",
      businessType: suggested.businessType,
      municipality: suggested.municipality,
      profileValues: suggested.profileValues,
      answers: suggested.answers,
      suggested: { profileValues: [], answers: [] },
      discarded: [],
    };
    const patch = toIntakePatch(promoted, { kb, allowedIndustries });
    onApply(patch, promoted);
    setChips((current) => [...current, ...patch.chips]);
    setPending(null);
  };

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

      {status === "done" && chips.length > 0 && (
        <div className="spr-nl-result">
          <span className="spr-nl-result-label">{L("We understood:", "Entendimos:")}</span>
          <div className="spr-nl-chips">
            {chips.map((chip, i) => (
              <span key={`${chip.label}-${i}`} className="spr-nl-chip">
                {chip.label}
              </span>
            ))}
          </div>
          <button
            type="button"
            className="spr-nl-edit"
            onClick={() => {
              setChips([]);
              setPending(null);
              setStatus("idle");
            }}
          >
            {L("Edit", "Editar")}
          </button>
        </div>
      )}

      {status === "done" && pending && (
        <div className="spr-nl-suggest">
          <span>
            {L("Also apply?", "¿Aplicar también?")}{" "}
            {[
              pending.businessType?.name,
              pending.municipality?.value,
              ...pending.profileValues.map((p) => p.value),
              ...pending.answers.filter((a) => a.value === true).map((a) => a.question),
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
          <button type="button" className="spr-nl-edit" onClick={() => applySuggestion(pending)}>
            {L("Yes", "Sí")}
          </button>
          <button type="button" className="spr-nl-edit" onClick={() => setPending(null)}>
            {L("No", "No")}
          </button>
        </div>
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
          busy={status === "loading"}
          onTranscript={handleVoiceTranscript}
          onUseTextInstead={focusDescribeBox}
        />
      )}
    </div>
  );
}
