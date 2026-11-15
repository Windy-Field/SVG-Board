import { chromium, expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { createDocument, createShape, GRID_SIZE } from "../../src/model";
import { parseDocument } from "../../src/document";
import { createFlowTemplate } from "../../src/templates";
import type { BoardDocument, Point } from "../../src/types";

const CHANNEL = process.env.PLAYWRIGHT_CHANNEL;
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
    "平移",
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
  await page.getByRole("button", { name: "新建存档", exact: true }).click();
  await expect(page.locator("#archive-list [data-archive]")).toHaveCount(4);
  const name = page.getByRole("textbox", { name: "作品名称", exact: true });
  await name.fill("第二份");
  await name.press("Tab");
  await saved(page);
  await page.locator("#archive-list").getByRole("button", { name: "第一份", exact: true }).click();
  await expect(name).toHaveValue("第一份");
  await page.getByRole("button", { name: "删除当前存档", exact: true }).click();
  await expect(page.locator("#delete-dialog")).toBeVisible();
  await page.locator("#delete-dialog").getByRole("button", { name: "取消", exact: true }).click();
  await expect(page.locator("#archive-list [data-archive]")).toHaveCount(4);
  await page.getByRole("button", { name: "删除当前存档", exact: true }).click();
  await page
    .locator("#delete-dialog")
    .getByRole("button", { name: "删除存档", exact: true })
    .click();
  await expect(page.locator("#archive-list [data-archive]")).toHaveCount(3);
  await expect(name).toHaveValue("第二份");
  await page.reload();
  await expect(name).toHaveValue("第二份");
  await expect(page.locator("#archive-list [data-archive]")).toHaveCount(3);
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
  await page.getByRole("combobox", { name: "浮动字体", exact: true }).selectOption("KaiTi");
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
  await expect(page.locator("#archive-list [data-archive]")).toHaveCount(3);
  await expect(page.getByRole("heading", { name: "参考示例", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "新建存档", exact: true }).click();
  await page.getByRole("button", { name: "新建存档", exact: true }).click();
  await expect(page.locator("#archive-list [data-archive]")).toHaveCount(3);
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
  await page.getByRole("checkbox", { name: "隐藏", exact: true }).check();
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
  await expect(page.locator("#archive-list [data-archive]")).toHaveCount(2);
  await expect(page.locator('[data-archive="first"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('[data-archive="edited"]')).toBeVisible();
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
