import { BOARD_WIDTH, BOARD_HEIGHT } from "../core/model";
import type { Point } from "../core/types";

// 数学坐标原点在画板中的固定位置，保存裁剪不会移动它
export const ORIGIN_X = BOARD_WIDTH / 2;
export const ORIGIN_Y = BOARD_HEIGHT / 2;
// 每个数学坐标单位对应的画布长度，不随视图缩放改变
export const COORDINATE_UNIT = 40;
// 单次数值输入允许的坐标绝对值
export const MAX_MATH_COORDINATE = 1000;
// 一次批量放置允许的最多点数
export const MAX_COORDINATE_POINTS = 200;
// 批量坐标文本输入上限，界面和解析器共用
export const MAX_COORDINATE_TEXT_LENGTH = 10000;

/** 数学坐标转为画布坐标，数学纵轴向上 */
export function toCanvasPoint(point: Point): Point {
  return { x: ORIGIN_X + point.x * COORDINATE_UNIT, y: ORIGIN_Y - point.y * COORDINATE_UNIT };
}

/** 画布位置转为数学坐标，供属性、函数和拟合共用 */
export function toMathPoint(point: Point): Point {
  return { x: (point.x - ORIGIN_X) / COORDINATE_UNIT, y: (ORIGIN_Y - point.y) / COORDINATE_UNIT };
}

/** 按行或分号读取坐标对，整批校验通过后再创建对象 */
export function parseCoordinatePoints(text: string): Point[] {
  if (text.length > MAX_COORDINATE_TEXT_LENGTH) {
    throw new Error("坐标文本不能超过 " + MAX_COORDINATE_TEXT_LENGTH + " 字");
  }
  const withoutOpening = text.replace(/[（(]/g, "");
  const withoutClosing = withoutOpening.replace(/[）)]/g, "");
  const normalized = withoutClosing.replace(/，/g, ",");
  const rows = normalized.split(/[\n;；]+/);
  const points: Point[] = [];
  for (const row of rows) {
    if (row.trim() === "") {
      continue;
    }
    const trimmed = row.trim();
    const values = trimmed.split(/[,\s]+/);
    if (values.length !== 2 || values[0] === "" || values[1] === "") {
      throw new Error("每行输入一组 x, y 坐标");
    }
    const point = { x: Number(values[0]), y: Number(values[1]) };
    if (
      !Number.isFinite(point.x) ||
      !Number.isFinite(point.y) ||
      Math.abs(point.x) > MAX_MATH_COORDINATE ||
      Math.abs(point.y) > MAX_MATH_COORDINATE
    ) {
      throw new Error(
        "坐标必须是 " + -MAX_MATH_COORDINATE + " 到 " + MAX_MATH_COORDINATE + " 的有限数值"
      );
    }
    points.push(point);
  }
  if (points.length === 0 || points.length > MAX_COORDINATE_POINTS) {
    throw new Error("一次输入 1 到 " + MAX_COORDINATE_POINTS + " 个坐标点");
  }
  return points;
}
