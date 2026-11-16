import { createDocument, createShape } from "../core/model";
import { updateRelations } from "../geometry/geometry";
import type { BoardDocument, Shape, ShapeKind } from "../core/types";

// 流程图处理节点填充色
const FLOW_BLUE = "#eaf1ff";
// 流程图起止节点填充色
const FLOW_GREEN = "#e9f6ee";
// 流程图判断节点填充色
const FLOW_YELLOW = "#fff6dc";
// 三角形中线与中点的颜色
const GEOMETRY_GREEN = "#148063";
// 流程图连接文字字号
const FLOW_LABEL_SIZE = 18;
// 流程图连接线颜色
const FLOW_LINE_COLOR = "#64748b";
// 三角形顶点名称的字号
const VERTEX_LABEL_SIZE = 24;

/** 向模板添加节点并设置文字，返回节点以便建立连接 */
function addNode(
  document: BoardDocument,
  kind: ShapeKind,
  name: string,
  left: number,
  top: number,
  width: number,
  height: number,
  fill: string
): Shape {
  const shape = createShape(kind, { x: left, y: top });
  shape.name = name;
  shape.text = name;
  shape.width = width;
  shape.height = height;
  shape.fill = fill;
  shape.layer = document.shapes.length;
  document.shapes.push(shape);
  return shape;
}

/** 在模板中的两个节点间建立关联连接线，线位于节点下方 */
function addConnector(document: BoardDocument, start: Shape, end: Shape, label: string): void {
  const shape = createShape("connector", { x: 0, y: 0 });
  shape.relation = { kind: "connector", sources: [start.id, end.id] };
  shape.name = start.name + " → " + end.name;
  shape.text = label;
  shape.fontSize = FLOW_LABEL_SIZE;
  shape.fill = "none";
  shape.stroke = FLOW_LINE_COLOR;
  shape.layer = -1;
  document.shapes.push(shape);
}

/** 创建可编辑的流程图模板，用于演示连接线随节点移动 */
export function createFlowTemplate(): BoardDocument {
  const document = createDocument();
  document.name = "课程作业 · 提交流程";
  const title = addNode(document, "text", "课程作业提交流程", 160, 95, 760, 52, "none");
  title.fontSize = 32;
  title.textAlign = "start";
  const start = addNode(document, "ellipse", "开始", 160, 230, 140, 64, FLOW_GREEN);
  const input = addNode(document, "rect", "准备作业材料", 370, 230, 180, 64, FLOW_BLUE);
  const check = addNode(document, "diamond", "材料完整？", 640, 210, 180, 104, FLOW_YELLOW);
  const submit = addNode(document, "rect", "提交作业", 910, 230, 160, 64, FLOW_BLUE);
  const repair = addNode(document, "rect", "补充材料", 640, 440, 180, 64, "#fceeee");
  const end = addNode(document, "ellipse", "完成", 920, 440, 140, 64, FLOW_GREEN);
  addConnector(document, start, input, "");
  addConnector(document, input, check, "");
  addConnector(document, check, submit, "是");
  addConnector(document, check, repair, "否");
  addConnector(document, repair, input, "");
  addConnector(document, submit, end, "");
  updateRelations(document);
  // 返回分支留出独立通道，避免补充材料的连线穿过主流程节点
  const returnLine = document.shapes[11];
  returnLine.relation = { kind: "none", sources: [] };
  returnLine.x = 640;
  returnLine.y = 472;
  returnLine.width = -180;
  returnLine.height = -178;
  return document;
}

/** 创建关联两点的线段，供三角形和中线复用 */
function addSegment(document: BoardDocument, first: Shape, second: Shape): Shape {
  const shape = createShape("line", { x: first.x, y: first.y });
  shape.name = first.text + second.text;
  shape.fill = "none";
  shape.relation = { kind: "segment", sources: [first.id, second.id] };
  shape.locked = true;
  shape.layer = -1;
  document.shapes.push(shape);
  return shape;
}

/** 创建三角形中线模板，顶点、中点与线段保存真实依赖关系 */
export function createGeometryTemplate(): BoardDocument {
  const document = createDocument();
  document.name = "几何作图 · 三角形中线";
  const title = addNode(document, "text", "三角形与中线", 180, 90, 700, 50, "none");
  title.textAlign = "start";
  title.fontSize = 30;
  const first = addNode(document, "point", "A", 570, 240, 0, 0, "#ffffff");
  const second = addNode(document, "point", "B", 290, 570, 0, 0, "#ffffff");
  const third = addNode(document, "point", "C", 890, 570, 0, 0, "#ffffff");
  addSegment(document, first, second);
  addSegment(document, first, third);
  const base = addSegment(document, second, third);
  const midpoint = addNode(document, "point", "D", 0, 0, 0, 0, "#ffffff");
  midpoint.stroke = GEOMETRY_GREEN;
  midpoint.relation = { kind: "midpoint", sources: [base.id] };
  midpoint.locked = true;
  const median = addSegment(document, first, midpoint);
  median.stroke = GEOMETRY_GREEN;
  median.dash = true;
  updateRelations(document);
  // 顶点名用独立文本框，文字可以单独选中、移动和编辑
  const vertices = [first, second, third, midpoint];
  for (const vertex of vertices) {
    const label = addNode(
      document,
      "text",
      vertex.name,
      vertex.x + 10,
      vertex.y - 36,
      48,
      32,
      "none"
    );
    label.fontSize = VERTEX_LABEL_SIZE;
    label.textAlign = "start";
    label.relation = { kind: "label", sources: [vertex.id], offsetX: 10, offsetY: -36 };
    vertex.text = "";
  }
  return document;
}
