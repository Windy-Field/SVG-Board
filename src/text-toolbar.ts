import { fontOptions } from "./fonts";
import type { Bounds, Shape } from "./types";

/** 创建一次文本浮动栏，后续仅同步控件值，不重建正在输入的控件 */
export function createTextToolbar(host: HTMLElement): void {
  const toolbar = document.createElement("div");
  toolbar.id = "text-toolbar";
  toolbar.className = "text-toolbar";
  toolbar.hidden = true;
  toolbar.setAttribute("role", "toolbar");
  toolbar.setAttribute("aria-label", "文字配置");
  toolbar.innerHTML =
    '<select data-text-property="fontFamily" aria-label="浮动字体">' +
    fontOptions() +
    '</select><input type="number" data-text-property="fontSize" aria-label="浮动字号" min="8" max="200" /><button type="button" data-text-toggle="bold" title="加粗" aria-label="加粗"><i data-lucide="bold" aria-hidden="true"></i></button><button type="button" data-text-toggle="italic" title="斜体" aria-label="斜体"><i data-lucide="italic" aria-hidden="true"></i></button><button type="button" data-text-toggle="underline" title="下划线" aria-label="下划线"><i data-lucide="underline" aria-hidden="true"></i></button><input type="color" data-text-property="stroke" aria-label="文字颜色" /><select data-text-property="textAlign" aria-label="浮动对齐"><option value="start">左对齐</option><option value="middle">居中</option><option value="end">右对齐</option></select><button type="button" data-action="edit-text" title="编辑文字" aria-label="编辑文字"><i data-lucide="text-cursor-input" aria-hidden="true"></i></button>';
  host.append(toolbar);
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
    return;
  }
  toolbar.hidden = false;
  for (const control of toolbar.querySelectorAll("[data-text-property]")) {
    if (control instanceof HTMLElement) {
      control.dataset.object = shape.id;
    }
  }
  const host = toolbar.parentElement;
  if (host === null) {
    return;
  }
  const maximum = Math.max(8, host.clientWidth - toolbar.offsetWidth - 8);
  toolbar.style.left = Math.max(8, Math.min(maximum, bounds.x)) + "px";
  toolbar.style.top = Math.max(8, bounds.y - toolbar.offsetHeight - 14) + "px";
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
