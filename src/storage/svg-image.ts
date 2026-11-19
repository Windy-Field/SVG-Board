import type { SvgImage } from "../core/types";

// SVG 根节点与导出文件使用同一命名空间
export const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

/** 固定以 SVG 图片模式加载，文件内容不会作为页面节点执行 */
export function svgImageUrl(image: SvgImage): string {
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(image.source);
}
