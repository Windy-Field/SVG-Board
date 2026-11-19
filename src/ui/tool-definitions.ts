import {
  ArrowUpRight,
  Slash,
  Link2,
  Type,
  Square,
  RectangleHorizontal,
  Pentagon,
  Dot,
  Spline
} from "lucide";
import { Circle, CircleDashed, MoveUpRight, MoveDiagonal, MapPin } from "lucide";
import type { Tool } from "../core/types";

// 保留文字工具的 T，用向下箭头区分竖排和横排
const VERTICAL_TEXT_ICON: typeof Type = [
  "svg",
  Type[1],
  [
    ["path", { d: "M3 6V4h10v2M8 4v16m-3 0h6" }],
    ["path", { d: "M18 4v16m-3-3 3 3 3-3" }]
  ]
];

// 不等长的边和顶点标记对应逐点绘制，尺寸沿用其他工具图标
const CUSTOM_POLYGON_ICON: typeof Pentagon = [
  "svg",
  Pentagon[1],
  [
    ["path", { d: "M4 9 11 4l9 3-3 7 3 5-13 1Z" }],
    ["circle", { cx: 4, cy: 9, r: 1.7, fill: "currentColor", stroke: "none" }],
    ["circle", { cx: 11, cy: 4, r: 1.7, fill: "currentColor", stroke: "none" }],
    ["circle", { cx: 20, cy: 7, r: 1.7, fill: "currentColor", stroke: "none" }],
    ["circle", { cx: 17, cy: 14, r: 1.7, fill: "currentColor", stroke: "none" }],
    ["circle", { cx: 20, cy: 19, r: 1.7, fill: "currentColor", stroke: "none" }],
    ["circle", { cx: 7, cy: 20, r: 1.7, fill: "currentColor", stroke: "none" }]
  ]
];

/** 分组工具共用同一份名称和图标，菜单与按钮不会出现模式不一致 */
export const TOOL_MODES = [
  { tool: "line", label: "线段", icon: Slash, group: "lines" },
  { tool: "ray", label: "射线", icon: MoveUpRight, group: "lines" },
  { tool: "straight", label: "直线", icon: MoveDiagonal, group: "lines" },
  { tool: "arrow", label: "箭头", icon: ArrowUpRight, group: "lines" },
  { tool: "connector", label: "连接线", icon: Link2, group: "lines" },
  { tool: "curve", label: "贝塞尔曲线", icon: Spline, group: "lines" },
  { tool: "text", label: "横向文本框", icon: Type, group: "text" },
  { tool: "vertical-text", label: "纵向文本框", icon: VERTICAL_TEXT_ICON, group: "text" },
  { tool: "rect", label: "矩形", icon: RectangleHorizontal, group: "rectangles" },
  { tool: "square", label: "正方形", icon: Square, group: "rectangles" },
  { tool: "ellipse", label: "椭圆", icon: CircleDashed, group: "ellipses" },
  { tool: "circle", label: "圆", icon: Circle, group: "ellipses" },
  { tool: "polygon", label: "正多边形", icon: Pentagon, group: "polygons" },
  { tool: "custom-polygon", label: "自定义多边形", icon: CUSTOM_POLYGON_ICON, group: "polygons" },
  { tool: "point", label: "几何点", icon: Dot, group: "points" },
  { tool: "coordinate-point", label: "坐标点", icon: MapPin, group: "points" },
  { tool: "segment", label: "两点直线", icon: Slash, group: "" }
];

/** 判断字符串是否为已配置的分组工具 */
export function isGroupedTool(value: string): value is Tool {
  for (const mode of TOOL_MODES) {
    if (mode.tool === value) {
      return true;
    }
  }
  return false;
}
