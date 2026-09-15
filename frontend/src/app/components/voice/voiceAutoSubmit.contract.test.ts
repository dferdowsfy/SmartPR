// Documents the Intake Start voice auto-submit contract.
// Run: node --experimental-strip-types --test src/app/components/voice/voiceAutoSubmit.contract.test.ts
//
// After speech→text, interpret must run automatically (no Describe → click).
// Orb stays processing through interpret; typed path keeps the arrow button.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const nli = readFileSync(join(here, "..", "NaturalLanguageIntake.tsx"), "utf8");
const orb = readFileSync(join(here, "IntakeVoiceOrb.tsx"), "utf8");

test("voice transcript force-runs interpret (not textarea-only)", () => {
  assert.match(
    nli,
    /interpretDescription\(transcript,\s*\{\s*force:\s*true\s*\}\)/,
    "handleVoiceTranscript must call interpret with { force: true }"
  );
  assert.match(
    nli,
    /throw new Error\("interpret_failed"\)/,
    "voice path must reject on interpret failure so the orb can show an error"
  );
  assert.match(
    nli,
    /opts\?\.force/,
    "interpretDescription must accept a force option to clear a stale loadingRef"
  );
});

test("orb awaits onTranscript through filling phase (no early collapse after STT)", () => {
  assert.match(orb, /setProcessingPhase\("filling"\)/);
  assert.match(orb, /await onTranscript\(transcript\)/);
  assert.match(orb, /Filling your profile/);
  assert.match(orb, /Completando su perfil/);
  // Success is brief then collapse — not immediate idle after STT alone.
  assert.match(orb, /setState\("success"\)/);
});
