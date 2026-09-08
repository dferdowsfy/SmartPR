export type AcquisitionEvent = 'visit' | 'checklist_completed' | 'signup_clicked' | 'account_created' | 'intake_opened';
export function trackAcquisition(event: AcquisitionEvent, source: string, language: string) {
  void fetch('/api/acquisition', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event, source: source.slice(0, 80), language, campaign: 'clinic' }),
    keepalive: true,
  }).catch(() => {});
}
