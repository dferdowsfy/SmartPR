// Deliberately excludes personal data. Events are available in hosting logs;
// forward these structured records to the chosen analytics destination.
export async function POST(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin || origin !== new URL(request.url).origin) return new Response(null, { status: 403 });
  if (Number(request.headers.get('content-length') || 0) > 1024) return new Response(null, { status: 413 });
  const raw = await request.text();
  if (raw.length > 1024) return new Response(null, { status: 413 });
  try {
    const data = JSON.parse(raw);
    if (!['visit', 'checklist_completed', 'signup_clicked', 'account_created', 'intake_opened'].includes(data?.event)) return new Response(null, { status: 400 });
    const source = typeof data.source === 'string' ? data.source.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80) : 'direct';
    console.info(JSON.stringify({ channel: 'smartpr_acquisition', campaign: 'restaurant', event: data.event, source: source || 'direct', language: data.language === 'es' ? 'es' : 'en', at: new Date().toISOString() }));
    return new Response(null, { status: 204 });
  } catch { return new Response(null, { status: 400 }); }
}
