import { chromium, expect, test } from "@playwright/test";
import { pathToFileURL } from "node:url";
import path from "node:path";
import fs from "node:fs";
import type { Route } from "@playwright/test";
import { BUILD_DIRECTORY } from "../../config/paths";

/** 使用普通 JSON 读取版本号，浏览器测试共用项目版本来源 */
function readVersion(): string {
  const value: unknown = JSON.parse(fs.readFileSync("package.json", "utf8"));
  if (
    typeof value === "object" &&
    value !== null &&
    "version" in value &&
    typeof value.version === "string"
  ) {
    return value.version;
  }
  throw new Error("项目配置缺少版本号");
}

/** 直接打开项目根入口，验证构建后的编辑器无需服务器即可绘制和导出 */
async function testOffline(): Promise<void> {
  test.skip(
    !fs.existsSync(path.join(BUILD_DIRECTORY, "editor.html")),
    "先运行 npm run build 生成离线文件"
  );
  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    /** 屏蔽开发服务探测，验证真实的离线文件回退路径 */
    async function disconnectRuntime(route: Route): Promise<void> {
      await route.abort();
    }
    await page.route("http://127.0.0.1:5173/__svg_board_runtime", disconnectRuntime);
    const errors: string[] = [];
    /** 收集本地文件加载和运行错误 */
    function collectError(error: Error): void {
      errors.push(error.message);
    }
    page.on("pageerror", collectError);
    await page.goto(pathToFileURL(path.resolve("index.html")).href);
    await expect(page.locator(".upper-canvas")).toBeVisible();
    expect(page.url()).toContain("file:///");
    await expect(page.locator("#app-version")).toHaveText("v" + readVersion());
    await expect(page.locator(".commandbar")).toHaveCount(0);
    await expect(page.locator('.archive-picker [data-action="new-archive"]')).toHaveCount(0);
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

/** 开发服务运行时，双击与手动访问使用相同网页和浏览器存档 */
async function testLiveEntry(): Promise<void> {
  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL });
  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(path.resolve("index.html")).href);
    await expect(page).toHaveURL("http://127.0.0.1:5173/editor.html");
    await expect(page.locator("#app-version")).toHaveText("v" + readVersion());
  } finally {
    await browser.close();
  }
}

test("双击入口优先连接当前开发页面", testLiveEntry);

/** 离线页面已经打开后，开发服务恢复时仍会自动切回同一入口 */
async function testLiveRecovery(): Promise<void> {
  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL });
  try {
    const page = await browser.newPage();
    /** 暂停探测以便先进入离线模式 */
    async function disconnectRuntime(route: Route): Promise<void> {
      await route.abort();
    }
    await page.route("http://127.0.0.1:5173/__svg_board_runtime", disconnectRuntime);
    await page.goto(pathToFileURL(path.resolve("index.html")).href);
    await expect(page.locator(".upper-canvas")).toBeVisible();
    expect(page.url()).toContain("file:///");
    await page.unroute("http://127.0.0.1:5173/__svg_board_runtime", disconnectRuntime);
    await expect(page).toHaveURL("http://127.0.0.1:5173/editor.html", { timeout: 10000 });
  } finally {
    await browser.close();
  }
}

test("离线页面自动切回恢复后的开发服务", testLiveRecovery);
