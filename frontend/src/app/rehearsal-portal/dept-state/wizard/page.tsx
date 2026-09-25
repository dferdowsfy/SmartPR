"use client";

/**
 * FICTIONAL rehearsal clone of the Dept. of State corporation-creation
 * wizard (Corporate & Entities Registry). Each screen reproduces the
 * heading, distinctive control and fields recorded in the 2026-09-24
 * read-only walkthrough (see lib/agency-runs/flows/deptStateCorporation.ts),
 * and declares data-smartpr-step / data-flow-step so the browser test can
 * prove every Mita request matches the visible screen.
 *
 * Screens never observed live (Signatures, Payment, Thank You) are clearly
 * approximations. The "survey" screen is NOT in the recorded flow — it
 * simulates the portal changing, which Mita must treat as unknown.
 * Nothing is stored or sent anywhere.
 */
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  CheckRow,
  PageSub,
  PageTitle,
  PortalCard,
  PrimaryButton,
  SelectInput,
  TextInput,
  useRehearsal,
  type RehearsalStep,
} from "../../rehearsal";

const ORDER = [
  "name_availability",
  "general_information",
  "filer",
  "designated_office",
  "resident_agent",
  "incorporators",
  "officers",
  "capital_stock",
  "supporting_docs",
  "review",
  "signatures",
  "payment",
  "thank_you",
] as const;

type Screen = (typeof ORDER)[number] | "survey";

const KIND: Record<Screen, RehearsalStep> = {
  name_availability: "form",
  general_information: "form",
  filer: "form",
  designated_office: "form",
  resident_agent: "form",
  incorporators: "form",
  officers: "form",
  capital_stock: "form",
  supporting_docs: "upload",
  review: "review",
  signatures: "signature",
  payment: "payment",
  thank_you: "submission",
  survey: "unknown",
};

function Wizard() {
  const params = useSearchParams();
  const router = useRouter();
  const { t, data, setField } = useRehearsal();
  const [error, setError] = useState<string | null>(null);
  const screen = (params.get("step") ?? "name_availability") as Screen;
  const next = () => {
    setError(null);
    const i = ORDER.indexOf(screen as (typeof ORDER)[number]);
    router.push(`/rehearsal-portal/dept-state/wizard?step=${ORDER[Math.min(i + 1, ORDER.length - 1)]}`);
  };
  const field = (id: string, label: string, props: Partial<Parameters<typeof TextInput>[0]> = {}) => (
    <TextInput id={`dos-${id}`} name={id} label={label} value={data[`dos_${id}`] ?? ""} onChange={(v) => setField(`dos_${id}`, v)} {...props} />
  );

  const body = (() => {
    switch (screen) {
      case "name_availability":
        return (
          <>
            <PageTitle>Name Availability</PageTitle>
            <SelectInput id="dos-entity-class" name="entity_class" label="Entity class" value={data.dos_entity_class ?? ""} onChange={(v) => setField("dos_entity_class", v)} required
              options={["Corporation", "LLC", "Close Corporation", "Professional Corporation", "Other"].map((o) => ({ value: o, label: o }))} />
            {field("entity_name", "Entity name", { required: true })}
            <SelectInput id="dos-name-designation" name="name_designation" label="Name designation" value={data.dos_name_designation ?? ""} onChange={(v) => setField("dos_name_designation", v)} required
              options={["Corp.", "Corporation", "Incorporated", "Inc."].map((o) => ({ value: o, label: o }))} />
          </>
        );
      case "general_information":
        return (
          <>
            <PageTitle>General Information</PageTitle>
            <SelectInput id="dos-entity-type" name="entity_type" label="Entity type" value={data.dos_entity_type ?? ""} onChange={(v) => setField("dos_entity_type", v)} required
              options={["For Profit", "Non-Profit"].map((o) => ({ value: o, label: o }))} />
            <SelectInput id="dos-jurisdiction" name="jurisdiction" label="Jurisdiction" value={data.dos_jurisdiction ?? ""} onChange={(v) => setField("dos_jurisdiction", v)} required
              options={["Domestic", "Foreign", "Foreign – NON US"].map((o) => ({ value: o, label: o }))} />
            {field("purposes", "Purposes", { required: true })}
          </>
        );
      case "filer":
        return (
          <>
            <PageTitle>Filer</PageTitle>
            <SelectInput id="dos-filer-type" name="filer_type" label="Filer type" value={data.dos_filer_type ?? ""} onChange={(v) => setField("dos_filer_type", v)} required
              options={["Employee/Owner/Partner", "CPA or Attorney/Paralegal"].map((o) => ({ value: o, label: o }))} />
            {field("filer_name", "Filer name", { required: true })}
            {field("filer_street", "Street address", { required: true, error })}
            {field("filer_phone", "Phone", { required: true, type: "tel" })}
            {field("filer_email", "Email", { required: true, type: "email" })}
            {field("filer_email_confirm", "Confirm email", { required: true, type: "email" })}
          </>
        );
      case "designated_office":
        return (
          <>
            <PageTitle>Designated Office</PageTitle>
            <CheckRow id="dos-office-same" name="office_same" label="Same as filer" checked={data.dos_office_same === "yes"} onChange={(v) => setField("dos_office_same", v ? "yes" : "")} />
            {field("office_street", "Office street address", { required: true })}
            {field("office_phone", "Office phone", { required: true, type: "tel" })}
          </>
        );
      case "resident_agent":
        return (
          <>
            <PageTitle>Resident Agent</PageTitle>
            <CheckRow id="dos-agent-same" name="agent_same" label="Resident agent is same as filer" checked={data.dos_agent_same === "yes"} onChange={(v) => setField("dos_agent_same", v ? "yes" : "")} />
            {field("agent_name", "Agent name", { required: true })}
            {field("agent_street", "Agent street address", { required: true })}
          </>
        );
      case "incorporators":
        return (
          <>
            <PageTitle>Incorporators</PageTitle>
            {field("incorporator_name", "Incorporator name", { required: true })}
            {field("incorporator_address", "Incorporator address", { required: true })}
            <p className="text-sm text-slate-600">Add New</p>
          </>
        );
      case "officers":
        return (
          <>
            <PageTitle>Officers</PageTitle>
            {field("officer_name", "Officer name", { required: true })}
            <SelectInput id="dos-officer-title" name="officer_title" label="Officer title" value={data.dos_officer_title ?? ""} onChange={(v) => setField("dos_officer_title", v)} required
              options={["President", "Secretary", "Vice President", "Treasurer"].map((o) => ({ value: o, label: o }))} />
          </>
        );
      case "capital_stock":
        return (
          <>
            <PageTitle>Capital Stock</PageTitle>
            <SelectInput id="dos-stock-class" name="stock_class" label="Stock class" value={data.dos_stock_class ?? ""} onChange={(v) => setField("dos_stock_class", v)} required
              options={["Common", "Preferred"].map((o) => ({ value: o, label: o }))} />
            {field("shares_number", "Number of shares", { required: true, inputMode: "numeric" })}
            {field("par_value", "Par value")}
            <p className="text-sm font-semibold text-slate-800">Fees: $140.00 + $10.00 certificate = $150.00</p>
          </>
        );
      case "supporting_docs":
        return (
          <>
            <PageTitle>Supporting Documentation</PageTitle>
            <PageSub>Optional. PDF/TIF only, under 7 MB, no SSN or tax ID data.</PageSub>
            <label className="mt-4 block text-sm font-semibold">Upload <input type="file" className="mt-1 block" /></label>
          </>
        );
      case "review":
        return (
          <>
            <PageTitle>Review Filing</PageTitle>
            <PageSub>Read-only summary. Fees: $150.00</PageSub>
            <dl className="mt-4 grid grid-cols-2 gap-2 text-sm">
              <dt>Entity name</dt><dd>{data.dos_entity_name || "—"}</dd>
              <dt>Filer</dt><dd>{data.dos_filer_name || "—"}</dd>
            </dl>
          </>
        );
      case "signatures":
        return (
          <>
            <PageTitle>Signatures</PageTitle>
            <PageSub>Approximation — this screen was not observed live. A person must sign.</PageSub>
            <CheckRow id="dos-perjury" name="perjury" label="Perjury declaration: I declare under penalty of perjury that the information is true." checked={data.dos_perjury === "yes"} onChange={(v) => setField("dos_perjury", v ? "yes" : "")} />
            {field("signer_name", "Signer printed name", { required: true })}
          </>
        );
      case "payment":
        return (
          <>
            <PageTitle>Payment</PageTitle>
            <PageSub>Approximation — not observed live. FICTIONAL: never enter a real card here.</PageSub>
            <p className="mt-4 text-lg font-bold" data-testid="dos-total">Total: $150.00</p>
            {field("card_number", "Card number", { required: true, autoComplete: "off", inputMode: "numeric" })}
            {field("card_expiry", "Expiration (MM/YY)", { required: true, autoComplete: "off" })}
          </>
        );
      case "thank_you":
        return (
          <>
            <PageTitle>Thank You</PageTitle>
            <p className="mt-4 text-base" data-testid="dos-confirmation">Confirmation: REHEARSAL-DOS-000123 — Certificate of Registry, Articles of Incorporation and Payment Receipt (fictional).</p>
          </>
        );
      case "survey":
        return (
          <>
            <PageTitle>Beneficial Ownership Survey</PageTitle>
            <PageSub>Simulated portal change — this screen is not in the recorded flow.</PageSub>
            {field("owner_pct", "Ownership percentage")}
          </>
        );
    }
  })();

  return (
    <PortalCard step={KIND[screen]} flowStep={screen === "survey" ? undefined : screen}>
      {/* noValidate: the registry validates server-side and shows its own
          messages — the fixture reproduces that instead of browser popups. */}
      <form
        noValidate
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          // Deterministic validation: a PO Box (or empty) street fails with
          // the registry's address message, as recorded in the walkthrough.
          if (screen === "filer") {
            const street = (data.dos_filer_street ?? "").trim();
            if (!street || /p\.?\s*o\.?\s*box|apartado/i.test(street)) {
              setError(t("PO Box addresses are not accepted. Enter a physical street address.", "No se aceptan apartados postales. Escriba una dirección física."));
              return;
            }
          }
          if (screen === "signatures" && (data.dos_perjury !== "yes" || !(data.dos_signer_name ?? "").trim())) return;
          next();
        }}
      >
        {body}
        {screen !== "thank_you" && (
          <PrimaryButton>{screen === "payment" ? "Pay and submit" : screen === "signatures" ? "Sign" : "Next"}</PrimaryButton>
        )}
      </form>
    </PortalCard>
  );
}

export default function DeptStateRehearsalWizard() {
  return (
    <Suspense fallback={null}>
      <Wizard />
    </Suspense>
  );
}
