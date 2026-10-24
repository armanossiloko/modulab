import { client } from './generated/client.gen';

/** Paths that must stay reachable without a session. */
const AUTH_PAGES = ['/login', '/setup'];

/** Configure the generated OpenAPI fetch client. Call once at startup. */
export function configureLabApi(): void {
  client.setConfig({
    baseUrl: '',
  });

  // Session expired or signed out elsewhere: go to the sign-in page and come back afterwards.
  client.interceptors.response.use((response, request) => {
    const path = window.location.pathname;
    const isAuthCall = new URL(request.url, window.location.origin).pathname.startsWith('/api/auth/');
    if (response.status === 401 && !isAuthCall && !AUTH_PAGES.some((p) => path.startsWith(p))) {
      const rd = encodeURIComponent(path + window.location.search);
      window.location.assign(`/login?rd=${rd}`);
    }
    return response;
  });
}

export function apiErrorMessage(error: unknown, fallback = 'Request failed'): string {
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message);
  }
  if (error instanceof Error) return error.message;
  return fallback;
}
