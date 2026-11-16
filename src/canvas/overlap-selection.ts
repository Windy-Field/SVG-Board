import type { Point } from "../core/types";

// 两次点击仍算同一位置的距离，单位为屏幕像素
const REPEAT_DISTANCE = 5;

/** 记录重复单击位置，轮换重叠对象时不改变对象层级 */
export class OverlapSelection {
  private position: Point | null = null;
  private candidates = "";
  private index = 0;

  /** 返回本次单击应选的编号，候选顺序由画布按文字优先排列 */
  choose(position: Point, ids: string[]): string | undefined {
    const key = ids.join(",");
    let repeated = false;
    if (this.position !== null) {
      repeated =
        Math.hypot(position.x - this.position.x, position.y - this.position.y) <= REPEAT_DISTANCE &&
        this.candidates === key;
    }
    if (repeated) {
      this.index = (this.index + 1) % Math.max(1, ids.length);
    } else {
      this.index = 0;
    }
    this.position = position;
    this.candidates = key;
    return ids[this.index];
  }

  /** 拖动、平移或更换作品后，从候选顺序的第一个对象重新开始 */
  reset(): void {
    this.position = null;
    this.candidates = "";
    this.index = 0;
  }
}
