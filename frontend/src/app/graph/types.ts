// ============================================================================
// Shared capture-event types for the SmartPR knowledge graph.
//
// These cross the client -> /api/graph/capture boundary. The graph is purely
// OBSERVATIONAL: events describe what the rules engine already produced. They
// never feed back into requirement generation.
// ============================================================================

export interface CapturedRequirement {
  document_id?: string;
  document: string;      // human label, e.g. "Health Permit"
  agency: string;
  reason: string;
  source_rule?: string;  // rule id, e.g. "RULE_0046" (stored as a Rule node)
  mandatory?: boolean;
  /** User-entered current expiry date (YYYY-MM-DD) for renewable documents.
   *  Absent = "I don't know" = no reminders (never estimated). */
  expiry_date?: string;
}

export interface CapturedAnswer {
  question_id: string;
  question: string;
  answer: string | boolean;
}

// Emitted once, when intake completes and the rules engine has run.
export interface SubmissionEvent {
  kind: "submission";
  submission_id: string;       // client-generated uuid (correlation id)
  municipality?: string | null;
  industry?: string | null;
  business_type?: string | null;
  business_structure?: string | null;
  location_type?: string | null;
  business_name?: string | null;
  business_id?: string | null;
  matter_id?: string | null;
  claim_email?: string | null;
  answers: CapturedAnswer[];
  requirements: CapturedRequirement[];
}

// Emitted each time a document is uploaded and validated.
export interface ValidationEvent {
  kind: "validation";
  submission_id: string;
  business_type?: string | null;
  document_type: string;
  requirement_id?: string | null;
  original_filename?: string | null;
  mime_type?: string | null;
  size_bytes?: number | null;
  validation_result: "PASS" | "NEEDS_REVIEW" | "FAIL";
  pass_fail: boolean;
  confidence: number;          // 0..100
  expiration_status: "Valid" | "Expired" | "Unknown";
  // Extraction-first details (all optional for backward compatibility).
  extracted_fields?: Record<string, string | null>;
  fields_found?: string[];
  fields_missing?: string[];
}

// Emitted when the readiness score is (re)computed.
export interface ReadinessEvent {
  kind: "readiness";
  submission_id: string;
  business_type?: string | null;
  score: number;               // 0..100
  status: string;              // e.g. "Ready For Submission"
  missing_documents?: string[];
}

export type CaptureEvent = SubmissionEvent | ValidationEvent | ReadinessEvent;
