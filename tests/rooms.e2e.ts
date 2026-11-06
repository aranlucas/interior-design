import { test } from "@e2e-dev/web";
import { expect } from "e2e";

// Real browser -> HTTP -> isolated SQLite -> reload; no provider or production data.
test("creates, autosaves, renames and permanently deletes a room", async ({
  app,
  screen,
  browser,
}) => {
  await app.open("/rooms");
  await screen.getByRole("button", "Bedroom", { exact: true }).tap();
  await expect(screen.getByRole("combobox", "Room", { exact: true })).toContainText("Bedroom");
  await screen
    .getByRole("textbox", "Brief", { exact: true })
    .fill("Keep the oak floor and windows.");
  await expect(browser.locator(".panel-foot [role=status]")).toHaveText("Saved");
  await screen.getByRole("button", "Rename room", { exact: true }).tap();
  await screen.getByRole("textbox", "Name", { exact: true }).fill("Quiet bedroom");
  await screen.getByRole("button", "Save", { exact: true }).tap();
  await expect(screen.getByRole("combobox", "Room", { exact: true })).toContainText(
    "Quiet bedroom",
  );
  await browser.reload();
  await expect(screen.getByRole("textbox", "Brief", { exact: true })).toHaveValue(
    "Keep the oak floor and windows.",
  );
  await expect(screen.getByRole("combobox", "Room", { exact: true })).toContainText(
    "Quiet bedroom",
  );
  await browser.onDialog(async (dialog) => {
    await dialog.accept();
  });
  await screen.getByRole("button", "Delete room Quiet bedroom", { exact: true }).tap();
  await expect(screen.getByRole("heading", "New room", { exact: true })).toBeVisible();
  await browser.reload();
  await expect(screen.getByRole("heading", "New room", { exact: true })).toBeVisible();
  await expect(screen.getByRole("combobox", "Room", { exact: true })).toHaveCount(0);
});
