import {
  ArrowUpRight,
  Slash,
  Link2,
  Type,
  TextCursorInput,
  Square,
  RectangleHorizontal,
  Pentagon,
  PenTool,
  Dot,
  Spline
} from "lucide";
import { Circle, CircleDashed } from "lucide";
import type { Tool } from "./types";

/** 分组工具共用同一份名称和图标，菜单与按钮不会出现模式不一致 */
export const TOOL_MODES = [
  { tool: "line", label: "线段", icon: Slash, group: "lines" },
  { tool: "arrow", label: "箭头", icon: ArrowUpRight, group: "lines" },
  { tool: "connector", label: "连接线", icon: Link2, group: "lines" },
  { tool: "curve", label: "贝塞尔曲线", icon: Spline, group: "lines" },
  { tool: "text", label: "横向文本框", icon: Type, group: "text" },
  { tool: "vertical-text", label: "纵向文本框", icon: TextCursorInput, group: "text" },
  { tool: "rect", label: "矩形", icon: RectangleHorizontal, group: "rectangles" },
  { tool: "square", label: "正方形", icon: Square, group: "rectangles" },
  { tool: "ellipse", label: "椭圆", icon: CircleDashed, group: "ellipses" },
  { tool: "circle", label: "圆", icon: Circle, group: "ellipses" },
  { tool: "polygon", label: "正多边形", icon: Pentagon, group: "polygons" },
  { tool: "custom-polygon", label: "自定义多边形", icon: PenTool, group: "polygons" },
  { tool: "point", label: "几何点", icon: Dot, group: "" },
  { tool: "segment", label: "两点线段", icon: Slash, group: "" }
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
