/**
 * Shared types and helpers for endpoint handlers.
 */

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

export interface SuccessResponse<T = unknown> {
  success: true;
  data: T;
}

export interface ErrorResponse {
  success: false;
  error: string;
}

export type HandlerResponse<T = unknown> = SuccessResponse<T> | ErrorResponse;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function ok<T>(data: T): SuccessResponse<T> {
  return { success: true, data };
}

export function fail(err: unknown): ErrorResponse {
  const message = err instanceof Error ? err.message : String(err);
  return { success: false, error: message };
}
