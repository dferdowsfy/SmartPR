// Server-side LLM document analysis route.
//
// This replaces the separate Python/FastAPI backend: it runs on the SAME
// Next.js service (same origin -> no CORS, no NEXT_PUBLIC_BACKEND_URL needed).
// The only server variables required are XAI_API_KEY and XAI_MODEL.
//
// Uses the Web Request/Response API so it is independent of Next-version-specific
// request helpers.

// Always run on the Node.js runtime (needs process.env + outbound fetch).
export const runtime = "nodejs";
// Never statically optimize/cache this handler.
export const dynamic = "force-dynamic";

import { buildExtraction } from "../../documentFields";
import { ACTIVE_JURISDICTION } from "../../jurisdictions";
import {
  XaiApiError,
} from "../../ai/xai";
import { aiModelFor, generateText, isAiConfigured } from "../../../lib/ai/router";

type DocPayload = {
  filename?: string;
  content?: string;
  requirement_code?: string;
  lang?: string;
  business_context?: Record<string, unknown>;
};

// Jurisdiction-specific extraction hints + document classes come from the
// active Regulatory Knowledge Pack, so this route has no hardcoded jurisdiction.
function specializedInstructions(requirementCode: string): string {
  const req = (requirementCode || "").toLowerCase();
  for (const hint of ACTIVE_JURISDICTION.documentIntelligence.extractionHints) {
    if (hint.match.some((m) => req.includes(m))) return hint.instructions;
  }
  return `GENERAL DOCUMENT INSTRUCTIONS:
- Perform careful extraction as if performing OCR + intelligent document processing on the text.`;
}

function buildSystemPrompt(requirementCode: string): string {
  const di = ACTIVE_JURISDICTION.documentIntelligence;
  const ocrDirective =
    "You are performing high-accuracy document intelligence as if using OCR + LLM extraction on the uploaded file text (the text may be noisy from scanning). Be extremely precise with numbers, dates, and names.";
  return `You are an expert ${di.analystSubject} document analyst for the ${ACTIVE_JURISDICTION.meta.productName} validation engine.

${ocrDirective}

EXTRACTION-FIRST MANDATE:
Your PRIMARY job is field extraction, not judgement. Exhaustively extract EVERY
identifiable field present in the document into the "extracted" object below —
business name, entity name, owner/authorized person, full address, all dates,
and every license/permit/merchant/account number you can find. Use null only
when a field is genuinely absent from the text. Do NOT summarize a document as
"blank", "needs review", or "missing information" — extract the concrete fields
and let the structured result speak for itself.

${specializedInstructions(requirementCode)}

DOCUMENT CLASSIFICATION:
Determine document_type from this list only:
${di.documentClasses.join(", ")}

Return ONLY valid JSON (no markdown, no extra text) with this exact structure:
{
  "document_type": "exact type from list above",
  "confidence": 0.0,
  "extracted": {
    "business_name": "string or null",
    "entity_name": "string or null",
    "owner": "string or null",
    "address": "string or null",
    "issue_date": "YYYY-MM-DD or null",
    "expiration_date": "YYYY-MM-DD or null",
    "license_or_permit_number": "string or null",
    "merchant_number": "string or null",
    "permit_number": "string or null"
  },
  "validation_checks": [
    {"check": "Business Name Match", "result": "pass|fail|warning", "details": "short explanation"},
    {"check": "Address Match", "result": "pass|fail|warning", "details": "..."},
    {"check": "Required Fields Present", "result": "pass|fail|warning", "details": "..."},
    {"check": "Not Expired", "result": "pass|fail|warning", "details": "..."},
    {"check": "Official Appearance", "result": "pass|fail|warning", "details": "..."}
  ],
  "overall_status": "Complete|Needs Review|Missing Information|Mismatch|Expired",
  "notes": "short summary"
}

Universal validation rules to always apply: Business Name Match (vs business_context name), Address Match if present, Expiration present and not expired, required License/Permit Number present if expected, required Agency Name present.

Determine overall_status:
- Complete: all key checks pass, no critical issues, high confidence
- Needs Review: minor issues or missing non-critical fields
- Missing Information: required fields missing
- Mismatch: name or address does not match intake
- Expired: expiration date in past

Always compare extracted fields against the business_context provided. Confidence should be high only if the type is clear and key matches succeed. Return ONLY the JSON. No other text.`;
}

function parseAnalysis(raw: string) {
  const cleaned = raw.replace(/```json|```/g, "").trim();
  try {
    const data = JSON.parse(cleaned);
    if (!data.overall_status) data.overall_status = "Needs Review";
    if (data.confidence === undefined) data.confidence = 0.5;
    if (!data.validation_checks) data.validation_checks = [];
    return data;
  } catch {
    // Try to salvage the first {...} block.
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        /* fall through */
      }
    }
    return {
      document_type: "Unknown",
      confidence: 0.2,
      extracted: {},
      validation_checks: [
        { check: "Parse Error", result: "fail", details: "Could not parse AI response" },
      ],
      overall_status: "Needs Review",
      notes: `AI response could not be parsed. Raw: ${raw.slice(0, 400)}`,
    };
  }
}

export async function POST(request: Request) {
  if (!isAiConfigured("document_analysis")) {
    return Response.json(
      { error: "XAI_API_KEY is not configured on the server." },
      { status: 503 }
    );
  }

  let payload: DocPayload;
  try {
    payload = (await request.json()) as DocPayload;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const filename = payload.filename || "uploaded-document";
  const content = (payload.content || "").slice(0, 4500);
  const requirementCode = payload.requirement_code || "";
  const businessContext = payload.business_context || {};
  const isEs = payload.lang === "es";

  const langDirective = isEs
    ? '\n\nIMPORTANT: Write all human-readable free-text fields ("notes" and the "details" of each validation_check) in SPANISH. Keep the JSON keys, document_type values, and date formats exactly as specified in English.'
    : "";

  const system = buildSystemPrompt(requirementCode) + langDirective;
  const user = `Filename: ${filename}
Business context (intake profile): ${JSON.stringify(businessContext)}

Document content / text (may be simulated or OCR):
${content}

Follow the SMARTPR DOCUMENT VALIDATION ENGINE rules exactly. Analyze and return ONLY the JSON.`;

  // Hard timeout so a slow/unreachable model never hangs the request.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);

  try {
    const text = await generateText("document_analysis", {
      input: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      maxOutputTokens: 2000,
      temperature: 0.2,
      signal: controller.signal,
    });
    const analysis = parseAnalysis(text);

    // Extraction-first: deterministically derive fields found/missing,
    // validation result, and reasoning from the extracted values + the
    // required-field schema for this document type. This never relies on the
    // model emitting vague statuses.
    const businessName =
      (businessContext as Record<string, unknown>).name as string | undefined;
    const extraction = buildExtraction(
      analysis.document_type || "Unknown",
      analysis.extracted || {},
      typeof analysis.confidence === "number" ? analysis.confidence : 0.5,
      { businessName: businessName ?? null }
    );
    analysis.extraction = extraction;
    // Keep overall_status consistent with the structured result for scoring.
    analysis.overall_status =
      extraction.validation_result === "PASS" ? "Complete"
      : extraction.validation_result === "FAIL" ? "Missing Information"
      : "Needs Review";

    return Response.json({
      analysis,
      ai_model: aiModelFor("document_analysis"),
      message: "Document analyzed with AI.",
    });
  } catch (e) {
    if (e instanceof XaiApiError) {
      return Response.json(
        { error: `xAI error ${e.status}`, detail: e.detail },
        { status: 502 }
      );
    }
    const aborted = e instanceof Error && e.name === "AbortError";
    return Response.json(
      { error: aborted ? "AI request timed out" : "AI request failed" },
      { status: 504 }
    );
  } finally {
    clearTimeout(timer);
  }
}
