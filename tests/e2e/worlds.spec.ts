import { expect, test } from "@playwright/test";

test("shows the Worlds competition shell without mislabeling development data", async ({ page }) => {
  await page.goto("/worlds");
  await expect(page.getByRole("heading", { name: "Welcome to Worlds 2026" })).toBeVisible();
  const waitingForProvider = page.getByRole("heading", { name: "Waiting for the Worlds field" });
  const connectedTournament = page.locator("#standings").getByText("Worlds 2026", { exact: true });
  await expect(waitingForProvider.or(connectedTournament)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Worlds standings" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Stage leaders" })).toHaveCount(0);
  await expect(page.getByText("LCS Development Playoffs")).toHaveCount(0);
});

test("redirects anonymous visitors away from the operator console", async ({ page }) => {
  await page.goto("/ops/worlds");
  await expect(page).toHaveURL(/\/login\?next=%2Fops%2Fworlds|\/login\?next=\/ops\/worlds/);
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
});
