import { controlsUtils } from "fabric";
import type { Control, Path, TPointerEvent, Transform, TransformActionHandler } from "fabric";
import type { Point } from "./types";

/** 曲线端点沿用统一吸附，方向控制点仍交给 Fabric 自由调整 */
export class CurveControls {
  private id: string;
  private snapPoint: (position: Point, excluded: string) => Point;
  private handlers = new Map<Control, TransformActionHandler>();

  /** 保存作品编号与吸附入口，路径计算继续使用库的控制器 */
  constructor(id: string, snapPoint: (position: Point, excluded: string) => Point) {
    this.id = id;
    this.snapPoint = snapPoint;
  }

  /** 只包装起点和终点，保留库提供的连接线与控制点显示 */
  install(object: Path): void {
    object.controls = controlsUtils.createPathControls(object);
    for (const key of Object.keys(object.controls)) {
      const control = object.controls[key];
      if (!key.includes("_CP_")) {
        this.handlers.set(control, control.actionHandler);
        control.actionHandler = this.moveEndpoint.bind(this, control);
      }
    }
  }

  /** 先吸附鼠标坐标，再调用库的路径编辑接口 */
  private moveEndpoint(
    control: Control,
    event: TPointerEvent,
    transform: Transform,
    left: number,
    top: number
  ): boolean {
    const handler = this.handlers.get(control);
    if (handler === undefined) {
      return false;
    }
    const position = this.snapPoint({ x: left, y: top }, this.id);
    return handler.call(control, event, transform, position.x, position.y);
  }
}
