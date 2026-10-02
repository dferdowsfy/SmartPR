/**
 * POST /api/clara-workspace/translate { texts: string[], to: "en" | "es" }
 * → { translations: Record<string, string> }
 *
 * Translates a portal's field labels and screen titles (e.g. "Primer
 * Nombre:*" → "First name") for the Teach Clara chat. Labels only — never
 * values. Passport-catalog names and a small glossary first; the app's
 * configured model (labels only) for the rest; untranslated labels are
 * simply left out.
 */
import { PASSPORT_CATALOG, normalizeLabel } from "../../../../lib/agency-runs/teach/passportCatalog";
import { currentViewer, modelPrompter, unauthorized } from "../../../../lib/agency-runs/teach/routeContext";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GLOSSARY: Record<string, string> = {
  "ciudadania": "Citizenship",
  "fecha de nacimiento": "Date of birth",
  "lugar de nacimiento": "Place of birth",
  "lugar de nacimiento ciudad o estado": "Place of birth (city or state)",
  "numero de identificacion nacional": "National ID number",
  "numero de seguro social": "Social Security number",
  "confirm ssn": "Confirm SSN",
  "genero": "Gender",
  "estado civil": "Marital status",
  "numero de licencia": "License number",
  "usuario": "Username",
  "contrasena": "Password",
  "correo electronico": "Email",
  "telefono": "Phone",
  "mi informacion": "My information",
  "informacion del perfil": "Profile information",
  "iniciar sesion": "Sign in",
  "registrese": "Register",
};

const cache = new Map<string, string>();

function localTranslate(text: string, to: "en" | "es"): string | null {
  const key = normalizeLabel(text);
  if (!key) return null;
  for (const c of PASSPORT_CATALOG) {
    const names = [normalizeLabel(c.es), normalizeLabel(c.en), ...c.keywords];
    if (names.includes(key)) return to === "en" ? c.en : c.es;
  }
  if (to === "en" && GLOSSARY[key]) return GLOSSARY[key];
  return null;
}

export async function POST(req: Request) {
  const viewer = await currentViewer();
  if (!viewer) return unauthorized();
  const body = (await req.json().catch(() => ({}))) as { texts?: unknown; to?: unknown };
  const to = body.to === "es" ? "es" : "en";
  const texts = (Array.isArray(body.texts) ? body.texts : [])
    .filter((t): t is string => typeof t === "string" && t.trim().length > 0)
    .map((t) => t.trim().slice(0, 160))
    .slice(0, 40);
  const out: Record<string, string> = {};
  const pending: string[] = [];
  for (const t of texts) {
    const hit = cache.get(`${to}|${t}`) ?? localTranslate(t, to);
    if (hit) out[t] = hit;
    else pending.push(t);
  }
  if (pending.length) {
    const prompt = await modelPrompter(600).catch(() => null);
    if (prompt) {
      try {
        const raw = await prompt({
          system: `Translate short web-form field labels and page titles from a Puerto Rico government portal into ${to === "en" ? "English" : "Spanish"}. Reply with JSON only: an array of strings in the same order. Keep them short; drop asterisks and trailing colons.`,
          user: JSON.stringify(pending),
        });
        const arr = JSON.parse(raw.slice(raw.indexOf("["), raw.lastIndexOf("]") + 1)) as unknown[];
        pending.forEach((t, i) => {
          const v = typeof arr[i] === "string" ? (arr[i] as string).trim().slice(0, 160) : "";
          if (v) {
            out[t] = v;
            cache.set(`${to}|${t}`, v);
          }
        });
      } catch {
        // Untranslated labels are shown as the portal wrote them.
      }
    }
  }
  return Response.json({ translations: out });
}
