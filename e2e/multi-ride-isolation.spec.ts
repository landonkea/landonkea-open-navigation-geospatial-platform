// ── e2e: two real, simultaneous rides don't leak data into each other ─
// WHAT THIS CHECKS: every ride-scoped query in this app filters by
// ride_id (see fetchParticipants()/fetchRouteForRide()/
// fetchHistorySamples() in src/core/adapters/supabase.ts), which was
// previously "true by construction, not independently stress-tested"
// (see OPERATIONS.md). This test actually exercises that with two
// real rides running at once: two independent browser sessions (not
// just two tabs sharing one, a real rider's phone and someone else's
// phone share nothing) join two different rides, and the test checks
// neither ride's roster or REST-level participant list ever shows the
// other ride's rider.
import { expect, test } from "@playwright/test";
import {
  countRiderParticipants,
  createTestAdminUser,
  deleteRide,
  deleteTestAdminUser,
  seedActiveRide,
} from "./localDb";

/** Clicks through the real join-choice/tag-picker screens as a rider, same steps as join-flow.spec.ts. */
async function joinAsRider(page: import("@playwright/test").Page): Promise<void> {
  await page.locator("#choice-ride").click();
  await page.locator("#tag-none").click();
  await expect(page.locator("#join-banner")).toHaveText("Joined, sharing your live location.", { timeout: 10_000 });
}

test("two simultaneous rides never mix participants", async ({ browser }) => {
  const adminUserId = await createTestAdminUser();
  const rideA = seedActiveRide("Isolation test A", adminUserId);
  const rideB = seedActiveRide("Isolation test B", adminUserId);

  // Separate browser contexts, not just separate pages/tabs in one
  // context, so this genuinely mirrors two different people's phones:
  // no shared cookies, localStorage, or device-id (see
  // src/core/participantId.ts), which a single shared context would
  // quietly share between "riders" and undermine the whole point of
  // this test.
  const contextA = await browser.newContext({
    geolocation: { latitude: 33.4152, longitude: -111.8315 },
    permissions: ["geolocation"],
  });
  const contextB = await browser.newContext({
    geolocation: { latitude: 34.0489, longitude: -111.0937 }, // a different real-world point, no relation to ride A's
    permissions: ["geolocation"],
  });

  try {
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    await pageA.goto(`/${rideA.slug}`);
    await pageB.goto(`/${rideB.slug}`);

    // Joining concurrently, not one after the other, is the actual
    // point: this is what could realistically expose a query missing
    // a ride_id filter (e.g. a poll for ride A racing a write to ride
    // B and somehow returning both).
    await Promise.all([joinAsRider(pageA), joinAsRider(pageB)]);

    // Database-level check: the real thing this test cares about,
    // using the exact same REST path the app itself polls.
    expect(countRiderParticipants(rideA.rideId)).toBe(1);
    expect(countRiderParticipants(rideB.rideId)).toBe(1);

    // UI-level check too: each ride's own roster panel should report
    // exactly one rider, not two, confirming the rendered view (not
    // just the raw query) stays correctly scoped.
    await pageA.locator("#roster-toggle").click();
    await expect(pageA.locator("#roster-panel .summary")).toContainText("1 riders joined");
    await pageB.locator("#roster-toggle").click();
    await expect(pageB.locator("#roster-panel .summary")).toContainText("1 riders joined");
  } finally {
    await contextA.close();
    await contextB.close();
    deleteRide(rideA.rideId);
    deleteRide(rideB.rideId);
    await deleteTestAdminUser(adminUserId);
  }
});
