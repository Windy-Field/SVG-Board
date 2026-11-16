/** 按方向键、Home 或 End 在菜单按钮间移动焦点，其他按键返回 false */
export function focusMenuOption(menu: HTMLElement, key: string): boolean {
  const buttons = menu.querySelectorAll<HTMLButtonElement>("button");
  if (buttons.length === 0) {
    return false;
  }
  let index = 0;
  for (let current = 0; current < buttons.length; current = current + 1) {
    if (buttons[current] === document.activeElement) {
      index = current;
    }
  }
  if (key === "ArrowDown") {
    index = (index + 1) % buttons.length;
  } else if (key === "ArrowUp") {
    index = (index + buttons.length - 1) % buttons.length;
  } else if (key === "Home") {
    index = 0;
  } else if (key === "End") {
    index = buttons.length - 1;
  } else {
    return false;
  }
  buttons[index].focus();
  return true;
}
