import { describe, expect, it } from "vitest";
import { computeRideRecapStats } from "../rideRecap";
import type { HistorySample } from "../rideExport";

function sample(participantId: string, lat: number, lng: number, recordedAt: string): HistorySample {
  return { participantId, lat, lng, recordedAt };
}

describe("computeRideRecapStats", () => {
  it("sums distance across multiple riders, not just one", () => {
    const samples: HistorySample[] = [
      sample("a", 33.4152, -111.8315, "2026-01-01T00:00:00Z"),
      sample("a", 33.4162, -111.8315, "2026-01-01T00:01:00Z"), // ~111m north
      sample("b", 0, 0, "2026-01-01T00:00:00Z"),
      sample("b", 1, 0, "2026-01-01T00:01:00Z"), // ~111195m north
    ];
    const stats = computeRideRecapStats(samples, null, null);
    expect(stats.riderCount).toBe(2);
    // Rider a's short hop plus rider b's much longer one, both counted.
    expect(stats.totalDistanceMeters).toBeGreaterThan(111000);
  });

  it("returns zero distance and one rider for a single stationary sample", () => {
    const stats = computeRideRecapStats([sample("a", 33.4152, -111.8315, "2026-01-01T00:00:00Z")], null, null);
    expect(stats.totalDistanceMeters).toBe(0);
    expect(stats.riderCount).toBe(1);
  });

  it("returns zero riders and zero distance for no samples at all", () => {
    const stats = computeRideRecapStats([], null, null);
    expect(stats.riderCount).toBe(0);
    expect(stats.totalDistanceMeters).toBe(0);
  });

  it("computes duration from started_at/ended_at when both are present", () => {
    const stats = computeRideRecapStats([], "2026-01-01T00:00:00Z", "2026-01-01T01:30:00Z");
    expect(stats.durationMs).toBe(90 * 60 * 1000);
  });

  it("returns a null duration when the ride never started or never ended", () => {
    expect(computeRideRecapStats([], null, "2026-01-01T01:00:00Z").durationMs).toBeNull();
    expect(computeRideRecapStats([], "2026-01-01T00:00:00Z", null).durationMs).toBeNull();
  });
});
