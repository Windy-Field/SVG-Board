import { ActiveSelection, Canvas, Textbox } from "fabric";
import type { FabricObject, TPointerEvent } from "fabric";

/** 库的命中结果同时记录当前目标与选区下方的目标 */
interface TargetInfo {
  target?: FabricObject;
  subTargets: FabricObject[];
  container?: FabricObject;
  currentTarget?: FabricObject;
  currentContainer?: FabricObject;
  currentSubTargets: FabricObject[];
}

/** 保留用户当前选中的重叠对象，文字首次命中时优先于线条 */
export class EditorCanvas extends Canvas {
  /** 只有存在对象变换时才通知库结束，空白区平移没有变换目标 */
  override endCurrentTransform(event?: TPointerEvent): void {
    if (this._currentTransform !== null) {
      super.endCurrentTransform(event);
    }
  }

  /** 使用库的像素命中结果，调整目标优先级后继续由库处理拖动 */
  override findTarget(event: TPointerEvent): TargetInfo {
    const result = super.findTarget(event);
    if (this.skipTargetFind || event.shiftKey || event.ctrlKey || event.metaKey) {
      return result;
    }
    const position = this.getScenePoint(event);
    const active = this.getActiveObject();
    if (active !== undefined) {
      if (active instanceof ActiveSelection || active.findControl(this.getViewportPoint(event))) {
        return result;
      }
      if (this.searchPossibleTargets([active], position).target !== undefined) {
        result.target = active;
        return result;
      }
    }
    const objects = this.getObjects();
    objects.reverse();
    for (const object of objects) {
      if (
        object instanceof Textbox &&
        object.evented &&
        this.searchPossibleTargets([object], position).target !== undefined
      ) {
        result.target = object;
        return result;
      }
    }
    return result;
  }
}
