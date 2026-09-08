import test from 'node:test';
import assert from 'node:assert/strict';
import { intakeUrl, readClinicHandoff, checklistKeys, type Answers } from './model';
import { POST } from '../api/acquisition/route';
const answers: Answers = {
  municipality: 'Bayamón',
  kind: 'Consultorio',
  premises: 'considering',
  renovation: 'yes',
  labPharmacy: 'unknown',
};
test('clinic answers survive signup and callback URL encoding without browser storage', () => {
  const next = intakeUrl(answers, 'es', 'instagram');
  const signup = new URL(`https://example.com/signup?next=${encodeURIComponent(next)}`);
  const callback = new URL(`https://example.com/auth/callback?next=${encodeURIComponent(signup.searchParams.get('next')!)}`);
  const restored = readClinicHandoff(new URL(callback.searchParams.get('next')!, 'https://example.com').searchParams, ['Bayamón']);
  assert.equal(restored?.profile.municipality, 'Bayamón');
  assert.equal(restored?.profile.business_type, 'Medical Office');
  assert.equal(restored?.profile.industry, 'Healthcare');
  assert.equal(restored?.language, 'es');
  assert.deepEqual(restored?.context, {
    premises: 'considering',
    renovation: 'yes',
    labPharmacy: 'unknown',
    clinic_kind: 'Consultorio',
  });
});
test('tampered municipality, clinic type and boolean values do not become intake facts', () => {
  for (const [key, value] of [
    ['municipality', 'Made up'],
    ['kind', '<script>'],
    ['labPharmacy', 'false'],
    ['renovation', 'invalid'],
    ['premises', 'invalid'],
  ]) {
    const p = new URL(intakeUrl(answers, 'en'), 'https://example.com').searchParams;
    p.set(`c_${key}`, value);
    assert.equal(readClinicHandoff(p, ['Bayamón']), null);
  }
});
test('conditional items retain uncertainty and disappear only after an explicit no', () => {
  assert.ok(checklistKeys(answers).includes('services'));
  assert.ok(checklistKeys(answers).includes('renovation'));
  assert.equal(checklistKeys({ ...answers, labPharmacy: 'no', renovation: 'no' }).length, 7);
});
test('analytics rejects cross-origin, oversized and unknown events', async () => {
  const req = (body: string, origin = 'https://example.com') =>
    new Request('https://example.com/api/acquisition', { method: 'POST', headers: { origin }, body });
  assert.equal((await POST(req('{}', 'https://evil.example'))).status, 403);
  assert.equal((await POST(req('x'.repeat(1025)))).status, 413);
  assert.equal((await POST(req('{"event":"made_up"}'))).status, 400);
});
