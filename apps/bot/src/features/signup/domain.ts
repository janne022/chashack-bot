export type SignupAdmission = 'allowed' | 'signup_not_open' | 'signup_closed';

/** Existing active registrations may be edited after the window closes;
 * withdrawals and new registrations must be inside the half-open window. */
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
