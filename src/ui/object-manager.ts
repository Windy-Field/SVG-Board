import { compareLayers } from "../core/model";
import { commandButton, getElement, refreshIcons } from "./ui";
import type { BoardDocument, Shape } from "../core/types";

/** 创建绑定对象编号的状态按钮，状态变化不依赖当前选区 */
function stateButton(shape: Shape, kind: "lock" | "visibility"): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "icon-button";
  let image = "eye";
  if (kind === "lock") {
    button.dataset.objectLock = shape.id;
    button.title = "锁定：" + shape.name;
    button.setAttribute("aria-pressed", String(shape.locked));
    image = "lock-open";
    if (shape.locked) {
      image = "lock-keyhole";
    }
  } else {
    button.dataset.visibility = shape.id;
    button.title = "切换显示：" + shape.name;
    button.setAttribute("aria-pressed", String(!shape.hidden));
    if (shape.hidden) {
      image = "eye-off";
    }
  }
  button.setAttribute("aria-label", button.title);
  button.innerHTML = '<i data-lucide="' + image + '" aria-hidden="true"></i>';
  return button;
}

/** 显示对象层级、锁定与隐藏状态，隐藏对象仍可从列表恢复 */
export function renderObjects(document: BoardDocument, selectedIds: string[]): void {
  const panel = getElement("object-list");
  const management = getElement("selected-object-management");
  management.innerHTML =
    '<div class="section-title"><h2>选中对象</h2><span>' +
    selectedIds.length +
    '</span></div><div class="object-actions">' +
    commandButton("raise", "上移一层", "arrow-up") +
    commandButton("lower", "下移一层", "arrow-down") +
    commandButton("copy", "复制对象", "copy") +
    commandButton("ungroup", "取消组合", "ungroup") +
    "</div>";
  panel.replaceChildren();
  const ordered = document.shapes.slice();
  ordered.sort(compareLayers);
  ordered.reverse();
  for (const shape of ordered) {
    const row = window.document.createElement("div");
    row.className = "object-row";
    row.classList.toggle("selected", selectedIds.includes(shape.id));
    row.classList.toggle("locked", shape.locked);
    const select = window.document.createElement("button");
    select.type = "button";
    select.dataset.objectSelect = shape.id;
    select.textContent = shape.name;
    select.title = shape.name;
    if (shape.locked) {
      select.title = shape.name + "（已锁定）";
    }
    row.append(select, stateButton(shape, "lock"), stateButton(shape, "visibility"));
    panel.append(row);
  }
  if (ordered.length === 0) {
    const empty = window.document.createElement("p");
    empty.className = "empty-object-list";
    empty.textContent = "暂无对象";
    panel.append(empty);
  }
  refreshIcons();
}
