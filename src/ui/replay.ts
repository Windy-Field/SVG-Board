import type { Bounds } from "../core/types";
import { parseDocument } from "../storage/document";
import { createSvg } from "../storage/files";
import { getDialog, getElement, getInput } from "./ui";
import { afterDialogExit } from "./motion";

// 自动播放每一步停留的时间，单位为毫秒
const FRAME_DURATION = 700;
let frames: string[] = [];
let area: Bounds;
let position = 0;
let timer = 0;
let previewUrl = "";

/** 绑定回放进度和关闭事件，支持方向键调整和 Escape 退出 */
export function setupReplay(): void {
  const dialog = getDialog("replay-dialog");
  dialog.addEventListener("close", stopClosedReplay);
  afterDialogExit(dialog, clearReplay);
  getInput("replay-position").addEventListener("input", seekReplay);
}

/** 打开只读预览，所有画面使用同一个画布范围 */
export function openReplay(snapshots: string[], bounds: Bounds): void {
  frames = snapshots;
  area = bounds;
  position = 0;
  const slider = getInput("replay-position");
  slider.max = String(frames.length - 1);
  getDialog("replay-dialog").showModal();
  showFrame();
}

/** 根据进度和播放状态更新按钮，不改变原编辑器的选区 */
function refreshControls(): void {
  for (const control of getDialog("replay-dialog").querySelectorAll("button")) {
    const action = control.dataset.action;
    if (action === "replay-previous") {
      control.disabled = position === 0;
    } else if (action === "replay-next") {
      control.disabled = position >= frames.length - 1;
    } else if (action === "replay-play") {
      control.hidden = timer !== 0;
    } else if (action === "replay-pause") {
      control.hidden = timer === 0;
    }
  }
  const label = position + 1 + " / " + frames.length;
  const slider = getInput("replay-position");
  slider.value = String(position);
  slider.setAttribute("aria-valuetext", label);
  getElement("replay-step").textContent = label;
}

/** 渲染快照副本，不让回放触发写入存档 */
function showFrame(): void {
  refreshControls();
  const image = getElement("replay-image");
  if (!(image instanceof HTMLImageElement)) {
    return;
  }
  releasePreview();
  try {
    const board = parseDocument(frames[position]);
    const svg = createSvg(board, {
      crop: false,
      transparent: false,
      hideAuxiliary: false,
      area: area,
      includeProject: false
    });
    previewUrl = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    image.src = previewUrl;
    getElement("replay-preview").style.backgroundColor = board.background;
    getElement("replay-error").textContent = "";
  } catch {
    image.removeAttribute("src");
    stopReplay();
    getElement("replay-error").textContent = "无法显示这一步";
  }
}

/** 停止计时并恢复播放按钮 */
function stopReplay(): void {
  window.clearInterval(timer);
  timer = 0;
  refreshControls();
}

/** 自动播放到最后一步时停止，不循环跳回早期画面 */
function advanceReplay(): void {
  position = position + 1;
  if (position >= frames.length - 1) {
    const focused = document.activeElement;
    stopReplay();
    if (focused instanceof HTMLButtonElement && focused.dataset.action === "replay-pause") {
      focusReplayButton("replay-play");
    }
  }
  showFrame();
}

/** 跳转会暂停自动播放，避免滑块和计时器同时改进度 */
function seekReplay(): void {
  position = Number(getInput("replay-position").value);
  stopReplay();
  showFrame();
}

/** 响应回放按钮，使用原生对话框保持键盘焦点 */
export function handleReplayAction(action: string): void {
  if (action === "replay-close") {
    getDialog("replay-dialog").close();
  } else if (action === "replay-play" && timer === 0) {
    if (position === frames.length - 1) {
      position = 0;
    }
    timer = window.setInterval(advanceReplay, FRAME_DURATION);
    showFrame();
    focusReplayButton("replay-pause");
  } else if (action === "replay-pause") {
    stopReplay();
    focusReplayButton("replay-play");
  } else if (action === "replay-previous" || action === "replay-next") {
    if (action === "replay-previous") {
      position = Math.max(0, position - 1);
    } else {
      position = Math.min(frames.length - 1, position + 1);
    }
    stopReplay();
    showFrame();
  }
}

/** 播放与暂停按钮替换时，把焦点交给可见按钮 */
function focusReplayButton(action: string): void {
  const button = getDialog("replay-dialog").querySelector('[data-action="' + action + '"]');
  if (button instanceof HTMLButtonElement) {
    button.focus();
  }
}

/** 回收上一帧生成的图片地址 */
function releasePreview(): void {
  if (previewUrl !== "") {
    URL.revokeObjectURL(previewUrl);
    previewUrl = "";
  }
}

/** 关闭窗口时马上停止计时，保留最后一帧直到淡出结束 */
function stopClosedReplay(): void {
  const dialog = getDialog("replay-dialog");
  if (!dialog.open) {
    stopReplay();
  }
}

/** 淡出后再释放最后一帧和回放快照 */
function clearReplay(): void {
  frames = [];
  releasePreview();
  const image = getElement("replay-image");
  image.removeAttribute("src");
}
