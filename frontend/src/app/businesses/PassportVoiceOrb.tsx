"use client";

import { useState } from "react";
import { IntakeVoiceOrb } from "../components/voice/IntakeVoiceOrb";
import { PassportVoiceReview, usePassportVoiceInput, type PassportInputTarget } from "../components/voice/PassportVoiceReview";
import type { Lang } from "../forms/engine/types";

// Same recorder, Grok STT route, interpreter and canonical update handler as
// intake. Lives inside the editor so unsaved typed values also win conflicts.
export function PassportVoiceOrb({ canonical, onChange, lang, onUseTextInstead, disabled = false }: PassportInputTarget & {
  lang: Lang;
  onUseTextInstead: () => void;
  disabled?: boolean;
}) {
  const review = usePassportVoiceInput({ canonical, onChange }, lang);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return <IntakeVoiceOrb
    lang={lang}
    busy={busy || review.saving || disabled}
    enableVoiceAnswers={false}
    onUseTextInstead={onUseTextInstead}
    feedback={<>{error && <p role="alert" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{error}</p>}<PassportVoiceReview review={review} lang={lang} /></>}
    onTranscript={async (transcript) => {
      setBusy(true);
      setError("");
      try {
        const response = await fetch("/api/intake/interpret", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: "passport", description: transcript, lang }),
        });
        if (!response.ok) throw new Error("extraction_failed");
        const result = await response.json();
        await review.receive(result.proposals, transcript);
      } catch {
        setError(lang === "es" ? "No se pudo interpretar la grabación. Los datos existentes se conservaron." : "Could not interpret the recording. Existing details were preserved.");
      } finally { setBusy(false); }
    }}
  />;
}
