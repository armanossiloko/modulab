import { client } from './generated/client.gen';

const API_KEY_STORAGE = 'modulab.apiKey';

/** Configure the generated OpenAPI fetch client (base URL + X-Lab-Key). Call once at startup. */
export function configureLabApi(): void {
  client.setConfig({
    baseUrl: '',
  });

  client.interceptors.request.use((request) => {
    const key = sessionStorage.getItem(API_KEY_STORAGE) || '';
    if (key) {
      request.headers.set('X-Lab-Key', key);
    }
    return request;
  });

  client.interceptors.error.use(async (error, response) => {
    if (response?.status === 401) {
      const key = window.prompt('Control Center API key (lab.controlCenterApiKey)');
      if (key) {
        sessionStorage.setItem(API_KEY_STORAGE, key);
      }
    }
    return error;
  });
}

export function apiErrorMessage(error: unknown, fallback = 'Request failed'): string {
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message);
  }
  if (error instanceof Error) return error.message;
  return fallback;
}
