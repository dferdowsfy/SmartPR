import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildChatMilestones,
  summarizeStage,
} from "./milestoneClassifier";
import type { AgencyRunEvent } from "./types";

const ev = (
  index: number,
  message: string,
  kind?: "info" | "pause" | "review",
  message_es?: string
): AgencyRunEvent => ({
  index,
  message,
  message_es: message_es ?? message,
  screenshot_url: "",
  created_at: `2026-09-16T10:00:${String(index).padStart(2, "0")}Z`,
  kind,
});

const NOISY: [string, string][] = [
  ["Opening SURI (suri.hacienda.pr.gov)…", "Abriendo SURI (suri.hacienda.pr.gov)…"],
  ["Register taxpayer — locating the online filing section", "Registro de contribuyente — localizando la sección de radicación en línea"],
  ["Prefilling from Business Passport (non-sensitive fields)", "Rellenando desde el Pasaporte de Negocio (campos no sensibles)"],
  ["Clicking Continue", "Haciendo clic en Continuar"],
  ["Entering legal entity name", "Ingresando el nombre de la entidad legal"],
  ["Entering trade name", "Ingresando el nombre comercial"],
  ["Scrolling down", "Desplazando hacia abajo"],
  ["Waiting for page to load", "Esperando que cargue la página"],
  ["Clicking Next", "Haciendo clic en Siguiente"],
  ["Entering mailing address", "Ingresando la dirección postal"],
];

function noisyEvents(): AgencyRunEvent[] {
  return NOISY.map(([message, message_es], i) => ev(i, message, "info", message_es));
}

describe("buildChatMilestones", () => {
  it("returns [] for empty input", () => {
    assert.deepEqual(buildChatMilestones([], { portalEn: "SURI", portalEs: "SURI" }), []);
  });

  it("collapses 10 noisy info events into <= 3 milestones", () => {
    const milestones = buildChatMilestones(noisyEvents(), {
      portalEn: "SURI",
      portalEs: "SURI",
    });
    assert.ok(milestones.length <= 3, `got ${milestones.length} milestones`);
  });

  it("first milestone is the run-started message with tone info", () => {
    const milestones = buildChatMilestones(noisyEvents(), {
      portalEn: "SURI",
      portalEs: "SURI",
    });
    const first = milestones[0]!;
    assert.equal(first.id, "m-0");
    assert.equal(first.tone, "info");
    assert.equal(
      first.heading_en,
      "I'm starting your SURI filing. I already have most of the information I need."
    );
    assert.equal(
      first.heading_es,
      "Empiezo tu radicación en SURI. Ya tengo casi toda la información que necesito."
    );
  });

  it("never emits micro-step noise as milestone headings", () => {
    const milestones = buildChatMilestones(noisyEvents(), {
      portalEn: "SURI",
      portalEs: "SURI",
    });
    const headings = milestones.flatMap((m) => [m.heading_en, m.heading_es]);
    for (const noise of ["Clicking Continue", "Entering legal entity name", "Scrolling"]) {
      assert.ok(
        !headings.some((h) => h.includes(noise)),
        `noise leaked into headings: ${noise}`
      );
    }
  });

  it("keeps every pause event as its own action milestone", () => {
    const events: AgencyRunEvent[] = [
      ev(0, "Opening SURI…", "info"),
      ev(
        1,
        "PAUSE_USER_LOGIN\nREQUIRED_FIELDS:\n- id=email; label=Email; type=email; sensitive=false\n- id=password; label=Password; type=password; sensitive=true",
        "pause"
      ),
      ev(2, "Review ready — you submit on the portal.", "review"),
    ];
    const milestones = buildChatMilestones(events, {
      portalEn: "SURI",
      portalEs: "SURI",
    });
    const pause = milestones.find((m) => m.id === "m-1")!;
    assert.ok(pause, "pause milestone present");
    assert.equal(pause.tone, "action");
    assert.equal(pause.heading_en, "Sign-in needed (Email, Password) — enter it in Assistant");
  });

  it("keeps every review event as its own success milestone", () => {
    const events: AgencyRunEvent[] = [
      ev(0, "Opening SURI…", "info"),
      ev(1, "Review ready — you submit on the portal. Agent never clicks final submit.", "review"),
    ];
    const milestones = buildChatMilestones(events, {
      portalEn: "SURI",
      portalEs: "SURI",
    });
    const review = milestones.find((m) => m.id === "m-1")!;
    assert.ok(review, "review milestone present");
    assert.equal(review.tone, "success");
    assert.equal(
      review.heading_en,
      "Your application is prepared and ready for final review."
    );
    assert.equal(
      review.heading_es,
      "Tu solicitud está preparada y lista para la revisión final."
    );
  });

  it("ids are deterministic m-<index> and output is ordered by created_at", () => {
    const events = noisyEvents().slice(0, 3).reverse();
    const milestones = buildChatMilestones(events, {
      portalEn: "SURI",
      portalEs: "SURI",
    });
    assert.equal(milestones[0]!.id, "m-0");
    const times = milestones.map((m) => m.created_at);
    assert.deepEqual([...times].sort(), times);
  });

  it("attaches details when the burst clearly names completed items", () => {
    const events: AgencyRunEvent[] = [
      ev(0, "Opening SURI…", "info"),
      ev(1, "Clicking Continue", "info"),
      ev(2, "Completed: business name", "info", "Completado: nombre del negocio"),
      ev(3, "Completed: EIN", "info", "Completado: EIN"),
    ];
    const milestones = buildChatMilestones(events, {
      portalEn: "SURI",
      portalEs: "SURI",
    });
    const burst = milestones.find((m) => m.id === "m-1")!;
    assert.ok(burst.details, "details attached");
    assert.equal(burst.details!.length, 2);
    assert.deepEqual(burst.details![0], {
      label_en: "business name",
      label_es: "nombre del negocio",
      done: true,
    });
  });

  it("omits details when messages name no clear completed items", () => {
    const milestones = buildChatMilestones(noisyEvents(), {
      portalEn: "SURI",
      portalEs: "SURI",
    });
    for (const m of milestones) {
      assert.equal(m.details, undefined, `details should be omitted on ${m.id}`);
    }
  });

  it("marks a burst with error language as warn tone", () => {
    const events: AgencyRunEvent[] = [
      ev(0, "Opening SURI…", "info"),
      ev(1, "Failed to load the section, retrying", "info"),
      ev(2, "Retrying the section load", "info"),
    ];
    const milestones = buildChatMilestones(events, {
      portalEn: "SURI",
      portalEs: "SURI",
    });
    const burst = milestones.find((m) => m.id === "m-1")!;
    assert.equal(burst.tone, "warn");
  });
});

describe("summarizeStage", () => {
  it("profile-flavored messages -> SmartPR profile heading", () => {
    const h = summarizeStage([
      "Prefilling from Business Passport (non-sensitive fields)",
      "Entering legal entity name",
    ]);
    assert.equal(
      h.heading_en,
      "Completing the business and registration details using your SmartPR profile"
    );
    assert.equal(
      h.heading_es,
      "Completando los datos del negocio y el registro con tu perfil de SmartPR"
    );
  });

  it("navigation-flavored messages -> portal navigation heading", () => {
    const h = summarizeStage([
      "Opening SURI (suri.hacienda.pr.gov)…",
      "Locating the online filing section",
    ]);
    assert.equal(h.heading_en, "Opening the portal and getting to the right section");
    assert.equal(h.heading_es, "Abriendo el portal y llegando a la sección correcta");
  });

  it("review-flavored messages -> final review heading", () => {
    const h = summarizeStage(["Navigating to pre-submit review (no final submit)"]);
    assert.equal(h.heading_en, "Preparing everything for your final review");
    assert.equal(h.heading_es, "Preparando todo para tu revisión final");
  });

  it("unrecognized messages -> generic working heading", () => {
    const h = summarizeStage(["Doing something", "Another thing"]);
    assert.equal(h.heading_en, "Working through the filing steps");
    assert.equal(h.heading_es, "Avanzando con los pasos de la radicación");
  });
});
