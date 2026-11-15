import { chromium, expect, test } from "@playwright/test";
import { pathToFileURL } from "node:url";
import path from "node:path";
import fs from "node:fs";

/** 直接打开项目根入口，验证构建后的编辑器无需服务器即可绘制和导出 */
async function testOffline(): Promise<void> {
  test.skip(!fs.existsSync("dist/editor.html"), "先运行 npm run build 生成离线文件");
  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errors: string[] = [];
    /** 收集本地文件加载和运行错误 */
    function collectError(error: Error): void {
      errors.push(error.message);
    }
    page.on("pageerror", collectError);
    await page.goto(pathToFileURL(path.resolve("index.html")).href);
    await expect(page.locator(".upper-canvas")).toBeVisible();
    await page.getByRole("button", { name: "新建画板", exact: true }).click();
    await page.getByRole("button", { name: "矩形", exact: true }).click();
    const box = await page.locator("#canvas-host").boundingBox();
    if (box === null) {
      throw new Error("离线画布未显示");
    }
    await page.mouse.move(box.x + 150, box.y + 150);
    await page.mouse.down();
    await page.mouse.move(box.x + 300, box.y + 250, { steps: 8 });
    await page.mouse.up();
    await expect(page.locator("#object-count")).toHaveText("1 个对象");
    await expect(page.getByRole("button", { name: "矩形", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    await page.getByRole("button", { name: "导出", exact: true }).click();
    await expect(page.getByRole("img", { name: "导出预览" })).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await browser.close();
  }
}

test("双击根入口离线绘图与导出", testOffline);
