// Playwright config. `npm test` starts the Worker with `npm run dev` and runs
// every spec in tests/ against it in headless Chromium.
import { defineConfig, devices } from '@playwright/test';

const PORT = 8787; // wrangler dev's default port
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: 'tests',
  testMatch: '**/*.spec.mjs',
  // Reports and traces go to .pipeline/, which git already ignores.
  outputDir: '.pipeline/test-results',
  reporter: [
    ['list'],
    ['html', { outputFolder: '.pipeline/playwright-report', open: 'never' }],
  ],
  forbidOnly: !!process.env.CI,
  retries: 0,
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        headless: true,
        // Software WebGL2 (SwiftShader) works without a GPU and gives the
        // same rounding on every machine. Newer Chromium needs the "unsafe"
        // flag before it will use SwiftShader for WebGL.
        launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
      },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: { WRANGLER_SEND_METRICS: 'false' },
  },
});
