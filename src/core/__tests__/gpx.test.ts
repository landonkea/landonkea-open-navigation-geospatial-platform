// ── Unit tests for src/core/gpx.ts ─────────────────────────────────

import { describe, expect, it } from "vitest";
import { parseGpx } from "../gpx";

// A small, real-shaped GPX file (the same format Strava/RideWithGPS
// export), three track points forming a route plus one named waypoint.
const SAMPLE_GPX = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1">
  <wpt lat="33.4200" lon="-111.9200">
    <name>Rest Stop</name>
  </wpt>
  <trk>
    <trkseg>
      <trkpt lat="33.4152" lon="-111.8315"></trkpt>
      <trkpt lat="33.4200" lon="-111.8400"></trkpt>
      <trkpt lat="33.4250" lon="-111.8500"></trkpt>
    </trkseg>
  </trk>
</gpx>`;

describe("parseGpx", () => {
  it("extracts the route line from track points, in [lng, lat] order", () => {
    const result = parseGpx(SAMPLE_GPX);
    const routeFeature = result.features.find((f) => f.properties?.kind === "route");
    expect(routeFeature).toBeDefined();
    expect(routeFeature?.geometry.type).toBe("LineString");
    if (routeFeature?.geometry.type === "LineString") {
      expect(routeFeature.geometry.coordinates).toEqual([
        [-111.8315, 33.4152], // note: [lng, lat], the reverse of GPX's lat/lon attribute order
        [-111.84, 33.42],
        [-111.85, 33.425],
      ]);
    }
  });

  it("extracts named waypoints separately from the route", () => {
    const result = parseGpx(SAMPLE_GPX);
    const waypointFeature = result.features.find((f) => f.properties?.kind === "waypoint");
    expect(waypointFeature).toBeDefined();
    expect(waypointFeature?.properties?.name).toBe("Rest Stop");
    expect(waypointFeature?.geometry).toEqual({ type: "Point", coordinates: [-111.92, 33.42] });
  });

  it("handles a GPX file with no waypoints gracefully (build prompt's exact case)", () => {
    const noWaypoints = `<?xml version="1.0"?><gpx version="1.1"><trk><trkseg>
      <trkpt lat="33.0" lon="-111.0"></trkpt>
      <trkpt lat="33.1" lon="-111.1"></trkpt>
    </trkseg></trk></gpx>`;
    const result = parseGpx(noWaypoints);
    const waypoints = result.features.filter((f) => f.properties?.kind === "waypoint");
    expect(waypoints).toHaveLength(0); // no waypoints, not an error
    const route = result.features.find((f) => f.properties?.kind === "route");
    expect(route).toBeDefined(); // route line still extracted fine
  });

  it("throws a plain-language error for genuinely malformed XML, doesn't crash silently", () => {
    expect(() => parseGpx("this is not xml at all <<<")).toThrow(/valid GPX file/);
  });

  it("doesn't produce a route line from a single stray point (needs at least 2 to form a line)", () => {
    const onePoint = `<?xml version="1.0"?><gpx version="1.1"><trk><trkseg>
      <trkpt lat="33.0" lon="-111.0"></trkpt>
    </trkseg></trk></gpx>`;
    const result = parseGpx(onePoint);
    const route = result.features.find((f) => f.properties?.kind === "route");
    expect(route).toBeUndefined();
  });
});
