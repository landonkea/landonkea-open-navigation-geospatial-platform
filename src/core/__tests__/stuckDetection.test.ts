// ── Unit tests for src/core/stuckDetection.ts ──────────────────────

import { describe, expect, it } from "vitest";
import { countsAsMovement, isPossiblyStuck } from "../stuckDetection";

describe("isPossiblyStuck", () => {
  const now = 1_000_000; // arbitrary fixed "current time" for every test below

  it("is false when the participant moved recently", () => {
    const fiveMinutesAgo = now - 5 * 60 * 1000;
    expect(isPossiblyStuck(fiveMinutesAgo, now)).toBe(false); // well under the 15-minute window
  });

  it("is true once they've been stationary past the threshold", () => {
    const twentyMinutesAgo = now - 20 * 60 * 1000;
    expect(isPossiblyStuck(twentyMinutesAgo, now)).toBe(true); // past the 15-minute window
  });

  it("is false exactly at the threshold (boundary check, not yet past it)", () => {
    const exactlyFifteenMinutesAgo = now - 15 * 60 * 1000;
    expect(isPossiblyStuck(exactlyFifteenMinutesAgo, now)).toBe(false); // "> threshold", not ">="
  });
});

describe("countsAsMovement", () => {
  it("is false for small GPS-jitter-sized distances", () => {
    expect(countsAsMovement(5)).toBe(false); // well under the 30m threshold
  });

  it("is true for distances clearly beyond jitter", () => {
    expect(countsAsMovement(100)).toBe(true); // well past the 30m threshold
  });

  it("is false exactly at the threshold (boundary check)", () => {
    expect(countsAsMovement(30)).toBe(false); // "> threshold", not ">="
  });
});
