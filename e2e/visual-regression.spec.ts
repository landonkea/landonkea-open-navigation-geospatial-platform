// ── e2e: visual regression baseline for the tag-picker overlay ──────
// WHAT THIS CATCHES: join-flow.spec.ts already asserts the tag-picker
// is "reasonably full-screen" (a bounding-box height check), the exact
// assertion that would have caught OPERATIONS.md bug #19 (missing CSS
// left it a barely-visible ~71px sliver). This test goes further: a
// pixel-level screenshot comparison catches a DIFFERENT class of
// regression that bounding-box math can't, e.g. text color matching
// the background, a button rendering off-screen to the side, broken
// spacing/alignment, anything visually wrong that still happens to
// report a normal-looking box size.
//
// #map is masked out of the comparison (blacked out by Playwright, not
// excluded from the screenshot) since satellite/street tile imagery is
// fetched from a live network service and isn't pixel-stable between
// runs, that would make this test flaky for reasons having nothing to
// do with this app's own code.
import { expect, test } from "@playwright/test";
import { createTestAdminUser, deleteRide, deleteTestAdminUser, seedActiveRide } from "./localDb";

test("tag-picker screen matches its visual baseline", async ({ page }) => {
  const adminUserId = await createTestAdminUser();
  const { rideId, slug } = seedActiveRide("Visual regression test", adminUserId);

  try {
    await page.goto(`/${slug}`);
    // "Just watching", not "I'm riding": avoids needing a mocked
    // geolocation permission just to reach the same tag-picker screen,
    // the tag-picker itself is identical either way (see main.ts).
    await page.locator("#choice-watch").click();

    const tagPicker = page.locator("#tag-picker");
    await expect(tagPicker).toBeVisible();

    await expect(page).toHaveScreenshot("tag-picker.png", {
      mask: [page.locator("#map")],
      maxDiffPixelRatio: 0.02, // small allowance for anti-aliasing/font-rendering differences across machines
    });
  } finally {
    deleteRide(rideId);
    await deleteTestAdminUser(adminUserId);
  }
});
