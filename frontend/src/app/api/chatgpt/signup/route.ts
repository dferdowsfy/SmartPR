import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getSiteUrl } from "../../../../lib/siteUrl";

/**
 * POST /api/chatgpt/signup
 * Embedded signup for the ChatGPT widget. The widget POSTs directly here
 * (not via MCP tool call) so the password never passes through ChatGPT's
 * infrastructure. Mirrors the /signup page validation and Supabase flow.
 *
 * Body: { firstName, lastName, email, password, phone?, businessName?,
 *         handoffPath?, intent? }
 * handoffPath: e.g. "/chatgpt/handoff?t=<token>" — embedded in the
 * verification email redirect so the scenario loads after email confirm.
 */
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const firstName = String(body.firstName || "").trim();
  const lastName = String(body.lastName || "").trim();
  const email = String(body.email || "").trim();
  const password = String(body.password || "");
  const phone = String(body.phone || "").trim();
  const businessName = String(body.businessName || "").trim();
  const handoffPath = String(body.handoffPath || "");
  const intent = body.intent === "manage" ? "manage" : "start";
  const agreed = body.agreed === true;

  // Mirror /signup page validation.
  if (!firstName || !lastName) {
    return NextResponse.json({ error: "First and last name are required." }, { status: 400 });
  }
  if (!/\S+@\S+\.\S+/.test(email)) {
    return NextResponse.json({ error: "Enter a valid work email." }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 });
  }
  if (!agreed) {
    return NextResponse.json({ error: "Please accept the Terms of Service and Privacy Policy." }, { status: 400 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnon) {
    return NextResponse.json({ error: "Account creation is unavailable right now." }, { status: 503 });
  }

  // Build the verification redirect carrying the handoff, mirroring
  // verificationRedirectUrl() in lib/siteUrl.ts.
  const safeNext = handoffPath && handoffPath.startsWith("/") ? handoffPath : "/businesses";
  const loginNext = `/auth/login?verified=1&next=${encodeURIComponent(safeNext)}`;
  const emailRedirectTo = `${getSiteUrl()}/auth/callback?next=${encodeURIComponent(loginNext)}`;

  const supabase = createClient(supabaseUrl, supabaseAnon);
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo,
      data: {
        full_name: `${firstName} ${lastName}`,
        first_name: firstName,
        last_name: lastName,
        phone: phone || null,
        onboarding_intent: intent,
        business_name: businessName || null,
        source: "chatgpt",
      },
    },
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    needsConfirmation: !data.session,
    email,
  });
}
