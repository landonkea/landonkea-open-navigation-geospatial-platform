// ── e2e: the real rider join flow, clicked through in a real browser ─
// This test exists to catch exactly the class of bug that unit tests
// structurally cannot: a screen that's present in the DOM and
// "clickable" by coordinate, but effectively invisible/unusable to a
// real person because its CSS is missing or broken. That's precisely
// what happened with the tag-picker screen (OPERATIONS.md bug #19):
// every earlier test called joinAsRider()/joinAsSpectator() directly,
// skipping the actual choice/tag-picker screens entirely, so a real
// rider's join silently stalled forever in production before anyone
// noticed. This test clicks the real buttons instead.
import { expect, test } from "@playwright/test";
import { countRiderParticipants, deleteRide, seedActiveRide } from "./localDb";

// A real GPS reading is needed for the "I'm riding" path to succeed
// (joinAsRider() requests actual geolocation), Playwright can mock
// this at the browser level rather than needing a real device.
test.use({
  geolocation: { latitude: 33.4152, longitude: -111.8315 }, // an arbitrary real-world point (Mesa, AZ, this project's first client)
  permissions: ["geolocation"],
});

test("a rider can join a ride through the real join-choice and tag-picker screens", async ({ page }) => {
  const { rideId, slug } = seedActiveRide("E2E join flow test");

  try {
    await page.goto(`/${slug}`);

    // The join-choice screen ("I'm riding" / "Just watching") should
    // actually be visible, not just present in the DOM, before we
    // interact with it.
    const joinChoice = page.locator("#join-choice");
    await expect(joinChoice).toBeVisible();
    await page.locator("#choice-ride").click();

    // This is the exact assertion that would have caught bug #19: the
    // tag-picker overlay is supposed to be full-screen (`inset: 0`),
    // not a barely-visible sliver. Checking only `toBeVisible()` isn't
    // enough, an element with `display: block` and no sizing can still
    // pass that check while being visually broken, so this also checks
    // its rendered height is a real fraction of the viewport.
    const tagPicker = page.locator("#tag-picker");
    await expect(tagPicker).toBeVisible();
    const box = await tagPicker.boundingBox();
    const viewportHeight = page.viewportSize()?.height ?? 0;
    expect(box, "tag-picker should have a real bounding box, not be collapsed").not.toBeNull();
    expect(
      box!.height,
      `tag-picker should be full-screen-ish (>50% of viewport height), got ${box!.height}px, ` +
        `a small height like this is exactly how bug #19 (missing CSS) looked`,
    ).toBeGreaterThan(viewportHeight * 0.5);

    await page.locator("#tag-none").click(); // skip the optional tag, not what this test is about

    // A real join actually happened: the banner reflects it, and the
    // database has a real participant row, not just a UI that looks
    // right, mirroring how bug #19 was actually confirmed fixed
    // (checked the database directly, not only the screen).
    await expect(page.locator("#join-banner")).toHaveText("Joined, sharing your live location.", {
      timeout: 10_000,
    });
    expect(countRiderParticipants(rideId)).toBe(1);
  } finally {
    deleteRide(rideId); // cascades to the participant row too
  }
});
