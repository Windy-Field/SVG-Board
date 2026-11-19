import { Point } from "fabric";
import type { Canvas, FabricObject } from "fabric";
import type { Bounds, Point as BoardPoint, Shape } from "../core/types";
import { getRotatedBounds, isLine } from "../core/model";
import { getLinePoints } from "../geometry/geometry";
import type { OutlineEdge } from "../geometry/outlines";

// 悬停和框选的提示颜色
const HOVER_COLOR = "#2563eb";
// 提示轮廓线宽，单位为屏幕像素
const OUTLINE_WIDTH = 1.5;
// 首个顶点的标记半径与预览虚线的长度，单位为屏幕像素
const POLYGON_START_RADIUS = 4;
const POLYGON_PREVIEW_DASH = [5, 4];
// 锁定标记的底色
const LOCK_BACKGROUND = "#ffffff";
// 锁定标记的描边颜色
const LOCK_COLOR = "#475569";
// 锁标记相对对象右上角的偏移，单位为屏幕像素
const LOCK_OFFSET_X = -8;
const LOCK_OFFSET_Y = -18;

/** 锁标记保存对象与模型，位置不依赖无限线临时裁剪后的外框 */
export interface LockedObject {
  object: FabricObject;
  shape: Shape;
}

/** 绘制画布提示和绘制草稿，不创建作品对象，也不参与保存与撤销 */
export class CanvasFeedback {
  private canvas: Canvas;
  private hovered: FabricObject | null = null;
  private marquee: Bounds | null = null;
  private locked: LockedObject[] = [];
  private polygonVertices: BoardPoint[] = [];
  private polygonNext: BoardPoint | null = null;
  private polygonClosing = false;
  private constructionEdges: OutlineEdge[] = [];
  private hoveredEdge: OutlineEdge | undefined;

  /** 绑定库的绘制事件，在场景绘制后补充鼠标指向提示 */
  constructor(canvas: Canvas) {
    this.canvas = canvas;
    canvas.on("after:render", this.draw.bind(this));
  }

  /** 切换高亮目标，目标不变时不重复请求重绘 */
  setHovered(object: FabricObject | null): void {
    if (this.hovered === object) {
      return;
    }
    this.hovered = object;
    this.canvas.requestRenderAll();
  }

  /** 右键框选与原生左键框选使用相同的轮廓颜色 */
  setMarquee(bounds: Bounds | null): void {
    this.marquee = bounds;
    this.canvas.requestRenderAll();
  }

  /** 保存需要显示锁标记的对象，标记仅用于编辑画面 */
  setLocked(objects: LockedObject[]): void {
    this.locked = objects;
  }

  /** 更新多边形已落下的顶点和待落点，传入空顶点列表可清除预览 */
  setPolygon(vertices: BoardPoint[], next: BoardPoint | null, closing: boolean): void {
    this.polygonVertices = vertices;
    this.polygonNext = next;
    this.polygonClosing = closing;
    this.canvas.requestRenderAll();
  }

  /** 保存已选直边与光标下的直边，清除时也请求重绘 */
  setConstructionEdges(edges: OutlineEdge[], hover: OutlineEdge | undefined): void {
    if (
      edges.length === 0 &&
      this.constructionEdges.length === 0 &&
      hover === undefined &&
      this.hoveredEdge === undefined
    ) {
      return;
    }
    this.constructionEdges = edges;
    this.hoveredEdge = hover;
    this.canvas.requestRenderAll();
  }

  /** 把草稿顶点换算成屏幕位置，使线宽和起点标记不随缩放改变 */
  private screenPoint(point: BoardPoint): Point {
    const position = new Point(point.x, point.y);
    return position.transform(this.canvas.viewportTransform);
  }

  /** 用实线显示已确认的边，虚线显示将要落下的边，起点可闭合时填实 */
  private drawPolygon(context: CanvasRenderingContext2D): void {
    if (this.polygonVertices.length === 0) {
      return;
    }
    const first = this.screenPoint(this.polygonVertices[0]);
    let last = first;
    context.save();
    context.strokeStyle = HOVER_COLOR;
    context.fillStyle = HOVER_COLOR;
    context.lineWidth = OUTLINE_WIDTH;
    context.beginPath();
    context.moveTo(first.x, first.y);
    for (let index = 1; index < this.polygonVertices.length; index = index + 1) {
      last = this.screenPoint(this.polygonVertices[index]);
      context.lineTo(last.x, last.y);
    }
    context.stroke();
    if (this.polygonNext !== null) {
      const next = this.screenPoint(this.polygonNext);
      context.setLineDash(POLYGON_PREVIEW_DASH);
      context.beginPath();
      context.moveTo(last.x, last.y);
      context.lineTo(next.x, next.y);
      context.stroke();
      context.setLineDash([]);
    }
    context.beginPath();
    context.arc(first.x, first.y, POLYGON_START_RADIUS, 0, Math.PI * 2);
    if (this.polygonClosing) {
      context.fill();
    } else {
      context.stroke();
    }
    context.restore();
  }

  /** 高亮选中的边，用虚线区分尚未点击的边 */
  private drawConstructionEdges(context: CanvasRenderingContext2D): void {
    if (this.constructionEdges.length === 0 && this.hoveredEdge === undefined) {
      return;
    }
    context.save();
    context.strokeStyle = HOVER_COLOR;
    context.lineWidth = OUTLINE_WIDTH * 2;
    context.beginPath();
    for (const edge of this.constructionEdges) {
      this.addEdgePath(context, edge);
    }
    context.stroke();
    if (this.hoveredEdge !== undefined) {
      context.setLineDash(POLYGON_PREVIEW_DASH);
      context.beginPath();
      this.addEdgePath(context, this.hoveredEdge);
      context.stroke();
    }
    context.restore();
  }

  /** 将画布坐标中的直边加入当前屏幕路径 */
  private addEdgePath(context: CanvasRenderingContext2D, edge: OutlineEdge): void {
    const start = this.screenPoint(edge.start);
    const end = this.screenPoint(edge.end);
    context.moveTo(start.x, start.y);
    context.lineTo(end.x, end.y);
  }

  /** 普通对象在右上角显示小锁，线条标记跟随实际方向点，不随作品导出 */
  private drawLocks(context: CanvasRenderingContext2D): void {
    for (const item of this.locked) {
      const object = item.object;
      if (!object.visible || object.canvas !== this.canvas) {
        continue;
      }
      const bounds = getRotatedBounds(item.shape);
      let position = new Point(bounds.x + bounds.width, bounds.y);
      if (isLine(item.shape)) {
        const endpoints = getLinePoints(item.shape);
        position = new Point(endpoints[1].x, endpoints[1].y);
      }
      const anchor = position.transform(this.canvas.viewportTransform);
      const left = anchor.x + LOCK_OFFSET_X;
      const top = anchor.y + LOCK_OFFSET_Y;
      context.save();
      context.fillStyle = LOCK_BACKGROUND;
      context.strokeStyle = LOCK_COLOR;
      context.lineWidth = OUTLINE_WIDTH;
      context.fillRect(left - 3, top - 3, 18, 20);
      context.strokeRect(left, top + 7, 12, 9);
      context.beginPath();
      context.arc(left + 6, top + 6, 4, Math.PI, 0);
      context.lineTo(left + 10, top + 7);
      context.stroke();
      context.restore();
    }
  }

  /** 将对象四角转换为屏幕位置，缩放画布时保持轮廓线宽不变 */
  private draw(event: { ctx: CanvasRenderingContext2D }): void {
    this.drawLocks(event.ctx);
    this.drawPolygon(event.ctx);
    this.drawConstructionEdges(event.ctx);
    if (this.marquee !== null) {
      const bounds = this.marquee;
      const start = new Point(bounds.x, bounds.y).transform(this.canvas.viewportTransform);
      const context = event.ctx;
      context.save();
      context.strokeStyle = HOVER_COLOR;
      context.fillStyle = "#2563eb22";
      const zoom = this.canvas.getZoom();
      context.fillRect(start.x, start.y, bounds.width * zoom, bounds.height * zoom);
      context.strokeRect(start.x, start.y, bounds.width * zoom, bounds.height * zoom);
      context.restore();
    }
    const object = this.hovered;
    if (object === null || !object.visible || object.canvas !== this.canvas) {
      return;
    }
    if (this.canvas.getActiveObjects().includes(object)) {
      return;
    }
    const context = event.ctx;
    const corners = object.getCoords();
    context.save();
    context.strokeStyle = HOVER_COLOR;
    context.lineWidth = OUTLINE_WIDTH;
    context.beginPath();
    for (let index = 0; index < corners.length; index = index + 1) {
      const corner = new Point(corners[index].x, corners[index].y);
      const screen = corner.transform(this.canvas.viewportTransform);
      if (index === 0) {
        context.moveTo(screen.x, screen.y);
      } else {
        context.lineTo(screen.x, screen.y);
      }
    }
    context.closePath();
    context.stroke();
    context.restore();
  }
}
