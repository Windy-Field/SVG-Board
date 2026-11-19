import { chromium, expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { createDocument, createShape, GRID_SIZE, MAX_NAME_LENGTH } from "../../src/core/model";
import { parseDocument } from "../../src/storage/document";
import { createFlowTemplate } from "../../src/objects/templates";
import type { BoardDocument, Point } from "../../src/core/types";
import { selectArchive, testArtifact } from "./helpers";
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
    "函数绘制",
    "点拟合",
    "自由画笔",
    "文字"
  ]);
  const constructions = await page.locator(".geometry-tools button").evaluateAll(readToolNames);
  expect(constructions).toEqual(["两点直线", "交点", "中点", "平行线", "垂线", "角平分线"]);
  const bisectorButton = page.getByRole("button", { name: "角平分线", exact: true });
  const bisectorIcon = bisectorButton.locator('svg[data-geometry-icon="bisector"]');
  await expect(bisectorIcon).toBeVisible();
  await expect(bisectorIcon).toHaveAttribute("viewBox", "0 0 24 24");
  await page.locator(".geometry-tools").screenshot({ path: testArtifact("geometry-toolbar.png") });
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
  await page.screenshot({ path: testArtifact("workspace-toolbar.png") });
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
  await page.screenshot({ path: testArtifact("workspace-arrow.png") });
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
  await drag(page, await screen(page, { x: 200, y: 200 }), await screen(page, { x: 320, y: 200 }));
  let document = await saved(page);
  expect(document.shapes[0].width).toBeCloseTo(120, 4);
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

/** 读取目标附近的蓝色预览或绿色构造线，避免单个像素受抗锯齿影响 */
async function hasPreviewInk(
  page: Page,
  position: Point,
  construction: boolean = false
): Promise<boolean> {
  /** 将屏幕位置换算成画布像素，再查找对应的笔画颜色 */
  function sample(canvas: Element, target: { position: Point; construction: boolean }): boolean {
    if (!(canvas instanceof HTMLCanvasElement)) {
      throw new Error("未找到绘图画布");
    }
    const context = canvas.getContext("2d");
    if (context === null) {
      throw new Error("无法读取画布像素");
    }
    const bounds = canvas.getBoundingClientRect();
    const point = target.position;
    const scale = canvas.width / bounds.width;
    const left = Math.round((point.x - bounds.x - 6) * scale);
    const top = Math.round((point.y - bounds.y - 6) * scale);
    const size = Math.round(12 * scale);
    const pixels = context.getImageData(left, top, size, size).data;
    for (let index = 0; index < pixels.length; index = index + 4) {
      const red = pixels[index];
      const green = pixels[index + 1];
      const blue = pixels[index + 2];
      if (target.construction && green - red > 65 && green - blue > 15) {
        return true;
      }
      if (!target.construction && blue - red > 90) {
        return true;
      }
    }
    return false;
  }

  const canvas = page.locator(".lower-canvas");
  return canvas.evaluate(sample, { position: position, construction: construction });
}

/** 在不按鼠标时检查活动边，确认草稿可取消，点回起点仅提交一个图形 */
async function checkPolygonPreview(page: Page): Promise<void> {
  await openBoard(page, createDocument());
  await page.locator("#grid-button").click();
  await page.locator("#axes-button").click();
  await mode(page, "polygons", "自定义多边形");
  const first = await screen(page, { x: 180, y: 200 });
  const second = await screen(page, { x: 440, y: 200 });
  const third = await screen(page, { x: 180, y: 480 });
  const horizontal = await screen(page, { x: 310, y: 200 });
  const vertical = await screen(page, { x: 180, y: 340 });
  await page.mouse.click(first.x, first.y);
  await page.mouse.move(second.x, second.y);
  await expect.poll(hasPreviewInk.bind(null, page, horizontal)).toBe(true);
  await page.mouse.move(third.x, third.y);
  await expect.poll(hasPreviewInk.bind(null, page, vertical)).toBe(true);
  await expect.poll(hasPreviewInk.bind(null, page, horizontal)).toBe(false);
  await expect(page.locator("#object-count")).toHaveText("0 个对象");
  await page.keyboard.press("Escape");
  await expect.poll(hasPreviewInk.bind(null, page, vertical)).toBe(false);
  await expect(page.locator("#object-count")).toHaveText("0 个对象");

  await page.getByRole("button", { name: "自定义多边形", exact: true }).click();
  await page.mouse.click(first.x, first.y);
  await page.mouse.click(second.x, second.y);
  await page.mouse.click(third.x, third.y);
  await page.mouse.move(first.x + 5, first.y);
  await expect.poll(hasPreviewInk.bind(null, page, horizontal)).toBe(true);
  await expect.poll(hasPreviewInk.bind(null, page, vertical)).toBe(true);
  await page.mouse.click(first.x + 5, first.y);
  const document = await saved(page);
  expect(document.shapes.length).toBe(1);
  expect(document.shapes[0].points.length).toBe(3);
  await expect(page.getByRole("button", { name: "自定义多边形", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true"
  );
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(page.locator("#object-count")).toHaveText("0 个对象");
}

/** 检查取消未松手的笔画后，新笔画不会带上旧路径 */
async function checkPencilCancel(page: Page): Promise<void> {
  await openBoard(page, createDocument());
  await page.getByRole("button", { name: "自由画笔", exact: true }).click();
  const start = await screen(page, { x: 200, y: 200 });
  const end = await screen(page, { x: 400, y: 300 });
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 5 });
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(page.locator("#object-count")).toHaveText("0 个对象");

  await page.getByRole("button", { name: "自由画笔", exact: true }).click();
  const nextStart = await screen(page, { x: 600, y: 400 });
  const nextEnd = await screen(page, { x: 720, y: 460 });
  await drag(page, nextStart, nextEnd);
  const document = await saved(page);
  expect(document.shapes.length).toBe(1);
  expect(document.shapes[0].kind).toBe("pencil");
  expect(document.shapes[0].x).toBeGreaterThan(590);
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
  await page.screenshot({ path: testArtifact("text-description-desktop.png") });
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
  await page.screenshot({ path: testArtifact("delete-hover.png") });
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
  let path = testArtifact("workspace-empty.png");
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
  await page.screenshot({ path: testArtifact("arrow-intersection.png") });
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

/** 验证线段与圆的两次点击放置，几何点和两点直线保留依赖 */
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
  await page.getByRole("button", { name: "两点直线", exact: true }).click();
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

/** 线段与箭头两端落在现有点上时，点移动后对象应跟随更新 */
async function checkDrawnLinesFollowPoints(page: Page): Promise<void> {
  const document = createDocument();
  const first = createShape("point", { x: 200, y: 200 });
  const second = createShape("point", { x: 500, y: 200 });
  document.shapes.push(first, second);
  await openBoard(page, document);

  await page.getByRole("button", { name: "线段", exact: true }).click();
  const firstPosition = await screen(page, first);
  const secondPosition = await screen(page, second);
  await page.mouse.click(firstPosition.x, firstPosition.y);
  await page.mouse.click(secondPosition.x, secondPosition.y);
  let savedDocument = await saved(page);
  const line = savedDocument.shapes[2];
  expect(line.relation.kind).toBe("segment");
  expect(line.relation.sources).toEqual([first.id, second.id]);

  await page.getByRole("button", { name: "选择", exact: true }).click();
  await page.locator("#objects-tab").click();
  const selectedPoint = page.locator('[data-object-select="' + first.id + '"]');
  await selectedPoint.click();
  await page.locator("#properties-tab").click();
  const horizontal = page.getByRole("spinbutton", { name: "X", exact: true });
  await horizontal.fill("240");
  await horizontal.press("Tab");
  savedDocument = await saved(page);
  expect(savedDocument.shapes[2].x).toBeCloseTo(240, 4);
  expect(savedDocument.shapes[2].width).toBeCloseTo(260, 4);

  const arrowStart = await screen(page, savedDocument.shapes[0]);
  const arrowEnd = await screen(page, savedDocument.shapes[1]);
  await mode(page, "lines", "箭头");
  await page.mouse.click(arrowStart.x, arrowStart.y);
  await page.mouse.click(arrowEnd.x, arrowEnd.y);
  savedDocument = await saved(page);
  const arrow = savedDocument.shapes[3];
  expect(arrow.kind).toBe("arrow");
  expect(arrow.relation.sources).toEqual([first.id, second.id]);
  await page.getByRole("button", { name: "选择", exact: true }).click();
  await page.locator("#objects-tab").click();
  await selectedPoint.click();
  await page.locator("#properties-tab").click();
  await horizontal.fill("270");
  await horizontal.press("Tab");
  savedDocument = await saved(page);
  expect(savedDocument.shapes[2].x).toBeCloseTo(270, 4);
  expect(savedDocument.shapes[3].x).toBeCloseTo(270, 4);
}

/** 吸附开启时拖动来源点，松手前直线和后续中点就要出现在新位置 */
async function checkLiveConstructionDrag(page: Page): Promise<void> {
  const document = createDocument();
  const first = createShape("point", { x: 200, y: 200 });
  const second = createShape("point", { x: 520, y: 200 });
  document.shapes.push(first, second);
  await openBoard(page, document);
  await page.locator("#snap-button").click();
  await page.getByRole("button", { name: "两点直线", exact: true }).click();
  const start = await screen(page, first);
  const end = await screen(page, second);
  await page.mouse.click(start.x, start.y);
  await page.mouse.click(end.x, end.y);
  await page.getByRole("button", { name: "中点", exact: true }).click();
  const constructed = await saved(page);
  const line = constructed.shapes[2];
  const midpoint = constructed.shapes[3];
  expect(line.relation.sources).toEqual([first.id, second.id]);
  expect(midpoint.relation.sources).toEqual([line.id]);

  await page.getByRole("button", { name: "选择", exact: true }).click();
  const oldStroke = await screen(page, { x: 280, y: 200 });
  const newStroke = await screen(page, { x: 280, y: 275 });
  const destination = await screen(page, { x: 200, y: 300 });
  await expect.poll(hasPreviewInk.bind(null, page, oldStroke, true)).toBe(true);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(destination.x, destination.y, { steps: 10 });
  await expect.poll(hasPreviewInk.bind(null, page, newStroke, true)).toBe(true);
  await expect.poll(hasPreviewInk.bind(null, page, oldStroke, true)).toBe(false);
  await page.mouse.up();

  const moved = await saved(page);
  expect(moved.shapes[0].y).toBe(300);
  expect(moved.shapes[2].y).toBe(300);
  expect(moved.shapes[3].y).toBe(250);
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  const restored = await saved(page);
  expect(restored.shapes[0].y).toBe(200);
  expect(restored.shapes[3].y).toBe(200);
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
  await page.screenshot({ path: testArtifact("locked-object.png") });
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
    await page.screenshot({ path: testArtifact("export-preview-" + width + ".png") });
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
    await page.screenshot({ path: testArtifact("text-toolbar-menu-" + width + ".png") });
    await page.keyboard.press("Escape");
    await page.screenshot({ path: testArtifact("text-toolbar-" + width + ".png") });
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
  horizontal.width = 480;
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

/** 从整图选区生成各边中点，撤销后用矩形和补选的点批量作垂线 */
async function checkWholeShapeConstruction(page: Page): Promise<void> {
  const document = createDocument();
  const polygon = createShape("polygon", { x: 200, y: 200 });
  polygon.width = 200;
  polygon.height = 160;
  polygon.sides = 3;
  polygon.points = [
    { x: 0, y: 0 },
    { x: 200, y: 0 },
    { x: 70, y: 160 }
  ];
  const rectangle = createShape("rect", { x: 500, y: 200 });
  rectangle.width = 200;
  rectangle.height = 160;
  const point = createShape("point", { x: 800, y: 400 });
  document.shapes.push(polygon, rectangle, point);
  await openBoard(page, document);

  const insidePolygon = await screen(page, { x: 280, y: 255 });
  await page.mouse.click(insidePolygon.x, insidePolygon.y);
  await page.getByRole("button", { name: "中点", exact: true }).click();
  const withMidpoints = await saved(page);
  const edges: number[] = [];
  for (const shape of withMidpoints.shapes) {
    if (shape.relation.kind === "midpoint" && shape.relation.sourceEdges !== undefined) {
      expect(shape.relation.sources).toEqual([polygon.id]);
      const edge = shape.relation.sourceEdges[0];
      if (edge !== null) {
        edges.push(edge);
      }
    }
  }
  expect(edges).toEqual([0, 1, 2]);
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(page.locator("#object-count")).toHaveText("3 个对象");

  const insideRectangle = await screen(page, { x: 600, y: 270 });
  await page.mouse.click(insideRectangle.x, insideRectangle.y);
  await page.getByRole("button", { name: "垂线", exact: true }).click();
  await expect(page.locator("#message")).toHaveText("再选一个点");
  const pointPosition = await screen(page, point);
  await page.mouse.click(pointPosition.x, pointPosition.y);
  const withPerpendiculars = await saved(page);
  expect(withPerpendiculars.shapes.length).toBe(7);
  for (let index = 0; index < 4; index = index + 1) {
    const line = withPerpendiculars.shapes[index + 3];
    expect(line.relation.kind).toBe("perpendicular");
    expect(line.relation.sources).toEqual([rectangle.id, point.id]);
    expect(line.relation.sourceEdges).toEqual([index, null]);
  }
}

/** 导入后点选同一矩形的两条边，交点保存后仍跟随矩形移动 */
async function checkImportedEdges(page: Page): Promise<void> {
  await openBoard(page, createDocument());
  const markup =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 700 600"><rect x="160" y="140" width="240" height="180" fill="#ffffff" stroke="#333333"/></svg>';
  const input = page.locator("#file-input");
  await input.setInputFiles({
    name: "frame.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(markup)
  });
  await expect(page.locator("#object-count")).toHaveText("1 个对象");
  await page.getByRole("button", { name: "适应画布", exact: true }).click();
  const document = await saved(page);
  const frame = document.shapes[0];
  expect(frame.kind).toBe("rect");
  const top = await screen(page, { x: frame.x + frame.width / 2, y: frame.y });
  const left = await screen(page, { x: frame.x, y: frame.y + frame.height / 2 });
  const middle = await screen(page, {
    x: frame.x + frame.width / 2,
    y: frame.y + frame.height / 2
  });
  await page.getByRole("button", { name: "交点", exact: true }).click();
  await page.mouse.click(middle.x, middle.y);
  await expect.poll(hasPreviewInk.bind(null, page, top)).toBe(false);
  await page.mouse.move(top.x, top.y);
  await expect.poll(hasPreviewInk.bind(null, page, top)).toBe(true);
  await page.mouse.click(top.x, top.y);
  await page.mouse.move(left.x, left.y);
  await expect.poll(hasPreviewInk.bind(null, page, top)).toBe(true);
  await page.mouse.click(left.x, left.y);
  const constructed = await saved(page);
  const intersection = constructed.shapes[1];
  expect(intersection.locked).toBe(true);
  expect(intersection.relation.sources).toEqual([frame.id, frame.id]);
  expect(intersection.relation.sourceEdges).toEqual([0, 3]);
  expect(intersection.x).toBeCloseTo(frame.x, 4);
  expect(intersection.y).toBeCloseTo(frame.y, 4);

  await page.reload();
  await expect(page.locator("#object-count")).toHaveText("3 个对象");
  await page.locator("#objects-tab").click();
  const source = page.locator('[data-object-select="' + frame.id + '"]');
  await source.click();
  await page.locator("#properties-tab").click();
  const horizontal = page.getByRole("spinbutton", { name: "X", exact: true });
  const nextX = Math.round(frame.x) + 60;
  await horizontal.fill(String(nextX));
  await horizontal.press("Tab");
  const moved = await saved(page);
  expect(moved.shapes[1].x).toBeCloseTo(nextX, 4);
  expect(moved.shapes[1].y).toBeCloseTo(frame.y, 4);
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
  await page.screenshot({ path: testArtifact("archive-menu-desktop.png") });
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

/** 在浏览器验证多边形的活动边、闭合与撤销 */
async function testPolygonPreview(): Promise<void> {
  await runBrowser(checkPolygonPreview);
}

/** 在浏览器验证未完成的笔画可以取消 */
async function testPencilCancel(): Promise<void> {
  await runBrowser(checkPencilCancel);
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

/** 在浏览器检查线段和箭头是否保持与端点的关联 */
async function testDrawnLinesFollowPoints(): Promise<void> {
  await runBrowser(checkDrawnLinesFollowPoints);
}

/** 检查实时联动与整次拖动的撤销记录 */
async function testLiveConstructionDrag(): Promise<void> {
  await runBrowser(checkLiveConstructionDrag);
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

/** 在浏览器验证 SVG 直边的高亮、保存和构造联动 */
async function testImportedEdges(): Promise<void> {
  await runBrowser(checkImportedEdges);
}

/** 用浏览器检查先选整图的批量构造和补选来源 */
async function testWholeShapeConstruction(): Promise<void> {
  await runBrowser(checkWholeShapeConstruction);
}

/** 检查菜单收起与存档菜单布局 */
async function testMenuToggle(): Promise<void> {
  await runBrowser(checkMenuToggle);
}

/** 检查构造锁定、长度修改、存档恢复与手动解锁 */
async function testConstructionLocks(): Promise<void> {
  await runBrowser(checkConstructionLocks);
}

/** 模拟存档写入失败，确认作品留在画板上且重试不会清空撤销记录 */
async function checkSaveFailure(page: Page): Promise<void> {
  await openBoard(page, createDocument());
  /** 拦截存档写入，直到测试允许恢复 */
  function blockArchiveWrites(): void {
    const write = Storage.prototype.setItem;
    /** 只阻止作品列表写入，保留其他浏览器存储行为 */
    function writeWithQuota(this: Storage, key: string, value: string): void {
      if (key === "svg-board-archives-v1" && sessionStorage.getItem("allow-save") === null) {
        throw new DOMException("模拟存储空间不足", "QuotaExceededError");
      }
      write.call(this, key, value);
    }
    Storage.prototype.setItem = writeWithQuota;
  }
  await page.evaluate(blockArchiveWrites);
  const title = page.getByRole("textbox", { name: "作品名称" });
  await title.fill("尚未保存的作品");
  await title.press("Tab");
  await expect(page.locator("#save-status")).toHaveText("保存失败");
  expect(await page.evaluate(leavingIsBlocked)).toBe(true);
  await selectArchive(page, "课程作业 · 提交流程");
  await expect(title).toHaveValue("尚未保存的作品");
  await expect(page.locator("#message")).toContainText("请导出项目备份");
  await page.getByRole("button", { name: "新建画板", exact: true }).click();
  await expect(title).toHaveValue("尚未保存的作品");
  /** 恢复正常存储，验证用户可直接重试 */
  function allowSave(): void {
    sessionStorage.setItem("allow-save", "true");
  }
  await page.evaluate(allowSave);
  await page.keyboard.press("Control+s");
  await expect(page.locator("#message")).toHaveText("已保存到此浏览器");
  expect(await page.evaluate(leavingIsBlocked)).toBe(false);
  await selectArchive(page, "尚未保存的作品");
  const undo = page.getByRole("button", { name: "撤销", exact: true });
  await expect(undo).toBeEnabled();
  await undo.click();
  await expect(page.locator("#message")).toHaveText("已撤销上一步");
}

/** 检查离开事件是否被拦截，不需要真的关闭页面 */
function leavingIsBlocked(): boolean {
  const event = new Event("beforeunload", { cancelable: true });
  return !window.dispatchEvent(event);
}

/** 修改名称但不失焦，重载页面时仍应弹出浏览器确认 */
async function checkLeaveWarning(page: Page): Promise<void> {
  await openBoard(page, createDocument());
  const title = page.getByRole("textbox", { name: "作品名称" });
  await title.click();
  await title.fill("尚未提交的名称");
  expect(await page.evaluate(leavingIsBlocked)).toBe(true);
  const warning = page.waitForEvent("dialog");
  /** 由页面发起重载，避免自动化关闭标签时跳过提示 */
  function requestReload(): void {
    /** 等当前脚本返回后再触发浏览器确认 */
    function reload(): void {
      window.location.reload();
    }
    window.setTimeout(reload, 0);
  }
  await page.evaluate(requestReload);
  const dialog = await warning;
  expect(dialog.type()).toBe("beforeunload");
  await dialog.dismiss();
  await expect(title).toHaveValue("尚未提交的名称");
  await title.press("Tab");
  await saved(page);
  expect(await page.evaluate(leavingIsBlocked)).toBe(false);
}

/** 多选点与线后应用批量命令，结果能够一次撤销 */
async function checkBatchConstruction(page: Page): Promise<void> {
  const board = createDocument();
  const first = createShape("point", { x: 210, y: 180 });
  const second = createShape("point", { x: 530, y: 240 });
  const horizontal = createShape("line", { x: 200, y: 350 });
  horizontal.width = 460;
  const vertical = createShape("line", { x: 450, y: 230 });
  vertical.height = 300;
  board.shapes.push(first, second, horizontal, vertical);
  await openBoard(page, board);
  await page.locator("#objects-tab").click();
  for (const line of [horizontal, vertical]) {
    const row = page.locator('[data-object-select="' + line.id + '"]');
    await row.click({ modifiers: ["Control"] });
  }
  const intersect = page.getByRole("button", { name: "交点", exact: true });
  await intersect.click();
  expect((await saved(page)).shapes.length).toBe(6);
  await page.locator('[data-object-select="' + horizontal.id + '"]').click();
  await page
    .locator('[data-object-select="' + vertical.id + '"]')
    .click({ modifiers: ["Control"] });
  await intersect.click();
  await expect(page.locator("#message")).toContainText("跳过 1 个已有或重合的交点");
  for (const point of [first, second]) {
    const row = page.locator('[data-object-select="' + point.id + '"]');
    await row.click({ modifiers: ["Control"] });
  }
  await page.getByRole("button", { name: "垂线", exact: true }).click();
  await expect(page.locator("#message")).toHaveText("已创建 4 个构造对象");
  expect((await saved(page)).shapes.length).toBe(10);
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  expect((await saved(page)).shapes.length).toBe(6);
}

/** 用浏览器验证原生退出提示和取消后的保存 */
async function testLeaveWarning(): Promise<void> {
  await runBrowser(checkLeaveWarning);
}

/** 用实际选区验证批量构造和撤销 */
async function testBatchConstruction(): Promise<void> {
  await runBrowser(checkBatchConstruction);
}

/** 验证取消不拆标签，确认保存后独立文字可以重新打开 */
async function checkTextCancel(page: Page): Promise<void> {
  const document = createDocument();
  const rectangle = createShape("rect", { x: 200, y: 200 });
  rectangle.width = 400;
  rectangle.height = 180;
  rectangle.text = "说明".repeat(MAX_NAME_LENGTH);
  document.shapes.push(rectangle);
  await openBoard(page, document);
  await page.locator("#objects-tab").click();
  await page.locator('[data-object-select="' + rectangle.id + '"]').click();
  await page.locator("#properties-tab").click();
  const edit = page.getByRole("button", { name: "编辑", exact: true });
  await edit.click();
  await page.locator("#text-value").fill("不保存的修改");
  await page.keyboard.press("Escape");
  await expect(page.locator("#text-dialog")).not.toBeVisible();
  await page.keyboard.press("Control+s");
  const unchanged = await saved(page);
  expect(unchanged.shapes).toHaveLength(1);
  expect(unchanged.shapes[0].text).toBe(rectangle.text);
  await edit.click();
  await expect(page.locator("#text-value")).toHaveValue(rectangle.text);
  await page.getByRole("button", { name: "保存文字", exact: true }).click();
  const updated = await saved(page);
  expect(updated.shapes).toHaveLength(2);
  expect(updated.shapes[1].name).toHaveLength(MAX_NAME_LENGTH);
  expect(updated.shapes[1].text).toBe(rectangle.text);
}

/** 在窄屏上验证 PNG 忙碌、失败和重试状态 */
async function checkExportFeedback(page: Page): Promise<void> {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openBoard(page, createDocument());
  /** 暂存第一次编码的回调，便于检查处理中状态 */
  function delayFirstPng(): void {
    const encode = HTMLCanvasElement.prototype.toBlob;
    /** 第一次编码失败，后续使用浏览器原有实现 */
    function waitForFailure(this: HTMLCanvasElement, callback: BlobCallback): void {
      /** 收到测试信号后完成失败的编码 */
      function finishFailure(): void {
        HTMLCanvasElement.prototype.toBlob = encode;
        callback(null);
      }
      window.addEventListener("test-png-failure", finishFailure, { once: true });
    }
    HTMLCanvasElement.prototype.toBlob = waitForFailure;
  }
  await page.evaluate(delayFirstPng);
  await page.getByRole("button", { name: "导出", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "导出作品" });
  const png = dialog.getByRole("button", { name: "导出 PNG" });
  const status = dialog.getByRole("status");
  await png.click();
  await expect(status).toHaveText("正在生成 PNG");
  await expect(png).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  /** 通知模拟编码器返回失败 */
  function finishPng(): void {
    window.dispatchEvent(new Event("test-png-failure"));
  }
  await page.evaluate(finishPng);
  await expect(status).toContainText("PNG 编码失败");
  await expect(png).toBeEnabled();
  const download = page.waitForEvent("download");
  await png.click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/\.png$/);
  await expect(status).toHaveText("已发起 PNG 下载");
  await dialog.getByRole("button", { name: "关闭导出" }).click();
  await expect(page.locator("#export-preview img")).toHaveCount(0);
}

/** 使用浏览器验证保存失败后保留作品 */
async function testSaveFailure(): Promise<void> {
  await runBrowser(checkSaveFailure);
}

/** 使用浏览器验证文字取消和长标签保存 */
async function testTextCancel(): Promise<void> {
  await runBrowser(checkTextCancel);
}

/** 使用浏览器验证导出状态和失败重试 */
async function testExportFeedback(): Promise<void> {
  await runBrowser(checkExportFeedback);
}

/** 在尺寸变化当帧检查画布像素，避免等重绘完成后才发现闪白 */
async function readSidebarResize(): Promise<number> {
  /** 侧栏改变尺寸后，在浏览器绘制前采样背景像素 */
  function sampleAfterResize(resolve: (alpha: number) => void): void {
    const host = document.querySelector("#canvas-host");
    const canvas = document.querySelector(".lower-canvas");
    const toggle = document.querySelector("#inspector-button");
    if (
      host === null ||
      !(canvas instanceof HTMLCanvasElement) ||
      !(toggle instanceof HTMLButtonElement)
    ) {
      throw new Error("工作区未加载");
    }
    const context = canvas.getContext("2d");
    if (context === null) {
      throw new Error("画布无法读取");
    }
    const paint = context;
    const observer = new ResizeObserver(sample);
    observer.observe(host);
    toggle.click();

    /** 读取画布中心像素的透明度，并结束观察 */
    function sample(): void {
      observer.disconnect();
      const surface = paint.canvas;
      const pixel = paint.getImageData(surface.width / 2, surface.height / 2, 1, 1);
      resolve(pixel.data[3]);
    }
  }
  return new Promise<number>(sampleAfterResize);
}

/** 验证侧栏开合不清空画面，切换长短内容时三个标题都保持原位 */
async function checkSidebarStability(page: Page): Promise<void> {
  const board = createDocument();
  board.description = "# 说明\n\n" + "这是一段用于测试滚动的说明\n\n".repeat(55);
  await openBoard(page, board);
  expect(await page.evaluate(readSidebarResize)).toBe(255);
  await expect(page.locator("#inspector")).toBeHidden();
  expect(await page.evaluate(readSidebarResize)).toBe(255);
  await expect(page.locator("#inspector")).toBeVisible();
  await page.addStyleTag({ content: ".inspector::-webkit-scrollbar { width: 16px; }" });
  const tabs = page.locator(".inspector-tabs button");
  /** 只比较水平方向，选中样式不应改变任何标题列的位置或宽度 */
  function readTabPositions(buttons: HTMLElement[]): number[] {
    const positions: number[] = [];
    for (const button of buttons) {
      const bounds = button.getBoundingClientRect();
      positions.push(bounds.x, bounds.width);
    }
    return positions;
  }
  for (const width of [1280, 375]) {
    await page.setViewportSize({ width: width, height: 900 });
    await page.locator("#objects-tab").click();
    const shortPanel = await tabs.evaluateAll(readTabPositions);
    await page.locator("#description-tab").click();
    const longPanel = await tabs.evaluateAll(readTabPositions);
    expect(longPanel).toEqual(shortPanel);
  }
}

/** 使用浏览器复现侧栏开合和标题切换 */
async function testSidebarStability(): Promise<void> {
  await runBrowser(checkSidebarStability);
}

/** 验证连续操作替换提示并重新计时，淡出时仍保留文字 */
async function checkToastMotion(page: Page): Promise<void> {
  await openBoard(page, createDocument());
  await page.clock.install();
  const message = page.locator("#message");
  await page.keyboard.press("Control+c");
  await expect(message).toHaveText("请先选择要复制的对象");
  await page.clock.runFor(1500);
  await page.keyboard.press("Control+v");
  await expect(message).toHaveText("暂无可粘贴的对象");
  await page.clock.runFor(1800);
  await expect(message).not.toHaveClass(/message-hidden/);
  await page.clock.runFor(250);
  await expect(message).toHaveClass(/message-hidden/);
  await expect(message).toHaveText("暂无可粘贴的对象");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(message).toHaveCSS("translate", "0px");
}

/** 使用真实浏览器检查提示计时和减少动态效果 */
async function testToastMotion(): Promise<void> {
  await runBrowser(checkToastMotion);
}

test("提示停留两秒，新提示重新计时并支持减少动态效果", testToastMotion);
test("侧栏开合不闪白且切换标题不移位", testSidebarStability);
test("保存失败保留当前画板与撤销记录", testSaveFailure);
test("未保存重载时显示浏览器确认，保存后不再拦截", testLeaveWarning);
test("多选求交去重并一次撤销批量垂线", testBatchConstruction);
test("取消文字编辑不拆标签且长标签可保存", testTextCancel);
test("PNG 导出显示进度并可在失败后重试", testExportFeedback);
test("工具图标对齐与纵向文本编辑", testToolbar);
test("参考线可拖动且箭头端点吸附网格", testLines);
test("Ctrl 多选取消与右键框选", testSelection);
test("只读模式覆盖鼠标属性和快捷键", testReadOnly);
test("存档新建切换与删除确认", testArchives);
test("只读箭头端点不可修改", testReadOnlyLine);
test("多边形模式与贝塞尔控制点保存", testShapes);
test("多边形实时预览并点回起点闭合", testPolygonPreview);
test("取消画笔后可重新绘制", testPencilCancel);
test("浮动文字配置说明净化与侧栏扩展", testTextAndDescription);
test("折线中段调整与撤销", testBend);
test("存档去重标题单行与删除悬停颜色", testArchiveDuplicates);
test("重叠轮换与点名移动隐藏", testOverlapsAndPointLabels);
test("拖动决定尺寸且矩形圆角保存", testDrawingSizes);
test("空白工作台截图", testWorkspaceScreenshot);
test("默认吸附与线条端点交点优先", testEndpointIntersections);
test("旧存档合并重复并保留编辑副本", testLegacyDuplicates);
test("点击放置线圆与两点直线", testClickPlacement);
test("线段和箭头跟随用户已有的端点移动", testDrawnLinesFollowPoints);
test("吸附开启时两点直线和中点随拖动实时更新", testLiveConstructionDrag);
test("标题栏存档与保存透明导出", testHeaderAndExport);
test("右键框选笔画与已有多选", testMarqueeEdges);
test("对象管理隐藏仅作用目标并显示锁定", testObjectManagement);
test("图形与线条标签可单独移动编辑", testShapeLabels);
test("画布颜色保存与导出预览无溢出", testBackgroundAndPreview);
test("文字配置栏独立菜单与响应式布局", testTextToolbarLayout);
test("长按左键平移与快速拖动对象", testHoldPan);
test("所有几何方法支持先选工具再选来源", testConstructionMethods);
test("导入 SVG 的两条边可分别选择并联动", testImportedEdges);
test("先选整图再批量取中点和作垂线", testWholeShapeConstruction);
test("存档字体工具菜单重复点击收起", testMenuToggle);
test("构造对象默认锁定且长度可调", testConstructionLocks);
