import { chromium, expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { parseDocument, STORAGE_KEY } from "../../src/storage/document";
import { createDocument, createShape } from "../../src/core/model";
import type { BoardDocument, Point, Shape } from "../../src/core/types";

// 测试浏览器通道由运行环境指定
const BROWSER_CHANNEL = process.env.PLAYWRIGHT_CHANNEL;
// 交互测试使用的开发服务地址
const APP_URL = "http://127.0.0.1:5173/";

/** 在新浏览器页面中预置作品，复现测试所需的几何与锁定条件 */
async function openDocument(page: Page, document: BoardDocument): Promise<void> {
  /** 页面加载前写入测试作品，避免与首次默认模板混淆 */
  function installDocument(value: { key: string; text: string }): void {
    localStorage.setItem(value.key, value.text);
  }
  await page.addInitScript(installDocument, { key: STORAGE_KEY, text: JSON.stringify(document) });
  await page.goto(APP_URL);
  await expect(page.locator(".upper-canvas")).toBeVisible();
  await page.getByRole("button", { name: "自动吸附", exact: true }).click();
  await page.getByRole("button", { name: "适应画布", exact: true }).click();
}

/** 将作品坐标换算为当前适应画板时的屏幕坐标 */
async function screenPoint(page: Page, point: Point): Promise<Point> {
  const host = await page.locator("#canvas-host").boundingBox();
  if (host === null) {
    throw new Error("画布未显示");
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

/** 等待一次自动保存，再用项目解析器读取结果 */
async function savedDocument(page: Page): Promise<BoardDocument> {
  await expect(page.locator("#save-status")).toHaveText("已保存到此浏览器");
  /** 只从本项目存储键读取作品文本 */
  function readSaved(): string {
    return localStorage.getItem("svg-board-document-v1") || "";
  }
  return parseDocument(await page.evaluate(readSaved));
}

/** 创建一个方便点击和拖动的矩形测试对象 */
function rectangle(name: string, left: number, top: number): Shape {
  const shape = createShape("rect", { x: left, y: top });
  shape.name = name;
  shape.width = 140;
  shape.height = 90;
  return shape;
}

/** 通过真实鼠标完成一次拖动 */
async function drag(page: Page, start: Point, end: Point): Promise<void> {
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await page.mouse.up();
}

/** 验证连续绘制保留工具，主动切回选择后可以拖动和取消变换 */
async function runDrawSelect(page: Page): Promise<void> {
  await openDocument(page, createDocument());
  await page.getByRole("button", { name: "矩形", exact: true }).click();
  const start = await screenPoint(page, { x: 200, y: 200 });
  const end = await screenPoint(page, { x: 400, y: 340 });
  await drag(page, start, end);
  await expect(page.getByRole("button", { name: "矩形", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true"
  );
  await expect(page.locator("#selection-count")).toHaveText("已选择 1");
  const first = await savedDocument(page);
  const nextStart = await screenPoint(page, { x: 600, y: 400 });
  const nextEnd = await screenPoint(page, { x: 720, y: 500 });
  await drag(page, nextStart, nextEnd);
  await expect(page.locator("#object-count")).toHaveText("2 个对象");
  await expect(page.getByRole("button", { name: "矩形", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true"
  );
  await page.getByRole("button", { name: "选择", exact: true }).click();
  const center = await screenPoint(page, { x: 300, y: 270 });
  await drag(page, center, { x: center.x + 50, y: center.y + 35 });
  const moved = await savedDocument(page);
  expect(moved.shapes.length).toBe(2);
  expect(moved.shapes[0].x).toBeGreaterThan(first.shapes[0].x + 40);
  const dragCenter = await screenPoint(page, {
    x: moved.shapes[0].x + 100,
    y: moved.shapes[0].y + 70
  });
  await page.mouse.move(dragCenter.x, dragCenter.y);
  await page.mouse.down();
  await page.mouse.move(dragCenter.x + 80, dragCenter.y + 10, { steps: 5 });
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await page.mouse.click(dragCenter.x, dragCenter.y);
  await expect(page.getByRole("spinbutton", { name: "X", exact: true })).toHaveValue(
    String(Math.round(moved.shapes[0].x * 100) / 100)
  );
}

/** 验证线条包围框里的空白区域不会抢走下方矩形的选择 */
async function runPreciseSelection(page: Page): Promise<void> {
  const document = createDocument();
  const shape = rectangle("背景矩形", 300, 140);
  const line = createShape("line", { x: 100, y: 100 });
  line.width = 500;
  line.height = 400;
  line.layer = 1;
  document.shapes.push(shape, line);
  await openDocument(page, document);
  const emptyArea = await screenPoint(page, { x: 370, y: 180 });
  await page.mouse.click(emptyArea.x, emptyArea.y);
  await expect(page.getByRole("textbox", { name: "对象名称", exact: true })).toHaveValue(
    "背景矩形"
  );
  const stroke = await screenPoint(page, { x: 250, y: 220 });
  await page.mouse.click(stroke.x, stroke.y);
  await expect(page.getByRole("textbox", { name: "对象名称", exact: true })).toHaveValue("线段");
}

/** 验证 Shift 多选拖动整体保持间距，加入锁定对象后整个选区不再变形 */
async function runMultiSelection(page: Page): Promise<void> {
  const document = createDocument();
  const first = rectangle("甲", 150, 200);
  const second = rectangle("乙", 450, 200);
  const locked = rectangle("锁定", 800, 200);
  locked.locked = true;
  document.shapes.push(first, second, locked);
  await openDocument(page, document);
  const firstCenter = await screenPoint(page, { x: 220, y: 245 });
  const secondCenter = await screenPoint(page, { x: 520, y: 245 });
  await page.mouse.click(firstCenter.x, firstCenter.y);
  await page.keyboard.down("Shift");
  await page.mouse.click(secondCenter.x, secondCenter.y);
  await page.keyboard.up("Shift");
  await expect(page.locator("#selection-count")).toHaveText("已选择 2");
  await drag(page, firstCenter, { x: firstCenter.x + 40, y: firstCenter.y + 40 });
  const moved = await savedDocument(page);
  expect(moved.shapes[1].x - moved.shapes[0].x).toBeCloseTo(300, 4);
  expect(moved.shapes[0].x).toBeGreaterThan(190);
  const lockCenter = await screenPoint(page, { x: 870, y: 245 });
  await page.keyboard.down("Shift");
  await page.mouse.click(lockCenter.x, lockCenter.y);
  await page.keyboard.up("Shift");
  await expect(page.locator("#selection-count")).toHaveText("已选择 3");
  const newCenter = await screenPoint(page, {
    x: moved.shapes[0].x + 70,
    y: moved.shapes[0].y + 45
  });
  await drag(page, newCenter, { x: newCenter.x + 50, y: newCenter.y + 20 });
  const after = await savedDocument(page);
  expect(after.shapes).toEqual(moved.shapes);
}

/** 验证按住空格拖动画布不会移动所选图形，松开后能继续拖动图形 */
async function runPanSelection(page: Page): Promise<void> {
  const document = createDocument();
  document.shapes.push(rectangle("平移测试", 300, 200));
  await openDocument(page, document);
  const center = await screenPoint(page, { x: 370, y: 245 });
  await page.mouse.click(center.x, center.y);
  await page.keyboard.down("Space");
  await drag(page, center, { x: center.x + 80, y: center.y + 30 });
  await page.keyboard.up("Space");
  await expect(page.locator("#selection-count")).toHaveText("已选择 1");
  await expect(page.getByRole("spinbutton", { name: "X", exact: true })).toHaveValue("300");
  await expect(page.getByRole("spinbutton", { name: "Y", exact: true })).toHaveValue("200");
  const shifted = { x: center.x + 80, y: center.y + 30 };
  await drag(page, shifted, { x: shifted.x + 30, y: shifted.y + 25 });
  const moved = await savedDocument(page);
  expect(moved.shapes[0].x).toBeCloseTo(330, 4);
}

/** 检查 Shift 左键框选后的组合拖动，普通空白拖动保留给平移 */
async function runGroupSelection(page: Page): Promise<void> {
  const document = createDocument();
  document.shapes.push(rectangle("甲", 150, 200), rectangle("乙", 450, 200));
  await openDocument(page, document);
  const topLeft = await screenPoint(page, { x: 110, y: 160 });
  const bottomRight = await screenPoint(page, { x: 640, y: 330 });
  await page.keyboard.down("Shift");
  await drag(page, topLeft, bottomRight);
  await page.keyboard.up("Shift");
  await expect(page.locator("#selection-count")).toHaveText("已选择 2");
  await page.getByRole("button", { name: "组合", exact: true }).click();
  await page.keyboard.press("Escape");
  const center = await screenPoint(page, { x: 220, y: 245 });
  await drag(page, center, { x: center.x + 40, y: center.y + 20 });
  const moved = await savedDocument(page);
  expect(moved.shapes[0].x).toBeCloseTo(190, 4);
  expect(moved.shapes[1].x - moved.shapes[0].x).toBeCloseTo(300, 4);
  await expect(page.locator("#selection-count")).toHaveText("已选择 2");
}

/** 检查控制点缩放和旋转不会改变选中对象，保存结果与画面一致 */
async function runControls(page: Page): Promise<void> {
  const document = createDocument();
  const shape = rectangle("控制点", 300, 200);
  document.shapes.push(shape);
  await openDocument(page, document);
  const center = await screenPoint(page, { x: 370, y: 245 });
  await page.mouse.click(center.x, center.y);
  const bottomRight = await screenPoint(page, { x: 440, y: 290 });
  // 选择控制点在对象边界外另有描边和间距，按实际画板缩放补偿屏幕位置
  const corner = { x: bottomRight.x + 5, y: bottomRight.y + 5 };
  await drag(page, corner, { x: corner.x + 45, y: corner.y + 30 });
  const resized = await savedDocument(page);
  expect(resized.shapes[0].width).toBeGreaterThan(170);
  expect(resized.shapes[0].height).toBeGreaterThan(105);
  const current = resized.shapes[0];
  const topCenter = await screenPoint(page, { x: current.x + current.width / 2, y: current.y });
  const rotate = { x: topCenter.x, y: topCenter.y - 45 };
  const objectCenter = await screenPoint(page, {
    x: current.x + current.width / 2,
    y: current.y + current.height / 2
  });
  await drag(page, rotate, { x: objectCenter.x + 100, y: objectCenter.y });
  const rotated = await savedDocument(page);
  expect(Math.abs(rotated.shapes[0].rotation)).toBeGreaterThan(30);
  await expect(page.locator("#selection-count")).toHaveText("已选择 1");
  await page.screenshot({ path: "test-results/selection-controls.png" });
}

/** 在水平、垂直和反向线条中间拖动，不能误触缩放手柄或改变线的方向 */
async function runStrokeDragging(page: Page): Promise<void> {
  const document = createDocument();
  const horizontal = createShape("line", { x: 200, y: 200 });
  horizontal.width = 300;
  const vertical = createShape("line", { x: 750, y: 160 });
  vertical.height = 240;
  const arrow = createShape("arrow", { x: 200, y: 500 });
  arrow.width = 300;
  const reverse = createShape("arrow", { x: 1000, y: 650 });
  reverse.width = -260;
  reverse.height = -180;
  document.shapes.push(horizontal, vertical, arrow, reverse);
  await openDocument(page, document);
  for (let index = 0; index < document.shapes.length; index = index + 1) {
    const original = document.shapes[index];
    const midpoint = await screenPoint(page, {
      x: original.x + original.width / 2,
      y: original.y + original.height / 2
    });
    await page.mouse.click(midpoint.x, midpoint.y);
    await expect(page.locator("#selection-count")).toHaveText("已选择 1");
    await drag(page, midpoint, { x: midpoint.x + 35, y: midpoint.y + 25 });
    const moved = await savedDocument(page);
    expect(moved.shapes[index].x).toBeGreaterThan(original.x + 25);
    expect(moved.shapes[index].y).toBeGreaterThan(original.y + 20);
    expect(moved.shapes[index].width).toBeCloseTo(original.width, 4);
    expect(moved.shapes[index].height).toBeCloseTo(original.height, 4);
    expect(moved.shapes[index].rotation).toBeCloseTo(0, 4);
  }
}

/** 在独立浏览器中运行交互回归，并统一检查浏览器异常 */
async function runInteraction(check: (page: Page) => Promise<void>): Promise<void> {
  const browser = await chromium.launch({ channel: BROWSER_CHANNEL });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errors: string[] = [];
    /** 保存事件循环中未捕获的异常，防止仅通过界面断言漏掉错误 */
    function collectError(error: Error): void {
      errors.push(error.message);
    }
    page.on("pageerror", collectError);
    await check(page);
    expect(errors).toEqual([]);
  } finally {
    await browser.close();
  }
}

/** 检查画完选中与取消变换 */
async function testDrawSelect(): Promise<void> {
  await runInteraction(runDrawSelect);
}

/** 检查细线命中 */
async function testPreciseSelection(): Promise<void> {
  await runInteraction(runPreciseSelection);
}

/** 检查多选约束 */
async function testMultiSelection(): Promise<void> {
  await runInteraction(runMultiSelection);
}

/** 检查临时平移 */
async function testPanSelection(): Promise<void> {
  await runInteraction(runPanSelection);
}

/** 检查组合与框选 */
async function testGroupSelection(): Promise<void> {
  await runInteraction(runGroupSelection);
}

/** 检查缩放旋转控制点 */
async function testControls(): Promise<void> {
  await runInteraction(runControls);
}

/** 检查线段和箭头中间拖动 */
async function testStrokeDragging(): Promise<void> {
  await runInteraction(runStrokeDragging);
}

test("连续绘制保留工具并支持主动选择调整", testDrawSelect);
test("细线仅在笔画附近响应选择", testPreciseSelection);
test("Shift 多选与锁定约束一致", testMultiSelection);
test("空格平移保留选区并恢复拖动", testPanSelection);
test("框选组合后首次拖动保持整体", testGroupSelection);
test("控制点缩放旋转保持选择", testControls);
test("线段箭头可从笔画中间拖动", testStrokeDragging);
