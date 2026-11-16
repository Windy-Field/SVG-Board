import { createElement } from "lucide";
import { TOOL_MODES } from "./tool-definitions";
// 长按展开工具菜单的等待时间，单位为毫秒
const LONG_PRESS_DELAY = 350;
let timer = 0;
let anchor: HTMLButtonElement | null = null;
let heldPointer = -1;
let menuOpen = false;

/** 绑定长按工具分组，短按继续使用当前模式，键盘下箭头也能展开 */
export function setupToolGroups(): void {
  document.addEventListener("pointerdown", handleDown);
  document.addEventListener("pointerup", handleRelease);
  document.addEventListener("pointercancel", closeMenu);
  document.addEventListener("keydown", handleKey);
  document.addEventListener("click", handleMenuClick, { capture: true });
}

/** 保存长按目标，等待期间不改变当前绘图模式 */
function handleDown(event: PointerEvent): void {
  if (!(event.target instanceof Element)) {
    return;
  }
  const button = event.target.closest("[data-tool-group]");
  if (!(button instanceof HTMLButtonElement) || button.disabled) {
    if (!event.target.closest("#tool-menu")) {
      closeMenu();
    }
    return;
  }
  anchor = button;
  heldPointer = event.pointerId;
  window.clearTimeout(timer);
  timer = window.setTimeout(openMenu, LONG_PRESS_DELAY);
}

/** 根据分组创建模式按钮，菜单显示在工具栏右侧 */
function openMenu(): void {
  if (anchor === null) {
    return;
  }
  const menu = document.getElementById("tool-menu");
  if (menu === null) {
    return;
  }
  menu.replaceChildren();
  for (const mode of TOOL_MODES) {
    if (mode.group !== anchor.dataset.toolGroup) {
      continue;
    }
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.tool = mode.tool;
    button.dataset.groupMode = "true";
    button.title = mode.label;
    button.setAttribute("aria-label", mode.label);
    const image = createElement(mode.icon);
    image.classList.add("lucide");
    image.setAttribute("aria-hidden", "true");
    button.append(image);
    button.setAttribute("aria-pressed", String(anchor.dataset.tool === mode.tool));
    menu.append(button);
  }
  const bounds = anchor.getBoundingClientRect();
  menu.style.left = bounds.right + 8 + "px";
  menu.style.top = Math.min(bounds.top, window.innerHeight - 150) + "px";
  menu.showPopover();
  menuOpen = true;
  anchor.setAttribute("aria-expanded", "true");
}

/** 松开在模式按钮上时选择该模式，避免长按释放又触发原工具 */
function handleRelease(event: PointerEvent): void {
  window.clearTimeout(timer);
  if (event.pointerId !== heldPointer || !menuOpen) {
    return;
  }
  const target = document.elementFromPoint(event.clientX, event.clientY);
  if (target instanceof Element) {
    const button = target.closest("button[data-group-mode]");
    if (button instanceof HTMLButtonElement) {
      button.click();
    }
  }
}

/** 模式选择后替换分组按钮的默认模式，保留右下角分组标记 */
function handleMenuClick(event: MouseEvent): void {
  if (!(event.target instanceof Element)) {
    return;
  }
  const mode = event.target.closest("[data-group-mode]");
  if (mode instanceof HTMLButtonElement && anchor !== null) {
    anchor.dataset.tool = mode.dataset.tool;
    anchor.setAttribute("aria-label", mode.title);
    anchor.title = mode.title;
    const previous = anchor.querySelector("svg");
    if (previous !== null) {
      previous.remove();
    }
    const image = mode.querySelector("svg");
    if (image !== null) {
      anchor.prepend(image.cloneNode(true));
    }
    closeMenu();
  } else if (menuOpen && event.target.closest("[data-tool-group]") !== null) {
    event.stopImmediatePropagation();
    event.preventDefault();
  }
}

/** 键盘可以打开模式菜单，Escape 关闭 */
function handleKey(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    closeMenu();
  }
  if (
    event.key === "ArrowDown" &&
    event.target instanceof HTMLButtonElement &&
    event.target.dataset.toolGroup !== undefined
  ) {
    event.preventDefault();
    anchor = event.target;
    openMenu();
    const first = document.querySelector("#tool-menu button");
    if (first instanceof HTMLButtonElement) {
      first.focus();
    }
  }
}

/** 关闭分组菜单并清理长按状态 */
function closeMenu(): void {
  window.clearTimeout(timer);
  if (anchor !== null) {
    anchor.setAttribute("aria-expanded", "false");
  }
  const menu = document.getElementById("tool-menu");
  if (menu !== null && menuOpen) {
    menu.hidePopover();
  }
  menuOpen = false;
  heldPointer = -1;
}
