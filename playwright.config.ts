// ── Playwright config, end-to-end browser tests ─────────────────────
// WHAT THIS IS FOR: vitest (see vitest config in package.json) only
// tests pure functions in isolation, it never actually renders the
// app or clicks a real button. That gap once hid a real, serious bug:
// the tag-picker screen had zero CSS and rendered as an invisible
// ~71px sliver, completely blocking every join, and no unit test
// could have caught it because unit tests called joinAsRider()
// directly instead of clicking through the real screen (see
// OPERATIONS.md bug #19 for the full story). These e2e tests exist
// specifically to close that gap: they load the real app in a real
// browser and click the real buttons, the same way a rider would.
//
// HOW TO RUN THESE LOCALLY: `supabase start` first (needs Docker
// Desktop open), then `npm run test:e2e`. The webServer block below
// starts the Vite dev server automatically if one isn't already
// running on port 5173.
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  retries: 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: {
    baseURL: "http://localhost:5173",
    trace: "retain-on-failure", // keeps a debuggable trace only for failing runs, not every run
  },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:5173",
    reuseExistingServer: true, // if a dev server's already running (local iteration), use it instead of starting a second one
    timeout: 30_000,
  },
});
