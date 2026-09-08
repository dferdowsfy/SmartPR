import test from 'node:test';
import assert from 'node:assert/strict';
import { intakeUrl, readRestaurantHandoff, checklistKeys, type Answers } from './model';
import { POST } from '../api/acquisition/route';
const answers: Answers = { municipality: 'Bayamón', kind: 'Cafe', premises: 'considering', alcohol: 'unknown', renovation: 'yes' };
test('restaurant answers survive signup and callback URL encoding without browser storage', () => {
  const next = intakeUrl(answers, 'es', 'instagram');
  const signup = new URL(`https://example.com/signup?next=${encodeURIComponent(next)}`);
  const callback = new URL(`https://example.com/auth/callback?next=${encodeURIComponent(signup.searchParams.get('next')!)}`);
  const restored = readRestaurantHandoff(new URL(callback.searchParams.get('next')!, 'https://example.com').searchParams, ['Bayamón']);
  assert.equal(restored?.profile.municipality, 'Bayamón');
  assert.equal(restored?.profile.business_type, 'Cafe');
  assert.equal(restored?.profile.alcohol_sold, null);
  assert.equal(restored?.language, 'es');
  assert.deepEqual(restored?.context, { premises: 'considering', renovation: 'yes' });
});
test('tampered municipality, business type and boolean values do not become intake facts', () => {
  for (const [key, value] of [['municipality', 'Made up'], ['kind', '<script>'], ['alcohol', 'false'], ['renovation', 'invalid'], ['premises', 'invalid']]) {
    const p = new URL(intakeUrl(answers, 'en'), 'https://example.com').searchParams;
    p.set(`r_${key}`, value);
    assert.equal(readRestaurantHandoff(p, ['Bayamón']), null);
  }
});
test('conditional items retain uncertainty and disappear only after an explicit no', () => {
  assert.ok(checklistKeys(answers).includes('alcohol'));
  assert.ok(checklistKeys(answers).includes('renovation'));
  assert.equal(checklistKeys({ ...answers, alcohol: 'no', renovation: 'no' }).length, 4);
});
test('analytics rejects cross-origin, oversized and unknown events', async () => {
  const req = (body: string, origin = 'https://example.com') => new Request('https://example.com/api/acquisition', { method: 'POST', headers: { origin }, body });
  assert.equal((await POST(req('{}', 'https://evil.example'))).status, 403);
  assert.equal((await POST(req('x'.repeat(1025)))).status, 413);
  assert.equal((await POST(req('{"event":"made_up"}'))).status, 400);
});
