/**
 * Result pattern: services return Ok/Err instead of throwing for
 * expected failures. Errors carry a stable code + human message.
 */
export interface Ok<T> {
  ok: true;
  value: T;
}

export interface Err {
  ok: false;
  code: string;
  message: string;
}

export type Result<T> = Ok<T> | Err;

export function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}

export function err(code: string, message: string): Err {
  return { ok: false, code, message };
}

/** Unwrap or throw — only for call sites where failure is a bug. */
export function unwrap<T>(result: Result<T>): T {
  if (result.ok) return result.value;
  throw new Error(`[${result.code}] ${result.message}`);
}
