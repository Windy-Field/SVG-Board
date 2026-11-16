import { Control, Point } from "fabric";
import type { FabricObject, TMat2D, TPointerEvent, Transform } from "fabric";
import { getLinePoints, isConstructionLine, resizeConstructionLine } from "./geometry";
import { updateFabricGeometry } from "./fabric-shapes";
import { GRID_SIZE, MAX_BEND_RATIO } from "./model";
import type { Shape, Point as BoardPoint } from "./types";

/** 使用 Fabric 控制点拖动线条端点，模型始终记录真正的起点和终点 */
export class LineControls {
  private shape: Shape;
  private snap: () => boolean;
  private changed: () => void;
  private canEdit: () => boolean;
  private snapPoint: (position: BoardPoint, excluded: string) => BoardPoint;

  /** 保存当前对象及吸附开关，回调只更新关联对象，不创建历史记录 */
  constructor(
    shape: Shape,
    snap: () => boolean,
    changed: () => void,
    canEdit: () => boolean,
    snapPoint: (position: BoardPoint, excluded: string) => BoardPoint
  ) {
    this.shape = shape;
    this.snap = snap;
    this.changed = changed;
    this.canEdit = canEdit;
    this.snapPoint = snapPoint;
  }

  /** 为线段安装两个端点手柄，线条中间专用于移动 */
  install(object: FabricObject): void {
    object.controls = {
      start: new Control({
        positionHandler: this.startPosition.bind(this),
        actionHandler: this.moveStart.bind(this),
        actionName: "endpoint",
        cursorStyle: "crosshair"
      }),
      end: new Control({
        positionHandler: this.endPosition.bind(this),
        actionHandler: this.moveEnd.bind(this),
        actionName: "endpoint",
        cursorStyle: "crosshair"
      })
    };
    if (this.shape.kind === "connector") {
      object.controls.bend = new Control({
        positionHandler: this.bendPosition.bind(this),
        actionHandler: this.moveBend.bind(this),
        actionName: "endpoint",
        cursorStyle: "ew-resize"
      });
    }
  }

  /** 连接线中段的手柄用于改变折线通道 */
  private bendPosition(_size: Point, _matrix: TMat2D, object: FabricObject): Point {
    const point = new Point(
      this.shape.x + this.shape.width * this.shape.bend,
      this.shape.y + this.shape.height / 2
    );
    if (object.canvas !== undefined) {
      return point.transform(object.canvas.viewportTransform);
    }
    return point;
  }

  /** 水平拖动中段时只改变折点，起终点不变 */
  private moveBend(
    _event: TPointerEvent,
    transform: Transform,
    left: number,
    _top: number
  ): boolean {
    if (!this.canEdit() || this.shape.locked || Math.abs(this.shape.width) < 1) {
      return false;
    }
    if (this.snap()) {
      left = Math.round(left / GRID_SIZE) * GRID_SIZE;
    }
    this.shape.bend = Math.max(
      -MAX_BEND_RATIO,
      Math.min(MAX_BEND_RATIO, (left - this.shape.x) / this.shape.width)
    );
    this.shape.relation = { kind: "none", sources: [] };
    updateFabricGeometry(transform.target, this.shape);
    this.changed();
    return true;
  }

  /** 将起点的作品坐标转换为屏幕坐标，手柄不受路径箭头外框影响 */
  private startPosition(_size: Point, _matrix: TMat2D, object: FabricObject): Point {
    return this.position(object, 0);
  }

  /** 将终点的作品坐标转换为屏幕坐标 */
  private endPosition(_size: Point, _matrix: TMat2D, object: FabricObject): Point {
    return this.position(object, 1);
  }

  /** 使用画布视口变换定位指定端点 */
  private position(object: FabricObject, index: number): Point {
    const points = getLinePoints(this.shape);
    const point = new Point(points[index].x, points[index].y);
    if (object.canvas !== undefined) {
      return point.transform(object.canvas.viewportTransform);
    }
    return point;
  }

  /** 接收起点拖动，终点保持不动 */
  private moveStart(
    _event: TPointerEvent,
    transform: Transform,
    left: number,
    top: number
  ): boolean {
    return this.moveEndpoint(transform.target, 0, left, top);
  }

  /** 接收终点拖动，起点保持不动 */
  private moveEnd(_event: TPointerEvent, transform: Transform, left: number, top: number): boolean {
    return this.moveEndpoint(transform.target, 1, left, top);
  }

  /** 锁定的构造线只沿原方向伸缩，解锁后调整端点才解除关联 */
  private moveEndpoint(object: FabricObject, index: number, left: number, top: number): boolean {
    if (!this.canEdit()) {
      return false;
    }
    const snapped = this.snapPoint({ x: left, y: top }, this.shape.id);
    if (this.shape.locked) {
      if (!isConstructionLine(this.shape) || !resizeConstructionLine(this.shape, index, snapped)) {
        return false;
      }
      updateFabricGeometry(object, this.shape);
      this.changed();
      return true;
    }
    const points = getLinePoints(this.shape);
    points[index] = snapped;
    this.shape.x = points[0].x;
    this.shape.y = points[0].y;
    this.shape.width = points[1].x - points[0].x;
    this.shape.height = points[1].y - points[0].y;
    this.shape.rotation = 0;
    this.shape.relation = { kind: "none", sources: [] };
    updateFabricGeometry(object, this.shape);
    this.changed();
    return true;
  }
}
