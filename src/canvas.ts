import { ActiveSelection, Canvas, Path, Pattern, PencilBrush, Point, Rect, Textbox } from "fabric";
import type { FabricObject, TPointerEvent, TPointerEventInfo } from "fabric";
import { isNode } from "./document";
import { compareLayers } from "./model";
import { createFabricLabel, createFabricShape, updateFabricGeometry } from "./fabric-shapes";
import { CanvasFeedback } from "./canvas-feedback";
import { updateRelations } from "./geometry";
import {
  createShape,
  findShape,
  getBounds,
  GRID_SIZE,
  isDependent,
  isLine,
  MAX_PATH_LENGTH,
  MAX_SHAPES,
  moveShape,
  resizeShape
} from "./model";
import type { BoardDocument, Point as BoardPoint, Shape, Tool, Viewport } from "./types";

const MIN_ZOOM = 0.15;
const MAX_ZOOM = 4;
const CANVAS_MARGIN = 40;
const GRID_COLOR = "#d3d8e2";

/** 画布只报告作品、选择和视口变化，文件管理不依赖 Fabric */
export interface CanvasCallbacks {
  changed(): void;
  selected(): void;
  viewChanged(): void;
  editText(id: string): void;
  notify(message: string): void;
  toolChanged(tool: Tool): void;
}

/** 保存绘图或平移起点，选择与变换手势使用 Fabric 的现成实现 */
interface DrawingGesture {
  start: BoardPoint;
  screen: BoardPoint;
  view: BoardPoint;
  shape: Shape | null;
  selection: string[];
}

/** 适配 Fabric 编辑能力与作品模型，仅额外处理关系更新和绘制工具 */
export class BoardCanvas {
  document: BoardDocument;
  selectedIds: string[] = [];
  tool: Tool = "select";
  viewport: Viewport = { x: 40, y: 40, zoom: 1 };
  showGrid = true;
  snap = false;
  stroke = "#334155";
  fill = "#ffffff";
  private host: HTMLElement;
  private fabric: Canvas;
  private callbacks: CanvasCallbacks;
  private objects = new Map<string, FabricObject>();
  private ids = new Map<FabricObject, string>();
  private labels = new Map<string, FabricObject>();
  private originals = new Map<string, Shape>();
  private initialScales = new Map<string, BoardPoint>();
  private gesture: DrawingGesture | null = null;
  private rebuilding = false;
  private initialFit = false;
  private feedback: CanvasFeedback;
  private transforming = false;
  private modificationPending = false;
  private spacePressed = false;

  /** 创建画布并绑定库提供的事件，不自行重写控制点、框选和旋转 */
  constructor(host: HTMLElement, document: BoardDocument, callbacks: CanvasCallbacks) {
    this.host = host;
    this.document = document;
    this.callbacks = callbacks;
    const element = window.document.createElement("canvas");
    this.host.append(element);
    this.fabric = new Canvas(element, {
      width: host.clientWidth,
      height: host.clientHeight,
      preserveObjectStacking: true,
      selection: true,
      selectionColor: "#2563eb22",
      selectionBorderColor: "#2563eb",
      selectionLineWidth: 1.5,
      selectionFullyContained: true,
      altActionKey: null,
      enablePointerEvents: true,
      stopContextMenu: true,
      enableRetinaScaling: true,
      targetFindTolerance: 7
    });
    this.fabric.upperCanvasEl.setAttribute("aria-label", "绘图画布");
    this.fabric.upperCanvasEl.setAttribute("tabindex", "0");
    this.feedback = new CanvasFeedback(this.fabric);
    this.fabric.upperCanvasEl.addEventListener(
      "pointerdown",
      this.handleBeforePointerDown.bind(this),
      { capture: true }
    );
    this.fabric.on("mouse:down", this.handlePointerDown.bind(this));
    this.fabric.on("mouse:move", this.handlePointerMove.bind(this));
    this.fabric.on("mouse:up", this.handlePointerUp.bind(this));
    this.fabric.on("mouse:wheel", this.handleWheel.bind(this));
    this.fabric.on("mouse:dblclick", this.handleDoubleClick.bind(this));
    this.fabric.on("selection:created", this.handleSelection.bind(this));
    this.fabric.on("selection:updated", this.handleSelection.bind(this));
    this.fabric.on("selection:cleared", this.handleSelection.bind(this));
    this.fabric.on("object:moving", this.handleMoving.bind(this));
    this.fabric.on("object:scaling", this.handleTransforming.bind(this));
    this.fabric.on("object:rotating", this.handleTransforming.bind(this));
    this.fabric.on("object:modified", this.handleModified.bind(this));
    this.fabric.on("text:editing:exited", this.handleTextExited.bind(this));
    this.fabric.on("path:created", this.handlePathCreated.bind(this));
    this.fabric.upperCanvasEl.addEventListener("pointerleave", this.clearHover.bind(this));
    this.fabric.upperCanvasEl.addEventListener(
      "pointercancel",
      this.handlePointerCancel.bind(this)
    );
    window.addEventListener("keydown", this.handleSpaceDown.bind(this));
    window.addEventListener("keyup", this.handleSpaceUp.bind(this));
    window.addEventListener("blur", this.handleWindowBlur.bind(this));
    const observer = new ResizeObserver(this.handleResize.bind(this));
    observer.observe(host);
    this.render();
  }

  /** 首次取得容器尺寸后适应画板，之后保留用户视角 */
  private handleResize(): void {
    this.fabric.setDimensions({
      width: Math.max(1, this.host.clientWidth),
      height: Math.max(1, this.host.clientHeight)
    });
    if (!this.initialFit) {
      this.initialFit = true;
      this.fit();
    } else {
      this.render();
    }
  }

  /** 返回已选中的作品对象，忽略已经删除的编号 */
  getSelectedShapes(): Shape[] {
    const selected: Shape[] = [];
    for (const id of this.selectedIds) {
      const shape = findShape(this.document, id);
      if (shape !== undefined) {
        selected.push(shape);
      }
    }
    return selected;
  }

  /** 更换作品时取消未完成图形并清空旧选区 */
  setDocument(document: BoardDocument): void {
    this.cancelGesture();
    this.document = document;
    this.selectedIds = [];
    this.render();
    this.callbacks.selected();
  }

  /** 切换工具时取消半成品，选择工具启用库的变换能力 */
  setTool(tool: Tool): void {
    this.cancelGesture();
    this.tool = tool;
    this.render();
    this.callbacks.toolChanged(tool);
  }

  /** 将整个画板放进工作区，不改变项目尺寸 */
  fit(): void {
    const width = Math.max(80, this.host.clientWidth - CANVAS_MARGIN * 2);
    const height = Math.max(80, this.host.clientHeight - CANVAS_MARGIN * 2);
    this.viewport.zoom = Math.max(
      MIN_ZOOM,
      Math.min(1, width / this.document.width, height / this.document.height)
    );
    this.viewport.x = (this.host.clientWidth - this.document.width * this.viewport.zoom) / 2;
    this.viewport.y = (this.host.clientHeight - this.document.height * this.viewport.zoom) / 2;
    this.applyViewport();
  }

  /** 使用库的缩放 API，保持指定屏幕位置下的画布坐标不变 */
  zoomTo(zoom: number, position?: BoardPoint): void {
    let center = position;
    if (center === undefined) {
      center = { x: this.host.clientWidth / 2, y: this.host.clientHeight / 2 };
    }
    const targetZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
    this.fabric.zoomToPoint(new Point(center.x, center.y), targetZoom);
    const transform = this.fabric.viewportTransform;
    this.viewport.zoom = this.fabric.getZoom();
    this.viewport.x = transform[4];
    this.viewport.y = transform[5];
    this.callbacks.viewChanged();
  }

  /** 将模型中的视角写入库，同步状态栏 */
  private applyViewport(): void {
    this.fabric.setViewportTransform([
      this.viewport.zoom,
      0,
      0,
      this.viewport.zoom,
      this.viewport.x,
      this.viewport.y
    ]);
    this.callbacks.viewChanged();
  }

  /** 从图层选择对象，追加选择用于 Shift 多选 */
  select(id: string, append: boolean): void {
    const shape = findShape(this.document, id);
    if (shape === undefined) {
      return;
    }
    if (!append) {
      this.selectedIds = [];
    }
    for (const member of this.document.shapes) {
      if (
        member.id === id ||
        (shape.group !== "" && member.group === shape.group && !member.hidden)
      ) {
        const index = this.selectedIds.indexOf(member.id);
        if (index < 0) {
          this.selectedIds.push(member.id);
        } else if (append) {
          this.selectedIds.splice(index, 1);
        }
      }
    }
    this.restoreSelection();
    this.fabric.requestRenderAll();
    this.callbacks.selected();
  }

  /** 把库中的选区转换为作品编号，背景和文字标签不参与选区 */
  private handleSelection(): void {
    if (this.rebuilding || this.spacePressed || this.tool === "hand") {
      return;
    }
    this.selectedIds = [];
    for (const object of this.fabric.getActiveObjects()) {
      const id = this.ids.get(object);
      if (id !== undefined) {
        this.selectedIds.push(id);
      }
    }
    // 组合是作品中的逻辑关系，选中其中一个成员时补齐同组对象
    const completeSelection = this.selectedIds.slice();
    for (const id of this.selectedIds) {
      const selected = findShape(this.document, id);
      if (selected === undefined || selected.group === "") {
        continue;
      }
      for (const member of this.document.shapes) {
        if (
          member.group === selected.group &&
          !member.hidden &&
          !completeSelection.includes(member.id)
        ) {
          completeSelection.push(member.id);
        }
      }
    }
    if (completeSelection.length !== this.selectedIds.length) {
      this.selectedIds = completeSelection;
      // 只扩展现有选区，不重建图形，当前鼠标手势可以继续使用库中的对象
      const active = this.fabric.getActiveObject();
      if (active instanceof ActiveSelection) {
        for (const id of completeSelection) {
          const member = this.objects.get(id);
          if (member !== undefined && member.group !== active) {
            active.multiSelectAdd(member);
          }
        }
      } else {
        this.restoreSelection();
      }
    }
    this.configureSelection();
    this.callbacks.selected();
  }

  /** 恢复现有对象的选区，不清空场景，也不重新创建标签 */
  private restoreSelection(): void {
    const wasRebuilding = this.rebuilding;
    this.rebuilding = true;
    this.fabric.discardActiveObject();
    if (this.tool === "select") {
      const active: FabricObject[] = [];
      for (const id of this.selectedIds) {
        const object = this.objects.get(id);
        if (object !== undefined && object.visible) {
          active.push(object);
        }
      }
      if (active.length === 1) {
        this.fabric.setActiveObject(active[0]);
      } else if (active.length > 1) {
        const selection = new ActiveSelection(active, {
          canvas: this.fabric,
          cornerStyle: "circle",
          cornerSize: 10,
          transparentCorners: false,
          cornerColor: "#ffffff",
          cornerStrokeColor: "#2563eb",
          borderColor: "#2563eb",
          lockSkewingX: true,
          lockSkewingY: true,
          lockScalingFlip: true
        });
        this.fabric.setActiveObject(selection);
      }
    }
    this.configureSelection();
    this.rebuilding = wasRebuilding;
  }

  /** 无论从框选、Shift 还是图层进入多选，都应用相同的约束 */
  private configureSelection(): void {
    const selection = this.fabric.getActiveObject();
    if (!(selection instanceof ActiveSelection)) {
      return;
    }
    let fixed = false;
    for (const shape of this.getSelectedShapes()) {
      if (shape.locked || isDependent(shape)) {
        fixed = true;
      }
    }
    selection.set({
      lockMovementX: fixed,
      lockMovementY: fixed,
      lockScalingX: fixed,
      lockScalingY: fixed,
      lockRotation: fixed,
      lockSkewingX: true,
      lockSkewingY: true,
      lockScalingFlip: true,
      hasControls: !fixed
    });
  }

  /** 同步全局位置和缩放比例，多选时不能直接读取组内的局部坐标 */
  private syncObject(object: FabricObject): void {
    const id = this.ids.get(object);
    if (id === undefined) {
      return;
    }
    const shape = findShape(this.document, id);
    if (shape === undefined || isDependent(shape) || shape.locked) {
      return;
    }
    const center = object.getCenterPoint();
    const scale = object.getObjectScaling();
    const original = this.originals.get(id);
    const initialScale = this.initialScales.get(id);
    if (original === undefined || initialScale === undefined) {
      return;
    }
    let width = (original.width * scale.x) / initialScale.x;
    let height = (original.height * scale.y) / initialScale.y;
    if (shape.kind === "point") {
      width = 0;
      height = 0;
    }
    moveShape(shape, center.x - width / 2 - shape.x, center.y - height / 2 - shape.y);
    resizeShape(shape, width, height);
    shape.rotation = object.getTotalAngle();
    if (object instanceof Textbox) {
      shape.text = object.text;
      shape.fontSize = Math.min(200, Math.max(8, (original.fontSize * scale.y) / initialScale.y));
    }
  }

  /** 拖动过程中更新关系，不替换正在被库操作的对象 */
  private handleTransforming(): void {
    this.transforming = true;
    this.clearHover();
    for (const object of this.fabric.getActiveObjects()) {
      this.syncObject(object);
    }
    this.refreshRelationships();
  }

  /** 网格吸附只调整拖动位置，不干扰缩放或旋转 */
  private handleMoving(event: { target: FabricObject }): void {
    if (this.snap) {
      const center = event.target.getCenterPoint();
      const snapped = new Point(
        Math.round(center.x / GRID_SIZE) * GRID_SIZE,
        Math.round(center.y / GRID_SIZE) * GRID_SIZE
      );
      event.target.setXY(snapped, "center", "center");
      event.target.setCoords();
    }
    this.handleTransforming();
  }

  /** 完成变换后恢复统一尺寸表示，只记录一次操作历史 */
  private handleModified(): void {
    if (this.rebuilding) {
      return;
    }
    for (const object of this.fabric.getActiveObjects()) {
      this.syncObject(object);
    }
    // 库需要先结束当前变换，再重建对象，否则清空选区会重复触发完成事件
    this.modificationPending = true;
    queueMicrotask(this.finishModification.bind(this));
  }

  /** 等待库完成事件收尾后重建画面，并提交本次操作 */
  private finishModification(): void {
    if (!this.modificationPending) {
      return;
    }
    this.modificationPending = false;
    this.transforming = false;
    this.render();
    this.callbacks.changed();
  }

  /** 原生文本编辑结束后保存文字，编辑期间不重建输入对象 */
  private handleTextExited(): void {
    if (this.rebuilding) {
      return;
    }
    const object = this.fabric.getActiveObject();
    if (object !== undefined) {
      this.syncObject(object);
      this.modificationPending = true;
      queueMicrotask(this.finishModification.bind(this));
    }
  }

  /** 重新计算构造与标签，退化的交点立即隐藏，恢复有效后再次显示 */
  private refreshRelationships(): void {
    const invalid = updateRelations(this.document);
    for (const shape of this.document.shapes) {
      const object = this.objects.get(shape.id);
      if (object !== undefined && isDependent(shape)) {
        updateFabricGeometry(object, shape);
        object.visible = !shape.hidden && !invalid.has(shape.id);
      }
      const label = this.labels.get(shape.id);
      if (label !== undefined) {
        const replacement = createFabricLabel(shape);
        label.visible = !shape.hidden && !invalid.has(shape.id);
        if (replacement !== null) {
          label.set({ left: replacement.left, top: replacement.top, angle: replacement.angle });
          label.setCoords();
          replacement.dispose();
        }
      }
    }
    this.fabric.requestRenderAll();
  }

  /** 锁定对象和构造对象仍可选择，但不能通过控制点破坏关系 */
  private configureObject(shape: Shape, object: FabricObject): void {
    const fixed = shape.locked || isDependent(shape);
    object.set({
      selectable: this.tool === "select",
      evented: true,
      lockMovementX: fixed,
      lockMovementY: fixed,
      lockRotation: fixed || shape.kind === "point",
      lockScalingX: fixed || shape.kind === "point",
      lockScalingY: fixed || shape.kind === "point",
      lockSkewingX: true,
      lockSkewingY: true,
      hasControls: !fixed && shape.kind !== "point",
      hoverCursor: "crosshair",
      moveCursor: "crosshair"
    });
    if (isLine(shape)) {
      // 水平或垂直线的边中手柄会压住笔画中心，隐藏它们后中心可以用于拖动
      object.setControlsVisibility({ mt: false, mb: false, ml: false, mr: false });
    }
    if (this.tool === "select") {
      object.hoverCursor = "move";
      object.moveCursor = "move";
      if (fixed) {
        object.hoverCursor = "default";
        object.moveCursor = "not-allowed";
      }
    }
    if (this.tool === "hand" || this.spacePressed) {
      object.hoverCursor = "grab";
      object.moveCursor = "grabbing";
    }
  }

  /** 获取画布坐标，需要时吸附网格 */
  private getPosition(event: TPointerEvent): BoardPoint {
    const position = this.fabric.getScenePoint(event);
    if (this.snap) {
      position.x = Math.round(position.x / GRID_SIZE) * GRID_SIZE;
      position.y = Math.round(position.y / GRID_SIZE) * GRID_SIZE;
    }
    return { x: position.x, y: position.y };
  }

  /** 开始绘图或平移，选择工具的操作全部交给库 */
  private handlePointerDown(event: TPointerEventInfo<TPointerEvent>): void {
    this.clearHover();
    this.fabric.upperCanvasEl.focus({ preventScroll: true });
    if ((event.e instanceof MouseEvent && event.e.button !== 0) || this.gesture !== null) {
      return;
    }
    const start = this.getPosition(event.e);
    const screen = this.fabric.getViewportPoint(event.e);
    if (this.tool === "hand" || this.spacePressed) {
      this.gesture = {
        start: start,
        screen: screen,
        view: { x: this.viewport.x, y: this.viewport.y },
        shape: null,
        selection: this.selectedIds.slice()
      };
      this.fabric.setCursor("grabbing");
      return;
    }
    if (this.tool === "select" || this.tool === "pencil") {
      return;
    }
    if (this.document.shapes.length >= MAX_SHAPES) {
      this.callbacks.notify("对象数量已达上限，请删除部分对象后再绘制");
      return;
    }
    const shape = createShape(this.tool, start);
    shape.stroke = this.stroke;
    shape.fill = this.fill;
    shape.layer = this.document.shapes.length;
    if (shape.kind === "text") {
      shape.text = "文字";
      shape.width = 200;
      shape.height = 60;
    }
    if (shape.kind === "point") {
      shape.text = "P" + String(this.document.shapes.length + 1);
    }
    if (shape.kind === "connector") {
      let id = "";
      if (event.target !== undefined) {
        id = this.ids.get(event.target) || "";
      }
      const source = findShape(this.document, id);
      if (source === undefined || !isNode(source)) {
        this.callbacks.notify("连接线需要从一个图形拖向另一个图形");
        return;
      }
      shape.relation = { kind: "connector", sources: [id] };
    }
    this.gesture = {
      start: start,
      screen: screen,
      view: { x: 0, y: 0 },
      shape: shape,
      selection: this.selectedIds.slice()
    };
    this.drawPreview();
  }

  /** 更新绘图预览，Shift 保持矩形和椭圆等宽高 */
  private handlePointerMove(event: TPointerEventInfo<TPointerEvent>): void {
    const gesture = this.gesture;
    if (gesture === null) {
      this.updateHover(event.target);
      return;
    }
    const shape = gesture.shape;
    if (shape === null) {
      const screen = this.fabric.getViewportPoint(event.e);
      this.viewport.x = gesture.view.x + screen.x - gesture.screen.x;
      this.viewport.y = gesture.view.y + screen.y - gesture.screen.y;
      this.applyViewport();
      return;
    }
    if (shape.kind === "text" || shape.kind === "point") {
      return;
    }
    const position = this.getPosition(event.e);
    shape.width = position.x - gesture.start.x;
    shape.height = position.y - gesture.start.y;
    if (event.e.shiftKey && !isLine(shape)) {
      const size = Math.max(Math.abs(shape.width), Math.abs(shape.height));
      shape.width = Math.sign(shape.width) * size;
      shape.height = Math.sign(shape.height) * size;
    }
    this.drawPreview();
  }

  /** 草稿只存在于手势中，预览不进入保存文件，也不重建已有图形 */
  private drawPreview(): void {
    const gesture = this.gesture;
    if (gesture === null || gesture.shape === null) {
      return;
    }
    const shape = gesture.shape;
    const previous = this.objects.get(shape.id);
    if (previous !== undefined) {
      this.fabric.remove(previous);
      previous.dispose();
    }
    const preview = createFabricShape(shape);
    preview.set({ selectable: false, evented: false, opacity: 0.75 });
    this.fabric.add(preview);
    this.objects.set(shape.id, preview);
    this.fabric.requestRenderAll();
  }

  /** 将库的平滑画笔路径保存到模型，不重复实现画笔采样与曲线拟合 */
  private handlePathCreated(event: { path: Path }): void {
    const object = event.path;
    let path = "";
    for (const command of object.path) {
      path = path + command.join(" ") + " ";
    }
    if (path.length > MAX_PATH_LENGTH || this.document.shapes.length >= MAX_SHAPES) {
      this.fabric.remove(object);
      this.callbacks.notify("画笔内容超过上限，请缩短笔画");
      return;
    }
    const center = object.getCenterPoint();
    const shape = createShape("pencil", {
      x: center.x - object.width / 2,
      y: center.y - object.height / 2
    });
    shape.width = object.width;
    shape.height = object.height;
    shape.path = path;
    shape.stroke = this.stroke;
    shape.fill = "none";
    shape.layer = this.document.shapes.length;
    this.document.shapes.push(shape);
    this.selectedIds = [shape.id];
    this.tool = "select";
    this.callbacks.toolChanged("select");
    this.modificationPending = true;
    queueMicrotask(this.finishModification.bind(this));
  }

  /** 完成绘制，连接线只接受两个不同的有效图形节点 */
  private handlePointerUp(event: TPointerEventInfo<TPointerEvent>): void {
    const gesture = this.gesture;
    if (gesture === null) {
      return;
    }
    const shape = gesture.shape;
    if (shape === null) {
      this.gesture = null;
      this.fabric.setCursor("grab");
      this.updateToolMode();
      queueMicrotask(this.restoreSelection.bind(this));
      return;
    }
    if (shape !== null && shape.kind === "connector") {
      const hit = this.fabric.findTarget(event.e);
      let destination: Shape | undefined;
      if (hit.target !== undefined) {
        const id = this.ids.get(hit.target);
        if (id !== undefined) {
          destination = findShape(this.document, id);
        }
      }
      if (
        destination === undefined ||
        !isNode(destination) ||
        destination.id === shape.relation.sources[0]
      ) {
        this.cancelGesture();
        this.callbacks.notify("连接未建立，请从一个图形拖向另一个图形");
        return;
      }
      shape.relation.sources.push(destination.id);
      shape.layer = -1;
    }
    if (
      shape !== null &&
      shape.kind !== "point" &&
      shape.kind !== "text" &&
      shape.kind !== "connector"
    ) {
      if (Math.hypot(shape.width, shape.height) < 4 && shape.kind !== "pencil") {
        shape.width = 160;
        if (!isLine(shape)) {
          shape.height = 80;
        }
      }
      if (!isLine(shape) && shape.kind !== "pencil") {
        const bounds = getBounds(shape);
        shape.x = bounds.x;
        shape.y = bounds.y;
        shape.width = Math.max(8, bounds.width);
        shape.height = Math.max(8, bounds.height);
      }
    }
    this.document.shapes.push(shape);
    this.selectedIds = [shape.id];
    this.gesture = null;
    this.tool = "select";
    this.callbacks.toolChanged("select");
    this.modificationPending = true;
    queueMicrotask(this.finishDrawing.bind(this, shape.id));
  }

  /** 库结束鼠标事件后选中新对象，文字对象随后打开编辑框 */
  private finishDrawing(id: string): void {
    this.finishModification();
    const shape = findShape(this.document, id);
    if (shape !== undefined && shape.kind === "text") {
      this.callbacks.editText(id);
    }
  }

  /** 取消半成品图形，避免保存不完整的连接关系 */
  cancelGesture(): void {
    if (this.transforming) {
      this.rebuilding = true;
      this.fabric.endCurrentTransform();
      this.rebuilding = false;
      for (const id of this.selectedIds) {
        const original = this.originals.get(id);
        const shape = findShape(this.document, id);
        if (original !== undefined && shape !== undefined) {
          Object.assign(shape, structuredClone(original));
        }
      }
      this.transforming = false;
      this.modificationPending = false;
      this.render();
      this.callbacks.selected();
    }
    if (this.gesture === null) {
      return;
    }
    const shape = this.gesture.shape;
    if (shape === null) {
      this.viewport.x = this.gesture.view.x;
      this.viewport.y = this.gesture.view.y;
    }
    this.selectedIds = this.gesture.selection;
    this.gesture = null;
    this.render();
    this.callbacks.selected();
  }

  /** 双击图形编辑标签，独立文字继续使用库的原生文字编辑 */
  private handleDoubleClick(event: TPointerEventInfo<TPointerEvent>): void {
    if (event.target === undefined || event.target instanceof Textbox || this.tool !== "select") {
      return;
    }
    const id = this.ids.get(event.target);
    if (id !== undefined) {
      this.callbacks.editText(id);
    }
  }

  /** 在库开始拖动前选中整个逻辑组，首次拖动就能一起移动 */
  private handleBeforePointerDown(event: PointerEvent): void {
    if (this.tool !== "select" || this.spacePressed || event.shiftKey || event.button !== 0) {
      return;
    }
    const hit = this.fabric.findTarget(event);
    if (hit.target === undefined) {
      return;
    }
    const id = this.ids.get(hit.target);
    if (id === undefined || this.selectedIds.includes(id)) {
      return;
    }
    const shape = findShape(this.document, id);
    if (shape !== undefined && shape.group !== "") {
      this.select(id, false);
    }
  }

  /** 鼠标指向未选中的对象时显示轮廓，拖动与平移期间不显示 */
  private updateHover(object: FabricObject | undefined): void {
    if (
      this.tool !== "select" ||
      this.spacePressed ||
      this.transforming ||
      object === undefined ||
      !this.ids.has(object)
    ) {
      this.clearHover();
      return;
    }
    this.feedback.setHovered(object);
  }

  /** 离开画布或开始操作时移除悬停轮廓 */
  private clearHover(): void {
    this.feedback.setHovered(null);
  }

  /** 系统取消触控手势时撤回草稿和未完成变换 */
  private handlePointerCancel(): void {
    this.cancelGesture();
    this.clearHover();
  }

  /** 判断键盘事件是否来自文字输入，避免空格平移打断输入 */
  private isTyping(event: KeyboardEvent): boolean {
    const target = event.target;
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement
    ) {
      return true;
    }
    if (target instanceof HTMLElement && target.isContentEditable) {
      return true;
    }
    if (window.document.querySelector("dialog[open]") !== null) {
      return true;
    }
    const active = this.fabric.getActiveObject();
    return active instanceof Textbox && active.isEditing;
  }

  /** 按住空格临时平移，松开后回到原来的绘图工具 */
  private handleSpaceDown(event: KeyboardEvent): void {
    if (event.code !== "Space" || this.isTyping(event)) {
      return;
    }
    event.preventDefault();
    if (this.spacePressed || this.gesture !== null || this.transforming) {
      return;
    }
    this.spacePressed = true;
    this.clearHover();
    this.updateToolMode();
    this.fabric.setCursor("grab");
  }

  /** 松开空格恢复原工具，平移尚未结束时等鼠标松开再恢复选区 */
  private handleSpaceUp(event: KeyboardEvent): void {
    if (event.code !== "Space" || !this.spacePressed) {
      return;
    }
    this.spacePressed = false;
    if (this.gesture === null) {
      this.updateToolMode();
      this.restoreSelection();
      this.fabric.requestRenderAll();
    }
  }

  /** 切换窗口时释放临时按键状态，防止回来后一直停在平移模式 */
  private handleWindowBlur(): void {
    this.spacePressed = false;
    this.cancelGesture();
    this.updateToolMode();
    this.clearHover();
  }

  /** 原地切换交互开关，不重建正在显示的图形 */
  private updateToolMode(): void {
    const panning = this.tool === "hand" || this.spacePressed;
    this.fabric.selection = this.tool === "select" && !panning;
    this.fabric.skipTargetFind = panning;
    this.fabric.isDrawingMode = this.tool === "pencil" && !panning;
    this.fabric.defaultCursor = "crosshair";
    if (this.tool === "select") {
      this.fabric.defaultCursor = "default";
    }
    if (panning) {
      this.fabric.defaultCursor = "grab";
    }
    for (const shape of this.document.shapes) {
      const object = this.objects.get(shape.id);
      if (object !== undefined) {
        this.configureObject(shape, object);
        object.selectable = this.fabric.selection;
      }
    }
    if (this.fabric.isDrawingMode) {
      const brush = new PencilBrush(this.fabric);
      brush.color = this.stroke;
      brush.width = 2;
      this.fabric.freeDrawingBrush = brush;
    }
    this.fabric.setCursor(this.fabric.defaultCursor);
  }

  /** 普通滚轮平移，Ctrl 或 Command 加滚轮围绕指针缩放 */
  private handleWheel(event: TPointerEventInfo<WheelEvent>): void {
    event.e.preventDefault();
    if (event.e.ctrlKey || event.e.metaKey) {
      this.zoomTo(
        this.viewport.zoom * Math.exp(-event.e.deltaY * 0.005),
        this.fabric.getViewportPoint(event.e)
      );
      return;
    }
    this.viewport.x = this.viewport.x - event.e.deltaX;
    this.viewport.y = this.viewport.y - event.e.deltaY;
    this.applyViewport();
  }

  /** 使用库的图案填充生成网格，避免创建几千个可命中的圆点对象 */
  private renderBackground(): void {
    const background = new Rect({
      left: 0,
      top: 0,
      originX: "left",
      originY: "top",
      width: this.document.width,
      height: this.document.height,
      fill: "#ffffff",
      stroke: "#dce0e7",
      strokeWidth: 1,
      selectable: false,
      evented: false
    });
    this.fabric.add(background);
    if (this.showGrid) {
      const tile = window.document.createElement("canvas");
      tile.width = GRID_SIZE;
      tile.height = GRID_SIZE;
      const context = tile.getContext("2d");
      if (context !== null) {
        context.fillStyle = GRID_COLOR;
        context.beginPath();
        context.arc(1, 1, 0.7, 0, Math.PI * 2);
        context.fill();
      }
      const grid = new Rect({
        left: 0,
        top: 0,
        originX: "left",
        originY: "top",
        width: this.document.width,
        height: this.document.height,
        fill: new Pattern({ source: tile, repeat: "repeat" }),
        selectable: false,
        evented: false,
        strokeWidth: 0
      });
      this.fabric.add(grid);
    }
  }

  /** 从模型恢复画面与选区，框选和控制点由 ActiveSelection 提供 */
  render(): void {
    this.rebuilding = true;
    this.clearHover();
    this.fabric.discardActiveObject();
    const previousObjects = this.fabric.getObjects();
    this.fabric.clear();
    for (const object of previousObjects) {
      object.dispose();
    }
    this.objects.clear();
    this.ids.clear();
    this.labels.clear();
    this.originals.clear();
    this.initialScales.clear();
    this.renderBackground();
    const invalid = updateRelations(this.document);
    const ordered = this.document.shapes.slice();
    ordered.sort(compareLayers);
    for (const shape of ordered) {
      if (shape.hidden) {
        continue;
      }
      const object = createFabricShape(shape);
      this.configureObject(shape, object);
      object.visible = !invalid.has(shape.id);
      this.fabric.add(object);
      this.objects.set(shape.id, object);
      this.ids.set(object, shape.id);
      this.originals.set(shape.id, structuredClone(shape));
      this.initialScales.set(shape.id, { x: object.scaleX, y: object.scaleY });
      const label = createFabricLabel(shape);
      if (label !== null) {
        label.visible = object.visible;
        this.fabric.add(label);
        this.labels.set(shape.id, label);
      }
    }
    this.updateToolMode();
    this.restoreSelection();
    this.fabric.setViewportTransform([
      this.viewport.zoom,
      0,
      0,
      this.viewport.zoom,
      this.viewport.x,
      this.viewport.y
    ]);
    this.fabric.requestRenderAll();
    this.rebuilding = false;
  }
}
