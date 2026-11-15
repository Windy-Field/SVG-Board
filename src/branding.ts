import { createElement, PenTool } from "lucide";

/** 标题与标签页共用钢笔图标，表示可编辑的矢量路径 */
export function mountBrandIcon(): void {
  const image = createElement(PenTool);
  image.setAttribute("stroke", "#2563eb");
  image.setAttribute("stroke-width", "1.8");
  image.setAttribute("width", "32");
  image.setAttribute("height", "32");
  const link = document.createElement("link");
  link.rel = "icon";
  link.type = "image/svg+xml";
  link.href = "data:image/svg+xml," + encodeURIComponent(image.outerHTML);
  document.head.append(link);
}
