// ── Unit tests for src/core/csvImport.ts ───────────────────────────

import { describe, expect, it } from "vitest";
import { parseHistoryCsv, parseRouteCsv } from "../csvImport";

describe("parseHistoryCsv", () => {
  it("parses a well-formed history export back into samples", () => {
    const csv = [
      "participant_id,lat,lng,recorded_at",
      "rider-a,33.42,-111.83,2026-08-11T10:00:00Z",
      "rider-b,33.41,-111.82,2026-08-11T10:01:00Z",
    ].join("\n");
    const result = parseHistoryCsv(csv);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      participantId: "rider-a",
      lat: 33.42,
      lng: -111.83,
      recordedAt: "2026-08-11T10:00:00Z",
    });
  });

  it("skips a malformed row rather than failing the whole file", () => {
    const csv = [
      "participant_id,lat,lng,recorded_at",
      "rider-a,33.42,-111.83,2026-08-11T10:00:00Z",
      "rider-b,not-a-number,-111.82,2026-08-11T10:01:00Z",
      "rider-c,33.40,-111.81,2026-08-11T10:02:00Z",
    ].join("\n");
    const result = parseHistoryCsv(csv);
    expect(result).toHaveLength(2); // the malformed middle row is skipped, not fatal
  });

  it("throws a plain-language error when nothing usable is found", () => {
    expect(() => parseHistoryCsv("participant_id,lat,lng,recorded_at")).toThrow(/No usable rows/);
  });
});

describe("parseRouteCsv", () => {
  it("builds a LineString route from lat,lng rows with no waypoints", () => {
    const csv = ["lat,lng,name", "33.42,-111.83,", "33.43,-111.84,", "33.44,-111.85,"].join("\n");
    const result = parseRouteCsv(csv);
    const route = result.features.find((f) => f.properties?.kind === "route");
    expect(route?.geometry).toEqual({
      type: "LineString",
      coordinates: [
        [-111.83, 33.42],
        [-111.84, 33.43],
        [-111.85, 33.44],
      ],
    });
    const waypoints = result.features.filter((f) => f.properties?.kind === "waypoint");
    expect(waypoints).toHaveLength(0);
  });

  it("treats a row with a name as also being a named waypoint", () => {
    const csv = ["lat,lng,name", "33.42,-111.83,", "33.43,-111.84,Rest Stop", "33.44,-111.85,"].join("\n");
    const result = parseRouteCsv(csv);
    const waypoints = result.features.filter((f) => f.properties?.kind === "waypoint");
    expect(waypoints).toHaveLength(1);
    expect(waypoints[0].properties?.name).toBe("Rest Stop");
  });

  it("throws a plain-language error with fewer than 2 valid points", () => {
    expect(() => parseRouteCsv("lat,lng,name\n33.42,-111.83,")).toThrow(/at least 2/);
  });
});
