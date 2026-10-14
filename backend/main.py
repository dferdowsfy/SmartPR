"""
SmartPR Backend (FastAPI)
Local dev server with real AI integration via xAI.

Uses the configured AI (Grok via the xAI Responses API) for:
- Document identification and text extraction
- Determining if requirements are met (validation + findings)
- "Use this AI for everything" as requested.

.env should contain:
  XAI_API_KEY=xai-...
  XAI_MODEL=grok-4.3
"""

import os
import json
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, Dict, Any, List
from datetime import datetime
import uuid

# Load environment
load_dotenv()

XAI_API_KEY = os.getenv("XAI_API_KEY", "")
XAI_MODEL = os.getenv("XAI_MODEL", "grok-4.3")
XAI_BASE_URL = os.getenv("XAI_BASE_URL", "https://api.x.ai/v1").rstrip("/")
AI_CONFIGURED = bool(XAI_API_KEY)

app = FastAPI(
    title="SmartPR API (Local Dev + Real AI)",
    description="Puerto Rico Business Licensing Readiness Platform - Local testing server with Grok AI for document analysis and requirements validation",
    version="0.2.0-ai"
)

# CORS
# Only SmartPR's own frontends may call this API from a browser. Set
# BACKEND_CORS_ORIGINS (comma-separated) to override the allowlist; a "*"
# entry is ignored — a wildcard origin is never allowed.
DEFAULT_ALLOWED_ORIGINS = [
    "https://www.getsmartpr.com",
    "https://getsmartpr.com",
    "https://trust.getsmartpr.com",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
]
_cors_env = os.getenv("BACKEND_CORS_ORIGINS", "").strip()
cors_origins = [o.strip() for o in _cors_env.split(",") if o.strip() and o.strip() != "*"] if _cors_env else []
if not cors_origins:
    cors_origins = list(DEFAULT_ALLOWED_ORIGINS)

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization", "X-Requested-With"],
)

# Longest user prompt sent to xAI; longer input is truncated (bounds cost and
# the amount of user/document text that leaves this service).
MAX_AI_USER_PROMPT_CHARS = 16_000

# --- AI Helper Functions (using Grok via xAI's Responses API) ---

def _call_ai(system_prompt: str, user_prompt: str, max_tokens: int = 1500) -> str:
    """Central AI call - used for EVERYTHING as requested."""
    if not AI_CONFIGURED:
        return "AI client not configured. Using fallback."
    user_prompt = (user_prompt or "")[:MAX_AI_USER_PROMPT_CHARS]

    try:
        payload = json.dumps({
            "model": XAI_MODEL,
            "input": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            "reasoning": {"effort": "none"},
            "max_output_tokens": max_tokens,
            "temperature": 0.2,
            "store": False,
        }).encode("utf-8")
        request = Request(
            f"{XAI_BASE_URL}/responses",
            data=payload,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {XAI_API_KEY}",
            },
        )
        with urlopen(request, timeout=60) as response:
            result = json.load(response)
        return "".join(
            block.get("text", "")
            for item in result.get("output", [])
            if isinstance(item, dict)
            for block in item.get("content", [])
            if isinstance(block, dict) and block.get("type") == "output_text"
        )
    except HTTPError as e:
        return f"AI call failed with xAI HTTP {e.code}. Falling back to rules."
    except Exception as e:
        return f"AI call failed: {str(e)}. Falling back to rules."

async def ai_identify_and_extract_document(document_text: str, filename: str, business_context: dict, requirement_code: Optional[str] = None) -> dict:
    """
    SMARTPR DOCUMENT VALIDATION ENGINE
    Uses the LLM (Grok via xAI) for high-accuracy identification + field extraction.
    When requirement_code is provided, a unique specialized prompt is used so the model
    focuses on the exact fields and formats expected for that specific licensing item
    (acting as intelligent OCR + validator on the provided text content).
    """
    # Build a specialized prompt block based on the exact requirement being uploaded for.
    # This ensures different documents get different extraction priorities (e.g. EIN specifically hunts for the EIN number).
    specialized_instructions = ""
    req = (requirement_code or "").lower()

    if "ein" in req:
        specialized_instructions = """
SPECIALIZED INSTRUCTIONS FOR THIS UPLOAD (EIN Letter):
- Treat the provided text as OCR output from an official IRS EIN confirmation letter.
- Specifically hunt for and extract the 9-digit Employer Identification Number (EIN). 
  It usually appears in the format XX-XXXXXXX (e.g. 66-1234567).
- Prioritize placing the clean EIN into "license_or_permit_number".
- Also extract business_name / entity_name exactly as shown.
- Validation checks MUST include "EIN Format Valid", "EIN Found", "Business Name Match".
- If no properly formatted EIN is present, set overall_status to "Missing Information" or "Needs Review".
"""
    elif "health" in req or "sanitary" in req:
        specialized_instructions = """
SPECIALIZED INSTRUCTIONS FOR THIS UPLOAD (Health / Sanitary Permit):
- Treat the provided text as OCR from a Departamento de Salud Health Permit.
- Specifically extract the permit number, facility name, expiration date, and any "uso" or classification.
- Place the permit number in "permit_number".
- Validation checks MUST include "Health Permit Number Found", "Not Expired", "Facility Name Match".
"""
    elif "fire" in req or "bombero" in req:
        specialized_instructions = """
SPECIALIZED INSTRUCTIONS FOR THIS UPLOAD (Fire Certification):
- Treat the provided text as OCR from a Certificado de Bomberos / Fire Safety document.
- Specifically extract the certificate number, business name, and expiration.
- Place certificate number in "license_or_permit_number".
- Validation checks MUST include "Fire Certificate Number Found", "Not Expired".
"""
    elif "permiso" in req or "unico" in req:
        specialized_instructions = """
SPECIALIZED INSTRUCTIONS FOR THIS UPLOAD (Permiso Único):
- Treat the provided text as OCR from an official OGPe Permiso Único.
- Extract permit number, business name, address, expiration, and use classification.
- Place permit number in "permit_number".
- Validation checks MUST include "Permit Number Found", "Address Match", "Permit Active".
"""
    elif "merchant" in req or "registro" in req:
        specialized_instructions = """
SPECIALIZED INSTRUCTIONS FOR THIS UPLOAD (Merchant Registration):
- Treat the provided text as OCR from Hacienda Registro de Comerciante / Merchant Certificate.
- Specifically extract the Merchant Number (often SURI-related), business name, and address.
- Place merchant number in "merchant_number".
- Validation checks MUST include "Merchant Number Extracted", "Merchant Registration Found".
"""
    elif "patente" in req:
        specialized_instructions = """
SPECIALIZED INSTRUCTIONS FOR THIS UPLOAD (Patente Municipal):
- Extract the municipal account / patente number, municipality name, and business name.
- Place the account number in "license_or_permit_number".
"""
    elif "lease" in req:
        specialized_instructions = """
SPECIALIZED INSTRUCTIONS FOR THIS UPLOAD (Lease Agreement):
- Extract tenant name, property address, lease start/end dates, landlord.
- Validate that the tenant roughly matches the business context.
"""
    else:
        specialized_instructions = """
GENERAL DOCUMENT INSTRUCTIONS:
- Perform careful extraction as if performing OCR + intelligent document processing on the text.
"""

    # Build the complete system prompt with specialized per-requirement instructions prepended.
    # This gives each upload a unique focused prompt (e.g. EIN upload specifically searches for and validates the EIN number).
    ocr_directive = "You are performing high-accuracy document intelligence as if using OCR + LLM extraction on the uploaded file text (the text may be noisy from scanning). Be extremely precise with numbers, dates, and names."

    system = f"""You are an expert Puerto Rico business licensing document analyst for the SmartPR validation engine.

{ocr_directive}

{specialized_instructions}

Follow these rules EXACTLY for every document.

DOCUMENT CLASSIFICATION:
Determine document_type from this list only:
Certificate of Incorporation, Articles of Organization, IRS EIN Letter, Merchant Registration Certificate, Permiso Único, Patente Municipal, Health Permit, Fire Certification, CFPM Certificate, Professional License, Contractor License, Tourism Registration, Lease Agreement, Property Deed, Floor Plan, Insurance Certificate, Workers Compensation Certificate, Medical Waste Contract, Alcohol Permit, Environmental Permit, Sign Permit, Background Check Documentation, Business Address Documentation, Unknown

Return ONLY valid JSON (no markdown, no extra text) with this exact structure:
{{
  "document_type": "exact type from list above",
  "confidence": 0.0 to 1.0,
  "extracted": {{
    "business_name": "string or null",
    "entity_name": "string or null",
    "owner": "string or null",
    "address": "string or null",
    "issue_date": "YYYY-MM-DD or null",
    "expiration_date": "YYYY-MM-DD or null",
    "license_or_permit_number": "string or null",
    "merchant_number": "string or null",
    "permit_number": "string or null"
  }},
  "validation_checks": [
    {{"check": "Business Name Match", "result": "pass|fail|warning", "details": "short explanation"}},
    {{"check": "Address Match", "result": "pass|fail|warning", "details": "..."}},
    {{"check": "Required Fields Present", "result": "pass|fail|warning", "details": "..."}},
    {{"check": "Not Expired", "result": "pass|fail|warning", "details": "..."}},
    {{"check": "Official Appearance", "result": "pass|fail|warning", "details": "..."}}
  ],
  "overall_status": "Complete|Needs Review|Missing Information|Mismatch|Expired",
  "notes": "short summary"
}}

Follow these specific rules for each type:

CERTIFICATE OF INCORPORATION / LLC FORMATION / Articles of Organization:
Look For: Business Name, Entity Type, Entity Number, Puerto Rico Department of State, Formation Date, Good Standing.
Extract: business_name, entity_name, issue_date (formation), license_or_permit_number (entity number).
Validate: Business Name exists and matches intake, document appears official (has Dept of State, seal, etc.).
In validation_checks include "Entity Found", "Name Match", "Formation Date Found".

IRS EIN LETTER:
Look For: IRS, Employer Identification Number, Business Name.
Extract: license_or_permit_number as EIN, business_name.
Validate: EIN exists, Business Name matches intake.
Checks: "EIN Found", "Name Match".

MERCHANT REGISTRATION CERTIFICATE / REGISTRO DE COMERCIANTE:
Look For: Registro de Comerciante, Departamento de Hacienda, SURI, Merchant Number, Business Name, Physical Address, Issue Date, Certificate Status.
Extract: merchant_number, business_name, address, issue_date.
Validate: Business Name matches intake, Address matches intake, Merchant Number exists, Certificate appears active.
Checks: "Merchant Registration Found", "Merchant Number Extracted", "Address Match", "Name Match".
Note: Merchant Registration is required for businesses operating in Puerto Rico. (Hacienda de Puerto Rico)

PERMISO ÚNICO:
Look For: Permiso Único, Single Business Portal, OGPe, Permit Number, Business Name, Business Address, Expiration Date, Use Classification.
Extract: permit_number, business_name, address, expiration_date, use_type.
Validate: Permit Number exists, Business Name matches, Address matches, Permit not expired.
Checks: "Permit Number Found", "Address Match", "Permit Active".
Note: Permiso Único consolidates use permits, fire, health, and other operational approvals.

PATENTE MUNICIPAL:
Look For: Municipality Name, Patente Municipal, Business Name, Municipal Account Number, Issue Date.
Extract: (use address or notes for municipality), business_name, license_or_permit_number as account.
Validate: Municipality matches intake, Business Name matches.
Checks: "Municipal License Found", "Municipality Match".

LEASE AGREEMENT:
Look For: Tenant Name, Property Address, Lease Start/End Date, Landlord Name.
Extract: owner (tenant), address, issue_date (start), expiration_date (end).
Validate: Tenant matches business owner or entity, Address matches intake, Lease active (not expired).
Checks: "Active Lease Found", "Address Match".

PROPERTY DEED:
Look For: Owner Name, Property Address, Parcel Information.
Extract: owner, address.
Validate: Owner matches intake, Address matches.
Checks: "Property Ownership Verified".

FLOOR PLAN:
Look For: Drawing Sheet, Architectural Plan, Dimensions, Scale, Room Labels.
Validate: Drawing appears legitimate, Contains usable layout.
Do NOT make compliance determination.
Return "Floor Plan Uploaded" in notes.

HEALTH PERMIT:
Look For: Departamento de Salud, License Number, Facility Name, Expiration Date.
Extract: permit_number, business_name, expiration_date.
Validate: Not expired, Business Name matches.
Checks: "Health Permit Found", "Permit Active".

FIRE CERTIFICATION / Certificado de Bomberos:
Look For: Certificado de Bomberos, Fire Prevention Certificate, Certificate Number, Business Name, Expiration.
Extract: license_or_permit_number, business_name, expiration_date.
Validate: Not expired, Name matches.
Checks: "Fire Certificate Found", "Certificate Active".

CFPM CERTIFICATE:
Look For: Certified Food Protection Manager, ServSafe, Prometric, National Registry, Certificate Number, Expiration.
Extract: owner (holder), license_or_permit_number, expiration_date.
Validate: Not expired, Certificate present.
Checks: "CFPM Certification Found".

PROFESSIONAL LICENSE:
Look For: Professional Board, License Number, License Holder, Expiration.
Extract: owner, license_or_permit_number, expiration_date.
Validate: Not expired, Name matches business owner or professional.
Checks: "Professional License Found".

CONTRACTOR LICENSE:
Look For: Contractor Registration, License Number, Business Name, Expiration.
Extract: license_or_permit_number, business_name, expiration_date.
Validate: Not expired, Name matches.
Checks: "Contractor License Found".

INSURANCE CERTIFICATE:
Look For: Certificate Holder, Carrier, Policy Number, Coverage Dates.
Extract: license_or_permit_number (policy), expiration_date.
Validate: Policy active, Business name matches.
Checks: "Insurance Active".

ALCOHOL LICENSE / Permit:
Look For: Alcohol Permit, License Number, Business Name, Expiration.
Extract: license_or_permit_number, business_name, expiration_date.
Validate: Active, Name Match.
Checks: "Alcohol Permit Found".

For every document also run UNIVERSAL VALIDATION RULES:
- Business Name Match (compare to business_context name)
- Address Match if present (compare to business_context address)
- Expiration Date present and not expired
- Required Signatures / Seal present if typical for type
- Required License/Permit Number present if expected
- Required Agency Name present

In validation_checks include the universal ones + type-specific.

Determine overall_status:
- Complete: all key checks pass, no critical issues, high confidence
- Needs Review: minor issues or missing non-critical fields
- Missing Information: required fields missing
- Mismatch: name or address does not match intake
- Expired: expiration date in past

Always compare extracted fields against the business_context provided (name, municipality, address if available).

Confidence should be high only if type is clear and key matches succeed.

Return ONLY the JSON. No other text."""

    user = f"""Filename: {filename}
Business context (intake profile): {business_context}

Document content / text (may be simulated or OCR):
{document_text[:4500]}

Follow the SMARTPR DOCUMENT VALIDATION ENGINE rules exactly. Analyze and return ONLY the JSON."""

    response = _call_ai(system, user, max_tokens=2000)
    
    import json, re
    try:
        cleaned = re.sub(r'```json|```', '', response).strip()
        data = json.loads(cleaned)
        # Ensure required fields
        if 'overall_status' not in data:
            data['overall_status'] = 'Needs Review'
        if 'confidence' not in data:
            data['confidence'] = 0.5
        if 'validation_checks' not in data:
            data['validation_checks'] = []
        return data
    except Exception as e:
        return {
            "document_type": "Unknown",
            "confidence": 0.2,
            "extracted": {},
            "validation_checks": [{"check": "Parse Error", "result": "fail", "details": str(e)}],
            "overall_status": "Needs Review",
            "notes": f"AI response could not be parsed. Raw: {response[:400]}"
        }

async def ai_validate_requirements(business: dict, requirements: list, extracted_docs: list) -> dict:
    """
    Use the AI to determine which requirements are met based on uploaded/extracted documents.
    Returns score, findings, and which items are satisfied.
    """
    system = """You are an expert Puerto Rico business licensing compliance validator.
You will be given:
- Business profile
- List of required items (with codes and agencies)
- List of documents that have been "uploaded" with their extracted fields and matched types

Your job:
- Decide for each requirement whether it is MET, PARTIALLY_MET, or NOT_MET based on the documents.
- Produce a realistic readiness score (0-100).
- Generate findings in this format:
  [
    {"severity": "critical|warning|informational", "title": "...", "description": "...", "recommended_action": "..."}
  ]

Return ONLY valid JSON:
{
  "readiness_score": 85,
  "findings": [ ... array as above ... ],
  "satisfied_codes": ["code1", "code2"],
  "summary": "short overall assessment"
}"""

    user = f"""Business profile: {business}

Required items:
{requirements}

Extracted / uploaded documents (with AI analysis):
{extracted_docs}

Analyze carefully and return the JSON only."""

    response = _call_ai(system, user, max_tokens=2000)
    
    import json, re
    try:
        cleaned = re.sub(r'```json|```', '', response).strip()
        return json.loads(cleaned)
    except:
        # Fallback to reasonable mock if AI fails
        return {
            "readiness_score": 68,
            "findings": [
                {"severity": "critical", "title": "AI validation partial", "description": "Could not fully parse AI response. Some requirements may still be outstanding.", "recommended_action": "Review uploaded documents manually."}
            ],
            "satisfied_codes": [],
            "summary": "AI analysis encountered an issue."
        }

# In-memory stores for local testing (reset on restart)
BUSINESSES: Dict[str, Dict[str, Any]] = {}
DISCOVERY: Dict[str, Dict[str, Any]] = {}
DOCUMENTS: Dict[str, List[Dict[str, Any]]] = {}
VALIDATIONS: Dict[str, Dict[str, Any]] = {}

# --- Models (aligned with design/api) ---

class BusinessCreate(BaseModel):
    name: str
    municipality: str
    industry: str
    business_structure: str
    is_home_based: bool = False
    employee_count: Optional[int] = None
    physical_address: Optional[str] = None

class DiscoveryAnswers(BaseModel):
    answers: Dict[str, Any]
    completed: bool = False

class ReadinessResponse(BaseModel):
    business_id: str
    readiness_score: float
    status: str
    critical_items: int
    total_mandatory: int
    findings: List[Dict[str, Any]]

# --- Endpoints ---

@app.get("/health")
async def health():
    return {"status": "ok", "service": "smartpr-backend-local", "time": datetime.utcnow().isoformat()}

@app.get("/api/v1/businesses")
async def list_businesses():
    return list(BUSINESSES.values())

@app.post("/api/v1/businesses")
async def create_business(payload: BusinessCreate):
    bid = str(uuid.uuid4())
    business = {
        "id": bid,
        "owner_id": "local-dev-user",
        "name": payload.name,
        "municipality": payload.municipality,
        "industry": payload.industry,
        "business_structure": payload.business_structure,
        "is_home_based": payload.is_home_based,
        "employee_count": payload.employee_count,
        "physical_address": payload.physical_address,
        "created_at": datetime.utcnow().isoformat(),
        "updated_at": datetime.utcnow().isoformat(),
    }
    BUSINESSES[bid] = business
    DOCUMENTS[bid] = []
    return business

@app.get("/api/v1/businesses/{business_id}")
async def get_business(business_id: str):
    if business_id not in BUSINESSES:
        raise HTTPException(404, "Business not found")
    return BUSINESSES[business_id]

@app.post("/api/v1/businesses/{business_id}/discovery")
async def submit_discovery(business_id: str, payload: DiscoveryAnswers):
    if business_id not in BUSINESSES:
        raise HTTPException(404, "Business not found")
    DISCOVERY[business_id] = payload.model_dump()
    return {"status": "saved", "business_id": business_id}

@app.get("/api/v1/businesses/{business_id}/requirements")
async def get_requirements(business_id: str):
    if business_id not in BUSINESSES:
        raise HTTPException(404, "Business not found")
    
    b = BUSINESSES[business_id]
    industry = b.get("industry", "")
    is_home = b.get("is_home_based", False)
    has_food = False
    
    # Structured rules engine (from approved design) - fast and deterministic.
    # AI is used on top for document identification + final "requirements met" decision.
    requirements = [
        {"code": "certificate_of_incorporation", "name": "Certificate of Incorporation", "mandatory": True, "status": "pending"},
        {"code": "ein_letter", "name": "EIN Confirmation Letter", "mandatory": True, "status": "pending"},
        {"code": "merchant_registration", "name": "Merchant Registration (Hacienda)", "mandatory": True, "status": "pending"},
        {"code": "permiso_unico", "name": "Permiso Único (OGPe)", "mandatory": True, "status": "pending"},
        {"code": "patente_municipal", "name": f"Patente Municipal ({b['municipality']})", "mandatory": True, "status": "pending"},
    ]
    
    if "restaurant" in industry.lower() or has_food:
        requirements.append({"code": "health_permit", "name": "Health / Sanitary Permit", "mandatory": True, "status": "pending"})
        requirements.append({"code": "fire_certification", "name": "Fire Safety Certification", "mandatory": True, "status": "pending"})
        requirements.append({"code": "food_manager_cert", "name": "Certified Food Protection Manager", "mandatory": True, "status": "pending"})
    
    if not is_home:
        requirements.append({"code": "lease_or_property_docs", "name": "Lease / Property Docs + Floor Plan", "mandatory": True, "status": "pending"})
    
    return {
        "business_id": business_id,
        "requirements": requirements,
        "rule_set_version": "demo-v0.1",
        "note": "Initial list from rules engine. AI (Grok) is used for document identification and final 'requirements met' validation."
    }

@app.post("/api/v1/businesses/{business_id}/validations")
async def trigger_validation(business_id: str):
    if business_id not in BUSINESSES:
        raise HTTPException(404, "Business not found")
    
    b = BUSINESSES[business_id]
    reqs = (await get_requirements(business_id))["requirements"]
    docs = DOCUMENTS.get(business_id, [])
    
    # === USE THE CONFIGURED AI FOR EVERYTHING (validation + findings) ===
    if AI_CONFIGURED:
        ai_result = await ai_validate_requirements(b, reqs, docs)
        score = ai_result.get("readiness_score", 65)
        findings = ai_result.get("findings", [])
    else:
        score = 65.0
        findings = [{"severity": "warning", "title": "AI not configured", "description": "Add XAI_API_KEY to .env", "recommended_action": "See backend/.env"}]
    
    run_id = str(uuid.uuid4())
    VALIDATIONS[run_id] = {
        "id": run_id,
        "business_id": business_id,
        "readiness_score": score,
        "status": "completed",
        "findings": findings,
        "created_at": datetime.utcnow().isoformat(),
        "ai_model_used": XAI_MODEL if AI_CONFIGURED else "none"
    }
    
    return {
        "job_id": run_id,
        "status": "completed",
        "readiness_score": score,
        "findings_count": len(findings),
        "ai_powered": AI_CONFIGURED
    }

@app.get("/api/v1/businesses/{business_id}/findings")
async def get_findings(business_id: str):
    # Return latest validation's findings (demo)
    for run in reversed(list(VALIDATIONS.values())):
        if run["business_id"] == business_id:
            return run["findings"]
    return []

# === NEW: Real AI-powered document identification and text extraction ===
class DocumentInput(BaseModel):
    filename: str
    content: str  # Text content of the document (or description / OCR text). For images/PDFs, paste key text or base64 note.
    requirement_code: Optional[str] = None  # e.g. "ein_letter", "health_permit" — enables unique tailored prompts
    # In a production version we would accept UploadFile + use vision.

@app.post("/api/v1/businesses/{business_id}/analyze-document")
async def analyze_document(business_id: str, payload: DocumentInput):
    if business_id not in BUSINESSES:
        raise HTTPException(404, "Business not found")
    
    b = BUSINESSES[business_id]
    
    # Use Grok via xAI to identify the document and extract structured data
    # Pass requirement_code so we can use a specialized prompt for the exact document type being uploaded
    analysis = await ai_identify_and_extract_document(
        document_text=payload.content,
        filename=payload.filename,
        business_context=b,
        requirement_code=payload.requirement_code
    )
    
    # Store the analyzed document
    doc_entry = {
        "id": str(uuid.uuid4()),
        "filename": payload.filename,
        "analysis": analysis,
        "uploaded_at": datetime.utcnow().isoformat(),
        "ai_model": XAI_MODEL
    }
    DOCUMENTS[business_id].append(doc_entry)
    
    return {
        "business_id": business_id,
        "analysis": analysis,
        "stored_document_id": doc_entry["id"],
        "message": "Document analyzed with AI. Matched requirement (if any) can now be used in validation."
    }

@app.post("/api/v1/businesses/{business_id}/packages")
async def generate_package(business_id: str):
    if business_id not in BUSINESSES:
        raise HTTPException(404, "Business not found")
    
    pkg_id = str(uuid.uuid4())
    # In real impl this would generate a PDF via ReportLab/Weasy and store in Supabase
    return {
        "package_id": pkg_id,
        "business_id": business_id,
        "readiness_score": 72.0,
        "download_url": f"/mock-package/{pkg_id}.pdf",
        "message": "Mock package generated. In production this returns a real PDF."
    }

if __name__ == "__main__":
    import uvicorn
    # Railway (and most PaaS) inject the port to bind via $PORT.
    port = int(os.getenv("PORT", "8000"))
    uvicorn.run(app, host="0.0.0.0", port=port)
