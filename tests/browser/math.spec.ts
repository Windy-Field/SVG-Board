import { testArtifact } from "./helpers";
import { chromium, expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { createDocument, createShape } from "../../src/core/model";
import { parseDocument } from "../../src/storage/document";
import type { BoardDocument, Point } from "../../src/core/types";
import { COORDINATE_UNIT, toCanvasPoint } from "../../src/math/coordinates";
import { createFunctionShape } from "../../src/math/plots";
import { constructShape } from "../../src/core/commands";
import { getLinePoints } from "../../src/geometry/geometry";

// 浏览器通道沿用已有测试配置
const CHANNEL = process.env.PLAYWRIGHT_CHANNEL;

/** 每项数学交互使用独立作品与浏览器，运行异常同时报告 */
async function run(check: (page: Page) => Promise<void>): Promise<void> {
  const browser = await chromium.launch({ channel: CHANNEL });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors: string[] = [];
    /** 记录界面脚本异常 */
    function capture(error: Error): void {
      errors.push(error.message);
    }
    page.on("pageerror", capture);
    await check(page);
    expect(errors).toEqual([]);
  } finally {
    await browser.close();
  }
}

/** 初始化空白作品，不依赖内置存档和前一项测试 */
async function open(page: Page, document: BoardDocument = createDocument()): Promise<void> {
  /** 页面首次加载前写入作品 */
  function seed(text: string): void {
    localStorage.setItem("svg-board-document-v1", text);
  }
  await page.addInitScript(seed, JSON.stringify(document));
  await page.goto("http://127.0.0.1:5173/");
  await expect(page.locator(".upper-canvas")).toBeVisible();
}

/** 读取自动保存的项目并校验所有新增字段 */
async function saved(page: Page): Promise<BoardDocument> {
  await expect(page.locator("#save-status")).toHaveText("已保存到此浏览器");
  /** 从浏览器读取正式自动恢复内容 */
  function read(): string {
    return localStorage.getItem("svg-board-document-v1") || "";
  }
  return parseDocument(await page.evaluate(read));
}

/** 根据实际视口计算画布点的屏幕位置 */
async function screen(page: Page, point: Point): Promise<Point> {
  const canvas = page.locator("#canvas-host");
  const bounds = await canvas.boundingBox();
  if (bounds === null) {
    throw new Error("画布未显示");
  }
  const zoom = Number(await canvas.getAttribute("data-zoom"));
  return {
    x: bounds.x + Number(await canvas.getAttribute("data-view-x")) + point.x * zoom,
    y: bounds.y + Number(await canvas.getAttribute("data-view-y")) + point.y * zoom
  };
}

/** 使用分组菜单选择工具，不绕过实际入口 */
async function mode(page: Page, group: string, label: string): Promise<void> {
  await page.locator('[data-tool-group="' + group + '"]').focus();
  await page.keyboard.press("ArrowDown");
  await page.locator("#tool-menu").getByRole("button", { name: label, exact: true }).click();
}

/** 立即读取锁标记所在区域，不等待截图或额外的动画帧 */
function readLockPixels(position: Point): number {
  const host = window.document.getElementById("canvas-host");
  const canvas = window.document.querySelector(".lower-canvas");
  if (host === null || !(canvas instanceof HTMLCanvasElement)) {
    return 0;
  }
  const context = canvas.getContext("2d");
  if (context === null) {
    return 0;
  }
  const zoom = Number(host.dataset.zoom);
  const ratio = canvas.width / host.clientWidth;
  const left = (Number(host.dataset.viewX) + position.x * zoom - 10) * ratio;
  const top = (Number(host.dataset.viewY) + position.y * zoom - 20) * ratio;
  const pixels = context.getImageData(left, top, 18 * ratio, 20 * ratio).data;
  let dark = 0;
  for (let index = 0; index < pixels.length; index = index + 4) {
    if (pixels[index] < 140 && pixels[index + 1] < 150 && pixels[index + 2] < 170) {
      dark = dark + 1;
    }
  }
  return dark;
}

/** 从实际导出的 SVG 读取可见文字，不把项目元数据当成显示结果 */
async function readPreviewLabels(): Promise<string[]> {
  const image = window.document.querySelector("#export-preview img");
  if (!(image instanceof HTMLImageElement)) {
    return [];
  }
  const response = await fetch(image.src);
  const text = await response.text();
  const xml = new DOMParser().parseFromString(text, "image/svg+xml");
  const labels: string[] = [];
  for (const element of xml.querySelectorAll("text")) {
    const content = element.textContent || "";
    const normalized = content.replace(/\s+/g, " ");
    labels.push(normalized.trim());
  }
  return labels;
}

/** 坐标批量创建、数学坐标编辑和多对象透明度都写入作品 */
async function checkCoordinates(page: Page): Promise<void> {
  await open(page);
  await mode(page, "points", "坐标点");
  await page.getByRole("textbox", { name: "坐标列表" }).fill("0, 0\n2, 3\n-2, 1");
  await page.getByRole("button", { name: "创建", exact: true }).click();
  const created = await saved(page);
  expect(created.shapes.length).toBe(6);
  expect(created.shapes[0].name).toBe("A");
  expect(created.shapes[1].name).toBe("B");
  expect(created.shapes[2].name).toBe("C");
  expect(created.shapes[3].text).toBe("A");
  expect(created.shapes[1].x).toBe(toCanvasPoint({ x: 2, y: 3 }).x);
  const opacity = page.getByRole("slider", { name: "透明度", exact: true });
  await opacity.fill("0.4");
  await opacity.press("Tab");
  const styled = await saved(page);
  for (let index = 0; index < 3; index = index + 1) {
    expect(styled.shapes[index].opacity).toBe(0.4);
  }
  await page.locator("#objects-tab").click();
  await page.locator('[data-object-select="' + created.shapes[1].id + '"]').click();
  await page.locator("#properties-tab").click();
  const horizontal = page.getByRole("spinbutton", { name: "坐标 x", exact: true });
  await horizontal.fill("4");
  await horizontal.press("Tab");
  const moved = await saved(page);
  expect(moved.shapes[1].x).toBe(toCanvasPoint({ x: 4, y: 3 }).x);
}

/** 函数输入报错不创建半成品，样式、解析式、隐藏与恢复使用原有入口 */
async function checkFunction(page: Page): Promise<void> {
  await open(page);
  await page.getByRole("button", { name: "函数绘制", exact: true }).click();
  await page.getByRole("textbox", { name: "函数解析式", exact: true }).fill("x=2");
  await page.getByRole("button", { name: "创建", exact: true }).click();
  await expect(page.locator("#math-error")).not.toBeEmpty();
  await page.getByRole("textbox", { name: "函数解析式", exact: true }).fill("sin(x)");
  await page.getByRole("button", { name: "创建", exact: true }).click();
  await expect(page.locator("#math-dialog")).toBeHidden();
  const created = await saved(page);
  expect(created.shapes[0].kind).toBe("function");
  await page.getByRole("button", { name: "导出", exact: true }).click();
  expect(await page.evaluate(readPreviewLabels)).toContain("y = sin(x)");
  await page.getByRole("button", { name: "关闭导出", exact: true }).click();
  const opacity = page.getByRole("slider", { name: "透明度", exact: true });
  await opacity.fill("0.5");
  await opacity.press("Tab");
  const width = page.getByRole("slider", { name: "线宽", exact: true });
  await width.fill("4");
  await width.press("Tab");
  const expression = page.getByRole("textbox", { name: "函数解析式", exact: true });
  await expression.fill("cos(x)");
  await expression.press("Tab");
  const styled = await saved(page);
  expect(styled.shapes[0].opacity).toBe(0.5);
  expect(styled.shapes[0].strokeWidth).toBe(4);
  expect(styled.shapes[0].formula).toBeDefined();
  await page.locator(".upper-canvas").focus();
  await page.keyboard.press("Control+h");
  expect((await saved(page)).shapes[0].hidden).toBe(true);
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  expect((await saved(page)).shapes[0].hidden).toBe(false);
  await page.screenshot({ path: testArtifact("function-workspace.png") });
}

/** 多项式拟合支持直接输入点，移动来源后重新生成解析式 */
async function checkFit(page: Page): Promise<void> {
  await open(page);
  await page.getByRole("button", { name: "点拟合", exact: true }).click();
  await page.getByRole("textbox", { name: "坐标列表" }).fill("-1, 1\n0, 0\n1, 1");
  await page.getByRole("radio", { name: "多项式拟合", exact: true }).check();
  await page.getByRole("spinbutton", { name: "多项式阶数", exact: true }).fill("2");
  await page.getByRole("button", { name: "创建", exact: true }).click();
  const fitted = await saved(page);
  expect(fitted.shapes.length).toBe(7);
  expect(fitted.shapes[3].relation.kind).toBe("fit");
  await page.getByRole("button", { name: "导出", exact: true }).click();
  expect(await page.evaluate(readPreviewLabels)).toContain("y = x^2");
  await page.getByRole("button", { name: "关闭导出", exact: true }).click();
  const before = fitted.shapes[3].path;
  await page.locator("#objects-tab").click();
  await page.locator('[data-object-select="' + fitted.shapes[1].id + '"]').click();
  await page.locator("#properties-tab").click();
  const vertical = page.getByRole("spinbutton", { name: "坐标 y", exact: true });
  await vertical.fill("1");
  await vertical.press("Tab");
  const changed = await saved(page);
  expect(changed.shapes[3].path).not.toBe(before);
  await page.getByRole("button", { name: "导出", exact: true }).click();
  expect(await page.evaluate(readPreviewLabels)).toContain("y = 1");
  await page.getByRole("button", { name: "关闭导出", exact: true }).click();
  await page.screenshot({ path: testArtifact("fitted-function.png") });
}

/** 射线按两次点击确定端点与方向，坐标轴比例尺长度使用真实缩放 */
async function checkLinesAndScale(page: Page): Promise<void> {
  await open(page);
  await page.getByRole("button", { name: "自动吸附", exact: true }).click();
  await mode(page, "lines", "射线");
  const first = await screen(page, { x: 300, y: 300 });
  const second = await screen(page, { x: 450, y: 350 });
  await page.mouse.click(first.x, first.y);
  await page.mouse.click(second.x, second.y);
  const ray = await saved(page);
  expect(ray.shapes[0].lineType).toBe("ray");
  expect(ray.shapes[0].x).toBeCloseTo(300, 1);
  await mode(page, "lines", "直线");
  await page.mouse.click(first.x, first.y + 100);
  await page.mouse.click(second.x, second.y + 100);
  expect((await saved(page)).shapes[1].lineType).toBe("straight");
  const ruler = page.locator("#canvas-scale");
  const widths: number[] = [];
  for (const label of [
    "放大画布",
    "放大画布",
    "放大画布",
    "放大画布",
    "缩小画布",
    "缩小画布",
    "缩小画布",
    "缩小画布",
    "缩小画布",
    "缩小画布",
    "缩小画布"
  ]) {
    await page.getByRole("button", { name: label, exact: true }).click();
    const zoom = Number(await page.locator("#canvas-host").getAttribute("data-zoom"));
    const step = Number(await ruler.getAttribute("data-step"));
    const bounds = await ruler.boundingBox();
    if (bounds === null) {
      throw new Error("比例尺未显示");
    }
    expect(bounds.width).toBeCloseTo(step * COORDINATE_UNIT * zoom, 1);
    widths.push(step);
  }
  expect(Math.max.apply(null, widths)).toBeGreaterThan(Math.min.apply(null, widths));
  await page.getByRole("button", { name: "显示坐标轴", exact: true }).click();
  await expect(page.locator("#axes-button")).toHaveAttribute("aria-pressed", "false");
  await page.screenshot({ path: testArtifact("rays-and-lines.png") });
}

/** 空白区直接拖动和对象上长按均可平移，作品坐标保持不变 */
async function checkPanning(page: Page): Promise<void> {
  const document = createDocument();
  const rectangle = createShape("rect", { x: 400, y: 300 });
  rectangle.width = 200;
  rectangle.height = 120;
  document.shapes.push(rectangle);
  await open(page, document);
  const canvas = page.locator("#canvas-host");
  let before = Number(await canvas.getAttribute("data-view-x"));
  const blank = await screen(page, { x: 200, y: 200 });
  await page.mouse.move(blank.x, blank.y);
  await page.mouse.down();
  await expect(canvas).toHaveAttribute("data-panning", "true");
  await page.mouse.move(blank.x + 60, blank.y + 30, { steps: 6 });
  await page.mouse.up();
  expect(Number(await canvas.getAttribute("data-view-x"))).toBeCloseTo(before + 60, 1);
  before = Number(await canvas.getAttribute("data-view-x"));
  const center = await screen(page, { x: 500, y: 360 });
  await page.mouse.move(center.x, center.y);
  await page.mouse.down();
  await page.mouse.move(center.x + 6, center.y + 3);
  await page.waitForTimeout(550);
  await page.mouse.move(center.x + 80, center.y + 30, { steps: 6 });
  await page.mouse.up();
  expect(Number(await canvas.getAttribute("data-view-x"))).toBeCloseTo(before + 80, 1);
  await page.getByRole("button", { name: "保存项目", exact: true }).click();
  expect((await saved(page)).shapes[0].x).toBe(400);
  await page.getByRole("button", { name: "矩形", exact: true }).click();
  const origin = await screen(page, { x: 200, y: 200 });
  before = Number(await canvas.getAttribute("data-view-x"));
  await page.mouse.move(origin.x, origin.y);
  await page.mouse.down();
  await page.waitForTimeout(550);
  await page.mouse.move(origin.x + 50, origin.y + 20, { steps: 6 });
  await page.mouse.up();
  expect(Number(await canvas.getAttribute("data-view-x"))).toBeCloseTo(before + 50, 1);
  await page.getByRole("button", { name: "保存项目", exact: true }).click();
  expect((await saved(page)).shapes.length).toBe(1);
}

/** 检查点只沿原曲线或边框移动，关闭吸附和重开作品也不解除约束 */
async function checkPointSnap(page: Page): Promise<void> {
  const document = createDocument();
  const curve = createFunctionShape({
    expression: "0.325",
    minimum: -6,
    maximum: 6,
    degree: 0,
    coefficients: []
  });
  const rectangle = createShape("rect", { x: 300, y: 220 });
  rectangle.width = 120;
  rectangle.height = 100;
  document.shapes.push(curve, rectangle);
  await open(page, document);
  await page.getByRole("button", { name: "几何点", exact: true }).click();
  const position = await screen(page, toCanvasPoint({ x: 2, y: 0.4 }));
  await page.mouse.click(position.x, position.y);
  const created = await saved(page);
  const curvePoint = created.shapes[2];
  expect(curvePoint.relation.kind).toBe("point-on-outline");
  expect(curvePoint.relation.sources).toEqual([curve.id]);
  expect(created.shapes[2].y).toBeCloseTo(toCanvasPoint({ x: 2, y: 0.325 }).y, 1);
  await page.getByRole("button", { name: "选择", exact: true }).click();
  await page.locator("#snap-button").click();
  const curveStart = await screen(page, curvePoint);
  const curveTarget = await screen(page, { x: 438, y: 275 });
  await page.mouse.move(curveStart.x, curveStart.y);
  await page.mouse.down();
  await page.mouse.move(curveTarget.x, curveTarget.y, { steps: 8 });
  await page.mouse.up();
  const moved = await saved(page);
  expect(moved.shapes[2].x).toBeCloseTo(438, 1);
  expect(moved.shapes[2].y).toBeCloseTo(curvePoint.y, 1);
  expect(moved.shapes[2].relation.sources).toEqual([curve.id]);

  await page.getByRole("button", { name: "几何点", exact: true }).click();
  const borderStart = await screen(page, { x: 300, y: 265 });
  await page.mouse.click(borderStart.x, borderStart.y);
  const withBorder = await saved(page);
  const borderPoint = withBorder.shapes[4];
  expect(borderPoint.relation.sources).toEqual([rectangle.id]);
  await page.getByRole("button", { name: "选择", exact: true }).click();
  const borderTarget = await screen(page, { x: 245, y: 292 });
  await page.mouse.move(borderStart.x, borderStart.y);
  await page.mouse.down();
  await page.mouse.move(borderTarget.x, borderTarget.y, { steps: 8 });
  await page.mouse.up();
  const movedBorder = await saved(page);
  expect(movedBorder.shapes[4].x).toBeCloseTo(300, 1);
  expect(movedBorder.shapes[4].y).toBeCloseTo(292, 1);
  await page.keyboard.press("Shift+ArrowUp");
  const nudged = await saved(page);
  expect(nudged.shapes[4].y).toBeCloseTo(282, 1);
  expect(nudged.shapes[4].relation.sources).toEqual([rectangle.id]);

  await page.reload();
  await expect(page.locator("#object-count")).toHaveText("6 个对象");
  await page.locator("#objects-tab").click();
  await page.locator('[data-object-select="' + rectangle.id + '"]').click();
  await page.locator("#properties-tab").click();
  const horizontal = page.getByRole("spinbutton", { name: "X", exact: true });
  await horizontal.fill("340");
  await horizontal.press("Tab");
  const translated = await saved(page);
  expect(translated.shapes[4].x).toBeCloseTo(340, 1);
  expect(translated.shapes[4].y).toBeCloseTo(282, 1);
}

/** 平移时锁标记始终位于直线保存的方向点外框旁，不跟随裁剪边缘 */
async function checkLockPosition(page: Page): Promise<void> {
  const document = createDocument();
  const line = createShape("line", { x: 300, y: 320 });
  line.width = 250;
  line.height = 100;
  line.lineType = "straight";
  line.locked = true;
  document.shapes.push(line);
  await open(page, document);
  const start = await screen(page, { x: 200, y: 200 });
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.waitForTimeout(550);
  for (const offset of [30, 60, 90]) {
    await page.mouse.move(start.x + offset, start.y + offset / 2);
    expect(await page.evaluate(readLockPixels, { x: 550, y: 420 })).toBeGreaterThan(15);
    await page.screenshot({ path: testArtifact("lock-pan-" + offset + ".png") });
  }
  await page.mouse.up();
  for (let index = 0; index < 2; index = index + 1) {
    await page.getByRole("button", { name: "放大画布", exact: true }).click();
    expect(await page.evaluate(readLockPixels, { x: 550, y: 420 })).toBeGreaterThan(15);
  }
}

/** 来源点拖动过程中，锁定构造线的标记随方向点一起移动 */
async function checkDependentLock(page: Page): Promise<void> {
  const document = createDocument();
  const source = createShape("line", { x: 200, y: 200 });
  source.width = 300;
  const point = createShape("point", { x: 600, y: 400 });
  document.shapes.push(source, point);
  const line = constructShape(document, [source, point], "parallel");
  const endpoint = getLinePoints(line)[1];
  await open(page, document);
  await page.getByRole("button", { name: "自动吸附", exact: true }).click();
  const start = await screen(page, point);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  for (const distance of [20, 40, 60]) {
    await page.mouse.move(start.x + distance, start.y + distance);
    const expected = { x: endpoint.x + distance, y: endpoint.y + distance };
    expect(await page.evaluate(readLockPixels, expected)).toBeGreaterThan(15);
  }
  await page.mouse.up();
}

/** 坐标轴开启时放置点保留轴上坐标，关闭后再使用网格 */
async function checkAxisSnap(page: Page): Promise<void> {
  await open(page);
  await expect(page.locator('[data-geometry-icon="intersection"] path')).toHaveAttribute(
    "d",
    "M3 6l18 12M6 21L18 3"
  );
  await page.getByRole("button", { name: "几何点", exact: true }).click();
  let position = await screen(page, { x: 604, y: 313 });
  await page.mouse.click(position.x, position.y);
  const first = await saved(page);
  expect(first.shapes[0].x).toBe(600);
  expect(first.shapes[0].y).toBeCloseTo(313, 4);
  expect(first.shapes[0].name).toBe("A");
  await page.getByRole("button", { name: "显示坐标轴", exact: true }).click();
  position = await screen(page, { x: 604, y: 227 });
  await page.mouse.click(position.x, position.y);
  const next = await saved(page);
  expect(next.shapes[2].y).toBe(220);
  expect(next.shapes[2].name).toBe("B");
}

/** 执行批量坐标相关操作 */
async function testCoordinates(): Promise<void> {
  await run(checkCoordinates);
}
/** 执行函数绘制与属性操作 */
async function testFunction(): Promise<void> {
  await run(checkFunction);
}
/** 执行拟合与来源联动操作 */
async function testFit(): Promise<void> {
  await run(checkFit);
}
/** 执行射线直线与比例尺操作 */
async function testLinesAndScale(): Promise<void> {
  await run(checkLinesAndScale);
}
/** 执行空白和长按平移操作 */
async function testPanning(): Promise<void> {
  await run(checkPanning);
}
/** 执行几何点放置和拖动吸附 */
async function testPointSnap(): Promise<void> {
  await run(checkPointSnap);
}
/** 执行无限线锁标记的平移位置检查 */
async function testLockPosition(): Promise<void> {
  await run(checkLockPosition);
}
/** 执行来源点拖动时的锁标记同步检查 */
async function testDependentLock(): Promise<void> {
  await run(checkDependentLock);
}
/** 执行坐标轴吸附与交点图标检查 */
async function testAxisSnap(): Promise<void> {
  await run(checkAxisSnap);
}

/** 验证函数无穷端点、存档恢复与键盘连续调节滑块 */
async function checkInfiniteDomain(page: Page): Promise<void> {
  await open(page);
  await page.getByRole("button", { name: "函数绘制", exact: true }).click();
  await page.locator("#math-minimum").fill("-INF");
  await page.locator("#math-maximum").fill("+inf");
  await page.getByRole("button", { name: "创建", exact: true }).click();
  await expect(page.locator("#math-dialog")).toBeHidden();
  const created = await saved(page);
  const formula = created.shapes[0].formula;
  if (formula === undefined) {
    throw new Error("作品缺少函数定义");
  }
  expect(formula.minimum).toBe("-inf");
  expect(formula.maximum).toBe("inf");
  const opacity = page.getByRole("slider", { name: "透明度", exact: true });
  await opacity.press("ArrowLeft");
  await expect(opacity).toBeFocused();
  await opacity.press("ArrowLeft");
  expect((await saved(page)).shapes[0].opacity).toBe(0.98);
  await page.reload();
  await page.locator("#objects-tab").click();
  await page.locator('[data-object-select="' + created.shapes[0].id + '"]').click();
  await page.locator("#properties-tab").click();
  await expect(page.getByRole("textbox", { name: "结束 x", exact: true })).toHaveValue("inf");
}

/** 使用实际工作台验证无穷定义域和滑块 */
async function testInfiniteDomain(): Promise<void> {
  await run(checkInfiniteDomain);
}

test("普通函数保存无穷定义域且滑块支持连续方向键", testInfiniteDomain);
test("批量坐标点与透明度属性", testCoordinates);
test("函数绘制属性与快捷键隐藏", testFunction);
test("多项式拟合来源点联动", testFit);
test("射线直线与真实比例尺", testLinesAndScale);
test("空白直接平移与对象绘图长按平移", testPanning);
test("边框和曲线上的点不会脱离来源且保存后仍联动", testPointSnap);
test("锁标记平移时保持固定几何位置", testLockPosition);
test("锁标记随来源点拖动立即更新", testDependentLock);
test("坐标轴吸附与连续点名及交点图标", testAxisSnap);
