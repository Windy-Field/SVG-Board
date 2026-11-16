import { chromium, expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { createDocument, createShape, GRID_SIZE } from "../../src/core/model";
import { parseDocument } from "../../src/storage/document";
import { createFlowTemplate } from "../../src/objects/templates";
import type { BoardDocument, Point } from "../../src/core/types";
import { selectArchive } from "./helpers";
import { constructShape } from "../../src/core/commands";

// 浏览器通道由运行环境指定，Windows 可使用 msedge
const CHANNEL = process.env.PLAYWRIGHT_CHANNEL;
// 显式开启后更新 README 截图，普通测试只写入测试输出目录
const UPDATE_SCREENSHOTS = process.env.UPDATE_SCREENSHOTS === "true";

/** 使用独立浏览器运行一次工作台操作，页面异常同样视为失败 */
async function runBrowser(check: (page: Page) => Promise<void>): Promise<void> {
  const browser = await chromium.launch({ channel: CHANNEL });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors: string[] = [];
    /** 保存浏览器事件错误 */
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

/** 页面加载前写入指定作品，让测试不依赖其他存档 */
async function openBoard(page: Page, board: BoardDocument): Promise<void> {
  /** 将作品放入本地自动恢复位置 */
  function seed(text: string): void {
    if (sessionStorage.getItem("test-seeded") === null) {
      localStorage.setItem("svg-board-document-v1", text);
      sessionStorage.setItem("test-seeded", "true");
    }
  }
  await page.addInitScript(seed, JSON.stringify(board));
  await page.goto("http://127.0.0.1:5173/");
  await expect(page.locator(".upper-canvas")).toBeVisible();
  await page.getByRole("button", { name: "自动吸附", exact: true }).click();
  await page.getByRole("button", { name: "适应画布", exact: true }).click();
}

/** 在适应画板后计算指定作品位置对应的屏幕坐标 */
async function screen(page: Page, point: Point): Promise<Point> {
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

/** 执行真实指针拖动，右键框选也通过同一入口验证 */
async function drag(
  page: Page,
  first: Point,
  second: Point,
  button: "left" | "right" = "left"
): Promise<void> {
  await page.mouse.move(first.x, first.y);
  await page.mouse.down({ button: button });
  await page.mouse.move(second.x, second.y, { steps: 10 });
  await page.mouse.up({ button: button });
}

/** 读取已保存作品，用真实解析器检查新字段和构造关系 */
async function saved(page: Page): Promise<BoardDocument> {
  await expect(page.locator("#save-status")).toHaveText("已保存到此浏览器");
  /** 获取自动保存内容 */
  function read(): string {
    return localStorage.getItem("svg-board-document-v1") || "";
  }
  return parseDocument(await page.evaluate(read));
}

/** 从长按菜单切换工具，覆盖按住并移入模式菜单的真实入口 */
async function mode(page: Page, group: string, label: string): Promise<void> {
  const button = page.locator('[data-tool-group="' + group + '"]');
  const bounds = await button.boundingBox();
  if (bounds === null) {
    throw new Error("工具未显示");
  }
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  const option = page.locator("#tool-menu").getByRole("button", { name: label, exact: true });
  await expect(option).toBeVisible();
  const target = await option.boundingBox();
  if (target === null) {
    throw new Error("工具菜单未显示");
  }
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2);
  await page.mouse.up();
  await expect(button).toHaveAttribute("aria-label", label);
}

/** 验证图标同轴、侧栏显示隐藏、长按模式选择与纵向文本框 */
async function checkToolbar(page: Page): Promise<void> {
  await openBoard(page, createDocument());
  const tools = await page.locator(".tools > button[data-tool]").evaluateAll(readToolNames);
  expect(tools).toEqual([
    "选择",
    "几何点",
    "线段",
    "矩形",
    "判断框",
    "正多边形",
    "椭圆",
    "自由画笔",
    "文字"
  ]);
  const constructions = await page.locator(".geometry-tools button").evaluateAll(readToolNames);
  expect(constructions).toEqual(["两点线段", "交点", "中点", "平行线", "垂线"]);
  await expect(page.locator(".tool-divider").first()).toBeVisible();
  /** 检查工具栏实际高度，不能靠隐藏溢出内容消除滚动条 */
  function toolbarFits(): boolean {
    const tools = window.document.querySelector(".tools");
    return tools instanceof HTMLElement && tools.scrollHeight <= tools.clientHeight;
  }
  expect(await page.evaluate(toolbarFits)).toBe(true);
  const centers: number[] = [];
  for (const button of await page.locator(".tools button").all()) {
    const bounds = await button.boundingBox();
    if (bounds !== null) {
      centers.push(bounds.x + bounds.width / 2);
    }
  }
  expect(Math.max.apply(null, centers) - Math.min.apply(null, centers)).toBeLessThan(1);
  const toggle = page.locator("#inspector-button");
  await toggle.click();
  await expect(page.locator("#inspector")).toBeHidden();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await toggle.click();
  await expect(page.locator("#inspector")).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await mode(page, "text", "纵向文本框");
  const position = await screen(page, { x: 400, y: 200 });
  await drag(page, position, await screen(page, { x: 460, y: 440 }));
  await page.locator("#text-value").fill("纵向文本");
  await page.getByRole("button", { name: "保存文字", exact: true }).click();
  await expect(page.locator("#selection-count")).toHaveText("已选择 1");
  const document = await saved(page);
  expect(document.shapes[0].textDirection).toBe("vertical");
  await page.getByRole("button", { name: "选择", exact: true }).click();
  const center = await screen(page, { x: 430, y: 280 });
  await drag(page, center, { x: center.x + 40, y: center.y + 20 });
  const moved = await saved(page);
  expect(moved.shapes[0].x).toBeGreaterThan(430);
  const object = moved.shapes[0];
  const corner = await screen(page, { x: object.x + object.width, y: object.y + object.height });
  await drag(page, { x: corner.x + 5, y: corner.y + 5 }, { x: corner.x + 25, y: corner.y + 45 });
  const resized = await saved(page);
  expect(resized.shapes[0].height).toBeGreaterThan(object.height + 20);
  const resizedCenter = await screen(page, {
    x: resized.shapes[0].x + resized.shapes[0].width / 2,
    y: resized.shapes[0].y + resized.shapes[0].height / 2
  });
  await page.mouse.dblclick(resizedCenter.x, resizedCenter.y);
  await expect(page.locator("#text-dialog")).toBeVisible();
  await expect(page.locator("#text-value")).toHaveValue("纵向文本");
  await page.getByRole("button", { name: "保存文字", exact: true }).click();
  await page.screenshot({ path: "test-results/workspace-toolbar.png" });
}

/** 按 DOM 顺序读取工具名称，验证截图指定的排列 */
function readToolNames(elements: Element[]): string[] {
  const names: string[] = [];
  for (const element of elements) {
    names.push(element.getAttribute("aria-label") || "");
  }
  return names;
}

/** 验证参考连线可拖动且箭头端点可对齐网格 */
async function checkLines(page: Page): Promise<void> {
  const document = createFlowTemplate();
  await openBoard(page, document);
  const connector = document.shapes[7];
  const middle = await screen(page, {
    x: connector.x + connector.width / 2,
    y: connector.y + connector.height / 2
  });
  await drag(page, middle, { x: middle.x + 30, y: middle.y + 40 });
  const moved = await saved(page);
  expect(moved.shapes[7].relation.kind).toBe("none");
  expect(moved.shapes[7].y).toBeGreaterThanOrEqual(connector.y + 39);
  await page.getByRole("button", { name: "新建画板", exact: true }).click();
  await page.getByRole("button", { name: "自动吸附", exact: true }).click();
  await mode(page, "lines", "箭头");
  const start = await screen(page, { x: 203, y: 207 });
  const end = await screen(page, { x: 497, y: 217 });
  await drag(page, start, end);
  const created = await saved(page);
  const arrow = created.shapes[0];
  expect(arrow.x % GRID_SIZE).toBe(0);
  expect(arrow.y % GRID_SIZE).toBe(0);
  expect((arrow.x + arrow.width) % GRID_SIZE).toBe(0);
  await page.getByRole("button", { name: "选择", exact: true }).click();
  const endpoint = await screen(page, { x: arrow.x + arrow.width, y: arrow.y + arrow.height });
  const target = await screen(page, { x: 637, y: 333 });
  await drag(page, endpoint, target);
  const changed = await saved(page);
  expect(changed.shapes[0].x + changed.shapes[0].width).toBe(640);
  expect(changed.shapes[0].y + changed.shapes[0].height).toBe(340);
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  const undone = await saved(page);
  expect(undone.shapes[0].width).toBe(arrow.width);
  await page.getByRole("button", { name: "重做", exact: true }).click();
  const redone = await saved(page);
  expect(redone.shapes[0].x + redone.shapes[0].width).toBe(640);
  await page.keyboard.press("Escape");
  await page.screenshot({ path: "test-results/workspace-arrow.png" });
}

/** 验证 Ctrl 增减多选、直接取消成员和右键框选 */
async function checkSelection(page: Page): Promise<void> {
  const document = createDocument();
  for (const left of [200, 500]) {
    const shape = createShape("rect", { x: left, y: 200 });
    shape.width = 140;
    shape.height = 100;
    document.shapes.push(shape);
  }
  await openBoard(page, document);
  const first = await screen(page, { x: 270, y: 250 });
  const second = await screen(page, { x: 570, y: 250 });
  await page.mouse.click(first.x, first.y);
  await page.keyboard.down("Control");
  await page.mouse.click(second.x, second.y);
  await page.keyboard.up("Control");
  await expect(page.locator("#selection-count")).toHaveText("已选择 2");
  await page.mouse.click(first.x, first.y);
  await expect(page.locator("#selection-count")).toHaveText("已选择 1");
  await page.keyboard.press("Escape");
  await drag(
    page,
    await screen(page, { x: 150, y: 150 }),
    await screen(page, { x: 700, y: 350 }),
    "right"
  );
  await expect(page.locator("#selection-count")).toHaveText("已选择 2");
}

/** 验证只读时指针、属性和快捷键不能改动作品，退出后恢复编辑 */
async function checkReadOnly(page: Page): Promise<void> {
  const document = createDocument();
  const shape = createShape("rect", { x: 300, y: 200 });
  shape.width = 200;
  shape.height = 120;
  document.shapes.push(shape);
  await openBoard(page, document);
  await page.getByRole("button", { name: "只读模式", exact: true }).click();
  const center = await screen(page, { x: 400, y: 260 });
  await page.mouse.click(center.x, center.y);
  await drag(page, center, { x: center.x + 80, y: center.y + 40 });
  await page.keyboard.press("Delete");
  await page.keyboard.press("ArrowRight");
  await expect(page.locator("#object-count")).toHaveText("1 个对象");
  await expect(page.getByRole("spinbutton", { name: "X", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "矩形", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "导出", exact: true }).click();
  await expect(page.getByRole("img", { name: "导出预览" })).toBeVisible();
  await page.getByRole("button", { name: "关闭导出", exact: true }).click();
  await page.getByRole("button", { name: "只读模式", exact: true }).click();
  await drag(page, center, { x: center.x + 40, y: center.y + 20 });
  const moved = await saved(page);
  expect(moved.shapes[0].x).toBeCloseTo(340, 4);
}

/** 验证只读下线条端点不能编辑 */
async function checkReadOnlyLine(page: Page): Promise<void> {
  const document = createDocument();
  const line = createShape("arrow", { x: 200, y: 200 });
  line.width = 300;
  document.shapes.push(line);
  await openBoard(page, document);
  await page.getByRole("button", { name: "只读模式", exact: true }).click();
  const middle = await screen(page, { x: 350, y: 200 });
  await page.mouse.click(middle.x, middle.y);
  await drag(page, await screen(page, { x: 500, y: 200 }), await screen(page, { x: 700, y: 300 }));
  await expect(page.getByRole("spinbutton", { name: "宽度", exact: true })).toHaveValue("300");
  await expect(page.getByRole("spinbutton", { name: "宽度", exact: true })).toBeDisabled();
}

/** 验证本地新建存档、切换、取消删除和确认删除 */
async function checkArchives(page: Page): Promise<void> {
  const document = createDocument();
  document.name = "第一份";
  await openBoard(page, document);
  await page.getByRole("button", { name: "新建画板", exact: true }).click();
  await expect(page.locator("#archive-options [role=option]")).toHaveCount(4);
  const name = page.getByRole("textbox", { name: "作品名称", exact: true });
  await name.fill("第二份");
  await name.press("Tab");
  await saved(page);
  await selectArchive(page, "第一份");
  await expect(name).toHaveValue("第一份");
  await page.getByRole("button", { name: "删除当前存档", exact: true }).click();
  await expect(page.locator("#delete-dialog")).toBeVisible();
  await page.locator("#delete-dialog").getByRole("button", { name: "取消", exact: true }).click();
  await expect(page.locator("#archive-options [role=option]")).toHaveCount(4);
  await page.getByRole("button", { name: "删除当前存档", exact: true }).click();
  await page
    .locator("#delete-dialog")
    .getByRole("button", { name: "删除存档", exact: true })
    .click();
  await expect(page.locator("#archive-options [role=option]")).toHaveCount(3);
  await expect(name).toHaveValue("第二份");
  await page.reload();
  await expect(name).toHaveValue("第二份");
  await expect(page.locator("#archive-options [role=option]")).toHaveCount(3);
}

/** 验证新增多边形模式、连续绘制和曲线控制点保存 */
async function checkShapes(page: Page): Promise<void> {
  await openBoard(page, createDocument());
  await mode(page, "rectangles", "正方形");
  await drag(page, await screen(page, { x: 200, y: 200 }), await screen(page, { x: 320, y: 270 }));
  let document = await saved(page);
  expect(document.shapes[0].width).toBeCloseTo(document.shapes[0].height, 4);
  await expect(page.locator('[data-tool-group="rectangles"]')).toHaveAttribute(
    "aria-pressed",
    "true"
  );
  await mode(page, "polygons", "正多边形");
  await page.locator("#polygon-sides").fill("6");
  await page.getByRole("button", { name: "开始绘制", exact: true }).click();
  await drag(page, await screen(page, { x: 450, y: 200 }), await screen(page, { x: 600, y: 350 }));
  document = await saved(page);
  expect(document.shapes[1].points.length).toBe(6);
  await mode(page, "polygons", "自定义多边形");
  for (const point of [
    { x: 200, y: 450 },
    { x: 350, y: 450 }
  ]) {
    const position = await screen(page, point);
    await page.mouse.click(position.x, position.y);
  }
  const last = await screen(page, { x: 280, y: 550 });
  await page.mouse.dblclick(last.x, last.y);
  document = await saved(page);
  expect(document.shapes[2].points.length).toBe(3);
  await mode(page, "lines", "贝塞尔曲线");
  await drag(page, await screen(page, { x: 450, y: 450 }), await screen(page, { x: 750, y: 550 }));
  document = await saved(page);
  const curve = document.shapes[3];
  expect(curve.kind).toBe("curve");
  expect(curve.path).toContain("C");
  await expect(page.locator('[data-tool-group="lines"]')).toHaveAttribute("aria-pressed", "true");
  // 初始曲线两个控制点位于端点外侧，先拖动第一个控制点
  const bend = Math.hypot(300, 100) * 0.3;
  const control = await screen(page, { x: 550, y: 450 - bend });
  await drag(page, control, { x: control.x, y: control.y - 50 });
  const changed = await saved(page);
  expect(changed.shapes[3].path).not.toBe(curve.path);
  expect(changed.shapes.length).toBe(4);
  await page.reload();
  await expect(page.locator(".upper-canvas")).toBeVisible();
  /** 刷新后读取已落盘的数据，不要求页面再次执行保存 */
  function readRestored(): string {
    return localStorage.getItem("svg-board-document-v1") || "";
  }
  const restored = parseDocument(await page.evaluate(readRestored));
  expect(restored.shapes[3].path).toBe(changed.shapes[3].path);
}

/** 验证浮动文字配置、说明预览净化和侧栏让出真实画布空间 */
async function checkTextAndDescription(page: Page): Promise<void> {
  const document = createDocument();
  const text = createShape("text", { x: -300, y: -100 });
  text.width = 300;
  text.height = 80;
  text.text = "标题文字";
  document.shapes.push(text);
  await openBoard(page, document);
  const center = await screen(page, { x: -150, y: -85 });
  await page.mouse.click(center.x, center.y);
  await expect(page.getByRole("toolbar", { name: "文字配置" })).toBeVisible();
  await page.getByRole("button", { name: "字体", exact: true }).click();
  await page.getByRole("menuitemradio", { name: "楷体", exact: true }).click();
  const size = page.getByRole("spinbutton", { name: "浮动字号", exact: true });
  await size.fill("32");
  await size.press("Tab");
  await page.getByRole("button", { name: "加粗", exact: true }).click();
  const savedText = await saved(page);
  expect(savedText.shapes[0].fontFamily).toBe("KaiTi");
  expect(savedText.shapes[0].fontSize).toBe(32);
  expect(savedText.shapes[0].bold).toBe(true);
  if (savedText.contentBounds === undefined) {
    throw new Error("保存内容缺少边界");
  }
  expect(savedText.contentBounds.x).toBeLessThan(-300);
  expect(savedText.width).toBeLessThan(1200);
  const before = await page.locator("#canvas-host").boundingBox();
  await page.locator("#inspector-button").click();
  await expect(page.locator("#inspector")).toBeHidden();
  const after = await page.locator("#canvas-host").boundingBox();
  if (before === null || after === null) {
    throw new Error("画布未显示");
  }
  expect(after.width).toBeGreaterThan(before.width + 250);
  await page.locator("#inspector-button").click();
  await page.locator("#description-tab").click();
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await page
    .locator("#description-editor")
    .fill("# 测试介绍\n\n**说明**\n\n<script>alert(1)</script><img src=x onerror=alert(1)>");
  await page.locator("#description-tab").click();
  await saved(page);
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await expect(page.locator("#description-preview h1")).toHaveText("测试介绍");
  await expect(page.locator("#description-preview script, #description-preview img")).toHaveCount(
    0
  );
  await page.screenshot({ path: "test-results/text-description-desktop.png" });
}

/** 验证折线中段可以单独调整，并在撤销后恢复 */
async function checkBend(page: Page): Promise<void> {
  const document = createDocument();
  const connector = createShape("connector", { x: 200, y: 200 });
  connector.width = 400;
  connector.height = 200;
  document.shapes.push(connector);
  await openBoard(page, document);
  const middle = await screen(page, { x: 400, y: 300 });
  await page.mouse.click(middle.x, middle.y);
  await drag(page, middle, await screen(page, { x: 480, y: 300 }));
  const changed = await saved(page);
  expect(changed.shapes[0].bend).toBeCloseTo(0.7, 2);
  expect(changed.shapes[0].width).toBe(400);
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  const undone = await saved(page);
  expect(undone.shapes[0].bend).toBe(0.5);
}

/** 验证重复空白存档、内置作品和删除按钮悬停状态 */
async function checkArchiveDuplicates(page: Page): Promise<void> {
  await openBoard(page, createDocument());
  await expect(page.locator("#archive-options [role=option]")).toHaveCount(3);
  await expect(page.getByRole("heading", { name: "参考示例", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "新建画板", exact: true }).click();
  await page.getByRole("button", { name: "新建画板", exact: true }).click();
  await expect(page.locator("#archive-options [role=option]")).toHaveCount(3);
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute("href", /^data:image\/svg\+xml,/);
  const statusBox = await page.locator("#save-status").boundingBox();
  if (statusBox === null) {
    throw new Error("保存状态区域缺失");
  }
  expect(statusBox.height).toBe(1);
  await page.getByRole("button", { name: "删除当前存档", exact: true }).click();
  const confirm = page.locator('[data-action="confirm-delete"]');
  await confirm.hover();
  await page.waitForTimeout(180);
  /** 读取实际悬停色，按钮文字与背景必须有清楚区分 */
  function colors(element: Element): string[] {
    const style = window.getComputedStyle(element);
    return [style.color, style.backgroundColor];
  }
  const palette = await confirm.evaluate(colors);
  expect(palette).toEqual(["rgb(255, 255, 255)", "rgb(145, 32, 24)"]);
  await page.screenshot({ path: "test-results/delete-hover.png" });
  await page.locator('[data-action="cancel-delete"]').first().click();
}

/** 验证文字优先于线条，同点单击可轮换，点名可以移动和隐藏 */
async function checkOverlapsAndPointLabels(page: Page): Promise<void> {
  const document = createDocument();
  const point = createShape("point", { x: 300, y: 200 });
  point.text = "A";
  const line = createShape("line", { x: 250, y: 183 });
  line.width = 200;
  line.layer = 10;
  document.shapes.push(point, line);
  await openBoard(page, document);
  const overlap = await screen(page, { x: 320, y: 183 });
  await page.mouse.click(overlap.x, overlap.y);
  await expect(page.getByRole("textbox", { name: "对象名称", exact: true })).toHaveValue("A");
  await page.mouse.click(overlap.x, overlap.y);
  await expect(page.getByRole("textbox", { name: "对象名称", exact: true })).toHaveValue("线段");
  await page.mouse.click(overlap.x, overlap.y);
  await expect(page.getByRole("textbox", { name: "对象名称", exact: true })).toHaveValue("A");
  await drag(page, overlap, { x: overlap.x + 50, y: overlap.y - 20 });
  const moved = await saved(page);
  expect(moved.shapes[2].x).toBeGreaterThan(350);
  expect(moved.shapes[0].x).toBe(300);
  await page.locator("#objects-tab").click();
  await page.locator('[data-visibility="' + moved.shapes[2].id + '"]').click();
  const hidden = await saved(page);
  expect(hidden.shapes[2].hidden).toBe(true);
}

/** 验证拖动决定文字尺寸、矩形圆角保存和普通图形单击取消 */
async function checkDrawingSizes(page: Page): Promise<void> {
  await openBoard(page, createDocument());
  await page.getByRole("button", { name: "矩形", exact: true }).click();
  const start = await screen(page, { x: 200, y: 200 });
  await page.mouse.click(start.x, start.y);
  await expect(page.locator("#object-count")).toHaveText("0 个对象");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "矩形", exact: true }).click();
  await drag(page, start, await screen(page, { x: 430, y: 330 }));
  await page.getByRole("button", { name: "选择", exact: true }).click();
  const radius = page.getByRole("spinbutton", { name: "圆角", exact: true });
  await expect(radius).toHaveValue("0");
  await radius.fill("24");
  await radius.press("Tab");
  const rectangle = await saved(page);
  expect(rectangle.shapes[0].cornerRadius).toBe(24);
  await page.getByRole("button", { name: "文字", exact: true }).click();
  await drag(page, await screen(page, { x: 500, y: 400 }), await screen(page, { x: 730, y: 460 }));
  await page.locator("#text-value").fill("自由尺寸");
  await page.getByRole("button", { name: "保存文字", exact: true }).click();
  const text = await saved(page);
  expect(text.shapes[1].width).toBeCloseTo(230, 2);
  expect(text.shapes[1].fontSize).toBeGreaterThan(40);
}

/** 保存空白工作台截图供 README 使用，截图不包含选区或对话框 */
async function checkWorkspaceScreenshot(page: Page): Promise<void> {
  await openBoard(page, createDocument());
  await page.locator("#snap-button").click();
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.locator("#object-count")).toHaveText("0 个对象");
  let path = "test-results/workspace-empty.png";
  if (UPDATE_SCREENSHOTS) {
    path = "docs/images/workspace-empty.png";
  }
  await page.screenshot({ path: path });
}

/** 默认吸附开启时，新建与调整线条端点都优先停在线与边框交点 */
async function checkEndpointIntersections(page: Page): Promise<void> {
  const document = createDocument();
  const rectangle = createShape("rect", { x: 413, y: 297 });
  rectangle.width = 160;
  rectangle.height = 140;
  const line = createShape("line", { x: 300, y: 357 });
  line.width = 400;
  document.shapes.push(rectangle, line);
  await openBoard(page, document);
  await page.getByRole("button", { name: "自动吸附", exact: true }).click();
  await expect(page.locator("#snap-button")).toHaveAttribute("aria-pressed", "true");
  await mode(page, "lines", "箭头");
  await drag(page, await screen(page, { x: 200, y: 180 }), await screen(page, { x: 417, y: 360 }));
  const created = await saved(page);
  const arrow = created.shapes[2];
  expect(arrow.x + arrow.width).toBeCloseTo(413, 4);
  expect(arrow.y + arrow.height).toBeCloseTo(357, 4);
  await page.getByRole("button", { name: "选择", exact: true }).click();
  await drag(page, await screen(page, { x: 413, y: 357 }), await screen(page, { x: 577, y: 360 }));
  const resized = await saved(page);
  expect(resized.shapes[2].x + resized.shapes[2].width).toBeCloseTo(573, 4);
  expect(resized.shapes[2].y + resized.shapes[2].height).toBeCloseTo(357, 4);
  await page.keyboard.press("Escape");
  await page.screenshot({ path: "test-results/arrow-intersection.png" });
}

/** 打开已有重复存档时合并相同内容，保留当前作品和修改后的副本 */
async function checkLegacyDuplicates(page: Page): Promise<void> {
  const first = createFlowTemplate();
  const second = createFlowTemplate();
  const edited = createFlowTemplate();
  edited.shapes[2].text = "补充检查";
  const archives = [
    { id: "first", document: first },
    { id: "second", document: second },
    { id: "edited", document: edited }
  ];
  /** 写入旧版的重复存档与当前编号 */
  function seedLegacy(text: string): void {
    localStorage.setItem("svg-board-archives-v1", text);
    localStorage.setItem("svg-board-active-archive", "second");
    localStorage.setItem("svg-board-builtin-archives-v1", "true");
  }
  await page.addInitScript(seedLegacy, JSON.stringify(archives));
  await page.goto("http://127.0.0.1:5173/");
  await expect(page.locator("#archive-options [role=option]")).toHaveCount(2);
  await expect(page.locator("#archive-select")).toHaveAttribute("data-value", "first");
  await expect(page.locator('[data-archive-value="edited"]')).toHaveCount(1);
}

/** 验证线段与圆的两次点击放置，几何点和两点线段保留依赖 */
async function checkClickPlacement(page: Page): Promise<void> {
  await openBoard(page, createDocument());
  await page.getByRole("button", { name: "线段", exact: true }).click();
  const first = await screen(page, { x: 200, y: 200 });
  const second = await screen(page, { x: 440, y: 300 });
  await page.mouse.click(first.x, first.y);
  await expect(page.locator("#object-count")).toHaveText("0 个对象");
  await page.mouse.move(second.x, second.y);
  await page.mouse.click(second.x, second.y);
  const line = await saved(page);
  expect(line.shapes[0].width).toBeCloseTo(240, 3);
  await mode(page, "ellipses", "圆");
  const center = await screen(page, { x: 650, y: 250 });
  const edge = await screen(page, { x: 730, y: 250 });
  await page.mouse.click(center.x, center.y);
  await page.mouse.click(edge.x, edge.y);
  const circle = await saved(page);
  expect(circle.shapes[1].width).toBeCloseTo(160, 3);
  expect(circle.shapes[1].height).toBeCloseTo(160, 3);
  expect(circle.shapes[1].x).toBeCloseTo(570, 3);
  await page.getByRole("button", { name: "几何点", exact: true }).click();
  const pointPosition = await screen(page, { x: 250, y: 450 });
  await page.mouse.click(pointPosition.x, pointPosition.y);
  let document = await saved(page);
  const point = document.shapes[2];
  expect(point.kind).toBe("point");
  expect(point.pointRadius).toBe(5);
  await page.getByRole("button", { name: "两点线段", exact: true }).click();
  await page.mouse.click(pointPosition.x, pointPosition.y);
  const end = await screen(page, { x: 500, y: 500 });
  await page.mouse.click(end.x, end.y);
  document = await saved(page);
  const segment = document.shapes[document.shapes.length - 1];
  expect(segment.relation.kind).toBe("segment");
  expect(segment.relation.sources[0]).toBe(point.id);
  await page.getByRole("button", { name: "选择", exact: true }).click();
  await drag(page, pointPosition, { x: pointPosition.x + 40, y: pointPosition.y });
  const moved = await saved(page);
  const dependent = moved.shapes[moved.shapes.length - 1];
  expect(dependent.x).toBeCloseTo(moved.shapes[2].x, 3);
}

/** 验证标题栏控件布局、标签居中、界面文字选择与保存导出职责 */
async function checkHeaderAndExport(page: Page): Promise<void> {
  await openBoard(page, createDocument());
  await expect(page.locator(".topbar #archive-select")).toBeVisible();
  await expect(page.locator("#inspector #archive-select")).toHaveCount(0);
  const ids = ["archive-select", "readonly-button", "snap-button", "grid-button"];
  await expect(page.locator(".commandbar")).toHaveCount(0);
  await expect(page.locator('.header-workspace [data-action="undo"]')).toBeVisible();
  await expect(page.locator('.header-workspace [data-action="redo"]')).toBeVisible();
  await expect(page.locator('[data-action="new-archive"]')).toHaveCount(0);
  let previous = 0;
  for (const id of ids) {
    const box = await page.locator("#" + id).boundingBox();
    if (box === null) {
      throw new Error("标题栏控件未显示");
    }
    expect(box.x).toBeGreaterThan(previous);
    previous = box.x;
  }
  /** 获取浏览器实际样式，验证文字大小和选择规则 */
  function interfaceStyles(): string[] {
    const heading = window.document.getElementById("properties-tab");
    const name = window.document.getElementById("document-name");
    if (heading === null || name === null) {
      return [];
    }
    return [
      getComputedStyle(heading).fontSize,
      getComputedStyle(heading).textAlign,
      getComputedStyle(window.document.body).userSelect,
      getComputedStyle(name).userSelect
    ];
  }
  expect(await page.evaluate(interfaceStyles)).toEqual(["18px", "center", "none", "text"]);
  let downloads = 0;
  /** 记录下载次数，保存按钮只写入本地存档 */
  function recordDownload(): void {
    downloads = downloads + 1;
  }
  page.on("download", recordDownload);
  await page.getByRole("button", { name: "保存项目", exact: true }).click();
  await saved(page);
  expect(downloads).toBe(0);
  await page.getByRole("button", { name: "导出", exact: true }).click();
  await expect(page.locator("#export-dialog input")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "导出项目", exact: true })).toBeVisible();
  /** 将预览 SVG 解析为 XML，透明背景不应生成背景矩形 */
  async function previewHasBackground(): Promise<boolean> {
    const image = window.document.querySelector("#export-preview img");
    if (!(image instanceof HTMLImageElement)) {
      return true;
    }
    const response = await fetch(image.src);
    const svg = new DOMParser().parseFromString(await response.text(), "image/svg+xml");
    return svg.querySelector('rect[width="100%"]') !== null;
  }
  expect(await page.evaluate(previewHasBackground)).toBe(false);
}

/** 右键框选与对象笔画相交时可选中，已有多选也可重新框选 */
async function checkMarqueeEdges(page: Page): Promise<void> {
  const document = createDocument();
  const line = createShape("line", { x: 200, y: 200 });
  line.width = 300;
  const rectangle = createShape("rect", { x: 600, y: 200 });
  rectangle.width = 140;
  rectangle.height = 100;
  document.shapes.push(line, rectangle);
  await openBoard(page, document);
  await drag(
    page,
    await screen(page, { x: 190, y: 195 }),
    await screen(page, { x: 745, y: 305 }),
    "right"
  );
  await expect(page.locator("#selection-count")).toHaveText("已选择 2");
  await drag(
    page,
    await screen(page, { x: 330, y: 190 }),
    await screen(page, { x: 370, y: 210 }),
    "right"
  );
  await expect(page.locator("#selection-count")).toHaveText("已选择 1");
  await expect(page.getByRole("textbox", { name: "对象名称", exact: true })).toHaveValue("线段");
}

/** 管理列表只隐藏对应对象，锁定状态在列表与画布保留并可解除 */
async function checkObjectManagement(page: Page): Promise<void> {
  const document = createDocument();
  const first = createShape("point", { x: 250, y: 250 });
  first.name = "起点";
  const second = createShape("point", { x: 600, y: 250 });
  second.name = "终点";
  const line = createShape("line", { x: 250, y: 250 });
  line.width = 350;
  line.relation = { kind: "segment", sources: [first.id, second.id] };
  line.name = "关联线";
  document.shapes.push(first, second, line);
  await openBoard(page, document);
  await page.locator("#objects-tab").click();
  await expect(page.getByRole("button", { name: "图层 3", exact: true })).toHaveCount(0);
  await page.locator('[data-object-select="' + line.id + '"]').click();
  await page.locator('[data-visibility="' + first.id + '"]').click();
  const hidden = await saved(page);
  expect(hidden.shapes[0].hidden).toBe(true);
  expect(hidden.shapes[2].hidden).toBe(false);
  await expect(page.locator('[data-visibility="' + line.id + '"]')).toHaveAttribute(
    "aria-pressed",
    "true"
  );
  await page.locator('[data-object-lock="' + line.id + '"]').click();
  const locked = await saved(page);
  expect(locked.shapes[2].locked).toBe(true);
  await expect(page.locator('[data-object-lock="' + line.id + '"]')).toHaveAttribute(
    "aria-pressed",
    "true"
  );
  await expect(page.locator(".object-row.locked")).toHaveCount(1);
  await page.locator("#properties-tab").click();
  await expect(page.getByRole("spinbutton", { name: "X", exact: true })).toBeDisabled();
  const middle = await screen(page, { x: 425, y: 250 });
  await drag(page, middle, { x: middle.x + 50, y: middle.y + 30 });
  const afterDrag = await saved(page);
  expect(afterDrag.shapes[2].x).toBe(250);
  await page.screenshot({ path: "test-results/locked-object.png" });
  await page.locator("#objects-tab").click();
  await page.locator('[data-object-lock="' + line.id + '"]').click();
  await page.locator('[data-visibility="' + first.id + '"]').click();
  const restored = await saved(page);
  expect(restored.shapes[0].hidden).toBe(false);
  expect(restored.shapes[2].locked).toBe(false);
  await page.getByRole("button", { name: "只读模式", exact: true }).click();
  await expect(page.locator('[data-object-lock="' + line.id + '"]')).toBeDisabled();
  await expect(page.locator('[data-visibility="' + first.id + '"]')).toBeDisabled();
}

/** 图形与线条文字可独立选择移动，原图形的尺寸和位置保持原样 */
async function checkShapeLabels(page: Page): Promise<void> {
  const document = createDocument();
  const rectangle = createShape("rect", { x: 200, y: 200 });
  rectangle.width = 220;
  rectangle.height = 100;
  rectangle.text = "模块文字";
  const line = createShape("line", { x: 200, y: 450 });
  line.width = 300;
  line.text = "连接文字";
  document.shapes.push(rectangle, line);
  await openBoard(page, document);
  const label = await screen(page, { x: 310, y: 250 });
  await drag(page, label, { x: label.x + 60, y: label.y - 30 });
  const moved = await saved(page);
  expect(moved.shapes.length).toBe(3);
  expect(moved.shapes[0].x).toBe(200);
  expect(moved.shapes[0].text).toBe("");
  expect(moved.shapes[2].text).toBe("模块文字");
  expect(moved.shapes[2].x).toBeGreaterThan(260);
  const lineLabel = await screen(page, { x: 350, y: 434 });
  await page.mouse.click(lineLabel.x, lineLabel.y);
  await expect(page.getByRole("toolbar", { name: "文字配置" })).toBeVisible();
  await page.getByRole("button", { name: "编辑文字", exact: true }).click();
  await page.locator("#text-value").fill("改后的连接文字");
  await page.getByRole("button", { name: "保存文字", exact: true }).click();
  const edited = await saved(page);
  expect(edited.shapes[1].text).toBe("");
  expect(edited.shapes[3].text).toBe("改后的连接文字");
  await page.reload();
  await expect(page.locator("#object-count")).toHaveText("4 个对象");
}

/** 画布颜色随作品保存，导出仍透明，预览在桌面和手机均不溢出 */
async function checkBackgroundAndPreview(page: Page): Promise<void> {
  const document = createDocument();
  const shape = createShape("rect", { x: 200, y: 100 });
  shape.width = 100;
  shape.height = 700;
  document.shapes.push(shape);
  await openBoard(page, document);
  const input = page.locator('[data-property="background"]');
  await expect(input).toHaveValue("#ffffff");
  await input.fill("#e2f3e8");
  await input.dispatchEvent("change");
  const savedColor = await saved(page);
  expect(savedColor.background).toBe("#e2f3e8");
  await page.reload();
  await expect(input).toHaveValue("#e2f3e8");
  for (const width of [1280, 375, 320]) {
    await page.setViewportSize({ width: width, height: 800 });
    await page.getByRole("button", { name: "导出", exact: true }).click();
    const image = page.getByRole("img", { name: "导出预览" });
    await expect(image).toBeVisible();
    await page.waitForTimeout(220);
    const frame = await page.locator("#export-preview").boundingBox();
    const picture = await image.boundingBox();
    if (frame === null || picture === null) {
      throw new Error("导出预览未显示");
    }
    expect(picture.x).toBeGreaterThanOrEqual(frame.x - 1);
    expect(picture.y).toBeGreaterThanOrEqual(frame.y - 1);
    expect(picture.x + picture.width).toBeLessThanOrEqual(frame.x + frame.width + 1);
    expect(picture.y + picture.height).toBeLessThanOrEqual(frame.y + frame.height + 1);
    await page.screenshot({ path: "test-results/export-preview-" + width + ".png" });
    await page.getByRole("button", { name: "关闭导出", exact: true }).click();
  }
}

/** 文字配置独立使用字体菜单与对齐图标，各尺寸下控件均位于工具栏内 */
async function checkTextToolbarLayout(page: Page): Promise<void> {
  const document = createDocument();
  const shape = createShape("text", { x: 250, y: 250 });
  shape.width = 200;
  shape.text = "文字配置";
  document.shapes.push(shape);
  await openBoard(page, document);
  for (const width of [1280, 375, 320]) {
    await page.setViewportSize({ width: width, height: 800 });
    if (
      width <= 720 &&
      (await page.locator("#inspector-button").getAttribute("aria-pressed")) === "true"
    ) {
      await page.locator("#inspector-button").click();
      await page.waitForTimeout(240);
    }
    await page.getByRole("button", { name: "适应画布", exact: true }).click();
    const position = await screen(page, { x: 350, y: 260 });
    await page.mouse.click(position.x, position.y);
    if (
      width <= 720 &&
      (await page.locator("#inspector-button").getAttribute("aria-pressed")) === "true"
    ) {
      await page.locator("#inspector-button").click();
      await page.waitForTimeout(240);
    }
    const toolbar = page.locator("#text-toolbar");
    await expect(toolbar).toBeVisible();
    await expect(toolbar.locator("select")).toHaveCount(0);
    const box = await toolbar.boundingBox();
    if (box === null) {
      throw new Error("文字工具栏未显示");
    }
    for (const control of await toolbar.locator('button, input:not([type="hidden"])').all()) {
      const bounds = await control.boundingBox();
      if (bounds === null) {
        throw new Error("文字配置控件未显示");
      }
      expect(bounds.x).toBeGreaterThanOrEqual(box.x);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(box.x + box.width);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(box.y + box.height);
    }
    await page.getByRole("button", { name: "文字左对齐", exact: true }).click();
    await expect(page.getByRole("button", { name: "文字左对齐", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    await page.getByRole("button", { name: "字体", exact: true }).click();
    await expect(page.getByRole("menu", { name: "字体列表" })).toBeVisible();
    await page.keyboard.press("Home");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(page.locator("#font-menu-label")).toHaveText("微软雅黑");
    await page.getByRole("button", { name: "字体", exact: true }).click();
    await page.screenshot({ path: "test-results/text-toolbar-menu-" + width + ".png" });
    await page.keyboard.press("Escape");
    await page.screenshot({ path: "test-results/text-toolbar-" + width + ".png" });
    if (UPDATE_SCREENSHOTS && width === 1280) {
      await toolbar.screenshot({ path: "docs/images/text-toolbar.png" });
    }
  }
}

/** 长按后拖动只平移视图，快速拖动仍移动对象 */
async function checkHoldPan(page: Page): Promise<void> {
  const document = createDocument();
  const rectangle = createShape("rect", { x: 300, y: 250 });
  rectangle.width = 160;
  rectangle.height = 100;
  document.shapes.push(rectangle);
  await openBoard(page, document);
  await expect(page.getByRole("button", { name: "平移", exact: true })).toHaveCount(0);
  const canvas = page.locator("#canvas-host");
  const before = Number(await canvas.getAttribute("data-view-x"));
  const center = await screen(page, { x: 380, y: 300 });
  await page.mouse.move(center.x, center.y);
  await page.mouse.down();
  await page.waitForTimeout(550);
  await page.mouse.move(center.x + 70, center.y + 30, { steps: 8 });
  await page.mouse.up();
  expect(Number(await canvas.getAttribute("data-view-x"))).toBeCloseTo(before + 70, 2);
  await page.getByRole("button", { name: "保存项目", exact: true }).click();
  const panned = await saved(page);
  expect(panned.shapes[0].x).toBe(300);
  expect(panned.shapes[0].y).toBe(250);
  const movedCenter = await screen(page, { x: 380, y: 300 });
  await drag(page, movedCenter, { x: movedCenter.x + 35, y: movedCenter.y + 20 });
  const moved = await saved(page);
  expect(moved.shapes[0].x).toBeCloseTo(335, 2);
}

/** 所有几何方法先选工具再点来源，原先选来源再构造也能继续使用 */
async function checkConstructionMethods(page: Page): Promise<void> {
  const document = createDocument();
  const first = createShape("point", { x: 220, y: 180 });
  const second = createShape("point", { x: 700, y: 180 });
  const horizontal = createShape("line", { x: 200, y: 350 });
  horizontal.width = 500;
  const vertical = createShape("line", { x: 450, y: 230 });
  vertical.height = 300;
  document.shapes.push(first, second, horizontal, vertical);
  await openBoard(page, document);
  const cases = [
    { label: "中点", kind: "midpoint", points: [{ x: 300, y: 350 }] },
    {
      label: "交点",
      kind: "intersection",
      points: [
        { x: 620, y: 350 },
        { x: 450, y: 480 }
      ]
    },
    {
      label: "平行线",
      kind: "parallel",
      points: [
        { x: 220, y: 180 },
        { x: 620, y: 350 }
      ]
    },
    {
      label: "垂线",
      kind: "perpendicular",
      points: [
        { x: 620, y: 350 },
        { x: 700, y: 180 }
      ]
    }
  ];
  for (const item of cases) {
    await page.getByRole("button", { name: item.label, exact: true }).click();
    for (const point of item.points) {
      const position = await screen(page, point);
      await page.mouse.click(position.x, position.y);
    }
    const restored = await saved(page);
    let found = false;
    for (const shape of restored.shapes) {
      if (shape.relation.kind === item.kind) {
        found = true;
        expect(shape.locked).toBe(true);
      }
    }
    expect(found, item.label).toBe(true);
  }
  await page.getByRole("button", { name: "选择", exact: true }).click();
  const position = await screen(page, { x: 300, y: 350 });
  await page.mouse.click(position.x, position.y);
  const before = await saved(page);
  await page.getByRole("button", { name: "中点", exact: true }).click();
  const constructed = await saved(page);
  expect(constructed.shapes.length).toBe(before.shapes.length + 2);
}

/** 存档、字体和工具分组选项重复点击均能收起，存档菜单尺寸与触发栏一致 */
async function checkMenuToggle(page: Page): Promise<void> {
  await openBoard(page, createDocument());
  const trigger = page.getByRole("combobox", { name: "画图存档", exact: true });
  await trigger.click();
  const menu = page.getByRole("listbox", { name: "画图存档选项", exact: true });
  await expect(menu).toBeVisible();
  const bounds = await menu.boundingBox();
  const button = await trigger.boundingBox();
  if (bounds === null || button === null) {
    throw new Error("存档菜单未显示");
  }
  expect(bounds.x).toBeCloseTo(button.x, 1);
  expect(bounds.width).toBeCloseTo(button.width, 1);
  await page.screenshot({ path: "test-results/archive-menu-desktop.png" });
  await trigger.click();
  await expect(menu).toBeHidden();
  await selectArchive(page, "课程作业 · 提交流程");
  await page.getByRole("button", { name: "选择", exact: true }).click();
  const text = await screen(page, { x: 300, y: 110 });
  await page.mouse.click(text.x, text.y);
  const font = page.getByRole("button", { name: "字体", exact: true });
  await font.click();
  await expect(page.getByRole("menu", { name: "字体列表" })).toBeVisible();
  await font.click();
  await expect(page.getByRole("menu", { name: "字体列表" })).toBeHidden();
  const group = page.locator('[data-tool-group="lines"]');
  await group.focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.locator("#tool-menu")).toBeVisible();
  await group.click();
  await expect(page.locator("#tool-menu")).toBeHidden();
}

/** 构造对象不能拖移，端点只伸缩，解锁后才允许自由修改 */
async function checkConstructionLocks(page: Page): Promise<void> {
  const document = createDocument();
  const source = createShape("line", { x: 200, y: 350 });
  source.width = 300;
  const point = createShape("point", { x: 700, y: 350 });
  document.shapes.push(source, point);
  const midpoint = constructShape(document, [source], "midpoint");
  const perpendicular = constructShape(document, [source, point], "perpendicular");
  await openBoard(page, document);
  await page.locator("#objects-tab").click();
  await page.locator('[data-object-select="' + perpendicular.id + '"]').click();
  await page.locator("#properties-tab").click();
  await expect(page.getByRole("spinbutton", { name: "X", exact: true })).toBeDisabled();
  await expect(page.getByRole("spinbutton", { name: "旋转角度", exact: true })).toBeDisabled();
  const middle = await screen(page, { x: 700, y: 400 });
  await drag(page, middle, { x: middle.x + 40, y: middle.y + 20 });
  await page.getByRole("button", { name: "保存项目", exact: true }).click();
  const fixed = await saved(page);
  expect(fixed.shapes[3].x).toBe(700);
  expect(fixed.shapes[3].height).toBe(240);
  const end = await screen(page, { x: 700, y: 470 });
  await drag(page, end, await screen(page, { x: 750, y: 530 }));
  const extended = await saved(page);
  expect(extended.shapes[3].width).toBeCloseTo(0, 4);
  expect(extended.shapes[3].height).toBeCloseTo(300, 1);
  expect(extended.shapes[3].relation.kind).toBe("perpendicular");
  expect(extended.shapes[3].locked).toBe(true);
  const length = page.getByRole("spinbutton", { name: "显示长度", exact: true });
  await length.fill("360");
  await length.press("Tab");
  const resized = await saved(page);
  expect(resized.shapes[3].height).toBeCloseTo(360, 4);
  await page.reload();
  await expect(page.locator(".upper-canvas")).toBeVisible();
  await page.locator("#objects-tab").click();
  await page.locator('[data-object-select="' + source.id + '"]').click();
  await page.locator("#properties-tab").click();
  const angle = page.getByRole("spinbutton", { name: "旋转角度", exact: true });
  await angle.fill("90");
  await angle.press("Tab");
  const rotated = await saved(page);
  expect(rotated.shapes[3].width).toBeCloseTo(-360, 4);
  expect(rotated.shapes[3].height).toBeCloseTo(0, 4);
  await page.locator("#objects-tab").click();
  await page.locator('[data-object-select="' + midpoint.id + '"]').click();
  await page.locator('[data-object-lock="' + midpoint.id + '"]').click();
  await page.locator("#properties-tab").click();
  const horizontal = page.getByRole("spinbutton", { name: "X", exact: true });
  await expect(horizontal).toBeEnabled();
  await horizontal.fill("400");
  await horizontal.press("Tab");
  const unlocked = await saved(page);
  expect(unlocked.shapes[2].relation.kind).toBe("none");
  expect(unlocked.shapes[2].x).toBe(400);
  await page.locator("#objects-tab").click();
  await page.locator('[data-object-select="' + perpendicular.id + '"]').click();
  await page.locator('[data-object-lock="' + perpendicular.id + '"]').click();
  await page.locator("#properties-tab").click();
  const freeAngle = page.getByRole("spinbutton", { name: "旋转角度", exact: true });
  await freeAngle.fill("30");
  await freeAngle.press("Tab");
  const free = await saved(page);
  expect(free.shapes[3].locked).toBe(false);
  expect(free.shapes[3].relation.kind).toBe("none");
  expect(free.shapes[3].rotation).toBe(30);
}

/** 检查工具布局与竖排文本 */
async function testToolbar(): Promise<void> {
  await runBrowser(checkToolbar);
}
/** 检查线条端点与吸附 */
async function testLines(): Promise<void> {
  await runBrowser(checkLines);
}
/** 检查新增选择方式 */
async function testSelection(): Promise<void> {
  await runBrowser(checkSelection);
}
/** 检查只读限制 */
async function testReadOnly(): Promise<void> {
  await runBrowser(checkReadOnly);
}
/** 检查存档管理 */
async function testArchives(): Promise<void> {
  await runBrowser(checkArchives);
}

/** 检查只读线条控制点 */
async function testReadOnlyLine(): Promise<void> {
  await runBrowser(checkReadOnlyLine);
}

/** 检查多边形与曲线 */
async function testShapes(): Promise<void> {
  await runBrowser(checkShapes);
}

/** 检查文字、说明和布局 */
async function testTextAndDescription(): Promise<void> {
  await runBrowser(checkTextAndDescription);
}

/** 检查折线中段 */
async function testBend(): Promise<void> {
  await runBrowser(checkBend);
}

/** 检查存档去重与按钮颜色 */
async function testArchiveDuplicates(): Promise<void> {
  await runBrowser(checkArchiveDuplicates);
}

/** 检查重叠对象和点名 */
async function testOverlapsAndPointLabels(): Promise<void> {
  await runBrowser(checkOverlapsAndPointLabels);
}

/** 检查放置尺寸和圆角 */
async function testDrawingSizes(): Promise<void> {
  await runBrowser(checkDrawingSizes);
}

/** 检查空白工作台 */
async function testWorkspaceScreenshot(): Promise<void> {
  await runBrowser(checkWorkspaceScreenshot);
}

/** 检查绘制与端点调整的交点吸附 */
async function testEndpointIntersections(): Promise<void> {
  await runBrowser(checkEndpointIntersections);
}

/** 检查已有存档迁移去重 */
async function testLegacyDuplicates(): Promise<void> {
  await runBrowser(checkLegacyDuplicates);
}

/** 检查点击式绘图与几何构造 */
async function testClickPlacement(): Promise<void> {
  await runBrowser(checkClickPlacement);
}

/** 检查标题栏和保存导出 */
async function testHeaderAndExport(): Promise<void> {
  await runBrowser(checkHeaderAndExport);
}

/** 检查右键框选边缘与重复框选 */
async function testMarqueeEdges(): Promise<void> {
  await runBrowser(checkMarqueeEdges);
}

/** 检查独立对象管理、隐藏与锁定 */
async function testObjectManagement(): Promise<void> {
  await runBrowser(checkObjectManagement);
}

/** 检查图形与线条标签独立编辑 */
async function testShapeLabels(): Promise<void> {
  await runBrowser(checkShapeLabels);
}

/** 检查画布颜色与受限预览尺寸 */
async function testBackgroundAndPreview(): Promise<void> {
  await runBrowser(checkBackgroundAndPreview);
}

/** 检查文字配置栏布局与菜单键盘操作 */
async function testTextToolbarLayout(): Promise<void> {
  await runBrowser(checkTextToolbarLayout);
}

/** 检查长按平移和普通拖动 */
async function testHoldPan(): Promise<void> {
  await runBrowser(checkHoldPan);
}

/** 检查几何工具的两种构造顺序 */
async function testConstructionMethods(): Promise<void> {
  await runBrowser(checkConstructionMethods);
}

/** 检查菜单收起与存档菜单布局 */
async function testMenuToggle(): Promise<void> {
  await runBrowser(checkMenuToggle);
}

/** 检查构造锁定、长度修改、存档恢复与手动解锁 */
async function testConstructionLocks(): Promise<void> {
  await runBrowser(checkConstructionLocks);
}

test("工具图标对齐与纵向文本编辑", testToolbar);
test("参考线可拖动且箭头端点吸附网格", testLines);
test("Ctrl 多选取消与右键框选", testSelection);
test("只读模式覆盖鼠标属性和快捷键", testReadOnly);
test("存档新建切换与删除确认", testArchives);
test("只读箭头端点不可修改", testReadOnlyLine);
test("多边形模式与贝塞尔控制点保存", testShapes);
test("浮动文字配置说明净化与侧栏扩展", testTextAndDescription);
test("折线中段调整与撤销", testBend);
test("存档去重标题单行与删除悬停颜色", testArchiveDuplicates);
test("重叠轮换与点名移动隐藏", testOverlapsAndPointLabels);
test("拖动决定尺寸且矩形圆角保存", testDrawingSizes);
test("空白工作台截图", testWorkspaceScreenshot);
test("默认吸附与线条端点交点优先", testEndpointIntersections);
test("旧存档合并重复并保留编辑副本", testLegacyDuplicates);
test("点击放置线圆与两点线段", testClickPlacement);
test("标题栏存档与保存透明导出", testHeaderAndExport);
test("右键框选笔画与已有多选", testMarqueeEdges);
test("对象管理隐藏仅作用目标并显示锁定", testObjectManagement);
test("图形与线条标签可单独移动编辑", testShapeLabels);
test("画布颜色保存与导出预览无溢出", testBackgroundAndPreview);
test("文字配置栏独立菜单与响应式布局", testTextToolbarLayout);
test("长按左键平移与快速拖动对象", testHoldPan);
test("所有几何方法支持先选工具再选来源", testConstructionMethods);
test("存档字体工具菜单重复点击收起", testMenuToggle);
test("构造对象默认锁定且长度可调", testConstructionLocks);
