import { defineConfig } from '@hey-api/openapi-ts';

export default defineConfig({
  input: './openapi/openapi.json',
  output: {
    path: 'src/app/api/generated',
    // Generated files are committed; skip formatter/linter churn on each regen.
    postProcess: [],
  },
  plugins: ['@hey-api/client-fetch'],
});
