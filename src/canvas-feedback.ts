import { Point } from "fabric";
import type { Canvas, FabricObject } from "fabric";
import type { Bounds } from "./types";

// 悬停和框选的提示颜色
const HOVER_COLOR = "#2563eb";
// 提示轮廓线宽，单位为屏幕像素
const OUTLINE_WIDTH = 1.5;
// 锁定标记的底色
const LOCK_BACKGROUND = "#ffffff";
// 锁定标记的描边颜色
const LOCK_COLOR = "#475569";

/** 只绘制悬停提示，不创建作品对象，也不参与保存与撤销 */
export class CanvasFeedback {
  private canvas: Canvas;
  private hovered: FabricObject | null = null;
  private marquee: Bounds | null = null;
  private locked: FabricObject[] = [];

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
  setLocked(objects: FabricObject[]): void {
    this.locked = objects;
  }

  /** 锁定对象右上角显示小锁，标记不随作品导出 */
  private drawLocks(context: CanvasRenderingContext2D): void {
    for (const object of this.locked) {
      if (!object.visible || object.canvas !== this.canvas) {
        continue;
      }
      const bounds = object.getBoundingRect();
      const anchor = new Point(bounds.left + bounds.width, bounds.top).transform(
        this.canvas.viewportTransform
      );
      const left = anchor.x - 8;
      const top = anchor.y - 18;
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
