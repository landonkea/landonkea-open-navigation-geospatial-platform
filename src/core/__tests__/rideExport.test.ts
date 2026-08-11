// ── Unit tests for src/core/rideExport.ts ──────────────────────────

import { describe, expect, it } from "vitest";
import { samplesToCsv, samplesToGpx, type HistorySample } from "../rideExport";

const SAMPLES: HistorySample[] = [
  { participantId: "rider-a", lat: 33.42, lng: -111.83, recordedAt: "2026-08-11T10:01:00Z" },
  { participantId: "rider-b", lat: 33.41, lng: -111.82, recordedAt: "2026-08-11T10:00:00Z" },
  // out of order on purpose, to prove grouping/sorting actually happens rather than assuming clean input
  { participantId: "rider-a", lat: 33.43, lng: -111.84, recordedAt: "2026-08-11T10:00:00Z" },
];

describe("samplesToGpx", () => {
  it("builds one <trk> per participant", () => {
    const gpx = samplesToGpx("Test Ride", SAMPLES);
    expect(gpx.match(/<trk>/g)).toHaveLength(2); // rider-a and rider-b
  });

  it("orders each participant's points chronologically, not insertion order", () => {
    const gpx = samplesToGpx("Test Ride", SAMPLES);
    const riderATrack = gpx.split("<name>rider-a</name>")[1].split("</trk>")[0];
    const firstPointIndex = riderATrack.indexOf('lat="33.43"'); // recorded 10:00, should come first
    const secondPointIndex = riderATrack.indexOf('lat="33.42"'); // recorded 10:01, should come second
    expect(firstPointIndex).toBeGreaterThan(-1);
    expect(secondPointIndex).toBeGreaterThan(firstPointIndex);
  });

  it("produces a valid, trackless file for an empty ride rather than erroring", () => {
    const gpx = samplesToGpx("Empty Ride", []);
    expect(gpx).toContain("<gpx");
    expect(gpx).not.toContain("<trk>");
  });

  it("escapes special XML characters in the ride name", () => {
    const gpx = samplesToGpx('Ride & "Fun" <2026>', []);
    expect(gpx).toContain("Ride &amp; &quot;Fun&quot; &lt;2026&gt;");
  });
});

describe("samplesToCsv", () => {
  it("includes a header row and one data row per sample", () => {
    const csv = samplesToCsv(SAMPLES);
    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe("participant_id,lat,lng,recorded_at");
    expect(lines).toHaveLength(4); // header + 3 samples
  });

  it("groups a participant's rows together in chronological order", () => {
    const csv = samplesToCsv(SAMPLES);
    const lines = csv.trim().split("\n");
    const riderALines = lines.filter((l) => l.startsWith("rider-a"));
    expect(riderALines[0]).toContain("2026-08-11T10:00:00Z"); // earlier sample first
    expect(riderALines[1]).toContain("2026-08-11T10:01:00Z");
  });

  it("produces just the header for an empty ride", () => {
    const csv = samplesToCsv([]);
    expect(csv.trim()).toBe("participant_id,lat,lng,recorded_at");
  });
});
