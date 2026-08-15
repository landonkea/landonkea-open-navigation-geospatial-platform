// ── Unit tests for src/core/errorReporting.ts ────────────────────────
// setUpErrorReporting() itself just wires DOM event listeners (needs a
// real browser to exercise meaningfully, same boundary sync.ts's
// pollOnce() draws), so this only covers the pure truncation logic
// directly, via the window "error"/"unhandledrejection" listeners it
// installs, confirming long values actually get capped before being
// handed to reportClientError().
import { describe, expect, it, vi, beforeEach, beforeAll } from "vitest";
import { setUpErrorReporting } from "../errorReporting";
import * as supabaseAdapter from "../adapters/supabase";

describe("setUpErrorReporting", () => {
  // Installed ONCE, not per test (found the hard way): window event
  // listeners persist across tests in the same jsdom instance, calling
  // setUpErrorReporting() again in a second test would add a SECOND
  // listener on top of the first, double-reporting every event from
  // then on. vi.clearAllMocks() between tests resets the spy's call
  // history without touching the listener itself.
  let reportSpy: ReturnType<typeof vi.spyOn>;

  beforeAll(() => {
    reportSpy = vi.spyOn(supabaseAdapter, "reportClientError").mockResolvedValue();
    setUpErrorReporting();
  });

  beforeEach(() => {
    reportSpy.mockClear();
  });

  it("truncates an overly long error message before reporting it", async () => {
    const longMessage = "x".repeat(1000);
    window.dispatchEvent(new ErrorEvent("error", { message: longMessage }));

    expect(reportSpy).toHaveBeenCalledTimes(1);
    const [message] = reportSpy.mock.calls[0];
    expect((message as string).length).toBe(500);
  });

  it("reports an unhandled promise rejection with a prefixed message", async () => {
    const event = new Event("unhandledrejection") as PromiseRejectionEvent;
    Object.defineProperty(event, "reason", { value: new Error("boom") });
    window.dispatchEvent(event);

    expect(reportSpy).toHaveBeenCalledTimes(1);
    const [message] = reportSpy.mock.calls[0];
    expect(message).toContain("Unhandled rejection: boom");
  });
});
