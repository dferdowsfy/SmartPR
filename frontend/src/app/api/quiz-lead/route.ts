import { notifyFounder } from '../../../lib/leads';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const email = typeof body.email === 'string' ? body.email.trim().slice(0, 254) : '';
    if (!email.includes('@')) return Response.json({ error: 'Invalid email' }, { status: 400 });

    const answers = body.answers && typeof body.answers === 'object' ? body.answers : {};
    const summary = Object.entries(answers)
      .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : String(v)}`)
      .join(' | ')
      .slice(0, 500);
    const matters = Array.isArray(body.matters) ? body.matters.slice(0, 12).join(', ') : '';

    // Fire-and-forget: never blocks the user flow.
    notifyFounder('Nuevo lead del quiz de permisos', {
      Email: email,
      Idioma: body.lang === 'en' ? 'EN' : 'ES',
      Puntaje: `${body.score ?? '?'} /10`,
      Respuestas: summary || '—',
      Asuntos: matters || '—',
    }).catch(() => {});

    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: 'Bad request' }, { status: 400 });
  }
}
