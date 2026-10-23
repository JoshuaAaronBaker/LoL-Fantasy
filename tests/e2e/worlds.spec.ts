import { expect, test } from "@playwright/test";

test("reports database health and sends production security headers", async ({ page, request }) => {
  const health = await request.get("/api/health");
  expect(health.status()).toBe(200);
  expect(await health.json()).toMatchObject({ status: "ok", database: "reachable" });

  const response = await page.goto("/");
  expect(response?.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(response?.headers()["x-content-type-options"]).toBe("nosniff");
});

test("shows the Worlds competition shell without mislabeling development data", async ({ page }) => {
  await page.goto("/worlds");
  await expect(page.getByRole("heading", { name: "Welcome to Worlds 2026" })).toBeVisible();
  const waitingForProvider = page.getByRole("heading", { name: "Waiting for the Worlds field" });
  const connectedTournament = page.locator("#standings").getByText("Worlds 2026", { exact: true });
  await expect(waitingForProvider.or(connectedTournament)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Worlds standings" })).toBeVisible();
  await expect(page.getByText("LCS Development Playoffs")).toHaveCount(0);
});

test("redirects anonymous visitors away from the operator console", async ({ page }) => {
  await page.goto("/ops/worlds");
  await expect(page).toHaveURL(/\/login\?next=%2Fops%2Fworlds|\/login\?next=\/ops\/worlds/);
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
});
