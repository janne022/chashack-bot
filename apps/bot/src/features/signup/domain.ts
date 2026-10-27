export type SignupWindowReason = 'signup_not_open' | 'signup_closed' | null;

export function eventEnforcesSignupWindow(formJson: string | null): boolean {
  try { return !!formJson && (JSON.parse(formJson) as { enforceSignupWindow?: unknown }).enforceSignupWindow === true; }
  catch { return false; }
}

/** Existing active registrations remain editable outside the new-signup window. */
export function signupWindowReason(enforced: boolean, startsAt: number | null, endsAt: number | null, status: string | null, now: number): SignupWindowReason {
  if (!enforced || status === 'active') return null;
  if (startsAt !== null && now < startsAt) return 'signup_not_open';
  if (endsAt !== null && now >= endsAt) return 'signup_closed';
  return null;
}
