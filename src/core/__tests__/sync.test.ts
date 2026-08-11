// ── Unit tests for src/core/sync.ts's backoff math ─────────────────
// Only computeBackoffSeconds() is tested here, the poll loop itself
// (startPolling/pollOnce) needs a real browser (Geolocation API,
// network) and is instead verified against the real local Supabase
// backend, see this repo's OPERATIONS.md for how.

import { describe, expect, it } from "vitest";
import { computeBackoffSeconds } from "../sync";

describe("computeBackoffSeconds", () => {
  it("uses the plain interval when there have been no failures", () => {
    expect(computeBackoffSeconds(15, 0)).toBe(15);
  });

  it("doubles the interval after one failure", () => {
    expect(computeBackoffSeconds(15, 1)).toBe(30);
  });

  it("keeps doubling for each additional consecutive failure", () => {
    expect(computeBackoffSeconds(15, 2)).toBe(60);
    expect(computeBackoffSeconds(15, 3)).toBe(120);
  });

  it("caps out at 5 minutes even after many consecutive failures", () => {
    expect(computeBackoffSeconds(15, 10)).toBe(300); // would be 15360s uncapped, way past the 300s ceiling
  });
});
