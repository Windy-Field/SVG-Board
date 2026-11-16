import { ticks, tickStep } from "d3-array";
import { COORDINATE_UNIT, ORIGIN_X, ORIGIN_Y } from "../math/coordinates";
import type { Viewport } from "../core/types";

// 相邻刻度期望的屏幕间距，单位为像素
const TICK_SPACING = 80;
// 坐标轴线条颜色
const AXIS_COLOR = "#697b91";
// 坐标轴标签字号，单位为屏幕像素
const AXIS_FONT_SIZE = 12;
// 刻度线在轴两侧的长度，单位为屏幕像素
const TICK_LENGTH = 4;

/** 坐标轴刻度和比例尺共用 D3 的 1、2、5 动态分度 */
export function axisStep(zoom: number, width: number): number {
  return tickStep(0, width / (COORDINATE_UNIT * zoom), Math.max(1, width / TICK_SPACING));
}

/** 在固定作品坐标原点绘制数学坐标轴，平移只改变观察位置 */
export function drawAxes(
  context: CanvasRenderingContext2D,
  viewport: Viewport,
  width: number,
  height: number
): void {
  const originX = viewport.x + ORIGIN_X * viewport.zoom;
  const originY = viewport.y + ORIGIN_Y * viewport.zoom;
  const unit = COORDINATE_UNIT * viewport.zoom;
  const minimumX = -originX / unit;
  const maximumX = (width - originX) / unit;
  const minimumY = (originY - height) / unit;
  const maximumY = originY / unit;
  context.save();
  context.strokeStyle = AXIS_COLOR;
  context.fillStyle = AXIS_COLOR;
  context.lineWidth = 1;
  context.font = AXIS_FONT_SIZE + "px sans-serif";
  context.beginPath();
  context.moveTo(0, originY);
  context.lineTo(width, originY);
  context.moveTo(originX, 0);
  context.lineTo(originX, height);
  context.stroke();
  const horizontal = ticks(minimumX, maximumX, Math.max(1, width / TICK_SPACING));
  const vertical = ticks(minimumY, maximumY, Math.max(1, height / TICK_SPACING));
  context.textAlign = "center";
  for (const value of horizontal) {
    const position = originX + value * unit;
    context.beginPath();
    context.moveTo(position, originY - TICK_LENGTH);
    context.lineTo(position, originY + TICK_LENGTH);
    context.stroke();
    if (originY >= 0 && originY < height - AXIS_FONT_SIZE * 2) {
      context.fillText(String(value), position, originY + AXIS_FONT_SIZE + TICK_LENGTH);
    }
  }
  context.textAlign = "right";
  for (const value of vertical) {
    const position = originY - value * unit;
    context.beginPath();
    context.moveTo(originX - TICK_LENGTH, position);
    context.lineTo(originX + TICK_LENGTH, position);
    context.stroke();
    if (value !== 0 && originX > AXIS_FONT_SIZE * 2 && originX < width) {
      context.fillText(String(value), originX - TICK_LENGTH * 2, position + TICK_LENGTH);
    }
  }
  context.textAlign = "right";
  context.fillText("x", width - 10, Math.max(AXIS_FONT_SIZE, Math.min(height - 10, originY - 10)));
  context.fillText(
    "y",
    Math.max(AXIS_FONT_SIZE, Math.min(width - 10, originX + 18)),
    AXIS_FONT_SIZE + 4
  );
  context.restore();
}
