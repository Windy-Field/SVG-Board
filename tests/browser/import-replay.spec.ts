import { chromium, expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { BoardDocument } from "../../src/core/types";
import { parseDocument } from "../../src/storage/document";

// 与其他浏览器测试使用同一个可选浏览器通道
const CHANNEL = process.env.PLAYWRIGHT_CHANNEL;

/** 模拟从文件选择器打开下载的 SVG */
async function openSvg(page: Page, name: string, markup: string): Promise<void> {
  await page
    .locator("#file-input")
    .setInputFiles({ name: name, mimeType: "image/svg+xml", buffer: Buffer.from(markup) });
  await expect(page.getByRole("textbox", { name: "作品名称" })).toHaveValue(name.slice(0, -4));
}

/** 等待自动保存完成后，用正式读取器校验文件结构 */
async function savedBoard(page: Page): Promise<BoardDocument> {
  await expect(page.locator("#save-status")).toHaveText("已保存到此浏览器");
  /** 从浏览器读取自动恢复内容 */
  function read(): string {
    return localStorage.getItem("svg-board-document-v1") || "";
  }
  return parseDocument(await page.evaluate(read));
}

/** 读取 SVG 导出预览并查看嵌套图像是否实际显示 */
async function previewPixel(): Promise<number[]> {
  const image = document.querySelector("#export-preview img");
  if (!(image instanceof HTMLImageElement)) {
    return [];
  }
  await image.decode();
  const sample = document.createElement("canvas");
  sample.width = image.naturalWidth;
  sample.height = image.naturalHeight;
  const context = sample.getContext("2d");
  if (context === null) {
    return [];
  }
  context.drawImage(image, 0, 0);
  const pixel = context.getImageData(sample.width / 2, sample.height / 2, 1, 1);
  return Array.from(pixel.data);
}

/** 简单 SVG 可逐个编辑，带定义和脚本的图像以图片模式保留 */
async function testSvgImport(): Promise<void> {
  const browser = await chromium.launch({ channel: CHANNEL });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto("http://127.0.0.1:5173/");
    await openSvg(
      page,
      "simple.svg",
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 60"><rect x="2" y="5" width="30" height="20" fill="#f00"/><path d="M40 0 Q60 20 55 50 Z" fill="blue"/></svg>'
    );
    const simple = await savedBoard(page);
    expect(simple.shapes[0].kind).toBe("rect");
    expect(simple.shapes[0].fill).toBe("#ff0000");
    expect(simple.shapes[1].kind).toBe("path");
    await openSvg(
      page,
      "gradient.svg",
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 70"><defs><linearGradient id="paint"><stop stop-color="#ff0000"/><stop offset="1" stop-color="#0000ff"/></linearGradient></defs><rect width="100" height="70" fill="url(#paint)"/><script>document.title = "unexpected"</script></svg>'
    );
    const complex = await savedBoard(page);
    expect(complex.shapes[0].kind).toBe("svg-image");
    const image = complex.shapes[0].svgImage;
    if (image === undefined) {
      throw new Error("作品缺少 SVG 图像");
    }
    expect(image.width).toBe(100);
    await expect(page).not.toHaveTitle("unexpected");
    await page.getByRole("button", { name: "导出", exact: true }).click();
    const color = await page.evaluate(previewPixel);
    expect(color[0]).toBeGreaterThan(60);
    expect(color[2]).toBeGreaterThan(60);
    expect(color[3]).toBe(255);
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "导出 SVG", exact: true }).click();
    const file = await download;
    const filepath = await file.path();
    await page.getByRole("button", { name: "关闭导出", exact: true }).click();
    await page.locator("#file-input").setInputFiles(filepath);
    await expect(page.locator("#message")).toContainText("保留为可整体编辑");
    expect((await savedBoard(page)).shapes[0].kind).toBe("svg-image");
  } finally {
    await browser.close();
  }
}

/** 回放包含导入、重命名与隐藏，退出后不改变现有作品和撤销指针 */
async function testEditReplay(): Promise<void> {
  const browser = await chromium.launch({ channel: CHANNEL });
  try {
    const page = await browser.newPage({ viewport: { width: 375, height: 800 } });
    await page.goto("http://127.0.0.1:5173/");
    await openSvg(
      page,
      "replay.svg",
      '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="70"><rect width="80" height="40" fill="red"/></svg>'
    );
    const title = page.getByRole("textbox", { name: "作品名称" });
    await title.fill("回放测试");
    await title.press("Tab");
    await page.locator("#canvas-host").click();
    await page.keyboard.press("Control+a");
    await page.keyboard.press("Control+h");
    expect((await savedBoard(page)).shapes[0].hidden).toBe(true);
    await page.getByRole("button", { name: "编辑回放", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "编辑回放" });
    const step = dialog.locator("#replay-step");
    await expect(step).toHaveText("1 / 4");
    await dialog.getByRole("button", { name: "下一步" }).click();
    await expect(step).toHaveText("2 / 4");
    await dialog.getByRole("slider", { name: "回放进度" }).press("End");
    await expect(step).toHaveText("4 / 4");
    await dialog.getByRole("button", { name: "播放回放" }).click();
    await expect(dialog.getByRole("button", { name: "暂停回放" })).toBeVisible();
    await dialog.getByRole("button", { name: "暂停回放" }).click();
    await expect(dialog.locator("#replay-error")).toBeEmpty();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(title).toHaveValue("回放测试");
    await page.getByRole("button", { name: "撤销", exact: true }).click();
    expect((await savedBoard(page)).shapes[0].hidden).toBe(false);
  } finally {
    await browser.close();
  }
}

test("导入普通 SVG，复杂效果可整图导出和恢复", testSvgImport);
test("回放任意编辑步骤且退出不改作品", testEditReplay);
