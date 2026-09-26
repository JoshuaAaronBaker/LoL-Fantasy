import { expect, test } from "@playwright/test";

test("shows the Worlds competition shell without mislabeling development data", async ({ page }) => {
  await page.goto("/worlds");
  await expect(page.getByRole("heading", { name: /One world/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Waiting for the Worlds field" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Worlds standings" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Stage leaders" })).toHaveCount(0);
  await expect(page.getByText("LCS Development Playoffs")).toHaveCount(0);
});
