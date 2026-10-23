/** JSON fetch for client components; throws with the API's error message. */
export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: init?.body && !(init.body instanceof FormData) ? { "Content-Type": "application/json", ...init?.headers } : init?.headers,
  });
  const body = await res.json().catch(() => ({}));
  if (res.status === 401 && typeof window !== "undefined") window.location.href = "/login";
  if (!res.ok) {
    const err = new Error(body.error ?? `Request failed (${res.status})`) as Error & { problems?: string[] };
    err.problems = body.problems;
    throw err;
  }
  return body as T;
}
