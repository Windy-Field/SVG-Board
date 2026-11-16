import "../styles/styles.css";
import "../styles/workspace.css";
import "../styles/motion.css";
import "../styles/selects.css";
import "../styles/text-toolbar.css";
import "../styles/archive-picker.css";
import { BoardCanvas } from "../canvas/canvas";
import {
  arrangeShapes,
  changeLayers,
  constructShape,
  deleteShapes,
  pasteShapes
} from "../core/commands";
import { parseDocument, STORAGE_KEY } from "../storage/document";
import {
  createSvg,
  downloadBlob,
  exportPng,
  getFileName,
  openProject,
  saveProject
} from "../storage/files";
import { updateRelations } from "../geometry/geometry";
import { applyProperty, renderProperties } from "../ui/inspector";
import { renderObjects } from "../ui/object-manager";
import { createDocument, findShape, History, isDependent, moveShape } from "../core/model";
import { getElement, getInput, isTool, mountInterface } from "../ui/ui";
import type { BoardDocument, RelationKind, Shape, Tool } from "../core/types";
import { Archives } from "../storage/archives";
import { updateTextToolbar } from "../ui/text-toolbar";
import { updateDescription } from "../ui/description";
import { setSidebar } from "../ui/motion";
import { prepareDocument } from "../storage/content";
import { createFabricShape } from "../canvas/fabric-shapes";
import { addPointLabel } from "../objects/point-labels";
import { detachLabel } from "../objects/shape-labels";
import { syncLiveEntry } from "./live-entry";
import { renderArchivePicker } from "../ui/archive-picker";
import { isConstructionTool, validConstructionSources } from "../geometry/construction-tools";

// 提示停留时间，单位为毫秒
const MESSAGE_DURATION = 6000;
// 自动保存等待时间，单位为毫秒
const AUTOSAVE_DELAY = 300;
// 方向键配合 Shift 时的单次移动距离
const LARGE_MOVE_DISTANCE = 10;
let board: BoardCanvas;
const history = new History();
let clipboard: Shape[] = [];
let textTarget = "";
let messageTimer = 0;
let saveTimer = 0;
let archives: Archives;
let deleteArchiveId = "";
let previousSelection = "";

/** 将未知异常转换为可显示的错误文字 */
function errorMessage(error: unknown): string {
  if (error instanceof SyntaxError) {
    return "文件格式错误";
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "操作失败，请重试";
}

/** 显示不改变页面布局的状态信息，后续信息替换旧信息 */
function notify(message: string): void {
  const element = getElement("message");
  const trimmed = message.trim();
  element.textContent = trimmed.replace(/[，。；：、！？,.!?:;]+$/g, "");
  element.hidden = false;
  element.classList.remove("message-hidden");
  window.clearTimeout(messageTimer);
  messageTimer = window.setTimeout(hideMessage, MESSAGE_DURATION);
}

/** 收起状态信息，不删除容器以保留无障碍播报入口 */
function hideMessage(): void {
  getElement("message").classList.add("message-hidden");
}

/** 从本地自动恢复作品，损坏数据不覆盖原记录 */
function loadInitialDocument(): BoardDocument {
  try {
    if (archives.find(archives.active) !== undefined) {
      return archives.open(archives.active);
    }
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved !== null) {
      return parseDocument(saved);
    }
  } catch (error) {
    notify("无法自动恢复：" + errorMessage(error));
  }
  return createDocument();
}

/** 延迟自动保存，避免拖动过程反复写入浏览器存储 */
function scheduleSave(): void {
  getElement("save-status").textContent = "正在保存";
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(saveLocal, AUTOSAVE_DELAY);
}

/** 保存前重新校验数据，存储不足时明确提示导出项目文件 */
function saveLocal(): void {
  if (board.readOnly) {
    return;
  }
  try {
    const saved = prepareDocument(board.document);
    const text = JSON.stringify(saved);
    parseDocument(text);
    localStorage.setItem(STORAGE_KEY, text);
    archives.save(saved);
    renderArchives();
    getElement("save-status").textContent = "已保存到此浏览器";
  } catch (error) {
    getElement("save-status").textContent = "自动保存失败";
    notify("自动保存失败，请下载项目文件");
  }
}

/** 更新状态栏、属性和对象管理列表 */
function refreshPanels(): void {
  const selected = board.getSelectedShapes();
  getInput("document-name").value = board.document.name;
  getElement("object-count").textContent = board.document.shapes.length + " 个对象";
  getElement("object-manager-count").textContent = String(board.document.shapes.length);
  getElement("board-size").textContent = board.document.width + " × " + board.document.height;
  getElement("selection-count").textContent = "";
  if (selected.length > 0) {
    getElement("selection-count").textContent = "已选择 " + selected.length;
  }
  renderProperties(board.document, selected);
  updateDescription(board.document.description, board.readOnly);
  refreshTextToolbar();
  const selection = board.selectedIds.join(",");
  if (selected.length > 0 && selection !== previousSelection && board.tool === "select") {
    setSidebar(true);
    if (getElement("objects-panel").hidden) {
      getElement("description-panel").hidden = true;
      getElement("properties-panel").hidden = false;
      syncTabs("properties");
    }
  }
  previousSelection = selection;
  renderObjects(board.document, board.selectedIds);
  renderArchives();
  applyReadOnlyControls();
  const undo = document.querySelector('[data-action="undo"]');
  const redo = document.querySelector('[data-action="redo"]');
  if (undo instanceof HTMLButtonElement) {
    undo.disabled = board.readOnly || !history.canUndo();
  }
  if (redo instanceof HTMLButtonElement) {
    redo.disabled = board.readOnly || !history.canRedo();
  }
  const invalid = updateRelations(board.document);
  const status = getElement("construction-status");
  status.textContent = "";
  if (invalid.size > 0) {
    status.textContent = invalid.size + " 个构造当前无有效结果";
  }
}

/** 完成一次作品修改后更新关系、历史和自动保存 */
function commit(): void {
  updateRelations(board.document);
  if (history.push(board.document)) {
    scheduleSave();
  }
  refreshPanels();
}

/** 视口变化只更新缩放数值，不把缩放写入操作历史 */
function refreshViewport(): void {
  if (board !== undefined) {
    getElement("zoom-value").textContent = Math.round(board.viewport.zoom * 100) + "%";
    const host = getElement("canvas-host");
    host.dataset.viewX = String(board.viewport.x);
    host.dataset.viewY = String(board.viewport.y);
    host.dataset.zoom = String(board.viewport.zoom);
    refreshTextToolbar();
  }
}

/** 替换作品时保留历史，使新建和切换模板也能撤销 */
function replaceDocument(document: BoardDocument): void {
  board.setDocument(document);
  board.fit();
  commit();
}

/** 更新工具按钮与当前工具，让选中状态同时可见且可被读屏识别 */
function chooseTool(tool: string): void {
  if (!isTool(tool)) {
    return;
  }
  if (tool === "polygon") {
    getDialog("polygon-dialog").showModal();
    return;
  }
  board.setTool(tool);
}

/** 工具按钮统一从画布同步，放置对象后继续保留当前模式 */
function refreshToolButtons(tool: Tool): void {
  for (const button of document.querySelectorAll("[data-tool]")) {
    button.setAttribute("aria-pressed", String(button.getAttribute("data-tool") === tool));
  }
  const lines = document.querySelector('[data-tool-group="lines"]');
  if (
    lines !== null &&
    (tool === "line" || tool === "arrow" || tool === "connector" || tool === "curve")
  ) {
    lines.setAttribute("aria-pressed", "true");
  }
  const text = document.querySelector('[data-tool-group="text"]');
  if (text !== null && (tool === "text" || tool === "vertical-text")) {
    text.setAttribute("aria-pressed", "true");
  }
  const rectangles = document.querySelector('[data-tool-group="rectangles"]');
  if (rectangles !== null && (tool === "rect" || tool === "square")) {
    rectangles.setAttribute("aria-pressed", "true");
  }
  const polygons = document.querySelector('[data-tool-group="polygons"]');
  if (polygons !== null && (tool === "polygon" || tool === "custom-polygon")) {
    polygons.setAttribute("aria-pressed", "true");
  }
  const ellipses = document.querySelector('[data-tool-group="ellipses"]');
  if (ellipses !== null && (tool === "ellipse" || tool === "circle")) {
    ellipses.setAttribute("aria-pressed", "true");
  }
  for (const button of document.querySelectorAll('[data-action^="construct-"]')) {
    const method = (button.getAttribute("data-action") || "").replace("construct-", "");
    button.setAttribute("aria-pressed", String(method === tool));
  }
}

/** 取得原生对话框，先验证元素类型再调用模态接口 */
function getDialog(id: string): HTMLDialogElement {
  const dialog = getElement(id);
  if (!(dialog instanceof HTMLDialogElement)) {
    throw new Error("对话框类型不正确：" + id);
  }
  return dialog;
}

/** 打开对象标签编辑，锁定对象不允许间接修改 */
function editText(id: string): void {
  if (board.readOnly) {
    return;
  }
  let shape = findShape(board.document, id);
  if (shape === undefined || shape.locked) {
    return;
  }
  if (shape.kind === "point") {
    let label: Shape | null = null;
    for (const candidate of board.document.shapes) {
      if (
        candidate.kind === "text" &&
        candidate.relation.kind === "label" &&
        candidate.relation.sources[0] === shape.id
      ) {
        label = candidate;
        break;
      }
    }
    if (label === null) {
      shape.text = shape.name;
      label = addPointLabel(board.document, shape);
    }
    if (label === null || label.locked) {
      return;
    }
    shape = label;
    id = label.id;
  } else if (shape.kind !== "text" && shape.text !== "") {
    const label = detachLabel(board.document, shape);
    if (label === null) {
      return;
    }
    shape = label;
    id = label.id;
  }
  textTarget = id;
  const input = getElement("text-value");
  if (input instanceof HTMLTextAreaElement) {
    input.value = shape.text;
  }
  getDialog("text-dialog").showModal();
}

/** 提交文字后保留原来的对象关系，按一次操作写入历史 */
function handleTextSubmit(event: SubmitEvent): void {
  event.preventDefault();
  const shape = findShape(board.document, textTarget);
  const input = getElement("text-value");
  if (!board.readOnly && shape !== undefined && input instanceof HTMLTextAreaElement) {
    shape.text = input.value;
    if (shape.kind === "text") {
      const object = createFabricShape(shape);
      shape.height = object.height;
      object.dispose();
    }
    board.render();
    commit();
  }
  getDialog("text-dialog").close();
}

/** 预览与下载共用透明背景、内容裁剪和辅助对象过滤 */
function getExportSvg(): string {
  return createSvg(board.document, {
    crop: true,
    transparent: true,
    hideAuxiliary: true
  });
}

/** 使用独立图片展示导出预览，预览不插入可执行的 SVG 内容 */
function refreshExportPreview(): void {
  const preview = getElement("export-preview");
  const previous = preview.querySelector("img");
  if (previous !== null) {
    URL.revokeObjectURL(previous.src);
  }
  const image = new Image();
  image.alt = "导出预览";
  image.src = URL.createObjectURL(new Blob([getExportSvg()], { type: "image/svg+xml" }));
  preview.replaceChildren(image);
}

/** 从文件选择器读取作品，失败时保持当前画板不变 */
async function handleFileChange(): Promise<void> {
  const input = getInput("file-input");
  if (input.files === null || input.files.length === 0) {
    return;
  }
  try {
    const document = await openProject(input.files[0]);
    replaceDocument(document);
  } catch (error) {
    notify(errorMessage(error));
  }
  input.value = "";
}

/** 处理统一入口的工具和命令，异步失败统一报告 */
async function handleClick(event: MouseEvent): Promise<void> {
  if (!(event.target instanceof Element)) {
    return;
  }
  const toolButton = event.target.closest("[data-tool]");
  if (toolButton !== null) {
    chooseTool(toolButton.getAttribute("data-tool") || "");
    return;
  }
  const textToggle = event.target.closest("[data-text-toggle]");
  if (textToggle instanceof HTMLButtonElement && !board.readOnly) {
    const selected = board.getSelectedShapes();
    if (selected.length === 1) {
      const property = textToggle.dataset.textToggle;
      if (property === "bold") {
        selected[0].bold = !selected[0].bold;
      }
      if (property === "italic") {
        selected[0].italic = !selected[0].italic;
      }
      if (property === "underline") {
        selected[0].underline = !selected[0].underline;
      }
      board.render();
      commit();
    }
    return;
  }
  const layer = event.target.closest("[data-object-select]");
  const archive = event.target.closest("[data-archive-value]");
  if (archive instanceof HTMLButtonElement) {
    const id = archive.dataset.archiveValue || "";
    saveLocal();
    openArchive(id);
    const menu = getElement("archive-options");
    menu.hidePopover();
    getElement("archive-select").focus();
    return;
  }
  if (layer !== null) {
    board.select(
      layer.getAttribute("data-object-select") || "",
      event.shiftKey || event.ctrlKey || event.metaKey
    );
    return;
  }
  const lock = event.target.closest("[data-object-lock]");
  if (lock !== null) {
    if (board.readOnly) {
      return;
    }
    const shape = findShape(board.document, lock.getAttribute("data-object-lock") || "");
    if (shape !== undefined) {
      shape.locked = !shape.locked;
      board.render();
      commit();
    }
    return;
  }
  const visibility = event.target.closest("[data-visibility]");
  if (visibility !== null) {
    if (board.readOnly) {
      return;
    }
    const shape = findShape(board.document, visibility.getAttribute("data-visibility") || "");
    if (shape !== undefined) {
      shape.hidden = !shape.hidden;
      board.render();
      commit();
    }
    return;
  }
  const button = event.target.closest("[data-action]");
  if (button === null || (button instanceof HTMLButtonElement && button.disabled)) {
    return;
  }
  try {
    await executeAction(button.getAttribute("data-action") || "");
  } catch (error) {
    notify(errorMessage(error));
  }
}

/** 执行文件与视图命令，作品对象操作交给单独函数 */
async function executeAction(action: string): Promise<void> {
  if (board.readOnly && !isViewAction(action)) {
    notify("只读模式");
    return;
  }
  if (action === "new") {
    saveLocal();
    board.setDocument(archives.create(createDocument()));
    history.reset(board.document);
    board.fit();
    commit();
  } else if (action === "open") {
    getInput("file-input").click();
  } else if (action === "save") {
    saveLocal();
  } else if (action === "delete-archive") {
    requestDeleteArchive(archives.active);
  } else if (action === "cancel-delete") {
    getDialog("delete-dialog").close();
  } else if (action === "confirm-delete") {
    const next = archives.remove(deleteArchiveId);
    getDialog("delete-dialog").close();
    if (next !== null) {
      board.setDocument(next);
      history.reset(next);
      board.fit();
      scheduleSave();
    }
    refreshPanels();
  } else if (action === "readonly") {
    if (!board.readOnly) {
      saveLocal();
    }
    board.setReadOnly(!board.readOnly);
    getElement("readonly-button").setAttribute("aria-pressed", String(board.readOnly));
    refreshPanels();
  } else if (action === "undo" || action === "redo") {
    let snapshot: string | null = null;
    if (action === "redo") {
      snapshot = history.redo();
    } else {
      snapshot = history.undo();
    }
    if (snapshot !== null) {
      board.setDocument(parseDocument(snapshot));
      scheduleSave();
      refreshPanels();
    }
  } else if (action === "zoom-in") {
    board.zoomTo(board.viewport.zoom * 1.2);
  } else if (action === "zoom-out") {
    board.zoomTo(board.viewport.zoom / 1.2);
  } else if (action === "reset-zoom") {
    board.zoomTo(1);
  } else if (action === "fit") {
    board.fit();
  } else if (action === "grid" || action === "snap") {
    if (action === "grid") {
      board.showGrid = !board.showGrid;
      getElement("grid-button").setAttribute("aria-pressed", String(board.showGrid));
    } else {
      board.snap = !board.snap;
      getElement("snap-button").setAttribute("aria-pressed", String(board.snap));
    }
    board.render();
  } else if (action === "toggle-inspector") {
    const workspace = document.querySelector(".workspace");
    if (workspace !== null) {
      setSidebar(workspace.classList.contains("inspector-hidden"));
    }
  } else if (action === "tab-description") {
    getElement("properties-panel").hidden = true;
    getElement("objects-panel").hidden = true;
    getElement("description-panel").hidden = false;
    syncTabs("description");
  } else if (action === "description-edit") {
    const editor = getElement("description-editor");
    editor.hidden = !editor.hidden;
    getElement("description-preview").hidden = !editor.hidden;
  } else if (action === "close-polygon") {
    getDialog("polygon-dialog").close();
  } else if (action === "tab-objects" || action === "tab-properties") {
    const objects = action === "tab-objects";
    getElement("description-panel").hidden = true;
    getElement("properties-panel").hidden = objects;
    getElement("objects-panel").hidden = !objects;
    syncTabs(action.replace("tab-", ""));
  } else if (action === "close-text") {
    getDialog("text-dialog").close();
  } else if (action === "close-export") {
    getDialog("export-dialog").close();
  } else if (action === "export") {
    getElement("export-error").textContent = "";
    refreshExportPreview();
    getDialog("export-dialog").showModal();
  } else if (action === "export-svg") {
    downloadBlob(
      new Blob([getExportSvg()], { type: "image/svg+xml" }),
      getFileName(board.document.name) + ".svg"
    );
  } else if (action === "export-project") {
    saveProject(board.document);
  } else if (action === "export-png") {
    const dialog = getDialog("export-dialog");
    dialog.setAttribute("aria-busy", "true");
    try {
      await exportPng(getExportSvg(), board.document.name);
    } catch (error) {
      getElement("export-error").textContent = errorMessage(error);
    } finally {
      dialog.setAttribute("aria-busy", "false");
    }
  } else {
    executeObjectAction(action);
  }
}

/** 从构造按钮名称得到支持的关系类型，不把任意字符串当作类型 */
function getRelationKind(action: string): RelationKind {
  if (action === "construct-segment") {
    return "segment";
  }
  if (action === "construct-midpoint") {
    return "midpoint";
  }
  if (action === "construct-intersection") {
    return "intersection";
  }
  if (action === "construct-parallel") {
    return "parallel";
  }
  if (action === "construct-perpendicular") {
    return "perpendicular";
  }
  throw new Error("不支持的构造命令");
}

/** 执行作用于选区的命令，复制保持原始依赖顺序以便粘贴后通过校验 */
function executeObjectAction(action: string): void {
  const selected = board.getSelectedShapes();
  if (action === "copy") {
    clipboard = [];
    for (const shape of board.document.shapes) {
      if (board.selectedIds.includes(shape.id)) {
        clipboard.push(structuredClone(shape));
      }
    }
    return;
  }
  if (action === "paste") {
    board.selectedIds = pasteShapes(board.document, clipboard);
  } else if (action === "delete") {
    const count = deleteShapes(board.document, board.selectedIds);
    if (count > board.selectedIds.length) {
      notify("已同时删除关联构造，可撤销");
    }
    board.selectedIds = [];
  } else if (action === "edit-text") {
    if (selected.length === 1) {
      editText(selected[0].id);
    }
    return;
  } else if (action.startsWith("construct-")) {
    const kind = getRelationKind(action);
    if (!isConstructionTool(kind)) {
      return;
    }
    if (!validConstructionSources(kind, selected)) {
      board.setTool(kind);
      return;
    }
    const shape = constructShape(board.document, selected, kind);
    addPointLabel(board.document, shape);
    board.selectedIds = [shape.id];
  } else if (
    action === "align-left" ||
    action === "align-top" ||
    action === "distribute" ||
    action === "same-width"
  ) {
    arrangeShapes(selected, action);
  } else if (action === "group") {
    const group = crypto.randomUUID();
    for (const shape of selected) {
      shape.group = group;
    }
  } else if (action === "ungroup") {
    for (const shape of selected) {
      shape.group = "";
    }
  } else if (action === "raise" || action === "lower") {
    changeLayers(board.document, board.selectedIds, action === "raise");
  } else {
    return;
  }
  board.render();
  commit();
}

/** 修改单个属性，先验证控件范围，再写入模型 */
function updateProperty(control: HTMLInputElement | HTMLSelectElement): void {
  if (board.readOnly) {
    return;
  }
  try {
    const changed = applyProperty(board.document, board.getSelectedShapes(), control);
    if (!changed) {
      return;
    }
    board.render();
    commit();
  } catch (error) {
    notify(errorMessage(error));
    refreshPanels();
  }
}

/** 处理存档切换、作品名称和对象属性变化 */
function handleChange(event: Event): void {
  const control = event.target;
  if (
    control instanceof HTMLTextAreaElement &&
    control.id === "description-editor" &&
    !board.readOnly
  ) {
    board.document.description = control.value;
    commit();
    return;
  }
  if (!(control instanceof HTMLInputElement) && !(control instanceof HTMLSelectElement)) {
    return;
  }
  if (board.readOnly) {
    return;
  }
  if (control.dataset.textProperty !== undefined) {
    control.dataset.property = control.dataset.textProperty;
    updateProperty(control);
    return;
  }
  if (control.id === "document-name") {
    board.document.name = control.value;
    commit();
  } else if (control.id === "tool-stroke") {
    board.stroke = control.value;
    board.render();
  } else if (control.dataset.property !== undefined) {
    updateProperty(control);
  }
}

/** 键盘操作不干扰输入框、原生文本编辑或打开的对话框 */
async function handleKeyDown(event: KeyboardEvent): Promise<void> {
  if (event.defaultPrevented) {
    return;
  }
  if (
    event.target instanceof HTMLInputElement ||
    event.target instanceof HTMLTextAreaElement ||
    event.target instanceof HTMLSelectElement ||
    document.querySelector("dialog[open]") !== null
  ) {
    return;
  }
  let action = "";
  const key = event.key.toLowerCase();
  if (event.ctrlKey || event.metaKey) {
    if (key === "z") {
      action = "undo";
      if (event.shiftKey) {
        action = "redo";
      }
    } else if (key === "y") {
      action = "redo";
    } else if (key === "c") {
      action = "copy";
    } else if (key === "v") {
      action = "paste";
    } else if (key === "s") {
      action = "save";
    } else if (key === "a") {
      event.preventDefault();
      board.selectedIds = [];
      for (const shape of board.document.shapes) {
        if (!shape.hidden) {
          board.selectedIds.push(shape.id);
        }
      }
      board.render();
      refreshPanels();
      return;
    }
  } else if (key === "delete" || key === "backspace") {
    action = "delete";
  } else if (key === "escape") {
    board.cancelGesture();
    board.selectedIds = [];
    chooseTool("select");
    refreshPanels();
    hideMessage();
    return;
  } else if (key.startsWith("arrow")) {
    if (board.readOnly) {
      return;
    }
    event.preventDefault();
    let distance = 1;
    if (event.shiftKey) {
      distance = LARGE_MOVE_DISTANCE;
    }
    for (const shape of board.getSelectedShapes()) {
      if (shape.locked) {
        continue;
      }
      if (isDependent(shape)) {
        shape.relation = { kind: "none", sources: [] };
      }
      if (key === "arrowleft") {
        moveShape(shape, -distance, 0);
      } else if (key === "arrowright") {
        moveShape(shape, distance, 0);
      } else if (key === "arrowup") {
        moveShape(shape, 0, -distance);
      } else if (key === "arrowdown") {
        moveShape(shape, 0, distance);
      }
    }
    board.render();
    commit();
    return;
  } else if (key === "v") {
    chooseTool("select");
  } else if (key === "h") {
    chooseTool("hand");
  } else if (key === "r") {
    chooseTool("rect");
  } else if (key === "o") {
    chooseTool("ellipse");
  } else if (key === "t") {
    chooseTool("text");
  }
  if (action !== "") {
    event.preventDefault();
    try {
      await executeAction(action);
    } catch (error) {
      notify(errorMessage(error));
    }
  }
}

/** 页面关闭前尝试保存最后一次修改，不创建额外的确认对话框 */
function handlePageHide(): void {
  if (saveTimer !== 0) {
    saveLocal();
  }
}

mountInterface();
if (window.matchMedia("(max-width: 45rem)").matches) {
  const workspace = document.querySelector(".workspace");
  if (workspace !== null) {
    workspace.classList.add("inspector-hidden");
    getElement("inspector-button").setAttribute("aria-pressed", "false");
    getElement("inspector-button").setAttribute("aria-expanded", "false");
  }
}
archives = new Archives();
const initial = loadInitialDocument();
if (archives.find(archives.active) === undefined) {
  archives.create(initial);
}
archives.seedBuiltins();
board = new BoardCanvas(getElement("canvas-host"), initial, {
  changed: commit,
  selected: refreshPanels,
  viewChanged: refreshViewport,
  editText: editText,
  notify: notify,
  toolChanged: refreshToolButtons
});
history.push(initial);
chooseTool("select");
refreshPanels();
document.addEventListener("click", handleClick);
document.addEventListener("change", handleChange);
document.addEventListener("keydown", handleKeyDown);
getInput("file-input").addEventListener("change", handleFileChange);
getElement("text-form").addEventListener("submit", handleTextSubmit);
getElement("polygon-form").addEventListener("submit", handlePolygonSubmit);
window.addEventListener("pagehide", handlePageHide);
syncLiveEntry();

/** 只读模式允许浏览、切换视图和导出，不允许改变作品或存档 */
function isViewAction(action: string): boolean {
  return [
    "readonly",
    "copy",
    "save",
    "export",
    "close-export",
    "export-svg",
    "export-png",
    "export-project",
    "zoom-in",
    "zoom-out",
    "reset-zoom",
    "fit",
    "grid",
    "snap",
    "toggle-inspector",
    "tab-objects",
    "tab-properties",
    "tab-description",
    "cancel-delete"
  ].includes(action);
}

/** 按当前作品状态禁用修改入口，快捷键另由命令入口统一校验 */
function applyReadOnlyControls(): void {
  const readonly = board.readOnly;
  getInput("document-name").disabled = readonly;
  for (const button of document.querySelectorAll("[data-visibility], [data-object-lock]")) {
    if (button instanceof HTMLButtonElement) {
      button.disabled = readonly;
    }
  }
  for (const control of document.querySelectorAll("[data-property]")) {
    if (control instanceof HTMLInputElement || control instanceof HTMLSelectElement) {
      if (readonly) {
        control.disabled = true;
      }
    }
  }
  for (const button of document.querySelectorAll(
    "button[data-action], button[data-tool], input#tool-stroke"
  )) {
    if (!(button instanceof HTMLButtonElement) && !(button instanceof HTMLInputElement)) {
      continue;
    }
    if (button instanceof HTMLInputElement) {
      button.disabled = readonly;
      continue;
    }
    const action = button.dataset.action;
    if (action !== undefined && action !== "undo" && action !== "redo") {
      button.disabled = readonly && !isViewAction(action);
    }
    if (button.dataset.tool !== undefined) {
      button.disabled =
        readonly && button.dataset.tool !== "select" && button.dataset.tool !== "hand";
    }
  }
}

/** 同步标题栏存档选择，选项值使用存档编号 */
function renderArchives(): void {
  renderArchivePicker(archives.items, archives.active);
}

/** 切换存档后重置撤销记录，避免修改跨存档混在一起 */
function openArchive(id: string): void {
  const document = archives.open(id);
  board.setDocument(document);
  history.reset(document);
  board.fit();
  refreshPanels();
  if (!board.readOnly) {
    scheduleSave();
  }
}

/** 删除前展示存档名称，只有明确确认后才移除本地数据 */
function requestDeleteArchive(id: string): void {
  if (board.readOnly) {
    return;
  }
  if (archives.find(id) === undefined) {
    archives.save(board.document);
    id = archives.active;
  }
  const item = archives.find(id);
  if (item === undefined) {
    return;
  }
  deleteArchiveId = id;
  getElement("delete-archive-name").textContent = "删除「" + item.document.name + "」？";
  getDialog("delete-dialog").showModal();
}

/** 更新选区上方的文字配置，不重建正在输入的控件 */
function refreshTextToolbar(): void {
  if (board === undefined) {
    return;
  }
  const shapes = board.getSelectedShapes();
  let selected: Shape | undefined;
  if (shapes.length === 1) {
    selected = shapes[0];
  }
  updateTextToolbar(selected, board.getSelectionBounds(), board.readOnly);
}

/** 面板标签使用统一选中状态 */
function syncTabs(active: string): void {
  for (const name of ["properties", "objects", "description"]) {
    const button = getElement(name + "-tab");
    button.classList.toggle("active", name === active);
    button.setAttribute("aria-pressed", String(name === active));
  }
}

/** 检查边数后进入正多边形工具，实际大小由拖动决定 */
function handlePolygonSubmit(event: SubmitEvent): void {
  event.preventDefault();
  const input = getInput("polygon-sides");
  if (!input.reportValidity() || board.readOnly) {
    return;
  }
  board.polygonSides = Number(input.value);
  board.setTool("polygon");
  getDialog("polygon-dialog").close();
}
