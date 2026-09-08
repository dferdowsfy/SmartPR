export type Answers = { municipality: string; kind: string; premises: string; alcohol: string; renovation: string };
export const kinds = ['Restaurant', 'Cafe', 'Bakery', 'Fast Food Restaurant'] as const;
export const emptyAnswers: Answers = { municipality: '', kind: 'Restaurant', premises: '', alcohol: '', renovation: '' };
export function intakeUrl(a: Answers, language: string, source = 'direct') {
  const p = new URLSearchParams({ entry: 'new-business', acquisition: 'restaurant', lang: language, source: source.slice(0, 80) });
  Object.entries(a).forEach(([key, value]) => p.set(`r_${key}`, value));
  return `/?${p}`;
}
// Only allow known fields and values. No business name, email or address in URLs.
export function readRestaurantHandoff(p: URLSearchParams, municipalities: string[]) {
  if (p.get('acquisition') !== 'restaurant') return null;
  const municipality = p.get('r_municipality') || '';
  const kind = p.get('r_kind') || '';
  const premises = p.get('r_premises');
  const alcohol = p.get('r_alcohol');
  const renovation = p.get('r_renovation');
  if (!municipalities.includes(municipality) || !kinds.includes(kind as typeof kinds[number]) || !['searching', 'considering', 'secured'].includes(premises || '') || !['yes', 'no', 'unknown'].includes(alcohol || '') || !['yes', 'no', 'unknown'].includes(renovation || '')) return null;
  return {
    profile: { business_stage: 'new' as const, municipality, industry: 'Food & Beverage', business_type: kind, location_type: 'Restaurant Location', food_prepared_or_sold: true, customers_visit: true, alcohol_sold: alcohol === 'unknown' ? null : alcohol === 'yes' },
    language: p.get('lang') === 'es' ? 'es' as const : 'en' as const,
    // Keep unresolved premises and renovation context available without treating it as an engine fact.
    context: { premises, renovation },
  };
}
export function checklistKeys(a: Answers) {
  return ['location', 'permit', 'merchant', 'municipal', ...(a.alcohol !== 'no' ? ['alcohol'] : []), ...(a.renovation !== 'no' ? ['renovation'] : [])];
}
