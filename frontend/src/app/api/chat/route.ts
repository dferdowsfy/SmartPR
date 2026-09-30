export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { generateText, isAiConfigured } from "../../../lib/ai/router";

type ChatMessage = { role: "user" | "assistant"; content: string };

type ChatPayload = {
  messages: ChatMessage[];
  context: {
    profile: {
      name?: string | null;
      business_type?: string | null;
      industry?: string | null;
      municipality?: string | null;
      business_structure?: string | null;
      location_type?: string | null;
    };
    requirements: Array<{ code: string; name: string; status?: string; mandatory?: boolean; agency?: string }>;
    language: "en" | "es";
  };
};

export async function POST(req: Request) {
  if (!isAiConfigured("chat")) {
    return Response.json({ reply: "AI assistant is not available." }, { status: 503 });
  }

  let body: ChatPayload;
  try {
    body = (await req.json()) as ChatPayload;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { messages, context } = body;
  const { profile, requirements, language } = context;
  const es = language === "es";

  const reqLines = (requirements ?? [])
    .slice(0, 25)
    .map((r) => {
      const tag = r.mandatory ? (es ? "[obligatorio]" : "[required]") : (es ? "[opcional]" : "[optional]");
      const status = r.status === "passed" ? (es ? "✓ validado" : "✓ validated")
        : r.status === "uploaded" ? (es ? "⬆ subido" : "⬆ uploaded")
        : r.status === "warning" ? (es ? "⚠ revisar" : "⚠ review")
        : (es ? "pendiente" : "pending");
      return `• ${r.name} ${tag} — ${status}${r.agency ? ` (${r.agency})` : ""}`;
    })
    .join("\n");

  const systemPrompt = es
    ? `Eres el Asistente de SmartPR, experto en licencias y regulaciones de negocios en Puerto Rico.
Ayudas a los dueños de negocios a entender sus requisitos de radicación, qué documentos necesitan y cuáles son los próximos pasos.

CONTEXTO DEL NEGOCIO:
- Nombre: ${profile.name || "No proporcionado"}
- Tipo de negocio: ${profile.business_type || "No proporcionado"}
- Industria: ${profile.industry || "No proporcionada"}
- Municipio: ${profile.municipality || "No proporcionado"}
- Estructura legal: ${profile.business_structure || "No proporcionada"}
- Tipo de ubicación: ${profile.location_type || "No proporcionado"}

REQUISITOS ACTUALES:
${reqLines || "Aún no se han identificado requisitos."}

INSTRUCCIONES:
- Responde basándote en el contexto del negocio de arriba
- Sé conciso pero útil — 2 a 4 oraciones para la mayoría de las respuestas
- Enfócate en orientación práctica: qué hacer, dónde ir, qué documentos reunir
- Si no estás seguro, dilo y sugiere que el usuario consulte a la agencia gubernamental correspondiente
- Responde siempre en español`
    : `You are SmartPR Assistant, an expert on Puerto Rico business licensing and regulatory requirements.
You help business owners understand their filing requirements, what documents they need, and next steps.

BUSINESS CONTEXT:
- Name: ${profile.name || "Not provided"}
- Business type: ${profile.business_type || "Not provided"}
- Industry: ${profile.industry || "Not provided"}
- Municipality: ${profile.municipality || "Not provided"}
- Business structure: ${profile.business_structure || "Not provided"}
- Location type: ${profile.location_type || "Not provided"}

CURRENT REQUIREMENTS:
${reqLines || "No requirements identified yet."}

INSTRUCTIONS:
- Answer questions based on the business context above
- Be concise but helpful — 2 to 4 sentences for most answers
- Focus on practical guidance: what to do, where to go, what documents to gather
- If uncertain, say so and suggest the user consult the relevant government agency
- Always respond in English`;

  const controller = new AbortController();
  setTimeout(() => controller.abort(), 25_000);

  try {
    const reply = await generateText("chat", {
      input: [
        { role: "system", content: systemPrompt },
        ...(messages ?? []).map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        })),
      ],
      maxOutputTokens: 512,
      temperature: 0.4,
      signal: controller.signal,
    });
    return Response.json({ reply: reply.trim() || (es ? "Sin respuesta." : "No response.") });
  } catch {
    return Response.json(
      { reply: es ? "Lo siento, ocurrió un error. Inténtalo de nuevo." : "Sorry, something went wrong. Please try again." },
      { status: 500 }
    );
  }
}
