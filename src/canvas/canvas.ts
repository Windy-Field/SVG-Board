import { ActiveSelection, Canvas, Path, PencilBrush, Point, Textbox, Polygon } from "fabric";
import type { FabricObject, TPointerEvent, TPointerEventInfo } from "fabric";
import { isNode } from "../storage/document";
import { compareLayers } from "../core/model";
import { createFabricLabel, createFabricShape, updateFabricGeometry } from "./fabric-shapes";
import { HANDLE_SIZE, SELECTION_COLOR } from "./fabric-shapes";
import { CanvasFeedback } from "./canvas-feedback";
import type { LockedObject } from "./canvas-feedback";
import { LineControls } from "./line-controls";
import { snapPosition } from "../geometry/snapping";
import { addPointLabel, nextPointName } from "../objects/point-labels";
import { OverlapSelection } from "./overlap-selection";
import { CurveControls } from "./curve-controls";
import { EditorCanvas } from "./editor-canvas";
import { constructShape } from "../core/commands";
import { constructSelection } from "../core/construction-batch";
import type { ConstructionResult } from "../core/construction-batch";
import { strokeInMarquee } from "../geometry/marquee";
import { detachLabel } from "../objects/shape-labels";
import { regularPoints, fitPolygon } from "../objects/shapes";
import { isConstructionLine, updateRelations } from "../geometry/geometry";
import { hasOpenDomain } from "../math/domain";
import { drawAxes } from "./axes";
import {
  createShape,
  findShape,
  getBounds,
  getRotatedBounds,
  GRID_SIZE,
  isDependent,
  isLine,
  MAX_PATH_LENGTH,
  MAX_SHAPES,
  moveShape,
  resizeShape
} from "../core/model";
import {
  DEFAULT_STROKE,
  DEFAULT_FILL,
  DEFAULT_POLYGON_SIDES,
  MIN_FONT_SIZE,
  MAX_FONT_SIZE
} from "../core/model";
import { MAX_POINT_RADIUS, MIN_POINT_RADIUS } from "../core/model";
import {
  isConstructionTool,
  constructionSourceCount,
  acceptsConstructionSource
} from "../geometry/construction-tools";
import type {
  BoardDocument,
  Bounds,
  ConstructionTool,
  Point as BoardPoint,
  Shape,
  Tool,
  Viewport
} from "../core/types";

// 画布缩放下限，0.15 表示 15%
const MIN_ZOOM = 0.15;
// 画布缩放上限，4 表示 400%
const MAX_ZOOM = 4;
// 适应画布时四周预留的屏幕像素
const CANVAS_MARGIN = 40;
// 浅色画布使用的网格点颜色
const GRID_COLOR = "#7889a2";
// 深色画布使用的网格点颜色
const GRID_LIGHT_COLOR = "#bac8dc";
// 网格点半径，单位为屏幕像素
const GRID_RADIUS = 1.05;
// 单击与拖动的区分距离，单位为屏幕像素
const CLICK_DISTANCE = 4;
// 几何点命中的容差，单位为屏幕像素
const POINT_HIT_DISTANCE = 12;
// 右键框选边缘的容差，单位为屏幕像素
const MARQUEE_TOLERANCE = 3;
// 低于此亮度时使用浅色网格，取值范围为 0 至 255
const DARK_BACKGROUND_THRESHOLD = 128;
// 网格在缩小时仍保持的最小屏幕间距
const MIN_GRID_SPACING = 12;
// 自由画笔默认笔宽，单位为画布坐标
const PENCIL_WIDTH = 2;
// 滚轮缩放灵敏度
const WHEEL_ZOOM_SPEED = 0.005;
// 按住左键后进入平移的等待时间，单位为毫秒
const HOLD_PAN_DELAY = 450;
// 长按期间允许的手部移动距离，单位为屏幕像素
const HOLD_PAN_TOLERANCE = 12;
// 新对象小于此对角线长度时取消创建，单位为画布坐标
const MIN_DRAWING_LENGTH = 4;
// 封闭图形创建后的最小边长，单位为画布坐标
const MIN_SHAPE_SIZE = 8;
// 草稿相对正式对象的显示透明度，取值为 0 到 1
const PREVIEW_OPACITY = 0.75;
// 多边形草稿的浅色填充
const POLYGON_PREVIEW_FILL = "#2563eb11";

/** 画布通过回调报告作品、选择和视口变化 */
export interface CanvasCallbacks {
  changed(): void;
  draftChanged(): void;
  constructed(result: ConstructionResult): void;
  selected(): void;
  viewChanged(): void;
  editText(id: string): void;
  notify(message: string): void;
  toolChanged(tool: Tool): void;
}

/** 将库解析过的路径命令写回作品，保存和导出使用同一份路径 */
function serializePath(object: Path): string {
  let path = "";
  for (const command of object.path) {
    path = path + command.join(" ") + " ";
  }
  return path;
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
  viewport: Viewport = { x: CANVAS_MARGIN, y: CANVAS_MARGIN, zoom: 1 };
  showGrid = true;
  showAxes = true;
  snap = true;
  readOnly = false;
  stroke = DEFAULT_STROKE;
  fill = DEFAULT_FILL;
  private host: HTMLElement;
  private fabric: Canvas;
  private callbacks: CanvasCallbacks;
  private objects = new Map<string, FabricObject>();
  private ids = new Map<FabricObject, string>();
  private labels = new Map<string, FabricObject>();
  private originals = new Map<string, Shape>();
  private initialScales = new Map<string, BoardPoint>();
  private initialCenters = new Map<string, BoardPoint>();
  private gesture: DrawingGesture | null = null;
  private rebuilding = false;
  private initialFit = false;
  private feedback: CanvasFeedback;
  private transforming = false;
  private modificationPending = false;
  private spacePressed = false;
  private rightSelection: { start: BoardPoint; append: boolean } | null = null;
  private selectionClick: { id: string; x: number; y: number; ids: string[] } | null = null;
  polygonSides = DEFAULT_POLYGON_SIDES;
  private customVertices: BoardPoint[] = [];
  private polygonPreview: Polygon | null = null;
  private overlapSelection = new OverlapSelection();
  private overlapClick: { x: number; y: number; ids: string[] } | null = null;
  private waitingForClick = false;
  private finishingClick = false;
  private segmentStart = "";
  private constructionIds: string[] = [];
  private holdTimer = 0;
  private holdPosition: { x: number; y: number; pointerId: number } | null = null;
  private holdPanning = false;
  private blankPanning = false;
  private constructionClick: ConstructionTool | null = null;

  /** 创建画布并绑定库提供的选择、变换与绘制事件 */
  constructor(host: HTMLElement, document: BoardDocument, callbacks: CanvasCallbacks) {
    this.host = host;
    this.document = document;
    this.callbacks = callbacks;
    const element = window.document.createElement("canvas");
    this.host.append(element);
    this.fabric = new EditorCanvas(element, {
      width: host.clientWidth,
      height: host.clientHeight,
      preserveObjectStacking: true,
      selection: true,
      selectionColor: "#2563eb22",
      selectionBorderColor: "#2563eb",
      selectionLineWidth: 1.5,
      selectionFullyContained: true,
      selectionKey: ["shiftKey", "ctrlKey", "metaKey"],
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
    this.fabric.on("text:changed", callbacks.draftChanged);
    this.fabric.on("path:created", this.handlePathCreated.bind(this));
    this.fabric.on("object:modifyPath", this.handleTransforming.bind(this));
    this.fabric.on("before:render", this.drawGrid.bind(this));
    this.fabric.upperCanvasEl.addEventListener("pointerleave", this.clearHover.bind(this));
    this.fabric.upperCanvasEl.addEventListener(
      "pointercancel",
      this.handlePointerCancel.bind(this)
    );
    window.addEventListener("keydown", this.handleSpaceDown.bind(this));
    window.addEventListener("keyup", this.handleSpaceUp.bind(this));
    window.addEventListener("blur", this.handleWindowBlur.bind(this));
    window.addEventListener("pointermove", this.handleRightMove.bind(this), { capture: true });
    window.addEventListener("pointermove", this.handleHoldMove.bind(this), { capture: true });
    window.addEventListener("pointerup", this.handleSelectionRelease.bind(this), { capture: true });
    const observer = new ResizeObserver(this.handleResize.bind(this));
    observer.observe(host);
    this.render();
  }

  /** 首次取得容器尺寸后适应画板，之后保留用户视角 */
  private handleResize(): void {
    const width = Math.max(1, this.host.clientWidth);
    const height = Math.max(1, this.host.clientHeight);
    if (this.initialFit && width === this.fabric.getWidth() && height === this.fabric.getHeight()) {
      return;
    }
    this.fabric.setDimensions({ width: width, height: height });
    if (!this.initialFit) {
      this.initialFit = true;
      this.fit();
      return;
    }
    // 改尺寸会清空画布，在浏览器显示这一帧前恢复内容
    this.refreshExtendedLines();
    this.fabric.renderAll();
    this.callbacks.viewChanged();
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

  /** 原地编辑的文字尚未写回作品时返回 true */
  hasTextDraft(): boolean {
    const object = this.fabric.getActiveObject();
    if (!(object instanceof Textbox) || !object.isEditing) {
      return false;
    }
    const id = this.ids.get(object);
    const shape = findShape(this.document, id || "");
    return shape !== undefined && object.text !== shape.text;
  }

  /** 返回选区在工作区内的位置，供浮动文本工具栏使用 */
  getSelectionBounds(): Bounds | null {
    const active = this.fabric.getActiveObject();
    if (active === undefined) {
      return null;
    }
    const box = active.getBoundingRect();
    return {
      x: box.left * this.viewport.zoom + this.viewport.x,
      y: box.top * this.viewport.zoom + this.viewport.y,
      width: box.width * this.viewport.zoom,
      height: box.height * this.viewport.zoom
    };
  }

  /** 更换作品时取消未完成图形并清空旧选区 */
  setDocument(document: BoardDocument): void {
    this.cancelGesture();
    this.document = document;
    this.selectedIds = [];
    this.overlapSelection.reset();
    this.render();
    this.callbacks.selected();
  }

  /** 切换工具时取消半成品，选择工具启用库的变换能力 */
  setTool(tool: Tool): void {
    if (this.readOnly && tool !== "select" && tool !== "hand") {
      return;
    }
    this.cancelGesture();
    this.tool = tool;
    if (isConstructionTool(tool)) {
      this.selectedIds = [];
      this.constructionIds = [];
    }
    this.render();
    this.callbacks.toolChanged(tool);
  }

  /** 进入只读前撤回未完成操作，保留查看和选择能力 */
  setReadOnly(readonly: boolean): void {
    this.cancelGesture();
    this.readOnly = readonly;
    if (readonly) {
      this.tool = "select";
      this.callbacks.toolChanged("select");
    }
    this.render();
  }

  /** 将整个画板放进工作区，不改变项目尺寸 */
  fit(): void {
    const width = Math.max(CANVAS_MARGIN * 2, this.host.clientWidth - CANVAS_MARGIN * 2);
    const height = Math.max(CANVAS_MARGIN * 2, this.host.clientHeight - CANVAS_MARGIN * 2);
    let bounds = { x: 0, y: 0, width: this.document.width, height: this.document.height };
    const objects = this.fabric.getObjects();
    if (objects.length > 0) {
      let left = Infinity;
      let top = Infinity;
      let right = -Infinity;
      let bottom = -Infinity;
      for (const object of objects) {
        if (!object.visible) {
          continue;
        }
        let box = object.getBoundingRect();
        const id = this.ids.get(object);
        const shape = findShape(this.document, id || "");
        if (shape !== undefined && shape.kind === "line" && shape.lineType !== "segment") {
          const anchors = getRotatedBounds(shape);
          box = { left: anchors.x, top: anchors.y, width: anchors.width, height: anchors.height };
        }
        left = Math.min(left, box.left);
        top = Math.min(top, box.top);
        right = Math.max(right, box.left + box.width);
        bottom = Math.max(bottom, box.top + box.height);
      }
      if (Number.isFinite(left)) {
        bounds = {
          x: left - CANVAS_MARGIN,
          y: top - CANVAS_MARGIN,
          width: right - left + CANVAS_MARGIN * 2,
          height: bottom - top + CANVAS_MARGIN * 2
        };
      }
    }
    this.viewport.zoom = Math.max(
      MIN_ZOOM,
      Math.min(1, width / bounds.width, height / bounds.height)
    );
    this.viewport.x =
      (this.host.clientWidth - bounds.width * this.viewport.zoom) / 2 -
      bounds.x * this.viewport.zoom;
    this.viewport.y =
      (this.host.clientHeight - bounds.height * this.viewport.zoom) / 2 -
      bounds.y * this.viewport.zoom;
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
    this.refreshExtendedLines();
    this.callbacks.viewChanged();
    this.fabric.renderAll();
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
    this.refreshExtendedLines();
    this.callbacks.viewChanged();
    this.fabric.renderAll();
  }

  /** 视口范围只影响无限线的显示，不改变保存的两个方向点 */
  viewBounds(): Bounds {
    return {
      x: -this.viewport.x / this.viewport.zoom,
      y: -this.viewport.y / this.viewport.zoom,
      width: this.fabric.getWidth() / this.viewport.zoom,
      height: this.fabric.getHeight() / this.viewport.zoom
    };
  }

  /** 平移或缩放后重新计算无限图形的可见部分 */
  private refreshExtendedLines(): void {
    if (this.transforming || this.rebuilding) {
      return;
    }
    for (const shape of this.document.shapes) {
      if ((shape.kind === "line" && shape.lineType !== "segment") || hasOpenDomain(shape.formula)) {
        const object = this.objects.get(shape.id);
        if (object !== undefined) {
          updateFabricGeometry(object, shape, this.viewBounds());
          const center = object.getCenterPoint();
          this.initialCenters.set(shape.id, { x: center.x, y: center.y });
        }
      }
    }
    this.fabric.requestRenderAll();
  }

  /** 从对象列表选择对象，追加选择用于 Shift 多选 */
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
    if (this.rebuilding || this.spacePressed || this.holdPanning || this.tool === "hand") {
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
    if (this.tool === "select" || this.tool === "curve" || isConstructionTool(this.tool)) {
      const active: FabricObject[] = [];
      for (const id of this.selectedIds) {
        const object = this.objects.get(id);
        const shape = findShape(this.document, id);
        let selectable = this.tool === "select" || isConstructionTool(this.tool);
        if (shape !== undefined && shape.kind === "curve") {
          selectable = true;
        }
        if (object !== undefined && object.visible && selectable) {
          active.push(object);
        }
      }
      if (active.length === 1) {
        this.fabric.setActiveObject(active[0]);
      } else if (active.length > 1) {
        const selection = new ActiveSelection(active, {
          canvas: this.fabric,
          cornerStyle: "circle",
          cornerSize: HANDLE_SIZE,
          transparentCorners: false,
          cornerColor: "#ffffff",
          cornerStrokeColor: SELECTION_COLOR,
          borderColor: SELECTION_COLOR,
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

  /** 框选、Shift 和对象列表的多选共用相同约束 */
  private configureSelection(): void {
    const selection = this.fabric.getActiveObject();
    if (!(selection instanceof ActiveSelection)) {
      return;
    }
    let fixed = false;
    for (const shape of this.getSelectedShapes()) {
      if (this.readOnly || shape.locked) {
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
    if (shape === undefined || shape.locked || this.readOnly) {
      return;
    }
    if (shape.kind === "function") {
      return;
    }
    if (isDependent(shape)) {
      shape.relation = { kind: "none", sources: [] };
    }
    const center = object.getCenterPoint();
    if (shape.kind === "line" && shape.lineType !== "segment") {
      const original = this.originals.get(id);
      const initial = this.initialCenters.get(id);
      if (original !== undefined && initial !== undefined) {
        shape.x = original.x + center.x - initial.x;
        shape.y = original.y + center.y - initial.y;
      }
      return;
    }
    if (object instanceof Path && (shape.kind === "arrow" || shape.kind === "connector")) {
      const radians = (object.getTotalAngle() * Math.PI) / 180;
      center.x =
        center.x -
        object.pathOffset.x * object.scaleX * Math.cos(radians) +
        object.pathOffset.y * object.scaleY * Math.sin(radians);
      center.y =
        center.y -
        object.pathOffset.x * object.scaleX * Math.sin(radians) -
        object.pathOffset.y * object.scaleY * Math.cos(radians);
    }
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
    if (object instanceof Textbox) {
      width = object.width * scale.x;
      height = object.height * scale.y;
    }
    if (object instanceof Path && shape.kind === "curve") {
      width = object.width * scale.x;
      height = object.height * scale.y;
    }
    moveShape(shape, center.x - width / 2 - shape.x, center.y - height / 2 - shape.y);
    resizeShape(shape, width, height);
    shape.rotation = object.getTotalAngle();
    if (object instanceof Textbox) {
      shape.width = object.width * scale.x;
      shape.text = object.text;
      if (shape.textDirection === "vertical") {
        shape.text = object.text.replace(/\n/g, "");
      }
      shape.fontSize = Math.min(
        MAX_FONT_SIZE,
        Math.max(MIN_FONT_SIZE, (original.fontSize * scale.y) / initialScale.y)
      );
      shape.height = object.getScaledHeight();
    }
    if (object instanceof Path && shape.kind === "curve") {
      shape.path = serializePath(object);
      shape.width = object.width * scale.x;
      shape.height = object.height * scale.y;
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
    this.callbacks.viewChanged();
    this.fabric.renderAll();
  }

  /** 拖动时按对象类型吸附，不干扰缩放或旋转 */
  private handleMoving(event: { target: FabricObject }): void {
    if (this.snap) {
      const center = event.target.getCenterPoint();
      const id = this.ids.get(event.target);
      const shape = findShape(this.document, id || "");
      let position = {
        x: Math.round(center.x / GRID_SIZE) * GRID_SIZE,
        y: Math.round(center.y / GRID_SIZE) * GRID_SIZE
      };
      if (shape !== undefined && shape.kind === "point") {
        position = this.snapPoint(center, shape.id);
      }
      const snapped = new Point(position.x, position.y);
      event.target.setXY(snapped, "center", "center");
      event.target.setCoords();
    }
    this.handleTransforming();
  }

  /** 完成变换后恢复统一尺寸表示，只记录一次操作历史 */
  private handleModified(event: { action?: string }): void {
    if (this.rebuilding || this.readOnly) {
      return;
    }
    const endpoint = event.action === "endpoint";
    if (!endpoint) {
      for (const object of this.fabric.getActiveObjects()) {
        this.syncObject(object);
      }
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
        updateFabricGeometry(object, shape, this.viewBounds());
        object.visible = !shape.hidden && !invalid.has(shape.id);
      }
      const label = this.labels.get(shape.id);
      if (label !== undefined) {
        const replacement = createFabricLabel(shape);
        label.visible = !shape.hidden && !invalid.has(shape.id);
        if (replacement !== null) {
          label.set({
            left: replacement.left,
            top: replacement.top,
            angle: replacement.angle,
            text: replacement.text,
            width: replacement.width
          });
          label.setCoords();
          replacement.dispose();
        }
      }
    }
    this.fabric.requestRenderAll();
  }

  /** 锁定对象和构造对象仍可选择，但不能通过控制点破坏关系 */
  private configureObject(shape: Shape, object: FabricObject): void {
    const fixed =
      this.readOnly || isConstructionTool(this.tool) || shape.locked || shape.kind === "function";
    const stretchable = !this.readOnly && this.tool === "select" && isConstructionLine(shape);
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
      hasControls: (!fixed || stretchable) && shape.kind !== "point",
      hoverCursor: "crosshair",
      moveCursor: "crosshair"
    });
    if (isLine(shape)) {
      const controls = new LineControls(
        shape,
        this.isSnapEnabled.bind(this),
        this.handleEndpointChanged.bind(this),
        this.canEdit.bind(this),
        this.snapPoint.bind(this),
        this.viewBounds.bind(this)
      );
      controls.install(object);
    }
    if (object instanceof Path && shape.kind === "curve" && !fixed) {
      const controls = new CurveControls(shape.id, this.snapPoint.bind(this));
      controls.install(object);
    }
    if (object instanceof Textbox) {
      object.editable = !this.readOnly && !shape.locked && shape.textDirection !== "vertical";
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

  /** 让端点控制器读取当前吸附开关，不复制一份状态 */
  private isSnapEnabled(): boolean {
    return this.snap;
  }

  /** 控制器与快捷键共用只读状态，不另设一份编辑权限 */
  private canEdit(): boolean {
    return !this.readOnly;
  }

  /** 端点拖动只更新关联预览，松开时统一保存历史 */
  private handleEndpointChanged(): void {
    this.transforming = true;
    this.refreshRelationships();
    this.fabric.renderAll();
  }

  /** 获取画布坐标，需要时吸附网格 */
  private getPosition(event: TPointerEvent): BoardPoint {
    const position = this.fabric.getScenePoint(event);
    return this.snapPoint(position, "");
  }

  /** 绘制和端点编辑共用吸附规则，排除正在调整的对象 */
  private snapPoint(position: BoardPoint, excluded: string): BoardPoint {
    return snapPosition(
      this.document,
      position,
      this.snap,
      this.viewport.zoom,
      excluded,
      this.showAxes
    );
  }

  /** 优先采用附近已有几何点，点击空白处时新建独立端点 */
  private segmentPoint(position: BoardPoint): Shape {
    let nearest: Shape | undefined;
    let distance = POINT_HIT_DISTANCE / this.viewport.zoom;
    for (const shape of this.document.shapes) {
      if (shape.kind !== "point" || shape.hidden) {
        continue;
      }
      const current = Math.hypot(shape.x - position.x, shape.y - position.y);
      if (current <= distance) {
        nearest = shape;
        distance = current;
      }
    }
    if (nearest !== undefined) {
      return nearest;
    }
    const point = createShape("point", position);
    point.stroke = this.stroke;
    point.fill = this.fill;
    point.layer = this.document.shapes.length;
    point.name = nextPointName(this.document);
    point.text = point.name;
    this.document.shapes.push(point);
    addPointLabel(this.document, point);
    return point;
  }

  /** 两次点击确定来源点，完成后可继续创建下一条直线 */
  private placeSegmentPoint(position: BoardPoint): void {
    if (this.document.shapes.length > MAX_SHAPES - 3) {
      this.callbacks.notify("对象数量已达上限");
      return;
    }
    const point = this.segmentPoint(position);
    const first = findShape(this.document, this.segmentStart);
    if (first === undefined) {
      this.segmentStart = point.id;
      this.selectedIds = [point.id];
    } else if (first.id !== point.id) {
      const line = constructShape(this.document, [first, point], "segment");
      this.selectedIds = [line.id];
      this.segmentStart = "";
      this.callbacks.notify("已创建两点直线");
    }
    this.render();
    this.callbacks.changed();
  }

  /** 根据点击位置挑选几何来源，文字标签不会代替底下的点或线 */
  private placeConstructionSource(event: TPointerEvent): void {
    if (!isConstructionTool(this.tool)) {
      return;
    }
    const position = this.fabric.getScenePoint(event);
    const selected: Shape[] = [];
    for (const id of this.constructionIds) {
      const shape = findShape(this.document, id);
      if (shape !== undefined) {
        selected.push(shape);
      }
    }
    const objects = this.fabric.getObjects();
    objects.reverse();
    for (const object of objects) {
      const id = this.ids.get(object);
      const candidate = findShape(this.document, id || "");
      if (
        candidate === undefined ||
        candidate.hidden ||
        !acceptsConstructionSource(this.tool, selected, candidate)
      ) {
        continue;
      }
      if (this.fabric.searchPossibleTargets([object], position).target === undefined) {
        continue;
      }
      selected.push(candidate);
      this.constructionIds.push(candidate.id);
      this.selectedIds = this.constructionIds.slice();
      if (selected.length === constructionSourceCount(this.tool)) {
        this.constructionIds = [];
        this.finishConstruction(selected, this.tool);
      } else {
        this.restoreSelection();
        this.fabric.requestRenderAll();
        this.callbacks.selected();
      }
      return;
    }
  }

  /** 完成点选构造，重复交点不写入作品或撤销历史 */
  private finishConstruction(sources: Shape[], kind: ConstructionTool): void {
    try {
      const result = constructSelection(this.document, sources, kind);
      if (result.created.length > 0) {
        this.selectedIds = [result.created[0].id];
        this.render();
        this.callbacks.changed();
      } else {
        this.restoreSelection();
        this.fabric.requestRenderAll();
        this.callbacks.selected();
      }
      this.callbacks.constructed(result);
    } catch (error) {
      if (error instanceof Error) {
        this.callbacks.notify(error.message);
      }
    }
  }

  /** 开始绘图或平移，选择工具的操作全部交给库 */
  private handlePointerDown(event: TPointerEventInfo<TPointerEvent>): void {
    this.clearHover();
    this.fabric.upperCanvasEl.focus({ preventScroll: true });
    if (event.e instanceof MouseEvent && event.e.button !== 0) {
      return;
    }
    if (this.gesture !== null) {
      if (this.waitingForClick) {
        this.finishingClick = true;
        this.handlePointerMove(event);
      }
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
    if (this.tool === "coordinate-point" || this.tool === "function" || this.tool === "fit") {
      return;
    }
    if (isConstructionTool(this.tool)) {
      this.constructionClick = this.tool;
      return;
    }
    if (
      this.tool === "curve" &&
      event.target instanceof Path &&
      this.fabric.getActiveObject() === event.target
    ) {
      return;
    }
    if (this.document.shapes.length >= MAX_SHAPES) {
      this.callbacks.notify("对象数量已达上限");
      return;
    }
    if (this.tool === "custom-polygon") {
      this.customVertices.push(start);
      this.previewPolygon();
      return;
    }
    let kind = this.tool;
    if (kind === "vertical-text") {
      kind = "text";
    }
    if (kind === "square") {
      kind = "rect";
    }
    if (kind === "circle") {
      kind = "ellipse";
    }
    if (kind === "ray" || kind === "straight") {
      kind = "line";
    }
    const shape = createShape(kind, start);
    if (this.tool === "ray" || this.tool === "straight") {
      shape.lineType = this.tool;
      shape.name = "直线";
      if (this.tool === "ray") {
        shape.name = "射线";
      }
    }
    shape.stroke = this.stroke;
    shape.fill = this.fill;
    shape.layer = this.document.shapes.length;
    shape.sides = this.polygonSides;
    if (shape.kind === "text") {
      shape.text = "文字";
      if (this.tool === "vertical-text") {
        shape.textDirection = "vertical";
      }
    }
    if (shape.kind === "point") {
      shape.name = nextPointName(this.document);
      shape.text = shape.name;
    }
    if (shape.kind === "connector") {
      let id = "";
      if (event.target !== undefined) {
        id = this.ids.get(event.target) || "";
      }
      const source = findShape(this.document, id);
      if (source !== undefined && isNode(source)) {
        shape.relation = { kind: "connector", sources: [id] };
      }
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
    if (shape.kind === "point") {
      const position = this.fabric.getScenePoint(event.e);
      if (
        (position.x - gesture.start.x) * (position.x - gesture.start.x) +
          (position.y - gesture.start.y) * (position.y - gesture.start.y) <
        CLICK_DISTANCE * CLICK_DISTANCE
      ) {
        return;
      }
      shape.pointRadius = Math.min(
        MAX_POINT_RADIUS,
        Math.max(
          MIN_POINT_RADIUS,
          Math.hypot(position.x - gesture.start.x, position.y - gesture.start.y)
        )
      );
      this.drawPreview();
      return;
    }
    const position = this.getPosition(event.e);
    shape.width = position.x - gesture.start.x;
    shape.height = position.y - gesture.start.y;
    if (this.tool === "circle") {
      const radius = Math.hypot(shape.width, shape.height);
      shape.x = gesture.start.x - radius;
      shape.y = gesture.start.y - radius;
      shape.width = radius * 2;
      shape.height = radius * 2;
    }
    if (shape.kind === "text") {
      const lines = Array.from(shape.text).length;
      let textHeight = Math.abs(shape.height);
      if (shape.textDirection === "vertical") {
        textHeight = textHeight / Math.max(1, lines);
      }
      shape.fontSize = Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, textHeight / 1.2));
    }
    if (
      (event.e.shiftKey || this.tool === "square" || shape.kind === "polygon") &&
      !isLine(shape)
    ) {
      const size = Math.max(Math.abs(shape.width), Math.abs(shape.height));
      shape.width = Math.sign(shape.width) * size;
      shape.height = Math.sign(shape.height) * size;
    }
    if (shape.kind === "polygon") {
      shape.points = regularPoints(shape.width, shape.height, shape.sides);
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
    const preview = createFabricShape(shape, this.viewBounds());
    preview.set({ selectable: false, evented: false, opacity: PREVIEW_OPACITY });
    this.fabric.add(preview);
    this.objects.set(shape.id, preview);
    this.fabric.requestRenderAll();
  }

  /** 将库生成的平滑画笔路径保存到模型 */
  private handlePathCreated(event: { path: Path }): void {
    if (this.readOnly) {
      this.fabric.remove(event.path);
      return;
    }
    const object = event.path;
    const path = serializePath(object);
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
    this.modificationPending = true;
    queueMicrotask(this.finishModification.bind(this));
  }

  /** 完成绘制，连接两个节点的折线保留跟随关系 */
  private handlePointerUp(event: TPointerEventInfo<TPointerEvent>): void {
    const construction = this.constructionClick;
    this.constructionClick = null;
    if (construction !== null && construction === this.tool) {
      if (construction === "segment") {
        this.placeSegmentPoint(this.getPosition(event.e));
      } else {
        this.placeConstructionSource(event.e);
      }
      return;
    }
    const gesture = this.gesture;
    if (gesture === null) {
      return;
    }
    const shape = gesture.shape;
    if (shape === null) {
      this.gesture = null;
      this.holdPanning = false;
      this.fabric.setCursor("grab");
      this.updateToolMode();
      queueMicrotask(this.restoreSelection.bind(this));
      return;
    }
    const pointer = this.fabric.getViewportPoint(event.e);
    const distance = Math.hypot(pointer.x - gesture.screen.x, pointer.y - gesture.screen.y);
    if (
      shape.kind !== "point" &&
      !this.finishingClick &&
      (this.waitingForClick || distance < CLICK_DISTANCE)
    ) {
      this.waitingForClick = true;
      return;
    }
    this.waitingForClick = false;
    this.finishingClick = false;
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
        shape.relation.sources.length === 1 &&
        destination !== undefined &&
        isNode(destination) &&
        destination.id !== shape.relation.sources[0]
      ) {
        shape.relation.sources.push(destination.id);
        shape.layer = -1;
      } else {
        shape.relation = { kind: "none", sources: [] };
      }
    }
    if (shape !== null && shape.kind !== "point") {
      if (Math.hypot(shape.width, shape.height) < MIN_DRAWING_LENGTH && shape.kind !== "pencil") {
        this.cancelGesture();
        return;
      }
      if (!isLine(shape) && shape.kind !== "pencil") {
        const bounds = getBounds(shape);
        shape.x = bounds.x;
        shape.y = bounds.y;
        shape.width = Math.max(MIN_SHAPE_SIZE, bounds.width);
        shape.height = Math.max(MIN_SHAPE_SIZE, bounds.height);
      }
      if (shape.kind === "polygon") {
        shape.points = regularPoints(shape.width, shape.height, shape.sides);
        fitPolygon(shape);
      }
    }
    if (shape.kind === "curve") {
      const object = createFabricShape(shape);
      if (object instanceof Path) {
        const center = object.getCenterPoint();
        shape.path = serializePath(object);
        shape.width = object.width;
        shape.height = object.height;
        shape.x = center.x - object.width / 2;
        shape.y = center.y - object.height / 2;
      }
      object.dispose();
    }
    if (shape.kind === "text") {
      const object = createFabricShape(shape);
      shape.height = object.height;
      object.dispose();
    }
    this.document.shapes.push(shape);
    addPointLabel(this.document, shape);
    this.selectedIds = [shape.id];
    this.gesture = null;
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

  /** 自定义多边形按点击顺序预览顶点，最后由双击闭合 */
  private previewPolygon(): void {
    const previous = this.fabric.getObjects();
    for (const object of previous) {
      if (object === this.polygonPreview) {
        this.fabric.remove(object);
        object.dispose();
      }
    }
    this.polygonPreview = new Polygon(this.customVertices, {
      fill: POLYGON_PREVIEW_FILL,
      stroke: this.stroke,
      strokeWidth: PENCIL_WIDTH,
      selectable: false,
      evented: false
    });
    this.fabric.add(this.polygonPreview);
  }

  /** 闭合至少三个不同顶点，归一化顶点后保存为普通可缩放对象 */
  private finishPolygon(): void {
    const points: BoardPoint[] = [];
    for (const point of this.customVertices) {
      const last = points[points.length - 1];
      if (last === undefined || Math.hypot(last.x - point.x, last.y - point.y) > 2) {
        points.push(point);
      }
    }
    if (points.length < 3) {
      return;
    }
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    for (const point of points) {
      left = Math.min(left, point.x);
      top = Math.min(top, point.y);
      right = Math.max(right, point.x);
      bottom = Math.max(bottom, point.y);
    }
    for (const point of points) {
      point.x = point.x - left;
      point.y = point.y - top;
    }
    const shape = createShape("polygon", { x: left, y: top });
    shape.width = right - left;
    shape.height = bottom - top;
    shape.points = points;
    shape.sides = points.length;
    shape.stroke = this.stroke;
    shape.fill = this.fill;
    shape.layer = this.document.shapes.length;
    this.document.shapes.push(shape);
    this.customVertices = [];
    this.polygonPreview = null;
    this.selectedIds = [shape.id];
    this.modificationPending = true;
    queueMicrotask(this.finishModification.bind(this));
  }

  /** 取消半成品图形，避免保存不完整的连接关系 */
  cancelGesture(): void {
    this.clearHold();
    this.holdPanning = false;
    this.blankPanning = false;
    this.host.dataset.panning = "false";
    this.constructionIds = [];
    this.constructionClick = null;
    this.waitingForClick = false;
    this.finishingClick = false;
    this.segmentStart = "";
    if (this.customVertices.length > 0) {
      this.customVertices = [];
      this.polygonPreview = null;
      this.render();
    }
    this.rightSelection = null;
    this.selectionClick = null;
    this.feedback.setMarquee(null);
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
    if (this.tool === "custom-polygon" && !this.readOnly) {
      this.finishPolygon();
      return;
    }
    if (this.readOnly || event.target === undefined || this.tool !== "select") {
      return;
    }
    const id = this.ids.get(event.target);
    if (id !== undefined) {
      const shape = findShape(this.document, id);
      if (
        event.target instanceof Textbox &&
        shape !== undefined &&
        shape.textDirection !== "vertical"
      ) {
        return;
      }
      this.callbacks.editText(id);
    }
  }

  /** 在库开始拖动前选中整个逻辑组，首次拖动就能一起移动 */
  private handleBeforePointerDown(event: PointerEvent): void {
    this.overlapClick = null;
    if (event.button === 0 && !this.spacePressed) {
      this.clearHold();
      this.holdPosition = { x: event.clientX, y: event.clientY, pointerId: event.pointerId };
      this.holdTimer = window.setTimeout(this.startHoldPan.bind(this), HOLD_PAN_DELAY);
    }
    if (this.tool !== "select" || this.spacePressed) {
      return;
    }
    const position = this.fabric.getScenePoint(event);
    if (event.button === 0 && !event.ctrlKey && !event.shiftKey && !event.metaKey) {
      const target = this.fabric.searchPossibleTargets(this.fabric.getObjects(), position).target;
      const active = this.fabric.getActiveObject();
      let control = false;
      if (active !== undefined) {
        control = active.findControl(this.fabric.getViewportPoint(event)) !== undefined;
      }
      if (target === undefined && !control) {
        this.startHoldPan();
        this.blankPanning = true;
        return;
      }
    }
    if (event.button === 2) {
      event.preventDefault();
      event.stopImmediatePropagation();
      this.rightSelection = {
        start: position,
        append: event.ctrlKey || event.shiftKey || event.metaKey
      };
      const selected = this.selectedIds.slice();
      this.fabric.discardActiveObject();
      this.selectedIds = selected;
      this.clearHover();
      return;
    }
    if (event.button !== 0) {
      return;
    }
    if (
      !this.readOnly &&
      !event.shiftKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      this.selectShapeLabel(position)
    ) {
      return;
    }
    const actual = this.fabric.searchPossibleTargets(this.fabric.getObjects(), position).target;
    const active = this.fabric.getActiveObject();
    const activeId = this.selectedIds[0];
    const activeShape = findShape(this.document, activeId || "");
    if (activeShape !== undefined && activeShape.relation.kind === "segment") {
      for (const source of activeShape.relation.sources) {
        const point = findShape(this.document, source);
        if (
          point !== undefined &&
          Math.hypot(point.x - position.x, point.y - position.y) <=
            POINT_HIT_DISTANCE / this.viewport.zoom
        ) {
          this.select(point.id, false);
          return;
        }
      }
    }
    if (active !== undefined && active.findControl(this.fabric.getViewportPoint(event))) {
      return;
    }
    if (!event.shiftKey && !event.ctrlKey && !event.metaKey && this.selectedIds.length <= 1) {
      const ids = this.overlapCandidates(position);
      this.overlapClick = { x: event.clientX, y: event.clientY, ids: ids };
      const first = findShape(this.document, ids[0] || "");
      if (
        first !== undefined &&
        (first.kind === "text" || first.kind === "point") &&
        !this.selectedIds.includes(first.id)
      ) {
        this.select(first.id, false);
      }
    }
    let actualId: string | undefined;
    if (actual !== undefined) {
      actualId = this.ids.get(actual);
    }
    if ((event.ctrlKey || event.metaKey) && actualId !== undefined) {
      event.preventDefault();
      event.stopImmediatePropagation();
      this.select(actualId, true);
      return;
    }
    this.selectionClick = null;
    if (
      !event.shiftKey &&
      actualId !== undefined &&
      this.selectedIds.length > 1 &&
      this.selectedIds.includes(actualId)
    ) {
      this.selectionClick = {
        id: actualId,
        x: event.clientX,
        y: event.clientY,
        ids: this.selectedIds.slice()
      };
    }
    if (event.shiftKey) {
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

  /** 松开、移动超过点击容差或切换工具时取消长按等待 */
  private clearHold(): void {
    window.clearTimeout(this.holdTimer);
    this.holdTimer = 0;
    this.holdPosition = null;
  }

  /** 平移使用窗口级指针坐标，移出画布后仍能继续拖动 */
  private handleHoldMove(event: PointerEvent): void {
    if (this.holdPanning && this.gesture !== null) {
      const bounds = this.host.getBoundingClientRect();
      this.viewport.x = this.gesture.view.x + event.clientX - bounds.left - this.gesture.screen.x;
      this.viewport.y = this.gesture.view.y + event.clientY - bounds.top - this.gesture.screen.y;
      this.applyViewport();
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    const start = this.holdPosition;
    if (
      start !== null &&
      Math.hypot(event.clientX - start.x, event.clientY - start.y) > HOLD_PAN_TOLERANCE
    ) {
      this.clearHold();
    }
  }

  /** 长按结束时撤回尚未完成的绘制，再将同一次手势用于平移 */
  private startHoldPan(): void {
    const start = this.holdPosition;
    if (start === null) {
      return;
    }
    const bounds = this.host.getBoundingClientRect();
    const screen = { x: start.x - bounds.left, y: start.y - bounds.top };
    this.fabric.upperCanvasEl.setPointerCapture(start.pointerId);
    this.cancelGesture();
    this.rebuilding = true;
    this.fabric.endCurrentTransform();
    this.fabric.discardActiveObject();
    this.rebuilding = false;
    this.holdPanning = true;
    this.host.dataset.panning = "true";
    this.gesture = {
      start: { x: 0, y: 0 },
      screen: screen,
      view: { x: this.viewport.x, y: this.viewport.y },
      shape: null,
      selection: this.selectedIds.slice()
    };
    this.selectionClick = null;
    this.overlapClick = null;
    this.updateToolMode();
    this.fabric.setCursor("grabbing");
  }

  /** 点击标签时保留原外观，并改由独立文本框接收后续手势 */
  private selectShapeLabel(position: Point): boolean {
    const labels = Array.from(this.labels.entries());
    labels.reverse();
    for (const entry of labels) {
      const object = entry[1];
      if (
        !object.visible ||
        this.fabric.searchPossibleTargets([object], position).target === undefined
      ) {
        continue;
      }
      const owner = findShape(this.document, entry[0]);
      if (owner === undefined || owner.locked) {
        continue;
      }
      const label = detachLabel(this.document, owner);
      if (label !== null) {
        this.selectedIds = [label.id];
        this.render();
        this.callbacks.changed();
        return true;
      }
    }
    return false;
  }

  /** 用库的实际命中检查收集对象，文本框优先于同位置的线条 */
  private overlapCandidates(position: Point): string[] {
    const texts: string[] = [];
    const points: string[] = [];
    const others: string[] = [];
    const objects = this.fabric.getObjects();
    objects.reverse();
    for (const object of objects) {
      const id = this.ids.get(object);
      if (
        id === undefined ||
        !object.visible ||
        this.fabric.searchPossibleTargets([object], position).target === undefined
      ) {
        continue;
      }
      const shape = findShape(this.document, id);
      if (shape !== undefined && shape.kind === "text") {
        texts.push(id);
      } else if (shape !== undefined && shape.kind === "point") {
        points.push(id);
      } else {
        others.push(id);
      }
    }
    return texts.concat(points, others);
  }

  /** 从右键起点计算正宽高的框选范围 */
  private rightBounds(event: PointerEvent): Bounds | null {
    if (this.rightSelection === null) {
      return null;
    }
    const point = this.fabric.getScenePoint(event);
    const start = this.rightSelection.start;
    return {
      x: Math.min(start.x, point.x),
      y: Math.min(start.y, point.y),
      width: Math.abs(point.x - start.x),
      height: Math.abs(point.y - start.y)
    };
  }

  /** 右键移动时只画预览，不让浏览器弹出菜单或拖动页面 */
  private handleRightMove(event: PointerEvent): void {
    const bounds = this.rightBounds(event);
    if (bounds === null) {
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    this.feedback.setMarquee(bounds);
  }

  /** 结束右键框选，或在多选后单击成员将其移出选区 */
  private handleSelectionRelease(event: PointerEvent): void {
    this.clearHold();
    if (this.holdPanning) {
      if (this.blankPanning && this.gesture !== null) {
        const bounds = this.host.getBoundingClientRect();
        const distance = Math.hypot(
          event.clientX - bounds.left - this.gesture.screen.x,
          event.clientY - bounds.top - this.gesture.screen.y
        );
        if (distance < CLICK_DISTANCE) {
          this.selectedIds = [];
        }
      }
      this.holdPanning = false;
      this.blankPanning = false;
      this.host.dataset.panning = "false";
      this.gesture = null;
      this.updateToolMode();
      this.restoreSelection();
      this.fabric.requestRenderAll();
      this.callbacks.selected();
      return;
    }
    const overlap = this.overlapClick;
    this.overlapClick = null;
    if (overlap !== null) {
      if (Math.hypot(event.clientX - overlap.x, event.clientY - overlap.y) < CLICK_DISTANCE) {
        const id = this.overlapSelection.choose(
          { x: event.clientX, y: event.clientY },
          overlap.ids
        );
        if (id !== undefined && overlap.ids.length > 1) {
          // 等库结束本次鼠标手势，再切换到下一个重叠对象
          queueMicrotask(this.select.bind(this, id, false));
        }
      } else {
        this.overlapSelection.reset();
      }
    }
    if (this.rightSelection !== null) {
      const bounds = this.rightBounds(event);
      const append = this.rightSelection.append;
      this.rightSelection = null;
      this.feedback.setMarquee(null);
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!append) {
        this.selectedIds = [];
      }
      if (bounds !== null) {
        for (const shape of this.document.shapes) {
          const object = this.objects.get(shape.id);
          if (object === undefined || !object.visible) {
            continue;
          }
          const tolerance = MARQUEE_TOLERANCE / this.viewport.zoom;
          const topLeft = new Point(bounds.x - tolerance, bounds.y - tolerance);
          const bottomRight = new Point(
            bounds.x + bounds.width + tolerance,
            bounds.y + bounds.height + tolerance
          );
          let hit =
            object.intersectsWithRect(topLeft, bottomRight) ||
            object.isContainedWithinRect(topLeft, bottomRight);
          if (
            isLine(shape) ||
            shape.kind === "curve" ||
            shape.kind === "pencil" ||
            shape.kind === "function"
          ) {
            hit = strokeInMarquee(shape, {
              x: topLeft.x,
              y: topLeft.y,
              width: bottomRight.x - topLeft.x,
              height: bottomRight.y - topLeft.y
            });
          }
          if (hit && !this.selectedIds.includes(shape.id)) {
            this.selectedIds.push(shape.id);
          }
        }
      }
      this.restoreSelection();
      this.fabric.requestRenderAll();
      this.callbacks.selected();
      return;
    }
    const click = this.selectionClick;
    this.selectionClick = null;
    if (
      click !== null &&
      Math.hypot(event.clientX - click.x, event.clientY - click.y) < CLICK_DISTANCE
    ) {
      this.selectedIds = click.ids;
      this.select(click.id, true);
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
    this.rightSelection = null;
    this.selectionClick = null;
    this.feedback.setMarquee(null);
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
    this.handlePointerCancel();
    this.updateToolMode();
    this.clearHover();
  }

  /** 原地切换交互开关，不重建正在显示的图形 */
  private updateToolMode(): void {
    const panning = this.tool === "hand" || this.spacePressed || this.holdPanning;
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
        object.selectable =
          this.fabric.selection || (this.tool === "curve" && shape.kind === "curve");
      }
    }
    if (this.fabric.isDrawingMode) {
      const brush = new PencilBrush(this.fabric);
      brush.color = this.stroke;
      brush.width = PENCIL_WIDTH;
      this.fabric.freeDrawingBrush = brush;
    }
    this.fabric.setCursor(this.fabric.defaultCursor);
  }

  /** 普通滚轮平移，Ctrl 或 Command 加滚轮围绕指针缩放 */
  private handleWheel(event: TPointerEventInfo<WheelEvent>): void {
    event.e.preventDefault();
    if (event.e.ctrlKey || event.e.metaKey) {
      this.zoomTo(
        this.viewport.zoom * Math.exp(-event.e.deltaY * WHEEL_ZOOM_SPEED),
        this.fabric.getViewportPoint(event.e)
      );
      return;
    }
    this.viewport.x = this.viewport.x - event.e.deltaX;
    this.viewport.y = this.viewport.y - event.e.deltaY;
    this.applyViewport();
  }

  /** 只绘制当前视口内的无限网格，跳过工作区边缘的点 */
  private drawGrid(event: { ctx: CanvasRenderingContext2D }): void {
    const context = event.ctx;
    const width = this.fabric.getWidth();
    const height = this.fabric.getHeight();
    context.save();
    context.fillStyle = this.document.background;
    context.fillRect(0, 0, width, height);
    if (this.showGrid) {
      let spacing = GRID_SIZE * this.viewport.zoom;
      while (spacing < MIN_GRID_SPACING) {
        spacing = spacing * 2;
      }
      const color = this.document.background;
      const red = Number.parseInt(color.slice(1, 3), 16);
      const green = Number.parseInt(color.slice(3, 5), 16);
      const blue = Number.parseInt(color.slice(5, 7), 16);
      const brightness = red * 0.2126 + green * 0.7152 + blue * 0.0722;
      context.fillStyle = GRID_COLOR;
      if (brightness < DARK_BACKGROUND_THRESHOLD) {
        context.fillStyle = GRID_LIGHT_COLOR;
      }
      const startX = ((this.viewport.x % spacing) + spacing) % spacing;
      const startY = ((this.viewport.y % spacing) + spacing) % spacing;
      for (let left = startX; left < width - 6; left = left + spacing) {
        if (left < 6) {
          continue;
        }
        for (let top = startY; top < height - 6; top = top + spacing) {
          if (top < 6) {
            continue;
          }
          context.beginPath();
          context.arc(left, top, GRID_RADIUS, 0, Math.PI * 2);
          context.fill();
        }
      }
    }
    if (this.showAxes) {
      drawAxes(context, this.viewport, width, height);
    }
    context.restore();
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
    this.initialCenters.clear();
    const invalid = updateRelations(this.document);
    const ordered = this.document.shapes.slice();
    ordered.sort(compareLayers);
    const locked: LockedObject[] = [];
    for (const shape of ordered) {
      if (shape.hidden) {
        continue;
      }
      const object = createFabricShape(shape, this.viewBounds());
      this.configureObject(shape, object);
      object.visible = !invalid.has(shape.id);
      this.fabric.add(object);
      if (shape.locked) {
        locked.push({ object: object, shape: shape });
      }
      this.objects.set(shape.id, object);
      this.ids.set(object, shape.id);
      this.originals.set(shape.id, structuredClone(shape));
      this.initialScales.set(shape.id, { x: object.scaleX, y: object.scaleY });
      const center = object.getCenterPoint();
      this.initialCenters.set(shape.id, { x: center.x, y: center.y });
      const label = createFabricLabel(shape);
      if (label !== null) {
        label.visible = object.visible;
        label.evented = this.tool === "select";
        this.fabric.add(label);
        this.labels.set(shape.id, label);
      }
    }
    this.updateToolMode();
    this.feedback.setLocked(locked);
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
