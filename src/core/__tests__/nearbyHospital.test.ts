import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchNearestHospital } from "../nearbyHospital";

describe("fetchNearestHospital", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the closest named hospital when several are found", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          elements: [
            { lat: 33.42, lon: -111.83, tags: { name: "Far Hospital" } }, // further from 33.4152,-111.8315
            { lat: 33.4153, lon: -111.8316, tags: { name: "Near Hospital" } }, // very close
            { lat: 33.5, lon: -111.9, tags: {} }, // unnamed, should be skipped
          ],
        }),
      }),
    );

    const result = await fetchNearestHospital(33.4152, -111.8315);
    expect(result?.name).toBe("Near Hospital");
  });

  it("returns null when no elements are found", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ elements: [] }) }));
    expect(await fetchNearestHospital(33.4152, -111.8315)).toBeNull();
  });

  it("fails soft (returns null) on a non-ok response, never throws", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }));
    await expect(fetchNearestHospital(33.4152, -111.8315)).resolves.toBeNull();
  });

  it("fails soft (returns null) on a network error, never throws", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    await expect(fetchNearestHospital(33.4152, -111.8315)).resolves.toBeNull();
  });
});
