/**
 * Requirements → Clara handoff. The requirements page opens
 * /businesses/<id>/agency-run?requirement=<DOC_ID>; once the business's
 * filings load, this decides what Clara does with that requirement. Clara
 * never starts a run on her own: "start" opens the pre-flight card, and the
 * user confirms before anything is filed.
 */
import type { FilingGroup, FilingOption } from "../../../../lib/agency-runs/agencyActions";

export const CLARA_HANDOFF_INTRO_EN =
  "I already have the information SmartPR collected for this filing. I'll use it to help complete the form and only ask you for anything that's missing.";
export const CLARA_HANDOFF_INTRO_ES =
  "Ya tengo la información que SmartPR recopiló para este trámite. La usaré para ayudarte a completar el formulario y solo te pediré lo que falte.";

export type ClaraHandoff =
  | { kind: "start"; filing: FilingOption }
  | { kind: "resume"; filing: FilingOption }
  | { kind: "prepare"; filing: FilingOption; textEn: string; textEs: string }
  | { kind: "missing"; textEn: string; textEs: string };

export function planClaraHandoff(groups: readonly FilingGroup[], requirementId: string): ClaraHandoff {
  const all = groups.flatMap((g) => g.filings);
  const matches = all.filter((f) => f.requirement_id === requirementId);
  const active = matches.find((f) => f.filing_status === "in_progress" && f.active_run_id);
  if (active) return { kind: "resume", filing: active };
  const startable = matches.find(
    (f) => f.supported && f.action && (f.filing_status === "ready_to_start" || f.filing_status === "missing_information")
  );
  if (startable) return { kind: "start", filing: startable };
  const known = matches.find((f) => f.action) ?? matches[0];
  if (known) {
    const a = known.action;
    const ready = a ? `${a.known} of ${a.total}` : null;
    const readyEs = a ? `${a.known} de ${a.total}` : null;
    const missing = a?.missing_items.filter((m) => !m.sensitive) ?? [];
    const needEn = missing.length ? ` Still needed: ${missing.map((m) => m.label_en).join(", ")}.` : "";
    const needEs = missing.length ? ` Falta: ${missing.map((m) => m.label_es).join(", ")}.` : "";
    return {
      kind: "prepare",
      filing: known,
      textEn: `I can't submit ${known.title_en} in the agency portal yet, so I'll prepare it with you instead.${ready ? ` ${ready} details are already on file from your Business Passport and this project.` : ""}${needEn} Open the agency site when you're ready — the checklist stays here.`,
      textEs: `Todavía no puedo radicar ${known.title_es} en el portal de la agencia, así que lo prepararé contigo.${readyEs ? ` ${readyEs} datos ya están en tu Pasaporte comercial y este proyecto.` : ""}${needEs} Abre el sitio de la agencia cuando estés listo; la lista queda aquí.`,
    };
  }
  return {
    kind: "missing",
    textEn: "This requirement isn't in your saved filings yet. Go back to your requirements and open it again once they have saved, and I'll load it here.",
    textEs: "Este requisito aún no está en tus trámites guardados. Vuelve a tus requisitos y ábrelo de nuevo cuando se hayan guardado; lo cargaré aquí.",
  };
}
