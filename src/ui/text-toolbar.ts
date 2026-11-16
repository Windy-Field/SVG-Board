import { FONTS } from "./fonts";
import type { Bounds, Shape } from "../core/types";
import { MIN_FONT_SIZE, MAX_FONT_SIZE } from "../core/model";

// 浮动工具栏与画布边缘的最小距离，单位为屏幕像素
const TOOLBAR_MARGIN = 8;
// 浮动工具栏与选区之间的距离，单位为屏幕像素
const TOOLBAR_GAP = 14;
// 菜单与触发按钮之间的距离，单位为屏幕像素
const FONT_MENU_GAP = 6;

/** 创建一次文本浮动栏，后续仅同步控件值，不重建正在输入的控件 */
export function createTextToolbar(host: HTMLElement): void {
  const toolbar = document.createElement("div");
  toolbar.id = "text-toolbar";
  toolbar.className = "text-toolbar";
  toolbar.hidden = true;
  toolbar.setAttribute("role", "toolbar");
  toolbar.setAttribute("aria-label", "文字配置");
  toolbar.innerHTML =
    '<div class="text-format-group"><button type="button" id="font-menu-button" popovertarget="font-menu" aria-label="字体" title="字体" aria-haspopup="menu" aria-expanded="false"><span id="font-menu-label">黑体</span><i data-lucide="chevron-down" aria-hidden="true"></i></button><input type="hidden" data-text-property="fontFamily" /><input type="number" data-text-property="fontSize" aria-label="浮动字号" title="字号" min="' +
    MIN_FONT_SIZE +
    '" max="' +
    MAX_FONT_SIZE +
    '" /></div><div class="text-format-group"><button type="button" data-text-toggle="bold" title="加粗" aria-label="加粗"><i data-lucide="bold" aria-hidden="true"></i></button><button type="button" data-text-toggle="italic" title="斜体" aria-label="斜体"><i data-lucide="italic" aria-hidden="true"></i></button><button type="button" data-text-toggle="underline" title="下划线" aria-label="下划线"><i data-lucide="underline" aria-hidden="true"></i></button><input type="color" data-text-property="stroke" aria-label="文字颜色" title="文字颜色" /></div><div class="text-format-group"><input type="hidden" data-text-property="textAlign" /><button type="button" data-text-align="start" title="左对齐" aria-label="文字左对齐"><i data-lucide="align-left" aria-hidden="true"></i></button><button type="button" data-text-align="middle" title="居中" aria-label="文字居中"><i data-lucide="align-center" aria-hidden="true"></i></button><button type="button" data-text-align="end" title="右对齐" aria-label="文字右对齐"><i data-lucide="align-right" aria-hidden="true"></i></button><button type="button" data-action="edit-text" title="编辑文字" aria-label="编辑文字"><i data-lucide="text-cursor-input" aria-hidden="true"></i></button></div>';
  host.append(toolbar);
  toolbar.addEventListener("click", handleToolbarClick);
  const menu = document.createElement("div");
  menu.id = "font-menu";
  menu.className = "font-menu";
  menu.setAttribute("popover", "auto");
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", "字体列表");
  for (const font of FONTS) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.fontValue = font.value;
    button.textContent = font.label;
    button.style.fontFamily = font.value;
    button.setAttribute("role", "menuitemradio");
    menu.append(button);
  }
  menu.addEventListener("click", handleFontClick);
  menu.addEventListener("toggle", handleFontToggle);
  menu.addEventListener("keydown", handleFontKeyDown);
  document.body.append(menu);
}

/** 字体和对齐共用属性更新事件，实际校验由属性模块完成 */
function changeTextProperty(property: string, value: string): void {
  const input = document.querySelector('#text-toolbar [data-text-property="' + property + '"]');
  if (input instanceof HTMLInputElement && !input.disabled) {
    input.value = value;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }
}

/** 对齐按钮复用属性更新入口，字体菜单由原生弹出层切换 */
function handleToolbarClick(event: MouseEvent): void {
  if (!(event.target instanceof Element)) {
    return;
  }
  const button = event.target.closest("button");
  if (!(button instanceof HTMLButtonElement) || button.disabled) {
    return;
  }
  if (button.dataset.textAlign !== undefined) {
    changeTextProperty("textAlign", button.dataset.textAlign);
  }
}

/** 按菜单实际尺寸定位，样式调整后仍与按钮对齐且不超出窗口 */
function positionFontMenu(menu: HTMLElement, button: HTMLElement): void {
  const bounds = button.getBoundingClientRect();
  menu.style.left =
    Math.max(
      TOOLBAR_MARGIN,
      Math.min(bounds.left, window.innerWidth - menu.offsetWidth - TOOLBAR_MARGIN)
    ) + "px";
  menu.style.top =
    Math.max(
      TOOLBAR_MARGIN,
      Math.min(
        bounds.bottom + FONT_MENU_GAP,
        window.innerHeight - menu.offsetHeight - TOOLBAR_MARGIN
      )
    ) + "px";
}

/** 选择字体后关闭菜单，将焦点交回字体按钮 */
function handleFontClick(event: MouseEvent): void {
  if (!(event.target instanceof Element)) {
    return;
  }
  const button = event.target.closest("[data-font-value]");
  if (button instanceof HTMLButtonElement && button.dataset.fontValue !== undefined) {
    changeTextProperty("fontFamily", button.dataset.fontValue);
    const menu = document.getElementById("font-menu");
    const trigger = document.getElementById("font-menu-button");
    if (menu !== null) {
      menu.hidePopover();
    }
    if (trigger !== null) {
      trigger.focus();
    }
  }
}

/** 字体菜单使用方向键移动焦点，Enter 和空格由按钮处理 */
function handleFontKeyDown(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    const menu = document.getElementById("font-menu");
    const trigger = document.getElementById("font-menu-button");
    if (menu !== null) {
      menu.hidePopover();
    }
    if (trigger !== null) {
      trigger.focus();
    }
    event.preventDefault();
    event.stopPropagation();
    return;
  }
  const buttons = document.querySelectorAll<HTMLButtonElement>("#font-menu button");
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
  event.preventDefault();
  buttons[index].focus();
}

/** 原生弹出层关闭时同步读屏可见的展开状态 */
function handleFontToggle(): void {
  const menu = document.getElementById("font-menu");
  const button = document.getElementById("font-menu-button");
  if (menu !== null && button !== null) {
    const open = menu.matches(":popover-open");
    button.setAttribute("aria-expanded", String(open));
    if (open) {
      positionFontMenu(menu, button);
      const selected = menu.querySelector('[aria-checked="true"]');
      if (selected instanceof HTMLButtonElement) {
        selected.focus();
      }
    }
  }
}

/** 将浮动栏放在选区上方，越过画布边缘时收回可见区域 */
export function updateTextToolbar(
  shape: Shape | undefined,
  bounds: Bounds | null,
  readonly: boolean
): void {
  const toolbar = document.getElementById("text-toolbar");
  if (toolbar === null) {
    return;
  }
  if (shape === undefined || bounds === null || (shape.kind !== "text" && shape.text === "")) {
    toolbar.hidden = true;
    const menu = document.getElementById("font-menu");
    if (menu !== null && menu.matches(":popover-open")) {
      menu.hidePopover();
    }
    return;
  }
  toolbar.hidden = false;
  const fontLabel = document.getElementById("font-menu-label");
  for (const font of FONTS) {
    if (font.value === shape.fontFamily && fontLabel !== null) {
      fontLabel.textContent = font.label;
    }
  }
  for (const button of document.querySelectorAll("#font-menu [data-font-value]")) {
    button.setAttribute(
      "aria-checked",
      String(button.getAttribute("data-font-value") === shape.fontFamily)
    );
  }
  for (const control of toolbar.querySelectorAll("[data-text-property]")) {
    if (control instanceof HTMLElement) {
      control.dataset.object = shape.id;
    }
  }
  const host = toolbar.parentElement;
  if (host === null) {
    return;
  }
  const maximum = Math.max(TOOLBAR_MARGIN, host.clientWidth - toolbar.offsetWidth - TOOLBAR_MARGIN);
  toolbar.style.left = Math.max(TOOLBAR_MARGIN, Math.min(maximum, bounds.x)) + "px";
  toolbar.style.top =
    Math.max(TOOLBAR_MARGIN, bounds.y - toolbar.offsetHeight - TOOLBAR_GAP) + "px";
  for (const control of toolbar.querySelectorAll("input, select, button")) {
    if (
      control instanceof HTMLInputElement ||
      control instanceof HTMLSelectElement ||
      control instanceof HTMLButtonElement
    ) {
      control.disabled = readonly || shape.locked;
    }
    if (
      (control instanceof HTMLInputElement || control instanceof HTMLSelectElement) &&
      control.dataset.textProperty !== undefined &&
      document.activeElement !== control
    ) {
      const property = control.dataset.textProperty;
      if (property === "fontFamily") {
        control.value = shape.fontFamily;
      } else if (property === "fontSize") {
        control.value = String(Math.round(shape.fontSize));
      } else if (property === "stroke") {
        control.value = shape.stroke;
      } else if (property === "textAlign") {
        control.value = shape.textAlign;
      }
    }
    if (control instanceof HTMLButtonElement) {
      if (control.dataset.textAlign !== undefined) {
        control.setAttribute("aria-pressed", String(control.dataset.textAlign === shape.textAlign));
        continue;
      }
      const property = control.dataset.textToggle;
      let pressed = false;
      if (property === "bold") {
        pressed = shape.bold;
      }
      if (property === "italic") {
        pressed = shape.italic;
      }
      if (property === "underline") {
        pressed = shape.underline;
      }
      control.setAttribute("aria-pressed", String(pressed));
    }
  }
}
