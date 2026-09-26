import { expect, test } from "@playwright/test";

test("registers, restores a draft, submits a lineup, and logs back in", async ({ page }) => {
  const username = `player_${Date.now()}`;
  const password = "fantasy-test-2026";

  await page.goto("/register?next=/play/lcs-dev-playoffs");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/play\/lcs-dev-playoffs$/);
  await expect(page.getByRole("heading", { name: /LCS Development/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /Submit lineup/i })).toBeDisabled();

  await page.getByRole("button", { name: "TOP", exact: true }).click();
  await page.selectOption("select[aria-label='Sort players']", "priceAsc");
  await page.locator("button:not([disabled])", { hasText: "Add" }).first().click();
  await expect.poll(() => page.evaluate(() => Object.values(localStorage).some((value) => value.includes('"TOP"')))).toBe(true);
  await page.reload();
  await expect(page.getByText("Local draft restored.")).toBeVisible();

  for (const role of ["JUNGLE", "MID", "BOT", "SUPPORT"]) {
    await page.getByRole("button", { name: role, exact: true }).click();
    await page.selectOption("select[aria-label='Sort players']", "priceAsc");
    await page.locator("button:not([disabled])", { hasText: "Add" }).first().click();
  }
  await page.getByTitle("Make captain").first().click();
  await page.getByRole("button", { name: /Submit lineup/i }).click();
  await expect(page.getByText(/Lineup saved/)).toBeVisible();
  await page.getByRole("link", { name: "Leaderboard" }).click();
  await expect(page).toHaveURL(/\/play\/lcs-dev-playoffs\/leaderboard$/);
  await expect(page.locator("summary").getByText(username)).toBeVisible();
  await expect(page.getByText("Opponent lineups are hidden until lock.")).toBeVisible();

  await page.getByLabel("Log out").click();
  await expect(page).toHaveURL("/");
  await page.goto("/login?next=/play/lcs-dev-playoffs");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/play\/lcs-dev-playoffs$/);
  await expect(page.getByText("Saved lineup loaded.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Update lineup" })).toBeEnabled();
});
