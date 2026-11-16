import type { Archive } from "../storage/archives";

// 存档菜单与窗口边缘的最小距离，单位为屏幕像素
const MENU_MARGIN = 8;
// 存档菜单与选择栏的垂直距离，单位为屏幕像素
const MENU_GAP = 6;

/** 让存档选择栏使用原生弹出层，重复点击与外侧点击均可收起 */
export function setupArchivePicker(): void {
  const trigger = document.getElementById("archive-select");
  const menu = document.getElementById("archive-options");
  if (trigger === null || menu === null) {
    return;
  }
  trigger.addEventListener("click", positionMenu);
  trigger.addEventListener("keydown", handleTriggerKey);
  menu.addEventListener("toggle", handleToggle);
  menu.addEventListener("keydown", handleMenuKey);
}

/** 菜单宽度沿用选择栏，展开时对齐同一左边界 */
function positionMenu(): void {
  const trigger = document.getElementById("archive-select");
  const menu = document.getElementById("archive-options");
  if (trigger === null || menu === null) {
    return;
  }
  const bounds = trigger.getBoundingClientRect();
  menu.style.width = bounds.width + "px";
  menu.style.left =
    Math.max(MENU_MARGIN, Math.min(bounds.left, window.innerWidth - bounds.width - MENU_MARGIN)) +
    "px";
  menu.style.top = bounds.bottom + MENU_GAP + "px";
}

/** 展开后聚焦当前存档，关闭后同步展开状态 */
function handleToggle(): void {
  const trigger = document.getElementById("archive-select");
  const menu = document.getElementById("archive-options");
  if (trigger === null || menu === null) {
    return;
  }
  const open = menu.matches(":popover-open");
  trigger.setAttribute("aria-expanded", String(open));
  if (open) {
    const selected = menu.querySelector('[aria-selected="true"]');
    if (selected instanceof HTMLButtonElement) {
      selected.focus();
    }
  }
}

/** 选择栏按上下方向键也可展开 */
function handleTriggerKey(event: KeyboardEvent): void {
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    const trigger = document.getElementById("archive-select");
    if (trigger instanceof HTMLButtonElement) {
      trigger.click();
    }
  }
}

/** 存档选项支持方向键和 Escape，保留画布的当前选区 */
function handleMenuKey(event: KeyboardEvent): void {
  const trigger = document.getElementById("archive-select");
  const menu = document.getElementById("archive-options");
  if (menu === null) {
    return;
  }
  if (event.key === "Escape") {
    menu.hidePopover();
    if (trigger !== null) {
      trigger.focus();
    }
  } else {
    const buttons = menu.querySelectorAll<HTMLButtonElement>("button");
    if (buttons.length === 0) {
      return;
    }
    let index = 0;
    for (let current = 0; current < buttons.length; current = current + 1) {
      if (buttons[current] === document.activeElement) {
        index = current;
      }
    }
    if (event.key === "ArrowDown") {
      index = (index + 1) % buttons.length;
    } else if (event.key === "ArrowUp") {
      index = (index + buttons.length - 1) % buttons.length;
    } else if (event.key === "Home") {
      index = 0;
    } else if (event.key === "End") {
      index = buttons.length - 1;
    } else {
      return;
    }
    buttons[index].focus();
  }
  event.preventDefault();
  event.stopPropagation();
}

/** 同步存档名称和选项状态，每一行都绑定明确的存档编号 */
export function renderArchivePicker(items: Archive[], active: string): void {
  const menu = document.getElementById("archive-options");
  const trigger = document.getElementById("archive-select");
  const label = document.getElementById("archive-label");
  if (menu === null || trigger === null || label === null) {
    return;
  }
  menu.replaceChildren();
  trigger.dataset.value = active;
  for (const archive of items) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.archiveValue = archive.id;
    button.setAttribute("role", "option");
    button.setAttribute("aria-selected", String(archive.id === active));
    button.textContent = archive.document.name;
    button.title = archive.document.name;
    menu.append(button);
    if (archive.id === active) {
      label.textContent = archive.document.name;
      trigger.title = archive.document.name;
    }
  }
}
