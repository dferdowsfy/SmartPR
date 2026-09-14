/**
 * Realistic sample data for the /admin/emails live preview.
 * Pure functions — the preview endpoint renders the founder's *edited*
 * template wrapper against these sample blocks, exactly like a real send.
 */
import type { DigestEmailInput } from "./compliance-digest-emails";
import type { ReminderEmailInput } from "./compliance-reminder-emails";
import type { EmailTemplateKey, EmailTemplateLang } from "./email-templates";

/** A full, realistic digest input for previewing the digest wrapper. */
export function sampleDigestInput(lang: EmailTemplateLang): DigestEmailInput {
  const es = lang === "es";
  return {
    lang,
    businessLabel: es ? "Café Luna y 1 negocio más" : "Café Luna + 1 more business",
    monthLabel: es ? "octubre 2026" : "October 2026",
    userName: "Darius",
    actionCount: 2,
    upcomingCount: 1,
    changeCount: 1,
    actionRequired: [
      {
        obligationId: "o1",
        name: es ? "Patente municipal" : "Municipal business license",
        businessName: "Café Luna",
        businessRef: "abc123",
        agency: es ? "Municipio de San Juan" : "Municipality of San Juan",
        dueDate: "2026-10-21",
        daysRemaining: 7,
        daysStalled: null,
        overdue: false,
        whatToDo: es
          ? "Radica la renovación de la patente con el pago correspondiente."
          : "File the license renewal with the corresponding payment.",
        whyApplies: es
          ? "Aplica a la actividad comercial en San Juan."
          : "Applies to commercial activity in San Juan.",
        risk: es
          ? "Vencer la fecha puede traer multas y recargos."
          : "Missing the date can bring fines and surcharges.",
        applicability: "confirmed",
        actionUrl: "https://www.getsmartpr.com/businesses/abc123#obligation-o1",
      },
    ],
    comingUp: [
      {
        obligationId: "o2",
        name: es ? "Registro de comerciante" : "Merchant registration",
        businessName: "Café Luna",
        businessRef: "abc123",
        agency: "Hacienda",
        dueDate: "2026-11-15",
        daysRemaining: 32,
        prepNow: es
          ? "Reúne las planillas del trimestre anterior."
          : "Gather last quarter's returns.",
        applicability: "confirmed",
        actionUrl: "https://www.getsmartpr.com/businesses/abc123#obligation-o2",
        window: "60",
      },
    ],
    changes: [
      {
        developmentId: "d1",
        title: es ? "OGPe actualiza la renovación del Permiso Único" : "OGPe updates Permiso Único renewal",
        summary: es ? "La ventana de renovación se extiende 30 días." : "The renewal window is extended by 30 days.",
        businessName: "Café Luna",
        effectiveDate: "2026-11-01",
        publishedDate: "2026-09-20",
        whyAffects: es ? "Afecta tu requisito de Permiso Único." : "Affects your Permiso Único requirement.",
        recommendedAction: es ? "Radica temprano de todos modos." : "File early anyway.",
        sourceName: "OGPe",
        sourceUrl: "https://www.ogpe.pr.gov",
        confidence: "high",
        applicability: "confirmed",
      },
    ],
    needsFromYou: [
      {
        kind: "date",
        name: es ? "Certificado de Bomberos" : "Fire certificate",
        businessName: "Café Luna",
        businessRef: "abc123",
        agency: "Bomberos",
        detail: es
          ? "Esta renovación no tiene fecha de vencimiento guardada."
          : "This renewal has no expiry date stored.",
        cta: es ? "Añadir fecha" : "Add date",
        actionUrl: "https://www.getsmartpr.com/businesses/abc123#obligation-o3",
      },
    ],
    health: { percent: 75, total: 4, current: 3, upcoming: 1, needsVerification: 0, overdue: 0 },
    overflow: { action: 0, coming: 0, changes: 0, needs: 0 },
    dashboardUrl: "https://www.getsmartpr.com/dashboard",
    complianceCenterUrl: "https://www.getsmartpr.com/compliance",
    manageUrl: "https://www.getsmartpr.com/settings",
    unsubscribeUrl: "https://www.getsmartpr.com/api/notifications/unsubscribe?token=preview",
  };
}

/** A realistic reminder input for previewing a reminder wrapper. */
export function sampleReminderInput(
  key: EmailTemplateKey,
  lang: EmailTemplateLang
): ReminderEmailInput {
  const es = lang === "es";
  const base = {
    lang,
    obligationName: es ? "Patente municipal" : "Municipal business license",
    businessName: "Café Luna",
    agency: es ? "Municipio de San Juan" : "Municipality of San Juan",
    actionUrl: "https://www.getsmartpr.com/businesses/abc123#obligation-o1",
    unsubscribeUrl: "https://www.getsmartpr.com/api/notifications/unsubscribe?token=preview",
  };
  if (key === "stalled_nudge") {
    return { ...base, kind: "stalled" };
  }
  const tier = key === "reminder_60" ? 60 : key === "reminder_7" ? 7 : 30;
  return {
    ...base,
    kind: "renewal",
    tier,
    dueDate: "2026-11-13",
    missingItems:
      tier === 30
        ? [es ? "Certificado de salud" : "Health certificate", es ? "Plano del local" : "Floor plan"]
        : undefined,
  };
}
