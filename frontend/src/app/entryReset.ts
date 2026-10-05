/**
 * Guard for the ?entry=new-business slate reset (the authenticated portfolio's
 * “File a New Business” action). The reset must NOT run when resuming a saved
 * submission: every resume link in the app is /?entry=new-business&resume=<id>
 * (Submission History, business pages, filing panel), and the reset was wiping
 * the hydrated draft — resume rendered a blank intake or a checklist recomputed
 * from empty answers. (2026-10-05 QA, live S436 follow-up: REG-LIVE-RESUME-BROKEN-001.)
 * ?business=<id> (Clara return) is likewise not a fresh entry.
 */
export function shouldApplyNewBusinessEntryReset(search: string): boolean {
  const params = new URLSearchParams(search);
  return params.get('entry') === 'new-business' && !params.get('business') && !params.get('resume');
}
