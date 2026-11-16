import { chromium, expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { parseDocument } from "../../src/storage/document";
import type { Point } from "../../src/core/types";
import { readFileSync } from "node:fs";
import { selectArchive, testArtifact } from "./helpers";

// 测试浏览器通道由运行环境指定
const BROWSER_CHANNEL = process.env.PLAYWRIGHT_CHANNEL;

/** 从项目配置读取期望版本，避免测试和页面各自维护版本号 */
function readVersion(): string {
  const text = readFileSync(new URL("../../package.json", import.meta.url), "utf8");
  const packageInfo: unknown = JSON.parse(text);
  if (
    typeof packageInfo === "object" &&
    packageInfo !== null &&
    "version" in packageInfo &&
    typeof packageInfo.version === "string"
  ) {
    return packageInfo.version;
  }
  throw new Error("项目配置缺少版本号");
}

/** 读取本地保存的作品对象，等待自动保存完成 */
async function readSavedDocument(page: Page): Promise<string> {
  await page.waitForTimeout(450);
  /** 在浏览器中读取存储，返回字符串后由测试代码校验 */
  function getSaved(): string {
    return localStorage.getItem("svg-board-document-v1") || "";
  }
  return page.evaluate(getSaved);
}

/** 验证画图、撤销重做、保存恢复和下载，覆盖实际使用闭环 */
async function runEditorTest(page: Page): Promise<void> {
  const errors: string[] = [];
  /** 收集浏览器未捕获异常，避免界面看似正常但操作已失败 */
  function collectError(error: Error): void {
    errors.push(error.message);
  }
  page.on("pageerror", collectError);
  await page.goto("http://127.0.0.1:5173/");
  await expect(page.locator(".upper-canvas")).toBeVisible();
  await page.getByRole("button", { name: "新建画板", exact: true }).click();
  await page.getByRole("button", { name: "矩形", exact: true }).click();
  const canvas = page.locator(".upper-canvas");
  const bounds = await canvas.boundingBox();
  if (bounds === null) {
    throw new Error("画布未显示");
  }
  await page.mouse.move(bounds.x + 180, bounds.y + 180);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 320, bounds.y + 260, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator("#object-count")).toHaveText("1 个对象");
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(page.locator("#object-count")).toHaveText("0 个对象");
  await page.getByRole("button", { name: "重做", exact: true }).click();
  await expect(page.locator("#object-count")).toHaveText("1 个对象");
  const saved = await readSavedDocument(page);
  expect(saved).toContain('"kind":"rect"');
  await page.reload();
  await expect(page.locator("#object-count")).toHaveText("1 个对象");
  await page.getByRole("button", { name: "导出", exact: true }).click();
  await expect(page.getByRole("img", { name: "导出预览" })).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出 SVG", exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toContain(".svg");
  const savedPath = testArtifact("roundtrip.svg");
  await download.saveAs(savedPath);
  await page.getByRole("button", { name: "关闭导出", exact: true }).click();
  await page.locator("#file-input").setInputFiles(savedPath);
  await expect(page.locator("#object-count")).toHaveText("1 个对象");
  await page.getByRole("button", { name: "导出", exact: true }).click();
  const pngPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出 PNG", exact: true }).click();
  const png = await pngPromise;
  expect(png.suggestedFilename()).toContain(".png");
  await png.saveAs(testArtifact("roundtrip.png"));
  expect(errors).toEqual([]);
}
/** 手动创建浏览器，绕开测试框架对解构参数的要求 */
async function testEditor(): Promise<void> {
  const browser = await chromium.launch({ channel: BROWSER_CHANNEL });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await runEditorTest(page);
  } finally {
    await browser.close();
  }
}
test("绘图保存导出闭环", testEditor);

/** 验证常见窄屏宽度没有页面横向溢出，并记录实际画面 */
async function runResponsiveTest(page: Page): Promise<void> {
  const widths = [320, 375, 414, 768, 1280];
  for (const width of widths) {
    await page.setViewportSize({ width: width, height: 800 });
    await page.goto("http://127.0.0.1:5173/");
    await expect(page.locator(".upper-canvas")).toBeVisible();
    await selectArchive(page, "课程作业 · 提交流程");
    const clock = page.locator("#current-time");
    await expect(clock).toBeVisible();
    await expect(clock).toHaveText(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    await expect(page.locator("#app-version")).toHaveText("v" + readVersion());
    const sidebarButton = await page.locator("#inspector-button").boundingBox();
    expect(sidebarButton).not.toBeNull();
    if (sidebarButton !== null) {
      expect(sidebarButton.x + sidebarButton.width).toBeLessThanOrEqual(width);
    }
    /** 只检查页面宽度，画布内部平移不应导致整页滚动 */
    function hasOverflow(): boolean {
      return document.documentElement.scrollWidth > window.innerWidth;
    }
    expect(await page.evaluate(hasOverflow)).toBe(false);
    /** 常用屏幕高度应完整显示工具，较矮窗口仍允许正常滚动 */
    function toolbarFits(): boolean {
      const tools = document.querySelector(".tools");
      return tools instanceof HTMLElement && tools.scrollHeight <= tools.clientHeight;
    }
    expect(await page.evaluate(toolbarFits), "工具栏需完整显示，宽度 " + width).toBe(true);
    /** 检查画布中存在深色图形像素，不能仅凭 canvas 元素存在认定图形已显示 */
    function hasDrawing(): boolean {
      const canvas = document.querySelector(".lower-canvas");
      if (!(canvas instanceof HTMLCanvasElement)) {
        return false;
      }
      const context = canvas.getContext("2d");
      if (context === null) {
        return false;
      }
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let darkPixels = 0;
      for (let index = 0; index < pixels.length; index = index + 4) {
        if (
          pixels[index] < 230 &&
          pixels[index + 1] < 230 &&
          pixels[index + 2] < 230 &&
          pixels[index + 3] > 100
        ) {
          darkPixels = darkPixels + 1;
        }
      }
      return darkPixels > 10;
    }
    await page.waitForFunction(hasDrawing);
    await page.screenshot({ path: testArtifact("editor-" + width + ".png") });
  }
  const displayed = await page.locator("#current-time").textContent();
  if (displayed !== null) {
    await expect(page.locator("#current-time")).not.toHaveText(displayed);
  }
}
/** 在同一个浏览器中验证不同宽度，结束后释放浏览器进程 */
async function testResponsive(): Promise<void> {
  const browser = await chromium.launch({ channel: BROWSER_CHANNEL });
  try {
    const page = await browser.newPage();
    await runResponsiveTest(page);
  } finally {
    await browser.close();
  }
}
test("工作台响应式布局", testResponsive);

/** 把已知画板坐标转换为屏幕坐标，测试保持与适应画板的计算一致 */
async function boardPosition(page: Page, point: Point): Promise<Point> {
  const host = await page.locator("#canvas-host").boundingBox();
  if (host === null) {
    throw new Error("工作区未显示");
  }
  const canvas = page.locator("#canvas-host");
  const zoom = Number(await canvas.getAttribute("data-zoom"));
  const left = Number(await canvas.getAttribute("data-view-x"));
  const top = Number(await canvas.getAttribute("data-view-y"));
  return {
    x: host.x + left + point.x * zoom,
    y: host.y + top + point.y * zoom
  };
}

/** 拖动真实节点后验证模型连接端点更新，再验证几何顶点与中点联动 */
async function runRelationshipTest(page: Page): Promise<void> {
  const errors: string[] = [];
  /** 保存拖动过程中发生的错误，优先报告真实异常而不是存储超时 */
  function collectError(error: Error): void {
    errors.push(error.message);
  }
  page.on("pageerror", collectError);
  await page.goto("http://127.0.0.1:5173/");
  await expect(page.locator(".upper-canvas")).toBeVisible();
  await selectArchive(page, "课程作业 · 提交流程");
  await page.getByRole("button", { name: "适应画布", exact: true }).click();
  await page.getByRole("button", { name: "自动吸附", exact: true }).click();
  const position = await boardPosition(page, { x: 380, y: 238 });
  await page.mouse.move(position.x, position.y);
  await page.mouse.down();
  await page.mouse.move(position.x, position.y + 70, { steps: 10 });
  await page.mouse.up();
  await page.screenshot({ path: testArtifact("drag-diagnostic.png") });
  expect(errors).toEqual([]);
  await expect(page.locator("#save-status")).toHaveText("已保存到此浏览器");
  const flow = parseDocument(await readSavedDocument(page));
  expect(flow.shapes[2].y).toBeGreaterThan(300);
  expect(flow.shapes[7].height).not.toBe(0);
  await selectArchive(page, "几何作图 · 三角形中线");
  const vertex = await boardPosition(page, { x: 290, y: 570 });
  await page.mouse.move(vertex.x, vertex.y);
  await page.mouse.down();
  await page.mouse.move(vertex.x + 70, vertex.y - 40, { steps: 10 });
  await page.mouse.up();
  const geometry = parseDocument(await readSavedDocument(page));
  const moved = geometry.shapes[2];
  const midpoint = geometry.shapes[7];
  expect(moved.x).toBeGreaterThan(350);
  expect(midpoint.x).toBeCloseTo((moved.x + geometry.shapes[3].x) / 2, 4);
  expect(midpoint.y).toBeCloseTo((moved.y + geometry.shapes[3].y) / 2, 4);
  await page.screenshot({ path: testArtifact("geometry-desktop.png") });
}

/** 用独立浏览器保证关系测试不受到其他测试的自动恢复数据影响 */
async function testRelationships(): Promise<void> {
  const browser = await chromium.launch({ channel: BROWSER_CHANNEL });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await runRelationshipTest(page);
  } finally {
    await browser.close();
  }
}
test("节点与几何关系随拖动更新", testRelationships);

/** 验证连接线建立、原生画笔、文字与属性编辑都写入真实项目数据 */
async function runToolsTest(page: Page): Promise<void> {
  const errors: string[] = [];
  /** 收集工具操作中的异常 */
  function collectError(error: Error): void {
    errors.push(error.message);
  }
  page.on("pageerror", collectError);
  await page.goto("http://127.0.0.1:5173/");
  await expect(page.locator(".upper-canvas")).toBeVisible();
  await selectArchive(page, "课程作业 · 提交流程");
  await page.locator('[data-tool-group="lines"]').focus();
  await page.keyboard.press("ArrowDown");
  await page.getByRole("button", { name: "连接线", exact: true }).click();
  const start = await boardPosition(page, { x: 230, y: 262 });
  const end = await boardPosition(page, { x: 990, y: 472 });
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 10 });
  await page.mouse.up();
  await expect(page.locator("#object-count")).toHaveText("14 个对象");
  const connected = parseDocument(await readSavedDocument(page));
  expect(connected.shapes[13].relation.sources.length).toBe(2);
  await page.getByRole("button", { name: "自由画笔", exact: true }).click();
  const pencil = await boardPosition(page, { x: 200, y: 650 });
  await page.mouse.move(pencil.x, pencil.y);
  await page.mouse.down();
  await page.mouse.move(pencil.x + 70, pencil.y + 20, { steps: 10 });
  await page.mouse.move(pencil.x + 150, pencil.y - 10, { steps: 10 });
  await page.mouse.up();
  await expect(page.locator("#object-count")).toHaveText("15 个对象");
  const drawn = parseDocument(await readSavedDocument(page));
  expect(drawn.shapes[14].path.length).toBeGreaterThan(10);
  await page.getByRole("button", { name: "选择", exact: true }).click();
  await page.locator("#objects-tab").click();
  await page.getByRole("button", { name: "准备作业材料", exact: true }).click();
  await page.getByRole("button", { name: "属性", exact: true }).click();
  await page.getByRole("spinbutton", { name: "宽度", exact: true }).fill("240");
  await page.getByRole("spinbutton", { name: "宽度", exact: true }).press("Tab");
  const resized = parseDocument(await readSavedDocument(page));
  expect(resized.shapes[2].width).toBe(240);
  await page.getByRole("button", { name: "文字", exact: true }).click();
  const text = await boardPosition(page, { x: 800, y: 650 });
  await page.mouse.move(text.x, text.y);
  await page.mouse.down();
  await page.mouse.move(text.x + 130, text.y + 45, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.locator("#text-value").fill("测试文字");
  await page.getByRole("button", { name: "保存文字", exact: true }).click();
  const written = parseDocument(await readSavedDocument(page));
  expect(written.shapes[15].text).toBe("测试文字");
  expect(errors).toEqual([]);
}

/** 用真实浏览器执行新增工具闭环，结束后回收进程 */
async function testTools(): Promise<void> {
  const browser = await chromium.launch({ channel: BROWSER_CHANNEL });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await runToolsTest(page);
  } finally {
    await browser.close();
  }
}
test("连接线画笔文字与属性编辑", testTools);
