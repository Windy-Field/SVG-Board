import type { Page } from "@playwright/test";
import { TEST_DIRECTORY } from "../../config/paths";

/** 截图和下载都放在同一个测试输出目录，避免再次写到项目根目录 */
export function testArtifact(filename: string): string {
  return TEST_DIRECTORY + "/" + filename;
}

/** 从实际弹出菜单切换存档，覆盖选择栏与选项点击流程 */
export async function selectArchive(page: Page, label: string): Promise<void> {
  await page.getByRole("combobox", { name: "画图存档", exact: true }).click();
  await page.getByRole("option", { name: label, exact: true }).click();
}
