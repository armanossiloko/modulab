import { client } from './generated/client.gen';

/** Configure the generated OpenAPI fetch client. Call once at startup. */
export function configureLabApi(): void {
  client.setConfig({
    baseUrl: '',
  });
}

export function apiErrorMessage(error: unknown, fallback = 'Request failed'): string {
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message);
  }
  if (error instanceof Error) return error.message;
  return fallback;
}
