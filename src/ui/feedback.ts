import { getElement } from "./ui";
import type { ConstructionResult } from "../core/construction-batch";

// 每条提示显示两秒，新提示从头计时
const MESSAGE_DURATION = 2000;
let messageTimer = 0;

/** 显示最新操作结果，状态颜色只作为文字的补充 */
export function notify(message: string, state: "info" | "success" | "error" = "info"): void {
  const element = getElement("message");
  const trimmed = message.trim();
  element.textContent = trimmed.replace(/[，。；：、！？,.!?:;]+$/g, "");
  element.dataset.state = state;
  element.classList.remove("message-hidden");
  window.clearTimeout(messageTimer);
  messageTimer = window.setTimeout(hideMessage, MESSAGE_DURATION);
}

/** 收起提示，保留文字直到淡出完成，下一条提示会替换它 */
export function hideMessage(): void {
  window.clearTimeout(messageTimer);
  messageTimer = 0;
  const element = getElement("message");
  element.classList.add("message-hidden");
}

/** 汇报新对象数量，以及跳过的重复交点和无效配对 */
export function notifyConstruction(result: ConstructionResult): void {
  let message = "未创建对象";
  if (result.created.length === 1) {
    message = "已创建「" + result.created[0].name + "」";
  } else if (result.created.length > 1) {
    message = "已创建 " + result.created.length + " 个构造对象";
  }
  if (result.duplicates > 0) {
    message = message + "，跳过 " + result.duplicates + " 个已有或重合的交点";
  }
  if (result.invalid > 0) {
    message = message + "，" + result.invalid + " 组无有效结果";
  }
  notify(message);
}
