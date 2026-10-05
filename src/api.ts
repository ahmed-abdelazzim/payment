/**
 * Browser API wrapper. Authentication is carried only by the HttpOnly
 * same-origin session cookie; frontend code must never read or persist it.
 */
export function apiFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  return fetch(input, {
    ...init,
    credentials: 'same-origin',
  });
}
