import { parseDocument } from "./document";
import { createDocument } from "../core/model";
import type { BoardDocument } from "../core/types";
import { archiveContent } from "./archive-content";
import { createFlowTemplate, createGeometryTemplate } from "../objects/templates";
import { isRecord } from "../core/validation";

// 存档列表在浏览器中的存储键
const ARCHIVE_KEY = "svg-board-archives-v1";
// 当前存档编号的存储键
const ACTIVE_KEY = "svg-board-active-archive";
// 浏览器中最多保留的存档数
const ARCHIVE_LIMIT = 40;
// 内置存档的首次写入标记
const SEEDED_KEY = "svg-board-builtin-archives-v1";

/** 一个本地存档有独立编号，重命名作品不会改变存档身份 */
export interface Archive {
  id: string;
  document: BoardDocument;
}

/** 管理本地存档，不修改画布选区或操作历史 */
export class Archives {
  items: Archive[] = [];
  active = "";

  /** 读取并校验所有存档，坏数据会明确报错，避免覆盖原内容 */
  constructor() {
    const saved = localStorage.getItem(ARCHIVE_KEY);
    let values: unknown = [];
    if (saved !== null) {
      values = JSON.parse(saved);
    }
    if (!Array.isArray(values) || values.length > ARCHIVE_LIMIT) {
      throw new Error("存档列表损坏");
    }
    for (const value of values) {
      if (!isRecord(value) || typeof value.id !== "string") {
        throw new Error("存档格式错误");
      }
      this.items.push({ id: value.id, document: parseDocument(JSON.stringify(value.document)) });
    }
    this.active = localStorage.getItem(ACTIVE_KEY) || "";
    this.replaceDuplicates(this.items, this.active);
  }

  /** 首次写入两份内置作品，之后删除作品也不会在刷新时重新出现 */
  seedBuiltins(): void {
    if (localStorage.getItem(SEEDED_KEY) !== null) {
      return;
    }
    const active = this.active;
    const items = this.items.slice();
    for (const document of [createFlowTemplate(), createGeometryTemplate()]) {
      if (items.length >= ARCHIVE_LIMIT) {
        break;
      }
      const key = archiveContent(document);
      let exists = false;
      for (const item of items) {
        if (archiveContent(item.document) === key) {
          exists = true;
          break;
        }
      }
      if (!exists) {
        items.push({ id: crypto.randomUUID(), document: document });
      }
    }
    this.persist(items, active);
    localStorage.setItem(SEEDED_KEY, "true");
  }

  /** 创建存档并设为当前作品，返回独立副本给画布使用 */
  create(document: BoardDocument): BoardDocument {
    const key = archiveContent(document);
    for (const item of this.items) {
      if (archiveContent(item.document) === key) {
        return this.open(item.id);
      }
    }
    if (this.items.length >= ARCHIVE_LIMIT) {
      throw new Error("最多保留 " + ARCHIVE_LIMIT + " 个存档");
    }
    const item = { id: crypto.randomUUID(), document: structuredClone(document) };
    const items = this.items.slice();
    items.push(item);
    this.persist(items, item.id);
    return structuredClone(item.document);
  }

  /** 保存当前存档，首次保存时为作品创建编号 */
  save(document: BoardDocument): void {
    const item = this.find(this.active);
    if (item === undefined) {
      this.create(document);
      return;
    }
    const items = this.items.slice();
    const index = items.indexOf(item);
    items[index] = { id: item.id, document: structuredClone(document) };
    this.replaceDuplicates(items, this.active);
  }

  /** 保留第一份相同内容，当前作品若重复则转到保留的存档 */
  private replaceDuplicates(items: Archive[], active: string): void {
    const unique: Archive[] = [];
    const keys = new Map<string, string>();
    for (const item of items) {
      const key = archiveContent(item.document);
      const existing = keys.get(key);
      if (existing === undefined) {
        unique.push(item);
        keys.set(key, item.id);
      } else if (active === item.id) {
        active = existing;
      }
    }
    if (items !== this.items || items.length !== unique.length) {
      this.persist(unique, active);
    }
  }

  /** 读取指定存档，不向调用者暴露内部保存的对象 */
  open(id: string): BoardDocument {
    const item = this.find(id);
    if (item === undefined) {
      throw new Error("存档不存在");
    }
    if (id !== this.active) {
      localStorage.setItem(ACTIVE_KEY, id);
      this.active = id;
    }
    return structuredClone(item.document);
  }

  /** 删除确认过的存档，删除当前作品后切换到剩余存档或新画板 */
  remove(id: string): BoardDocument | null {
    const remaining: Archive[] = [];
    for (const item of this.items) {
      if (item.id !== id) {
        remaining.push(item);
      }
    }
    if (id !== this.active) {
      this.persist(remaining, this.active);
      return null;
    }
    if (remaining.length === 0) {
      const blank = { id: crypto.randomUUID(), document: createDocument() };
      remaining.push(blank);
    }
    const next = remaining[remaining.length - 1];
    this.persist(remaining, next.id);
    return structuredClone(next.document);
  }

  /** 通过编号查找存档 */
  find(id: string): Archive | undefined {
    for (const item of this.items) {
      if (item.id === id) {
        return item;
      }
    }
    return undefined;
  }

  /** 两个存储键都写入后才更新内存，列表写入失败时恢复原编号 */
  private persist(items: Archive[], active: string): void {
    const text = JSON.stringify(items);
    const previous = localStorage.getItem(ACTIVE_KEY);
    if (previous !== active) {
      localStorage.setItem(ACTIVE_KEY, active);
    }
    try {
      localStorage.setItem(ARCHIVE_KEY, text);
    } catch (error) {
      if (previous === null) {
        localStorage.removeItem(ACTIVE_KEY);
      } else if (previous !== active) {
        localStorage.setItem(ACTIVE_KEY, previous);
      }
      throw error;
    }
    this.items = items;
    this.active = active;
  }
}
