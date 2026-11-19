import "../styles/styles.css";
import "../styles/workspace.css";
import "../styles/motion.css";
import "../styles/selects.css";
import "../styles/text-toolbar.css";
import "../styles/archive-picker.css";
import "../styles/math-tools.css";
import { BoardCanvas } from "../canvas/canvas";
import { arrangeShapes, changeLayers, deleteShapes, pasteShapes } from "../core/commands";
import { constructSelection, expandConstructionSelection } from "../core/construction-batch";
import { parseDocument, STORAGE_KEY } from "../storage/document";
import { openProject } from "../storage/files";
import { updateRelations } from "../geometry/geometry";
import { slideAttachedPoint } from "../geometry/point-attachment";
import { applyProperty, renderProperties, updateRangeValue } from "../ui/inspector";
import { renderObjects } from "../ui/object-manager";
import {
  createDocument,
  findShape,
  History,
  isDependent,
  MAX_SHAPES,
  moveShape
} from "../core/model";
import { getDialog, getElement, getInput, isTool, mountInterface } from "../ui/ui";
import type { BoardDocument, ConstructionTool, Shape, Tool } from "../core/types";
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
import { validConstructionSources } from "../geometry/construction-tools";
import { openMathDialog, setupMathDialogs } from "../ui/math-dialogs";
import { axisStep } from "../canvas/axes";
import { COORDINATE_UNIT } from "../math/coordinates";
import { refreshIcons } from "../ui/ui";
import { handleExportAction, setupExportDialog } from "../ui/export-dialog";
import { handleReplayAction, openReplay, setupReplay } from "../ui/replay";
import { hideMessage, notify, notifyConstruction } from "../ui/feedback";

// 自动保存等待时间，单位为毫秒
const AUTOSAVE_DELAY = 300;
// 方向键配合 Shift 时的单次移动距离
const LARGE_MOVE_DISTANCE = 10;
// 点击缩放按钮时的倍率，大于 1，缩小时使用它的倒数
const ZOOM_BUTTON_FACTOR = 1.2;
let board: BoardCanvas;
const history = new History();
let clipboard: Shape[] = [];
let textTarget = "";
let initialDialogText = "";
let saveTimer = 0;
let needsSave = false;
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
    notify("无法恢复作品：" + errorMessage(error), "error");
  }
  return createDocument();
}

/** 延迟自动保存，避免拖动过程反复写入浏览器存储 */
function scheduleSave(): void {
  needsSave = true;
  syncLeaveWarning();
  getElement("save-status").textContent = "正在保存";
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(runAutosave, AUTOSAVE_DELAY);
}

/** 自动保存只在失败时显示浮动提示 */
function runAutosave(): void {
  saveLocal();
}

/** 校验并保存作品，返回是否可以离开当前存档 */
function saveLocal(): boolean {
  window.clearTimeout(saveTimer);
  saveTimer = 0;
  try {
    const saved = prepareDocument(board.document);
    const text = JSON.stringify(saved);
    parseDocument(text);
    archives.save(saved);
    needsSave = false;
    syncLeaveWarning();
    // 旧版恢复键仍供兼容使用，写入失败不影响已经保存的存档
    try {
      localStorage.setItem(STORAGE_KEY, text);
    } catch {
      // 启动时优先读取当前存档
    }
    renderArchives();
    getElement("save-status").textContent = "已保存到此浏览器";
    return true;
  } catch (error) {
    needsSave = true;
    syncLeaveWarning();
    getElement("save-status").textContent = "保存失败";
    notify("保存失败，当前作品仍在画板上，请导出项目备份", "error");
    return false;
  }
}

/** 有未保存的修改时先保存，失败则保留当前作品 */
function saveBeforeLeaving(): boolean {
  if (needsSave) {
    return saveLocal();
  }
  return true;
}

/** 更新状态栏、属性和对象管理列表 */
function refreshPanels(): void {
  const selected = board.getSelectedShapes();
  getElement("axes-button").setAttribute("aria-pressed", String(board.showAxes));
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
    const scale = getElement("canvas-scale");
    const step = axisStep(board.viewport.zoom, host.clientWidth);
    scale.textContent = step + " 单位";
    scale.style.width = step * COORDINATE_UNIT * board.viewport.zoom + "px";
    scale.dataset.step = String(step);
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
  if (tool === "function" || tool === "fit" || tool === "coordinate-point") {
    if (!board.readOnly) {
      openMathDialog(tool);
    }
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
    (tool === "line" ||
      tool === "ray" ||
      tool === "straight" ||
      tool === "arrow" ||
      tool === "connector" ||
      tool === "curve")
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

/** 只读取要编辑的文字，确认保存后才创建独立标签 */
function editText(id: string): void {
  if (board.readOnly) {
    return;
  }
  const shape = findShape(board.document, id);
  if (
    shape === undefined ||
    shape.locked ||
    shape.kind === "function" ||
    shape.kind === "svg-image"
  ) {
    return;
  }
  let text = shape.text;
  if (shape.kind === "point") {
    for (const candidate of board.document.shapes) {
      if (
        candidate.kind === "text" &&
        candidate.relation.kind === "label" &&
        candidate.relation.sources[0] === shape.id
      ) {
        if (candidate.locked) {
          return;
        }
        id = candidate.id;
        text = candidate.text;
        break;
      }
    }
    if (id === shape.id && text === "") {
      text = shape.name;
    }
  }
  textTarget = id;
  initialDialogText = text;
  const input = getElement("text-value");
  if (input instanceof HTMLTextAreaElement) {
    input.value = text;
  }
  getElement("text-error").textContent = "";
  getDialog("text-dialog").showModal();
}

/** 提交文字后保留原来的对象关系，按一次操作写入历史 */
function handleTextSubmit(event: SubmitEvent): void {
  event.preventDefault();
  const shape = findShape(board.document, textTarget);
  const input = getElement("text-value");
  const dialog = getDialog("text-dialog");
  if (
    board.readOnly ||
    shape === undefined ||
    shape.locked ||
    !(input instanceof HTMLTextAreaElement)
  ) {
    dialog.close();
    return;
  }
  let edited = shape;
  if (shape.kind === "point" || (shape.kind !== "text" && shape.text !== "")) {
    if (board.document.shapes.length >= MAX_SHAPES) {
      getElement("text-error").textContent = "对象数量已达上限，无法创建独立标签";
      return;
    }
    let label: Shape | null;
    if (shape.kind === "point") {
      if (shape.text === "") {
        shape.text = shape.name;
      }
      label = addPointLabel(board.document, shape);
    } else {
      label = detachLabel(board.document, shape);
    }
    if (label !== null) {
      edited = label;
    }
  }
  edited.text = input.value;
  if (edited.kind === "text") {
    const object = createFabricShape(edited);
    edited.height = object.height;
    object.dispose();
  }
  dialog.close();
  board.render();
  commit();
  notify("已更新文字", "success");
}

/** 从文件选择器读取作品，失败时保持当前画板不变 */
async function handleFileChange(): Promise<void> {
  const input = getInput("file-input");
  if (input.files === null || input.files.length === 0) {
    return;
  }
  try {
    const document = await openProject(input.files[0]);
    if (board.readOnly || !saveBeforeLeaving()) {
      return;
    }
    replaceDocument(document);
    if (document.shapes.length === 1 && document.shapes[0].kind === "svg-image") {
      notify("已打开「" + document.name + "」，保留为可整体编辑的 SVG 图像", "success");
      return;
    }
    notify("已打开「" + document.name + "」", "success");
  } catch (error) {
    notify("打开失败：" + errorMessage(error), "error");
  } finally {
    input.value = "";
  }
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
    const menu = getElement("archive-options");
    menu.hidePopover();
    getElement("archive-select").focus();
    switchArchive(id);
    return;
  }
  if (layer !== null) {
    board.selectObject(
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
      if (shape.locked) {
        notify("已锁定「" + shape.name + "」");
      } else {
        notify("已解锁「" + shape.name + "」");
      }
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
      if (shape.hidden) {
        notify("已隐藏「" + shape.name + "」");
      } else {
        notify("已显示「" + shape.name + "」");
      }
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
    notify(errorMessage(error), "error");
  }
}

/** 执行文件与视图命令，作品对象操作交给单独函数 */
async function executeAction(action: string): Promise<void> {
  if (board.readOnly && !isViewAction(action)) {
    notify("只读模式下无法修改作品");
    return;
  }
  if (action === "new") {
    if (!saveBeforeLeaving()) {
      return;
    }
    board.setDocument(archives.create(createDocument()));
    history.reset(board.document);
    board.fit();
    commit();
    notify("已打开空白画板", "success");
  } else if (action === "open") {
    getInput("file-input").click();
  } else if (action === "save") {
    if (saveLocal()) {
      notify("已保存到此浏览器", "success");
    }
  } else if (action === "delete-archive") {
    requestDeleteArchive(archives.active);
  } else if (action === "cancel-delete") {
    getDialog("delete-dialog").close();
  } else if (action === "confirm-delete") {
    const dialog = getDialog("delete-dialog");
    let next: BoardDocument | null;
    try {
      next = archives.remove(deleteArchiveId);
    } catch {
      getElement("delete-error").textContent = "删除失败，存档未更改";
      return;
    }
    dialog.close();
    if (next !== null) {
      board.setDocument(next);
      history.reset(next);
      board.fit();
      scheduleSave();
    }
    refreshPanels();
    notify("已删除存档", "success");
  } else if (action === "readonly") {
    if (!board.readOnly && !saveBeforeLeaving()) {
      return;
    }
    board.setReadOnly(!board.readOnly);
    getElement("readonly-button").setAttribute("aria-pressed", String(board.readOnly));
    refreshPanels();
    if (board.readOnly) {
      notify("已进入只读模式");
    } else {
      notify("已恢复编辑");
    }
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
      if (action === "undo") {
        notify("已撤销上一步");
      } else {
        notify("已重做上一步");
      }
    }
  } else if (action === "zoom-in") {
    board.zoomTo(board.viewport.zoom * ZOOM_BUTTON_FACTOR);
  } else if (action === "zoom-out") {
    board.zoomTo(board.viewport.zoom / ZOOM_BUTTON_FACTOR);
  } else if (action === "reset-zoom") {
    board.zoomTo(1);
  } else if (action === "fit") {
    board.fit();
  } else if (action === "axes") {
    board.showAxes = !board.showAxes;
    getElement("axes-button").setAttribute("aria-pressed", String(board.showAxes));
    board.render();
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
  } else if (action === "replay") {
    const frames = history.replayFrames();
    if (frames.length < 2) {
      notify("当前画板还没有可回放的编辑步骤");
      return;
    }
    openReplay(frames, board.viewBounds());
  } else if (action.startsWith("replay-")) {
    handleReplayAction(action);
  } else if (action === "export" || action === "close-export" || action.startsWith("export-")) {
    await handleExportAction(action, board.document);
  } else {
    executeObjectAction(action);
  }
}

/** 从构造按钮名称得到支持的关系类型，不把任意字符串当作类型 */
function getRelationKind(action: string): ConstructionTool {
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
  if (action === "construct-bisector") {
    return "bisector";
  }
  throw new Error("不支持的构造命令");
}

/** 执行作用于选区的命令，复制保持原始依赖顺序以便粘贴后通过校验 */
function executeObjectAction(action: string): void {
  const selected = board.getSelectedShapes();
  if (action === "copy") {
    if (selected.length === 0) {
      notify("请先选择要复制的对象");
      return;
    }
    clipboard = [];
    for (const shape of board.document.shapes) {
      if (board.selectedIds.includes(shape.id)) {
        clipboard.push(structuredClone(shape));
      }
    }
    notify("已复制 " + clipboard.length + " 个对象");
    return;
  }
  let feedback = "";
  if (action === "hide") {
    for (const shape of selected) {
      shape.hidden = true;
    }
    board.selectedIds = [];
    if (selected.length > 0) {
      feedback = "已隐藏 " + selected.length + " 个对象，可在对象管理中恢复";
    }
  } else if (action === "paste") {
    if (clipboard.length === 0) {
      notify("暂无可粘贴的对象");
      return;
    }
    board.selectedIds = pasteShapes(board.document, clipboard);
    feedback = "已粘贴 " + board.selectedIds.length + " 个对象";
  } else if (action === "delete") {
    const count = deleteShapes(board.document, board.selectedIds);
    if (count > selected.length) {
      feedback = "已删除 " + count + " 个对象，含关联构造，可撤销";
    } else if (count > 0) {
      feedback = "已删除 " + count + " 个对象，可撤销";
    }
    board.selectedIds = [];
  } else if (action === "edit-text") {
    if (selected.length === 1) {
      editText(selected[0].id);
    }
    return;
  } else if (action.startsWith("construct-")) {
    constructFromSelection(action, selected);
    return;
  } else if (
    action === "align-left" ||
    action === "align-top" ||
    action === "distribute" ||
    action === "same-width"
  ) {
    arrangeShapes(selected, action);
  } else if (action === "group") {
    if (selected.length < 2) {
      notify("请至少选择两个对象再组合");
      return;
    }
    const group = crypto.randomUUID();
    for (const shape of selected) {
      shape.group = group;
    }
    feedback = "已组合 " + selected.length + " 个对象";
  } else if (action === "ungroup") {
    for (const shape of selected) {
      if (shape.group !== "") {
        feedback = "已取消组合";
      }
      shape.group = "";
    }
  } else if (action === "raise" || action === "lower") {
    changeLayers(board.document, board.selectedIds, action === "raise");
  } else {
    return;
  }
  board.render();
  commit();
  if (feedback !== "") {
    notify(feedback);
  }
}

/** 多选时批量构造，选区不足时仍可先开工具再点选来源 */
function constructFromSelection(action: string, selected: Shape[]): void {
  const kind = getRelationKind(action);
  const selection = expandConstructionSelection(selected, kind);
  if (!validConstructionSources(kind, selection.sources, selection.edges.size > 0)) {
    // 不够构造时保留明确的来源，避免把上一个工具的结果自动带入下一个工具
    const isPointAndLine = kind === "parallel" || kind === "perpendicular";
    const canKeepSelection = isPointAndLine || selection.sources.length === 1;
    if (board.tool !== "select" || !canKeepSelection || selection.sources.length === 0) {
      board.setTool(kind);
      return;
    }
    board.startConstruction(kind, selection.sources, selection.edges);
    if (kind === "segment") {
      notify("再选一个点");
    } else if (isPointAndLine) {
      if (selection.sources[0].kind === "point") {
        notify("再选一条线或直边");
      } else {
        notify("再选一个点");
      }
    } else {
      notify("再选一条线或直边");
    }
    return;
  }
  const result = constructSelection(board.document, selection.sources, kind, selection.edges);
  if (result.created.length > 0) {
    board.selectedIds = [];
    for (const shape of result.created) {
      board.selectedIds.push(shape.id);
    }
    board.render();
    commit();
  }
  notifyConstruction(result);
}

/** 修改单个属性，先验证控件范围，再写入模型 */
function updateProperty(control: HTMLInputElement | HTMLSelectElement): void {
  if (board.readOnly) {
    return;
  }
  try {
    let focusedRange = "";
    if (
      control instanceof HTMLInputElement &&
      control.type === "range" &&
      control === document.activeElement
    ) {
      focusedRange = control.dataset.property || "";
    }
    const changed = applyProperty(board.document, board.getSelectedShapes(), control);
    if (!changed) {
      return;
    }
    board.render();
    commit();
    // 属性面板重绘后把焦点还给滑块，方向键可以连续调整
    if (focusedRange !== "") {
      const next = document.querySelector(
        'input[type="range"][data-property="' + focusedRange + '"]'
      );
      if (next instanceof HTMLInputElement) {
        next.focus();
      }
    }
  } catch (error) {
    notify("无法更新属性：" + errorMessage(error), "error");
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
    } else if (key === "h") {
      action = "hide";
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
    const offset = { x: 0, y: 0 };
    if (key === "arrowleft") {
      offset.x = -distance;
    } else if (key === "arrowright") {
      offset.x = distance;
    } else if (key === "arrowup") {
      offset.y = -distance;
    } else if (key === "arrowdown") {
      offset.y = distance;
    } else {
      return;
    }
    for (const shape of board.getSelectedShapes()) {
      if (shape.locked) {
        continue;
      }
      if (shape.relation.kind === "point-on-outline") {
        const target = { x: shape.x + offset.x, y: shape.y + offset.y };
        slideAttachedPoint(board.document, shape, target, board.viewBounds());
        continue;
      }
      if (isDependent(shape)) {
        shape.relation = { kind: "none", sources: [] };
      }
      moveShape(shape, offset.x, offset.y);
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
      notify(errorMessage(error), "error");
    }
  }
}

/** 判断名称、说明或文字对象是否有尚未提交的输入 */
function hasTextDraft(): boolean {
  const title = getInput("document-name");
  const description = getElement("description-editor");
  if (title.value !== board.document.name) {
    return true;
  }
  if (
    description instanceof HTMLTextAreaElement &&
    description.value !== board.document.description
  ) {
    return true;
  }
  const textDialog = getDialog("text-dialog");
  const textInput = getElement("text-value");
  if (
    textDialog.open &&
    textInput instanceof HTMLTextAreaElement &&
    textInput.value !== initialDialogText
  ) {
    return true;
  }
  return board.hasTextDraft();
}

/** 仅在有未保存内容时监听退出，保存成功后解除监听 */
function syncLeaveWarning(): void {
  if (needsSave || hasTextDraft()) {
    window.addEventListener("beforeunload", confirmLeave);
  } else {
    window.removeEventListener("beforeunload", confirmLeave);
  }
}

/** 请求浏览器显示原生离开确认，是否弹出由浏览器决定 */
function confirmLeave(event: BeforeUnloadEvent): void {
  if (needsSave || hasTextDraft()) {
    event.preventDefault();
    event.returnValue = " ";
  }
}

/** 页面确认离开后再尝试保存已经提交的修改 */
function handlePageHide(): void {
  if (needsSave && !board.readOnly) {
    saveLocal();
  }
}

mountInterface();
mountMathView();
if (window.matchMedia("(max-width: 45rem)").matches) {
  setSidebar(false);
}
archives = new Archives();
const initial = loadInitialDocument();
if (archives.find(archives.active) === undefined) {
  archives.create(initial);
}
archives.seedBuiltins();
board = new BoardCanvas(getElement("canvas-host"), initial, {
  changed: commit,
  draftChanged: syncLeaveWarning,
  constructed: notifyConstruction,
  selected: refreshPanels,
  viewChanged: refreshViewport,
  editText: editText,
  notify: notify,
  toolChanged: refreshToolButtons
});
setupMathDialogs(board, commit);
setupExportDialog();
setupReplay();
refreshIcons();
history.push(initial);
chooseTool("select");
refreshPanels();
document.addEventListener("click", handleClick);
document.addEventListener("change", handleChange);
document.addEventListener("input", updateRangeValue);
getInput("document-name").addEventListener("input", syncLeaveWarning);
getElement("description-editor").addEventListener("input", syncLeaveWarning);
getElement("text-value").addEventListener("input", syncLeaveWarning);
getDialog("text-dialog").addEventListener("close", syncLeaveWarning);
document.addEventListener("keydown", handleKeyDown);
getInput("file-input").addEventListener("change", handleFileChange);
getElement("text-form").addEventListener("submit", handleTextSubmit);
getElement("polygon-form").addEventListener("submit", handlePolygonSubmit);
window.addEventListener("pagehide", handlePageHide);
syncLiveEntry();

/** 只读模式允许浏览、切换视图和导出，不允许改变作品或存档 */
function isViewAction(action: string): boolean {
  if (action === "replay" || action.startsWith("replay-")) {
    return true;
  }
  return [
    "readonly",
    "copy",
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
    "axes",
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

/** 保存当前作品后切换存档，重复选择当前项时保留撤销记录 */
function switchArchive(id: string): void {
  if (id === archives.active || !saveBeforeLeaving()) {
    return;
  }
  // 保存时可能合并重复作品，合并后不必再打开同一份存档
  if (id === archives.active) {
    return;
  }
  try {
    openArchive(id);
    notify("已切换到「" + board.document.name + "」", "success");
  } catch (error) {
    notify("切换失败：" + errorMessage(error), "error");
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
  getElement("delete-error").textContent = "";
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

/** 坐标轴按钮紧跟网格，比例尺固定放在画布右上角 */
function mountMathView(): void {
  const button = document.createElement("button");
  button.type = "button";
  button.id = "axes-button";
  button.className = "icon-button";
  button.dataset.action = "axes";
  button.title = "显示坐标轴";
  button.setAttribute("aria-label", "显示坐标轴");
  button.setAttribute("aria-pressed", "true");
  button.innerHTML = '<i data-lucide="axis-3d" aria-hidden="true"></i>';
  getElement("grid-button").after(button);
  const scale = document.createElement("div");
  scale.id = "canvas-scale";
  scale.className = "canvas-scale";
  scale.setAttribute("aria-label", "坐标轴比例尺");
  getElement("canvas-host").append(scale);
}
