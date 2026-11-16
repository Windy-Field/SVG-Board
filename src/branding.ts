import { createElement, PenTool } from "lucide";

// 标题与浏览器标签页图标共用的主题色
const BRAND_COLOR = "#2563eb";
// 标签页图标尺寸，单位为像素
const ICON_SIZE = 32;
// 标签页图标的线条粗细
const ICON_STROKE = 1.8;

/** 标题与标签页共用钢笔图标，表示可编辑的矢量路径 */
export function mountBrandIcon(): void {
  const image = createElement(PenTool);
  image.setAttribute("stroke", BRAND_COLOR);
  image.setAttribute("stroke-width", String(ICON_STROKE));
  image.setAttribute("width", String(ICON_SIZE));
  image.setAttribute("height", String(ICON_SIZE));
  const link = document.createElement("link");
  link.rel = "icon";
  link.type = "image/svg+xml";
  link.href = "data:image/svg+xml," + encodeURIComponent(image.outerHTML);
  document.head.append(link);
}
