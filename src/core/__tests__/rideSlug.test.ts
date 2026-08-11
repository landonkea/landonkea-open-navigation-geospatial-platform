// ── Unit tests for src/core/rideSlug.ts ────────────────────────────

import { describe, expect, it } from "vitest"; // Vitest's test-writing functions
import { baseSlugForDate, pickUniqueSlug } from "../rideSlug";

describe("baseSlugForDate", () => {
  it("formats a date as MMDDYYYY with no separators", () => {
    // Month is 0-indexed in JS Date's constructor, so 7 here means
    // August (the 8th month), matching what baseSlugForDate should
    // output as "08".
    const date = new Date(2026, 7, 11); // August 11, 2026
    expect(baseSlugForDate(date)).toBe("08112026");
  });

  it("pads single-digit months and days with a leading zero", () => {
    const date = new Date(2026, 0, 5); // January 5, 2026, both month and day are single digits
    expect(baseSlugForDate(date)).toBe("01052026"); // "01" and "05", not "1" and "5"
  });
});

describe("pickUniqueSlug", () => {
  it("returns the plain date slug when nothing collides", () => {
    const noExistingSlugs = new Set<string>(); // an empty set, nothing taken yet
    expect(pickUniqueSlug("08112026", noExistingSlugs)).toBe("08112026");
  });

  it("appends -2 when the plain date slug is already taken", () => {
    const oneRideAlreadyToday = new Set(["08112026"]); // the first ride of the day already has this slug
    expect(pickUniqueSlug("08112026", oneRideAlreadyToday)).toBe("08112026-2");
  });

  it("keeps counting up until it finds a free suffix", () => {
    // Simulates a day with three rides already created (the plain
    // slug, -2, and -3 are all taken), a fourth ride should land on -4.
    const threeRidesAlreadyToday = new Set(["08112026", "08112026-2", "08112026-3"]);
    expect(pickUniqueSlug("08112026", threeRidesAlreadyToday)).toBe("08112026-4");
  });
});
