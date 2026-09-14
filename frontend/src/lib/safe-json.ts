// Shared defensive JSON parsing for client-side fetches.
//
// Server route handlers can fail with an empty/non-JSON body (e.g. a 500
// thrown outside try/catch). Calling `await res.json()` on that throws the
// raw "Failed to execute 'json' on 'Response': Unexpected end of JSON input"
// error. Every enterprise page must use readJson() instead of res.json() so
// transport failures surface as a friendly retry message, never a crash.

export type SafeJsonResult<T = unknown> = {
  ok: boolean;
  status: number;
  /** Parsed body (present even on error statuses when the body was JSON). */
  data: T | null;
  /** Friendly message when !ok; null when ok. */
  error: string | null;
};

export async function readJson<T = unknown>(res: Response): Promise<SafeJsonResult<T>> {
  let text = "";
  try {
    text = await res.text();
  } catch {
    return {
      ok: false,
      status: res.status,
      data: null,
      error: `Could not read the server response (HTTP ${res.status}). Please retry.`,
    };
  }
  if (!text.trim()) {
    return {
      ok: false,
      status: res.status,
      data: null,
      error:
        res.status === 401
          ? "Your session expired. Please sign in again."
          : `The server returned an empty response (HTTP ${res.status}). Please retry.`,
    };
  }
  let data: T;
  try {
    data = JSON.parse(text) as T;
  } catch {
    return {
      ok: false,
      status: res.status,
      data: null,
      error: `The server returned an unexpected response (HTTP ${res.status}). Please retry.`,
    };
  }
  if (!res.ok) {
    const body = data as unknown as Record<string, unknown> | null;
    const msg =
      (body && typeof body.message === "string" && body.message) ||
      (body && typeof body.error === "string" && body.error) ||
      `Request failed (HTTP ${res.status}). Please retry.`;
    return { ok: false, status: res.status, data, error: msg };
  }
  return { ok: true, status: res.status, data, error: null };
}
