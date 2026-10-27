export type SignupWindowReason = 'signup_not_open' | 'signup_closed' | null;

export type SignupAdmission = 'allowed' | 'signup_not_open' | 'signup_closed';

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

/** Unconditional window check used where no explicit enforcement flag exists
 * (for example a caller that already knows the event opted in). */
export function signupAdmission(
  window: { signupStartsAt: number | null; signupEndsAt: number | null },
  existingStatus: 'active' | 'withdrawn' | 'blocked' | null,
  now: number,
): SignupAdmission {
  if (existingStatus === 'blocked') return 'signup_closed';
  if (existingStatus === 'active') return 'allowed';
  if (window.signupStartsAt !== null && now < window.signupStartsAt) return 'signup_not_open';
  if (window.signupEndsAt !== null && now >= window.signupEndsAt) return 'signup_closed';
  return 'allowed';
}
