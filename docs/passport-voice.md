# Passport voice input

Voice fills the same canonical fields as the Passport editor. It does not create
a second profile or determine regulatory requirements.

## Flow

1. `IntakeVoiceOrb` records with the existing `MediaRecorder` helpers.
2. `POST /api/intake/voice` sends the audio to xAI `POST /v1/stt` through
   `ai/xai.ts`. The server retains the API key. The request contract matches the
   [official Grok speech-to-text API](https://docs.x.ai/developers/model-capabilities/audio/speech-to-text).
3. `POST /api/intake/interpret` uses the existing Grok Responses client. Its
   original discovery prompt and 900-token request are unchanged when `mode`
   is absent. Once discovery is complete, `mode: "passport"` adds the canonical
   Passport catalog and explicit-evidence extraction. Discovery facts can still
   be returned, but overlapping identity fields cannot bypass Passport review.
4. `passportExtraction.ts` validates catalog IDs, value types, confidence,
   transcript evidence, identifiers, dates, enums and numeric values. Both the
   server and client validate proposals. The client never uses a model-supplied
   canonical path, label or display value.
5. `usePassportVoiceInput` compares proposals with the **current** canonical
   state, including typing done while the request was running. Empty fields fill
   immediately. Equivalent values stay unchanged. Different values are shown
   with **Replace** / **Keep current**. A later manual edit invalidates a stale
   approval. Existing EIN/pending and employee-count mirrors are considered.
6. Intake writes `canonicalOverride` through the same handler used by Core
   Application Details. Existing local persistence and authenticated autosave
   handle durability. The Business Profile editor uses its current draft and
   existing `PATCH /api/businesses/:id` save function. Server-side persistence
   remains `businesses.passport_json` plus existing denormalized columns.

The former standalone Passport recorder now wraps the shared orb and
interpreter. The older authenticated `/api/passport/voice` endpoint remains for
compatibility and shares the same extraction prompt and validator. No schema
migration or new database table is needed.

## Canonical field mapping

| Requested meaning | Existing canonical path |
| --- | --- |
| Legal entity name | `business.legalName` |
| Trade name / DBA | `business.tradeName` |
| Entity or filing type | `business.entityType` |
| Formation status | `business.formationStatus` |
| Jurisdiction of formation | `business.jurisdictionOfFormation` |
| Profit status | `business.forProfitStatus` |
| Purpose / activity description | `business.purpose` |
| Entity email / main telephone | `business.email`, `business.phone` |
| EIN / unavailable EIN | `business.ein`, `business.einPending` |
| Planned operations start | `business.operationsStartDate` |
| Employee count | `business.employeeCount` (existing `operations.employeeCount` mirror kept consistent) |
| Formation date | `business.incorporationDate` |
| NAICS | `business.naicsCode` |
| State registry number | `business.registryNumber` |
| Hacienda merchant registration | `business.merchantRegistrationNumber` |
| Primary contact | `contact.fullName`, `.email`, `.phone`, `.role` |
| Principal physical address | `addresses.principalPhysical` |
| Principal mailing address | `addresses.principalMailing` |
| PR operating address | `addresses.operatingAddress` |
| Same mailing address | `addresses.mailingSameAsPhysical` |
| Municipality | `addresses.municipality` |
| Ownership / owner / cadastral / square footage | `property.occupancyType`, `.ownerName`, `.cadastralNumber`, `.squareFootage` |

Each address has separately validated `line1`, `line2`, `cityOrMunicipality`,
`stateOrTerritory`, `postalCode`, and `country` updates. Missing components stay
blank; there is no default PR/US inference. This gives 45 supported extraction
fields, including the existing unavailable-EIN flag. All requested field groups
are supported. Nothing new is mandatory and optional blanks do not block progress.

## Behavior and limits

- English, Spanish and mixed utterances use the same schema and prompt.
- LLC, sole proprietor, nonprofit, leased/rented/alquilado and PR aliases normalize
  to existing canonical values. Generic “corporation” cannot choose a subtype.
- Identifiers remain strings. EIN formatting and leading zeros are retained.
- Dates require an explicit complete, unambiguous date. Unclear dates, malformed
  identifiers, low-confidence results and unsupported values are left for typing
  or clarification. Model confidence alone is insufficient: evidence must occur
  in the transcript, and sensitive values must match that evidence.
- Built-in `other` / `not_formed` defaults can be filled in untouched intake.
  Stored or edited values are conservatively treated as existing data and reviewed.
- The 12 MB audio limit remains. Full Passport transcripts up to 12,000 characters
  are supported. The main STT endpoint rejects longer transcripts instead of
  silently dropping the end of a dictation. Discovery keeps its original limit.
- No SSNs, passwords or personal taxpayer identifiers are accepted.
- Grok handles **input transcription**. Existing spoken answers to discovery
  questions still use the browser's speech synthesis; this feature does not
  replace the working discovery question-answer flow with a realtime agent.
- In Passport mode, utterances are sent to field extraction rather than the
  heuristic spoken-question router, so a punctuation mark cannot route a whole
  multi-field statement away from Passport validation.
- No full raw transcript is persisted as a separate voice record by this feature.

## Recording controls

The existing globe is retained. At rest it shows a crossed-out microphone and
“Mic off · Tap to speak.” Permission requests have a distinct status. Recording
uses a larger, fixed 96 px control, a contrasting ring, animated internal waveform,
stop icon and “Mic on · Listening — tap to finish.” Processing explicitly says
the microphone is off. The clickable target does not pulse or move. Status and
pressed state are exposed to assistive technology; reduced motion keeps the same
size, labels and stop control without animation. English and Spanish labels are
provided. Stopping recording releases the microphone before extraction.

## Verification

```sh
cd frontend
npm ci
npm run test:voice
npx playwright install chromium
npm run test:voice:ui
```

`test:voice` exercises the extraction contract, real route handlers with a mocked
xAI transport, existing discovery interpretation, relationship inference, and
Passport/form mappings. It includes the requested multi-field English/Spanish
examples, isolated updates, conflicting/stale changes, partial addresses, numeric
and identifier validation, unavailable EIN, arbitrary-key rejection and all
canonical field families.

`test:voice:ui` starts a local Next server on port 3107. It uses Chromium's
synthetic microphone and mocked application API responses: it never contacts
production or writes live business records. It covers both actual pages,
immediate updates, existing autosave payloads, unsaved typing, conflict decisions,
save failures, original discovery routing, and mobile reduced-motion controls.
`VOICE_TEST_CHROME` optionally points to an installed Chrome executable.

Local verification does **not** prove live ASR or LLM accuracy. Before deployment,
exercise the examples with a configured server-side `XAI_API_KEY`, real English,
Spanish and mixed-language audio, and a test business account. Also verify a
save/reload through the authenticated database path. Never put the key in a
`NEXT_PUBLIC_` variable. This implementation does not deploy or modify live data.
