export type Answers = {
  municipality: string;
  kind: string;
  premises: string;
  renovation: string;
  labPharmacy: string;
};
export const kinds = ['Consultorio', 'Outpatient', 'Lab', 'Other'] as const;
export const emptyAnswers: Answers = {
  municipality: '',
  kind: 'Consultorio',
  premises: '',
  renovation: '',
  labPharmacy: '',
};
const kindToBusinessType: Record<(typeof kinds)[number], string> = {
  Consultorio: 'Medical Office',
  Outpatient: 'Urgent Care Center',
  Lab: 'Laboratory',
  Other: 'Medical Office',
};
export function intakeUrl(a: Answers, language: string, source = 'direct') {
  const p = new URLSearchParams({
    entry: 'new-business',
    acquisition: 'clinic',
    lang: language,
    source: source.slice(0, 80),
  });
  Object.entries(a).forEach(([key, value]) => p.set(`c_${key}`, value));
  return `/?${p}`;
}
// Only allow known fields and values. No business name, email or address in URLs.
export function readClinicHandoff(p: URLSearchParams, municipalities: string[]) {
  if (p.get('acquisition') !== 'clinic') return null;
  const municipality = p.get('c_municipality') || '';
  const kind = p.get('c_kind') || '';
  const premises = p.get('c_premises');
  const renovation = p.get('c_renovation');
  const labPharmacy = p.get('c_labPharmacy');
  if (
    !municipalities.includes(municipality) ||
    !kinds.includes(kind as (typeof kinds)[number]) ||
    !['searching', 'considering', 'secured'].includes(premises || '') ||
    !['yes', 'no', 'unknown'].includes(renovation || '') ||
    !['yes', 'no', 'unknown'].includes(labPharmacy || '')
  ) {
    return null;
  }
  return {
    profile: {
      business_stage: 'new' as const,
      municipality,
      industry: 'Healthcare',
      business_type: kindToBusinessType[kind as (typeof kinds)[number]],
      location_type: 'Healthcare Facility',
      healthcare_services: true,
      customers_visit: true,
      professional_licenses_required: true,
    },
    language: p.get('lang') === 'es' ? ('es' as const) : ('en' as const),
    context: { premises, renovation, labPharmacy, clinic_kind: kind },
  };
}
export function checklistKeys(a: Answers) {
  return [
    'location',
    'entity',
    'cnc',
    'health',
    'permit',
    'municipal',
    'boards',
    ...(a.labPharmacy !== 'no' ? ['services'] : []),
    ...(a.renovation !== 'no' ? ['renovation'] : []),
  ];
}
