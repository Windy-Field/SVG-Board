import type { Page } from "@playwright/test";

/** 从实际弹出菜单切换存档，覆盖选择栏与选项点击流程 */
export async function selectArchive(page: Page, label: string): Promise<void> {
  await page.getByRole("combobox", { name: "画图存档", exact: true }).click();
  await page.getByRole("option", { name: label, exact: true }).click();
}
