// ── Unit tests for src/core/geo.ts ─────────────────────────────────
// WHAT: verifies the GPS math and signal-status logic in isolation,
// no network, no database, no map library, just numbers in and
// numbers checked out. Follows the build prompt's TDD requirement for
// exactly this kind of logic ("easy to get subtly wrong and hard to
// verify just by looking at it").

import { describe, expect, it } from "vitest"; // Vitest's test-writing functions
import {
  distanceMeters,
  headingDegrees,
  signalStatus,
  speedMetersPerSecond,
  type GpsPoint,
} from "../geo";

// A small helper to build a GpsPoint without repeating every field
// name at every call site below, keeps each test focused on the one
// value that actually matters for that test.
function point(lat: number, lng: number, timestampMs = 0, accuracyM = 5): GpsPoint {
  return { lat, lng, accuracyM, timestampMs }; // just bundles the args into the expected shape
}

describe("distanceMeters", () => {
  it("returns 0 for the same point twice", () => {
    const a = point(33.4152, -111.8315); // an arbitrary Mesa, AZ coordinate
    expect(distanceMeters(a, a)).toBeCloseTo(0, 5); // no movement, no distance
  });

  it("matches the known meters-per-degree-of-latitude figure", () => {
    // One degree of latitude is a fixed, well-known distance
    // (independent of longitude), roughly 111,195 meters, this is a
    // good sanity check that isn't just testing the code against
    // itself.
    const a = point(0, 0); // the equator, arbitrary starting point
    const b = point(1, 0); // exactly 1 degree further north, same longitude
    expect(distanceMeters(a, b)).toBeCloseTo(111195, -2); // within ~100m of the known figure
  });
});

describe("speedMetersPerSecond", () => {
  it("computes distance divided by elapsed time", () => {
    const a = point(0, 0, 0); // start: time 0
    const b = point(1, 0, 10_000); // 1 degree north, 10 seconds later
    const expectedSpeed = distanceMeters(a, b) / 10; // reuse distanceMeters, already verified above
    expect(speedMetersPerSecond(a, b)).toBeCloseTo(expectedSpeed, 5);
  });

  it("returns 0 when the time gap is zero (guards divide-by-zero)", () => {
    const a = point(0, 0, 5000); // same timestamp as b
    const b = point(1, 0, 5000);
    expect(speedMetersPerSecond(a, b)).toBe(0); // no time elapsed, can't compute a real speed
  });

  it("returns 0 when points are out of chronological order", () => {
    const a = point(0, 0, 5000); // "later" point passed first
    const b = point(1, 0, 1000); // "earlier" point passed second
    expect(speedMetersPerSecond(a, b)).toBe(0); // negative elapsed time, treat as unknown, not negative speed
  });
});

describe("headingDegrees", () => {
  // Four cardinal-direction checks, the simplest, most verifiable
  // cases, if these are right, the underlying bearing math is sound.
  it("reads as 0 (north) when moving due north", () => {
    const a = point(0, 0);
    const b = point(1, 0); // higher latitude, same longitude
    expect(headingDegrees(a, b)).toBeCloseTo(0, 0);
  });

  it("reads as 90 (east) when moving due east", () => {
    const a = point(0, 0);
    const b = point(0, 1); // same latitude, higher longitude
    expect(headingDegrees(a, b)).toBeCloseTo(90, 0);
  });

  it("reads as 180 (south) when moving due south", () => {
    const a = point(1, 0);
    const b = point(0, 0); // lower latitude, same longitude
    expect(headingDegrees(a, b)).toBeCloseTo(180, 0);
  });

  it("reads as 270 (west) when moving due west", () => {
    const a = point(0, 1);
    const b = point(0, 0); // same latitude, lower longitude
    expect(headingDegrees(a, b)).toBeCloseTo(270, 0);
  });
});

describe("signalStatus", () => {
  const now = 1_000_000; // an arbitrary fixed "current time" for every test below

  it("is green for a recent, accurate update", () => {
    expect(signalStatus(now - 5_000, 10, now)).toBe("green"); // 5s old, 10m accuracy
  });

  it("is yellow for a recent update with degraded accuracy", () => {
    expect(signalStatus(now - 5_000, 40, now)).toBe("yellow"); // 5s old, but poor 40m accuracy
  });

  it("is red for a stale update, even if accuracy was good", () => {
    expect(signalStatus(now - 200_000, 5, now)).toBe("red"); // 200s old, well past the stale threshold
  });

  it("treats exactly-at-threshold staleness as still red (boundary check)", () => {
    expect(signalStatus(now - 90_001, 5, now)).toBe("red"); // 1ms past the 90s cutoff
  });

  it("treats exactly-at-threshold accuracy as still green (boundary check)", () => {
    expect(signalStatus(now - 5_000, 25, now)).toBe("green"); // exactly at the 25m cutoff, not over it
  });
});
