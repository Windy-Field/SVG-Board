import { parseDocument } from "./document";
import { createDocument } from "./model";
import type { BoardDocument } from "./types";

const ARCHIVE_KEY = "svg-board-archives-v1";
const ACTIVE_KEY = "svg-board-active-archive";
const ARCHIVE_LIMIT = 40;

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
    if (saved === null) {
      return;
    }
    const values: unknown = JSON.parse(saved);
    if (!Array.isArray(values) || values.length > ARCHIVE_LIMIT) {
      throw new Error("存档列表损坏");
    }
    for (const value of values) {
      if (
        typeof value !== "object" ||
        value === null ||
        !("id" in value) ||
        !("document" in value) ||
        typeof value.id !== "string"
      ) {
        throw new Error("存档格式错误");
      }
      this.items.push({ id: value.id, document: parseDocument(JSON.stringify(value.document)) });
    }
    this.active = localStorage.getItem(ACTIVE_KEY) || "";
  }

  /** 创建存档并设为当前作品，返回独立副本给画布使用 */
  create(document: BoardDocument): BoardDocument {
    if (this.items.length >= ARCHIVE_LIMIT) {
      throw new Error("最多保留 40 个存档");
    }
    const item = { id: crypto.randomUUID(), document: structuredClone(document) };
    this.items.push(item);
    this.active = item.id;
    this.persist();
    return structuredClone(item.document);
  }

  /** 保存当前存档，首次保存时为作品创建编号 */
  save(document: BoardDocument): void {
    const item = this.find(this.active);
    if (item === undefined) {
      this.create(document);
      return;
    }
    item.document = structuredClone(document);
    this.persist();
  }

  /** 读取指定存档，不向调用者暴露内部保存的对象 */
  open(id: string): BoardDocument {
    const item = this.find(id);
    if (item === undefined) {
      throw new Error("存档不存在");
    }
    this.active = id;
    this.persist();
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
    this.items = remaining;
    if (id !== this.active) {
      this.persist();
      return null;
    }
    if (this.items.length === 0) {
      this.active = "";
      return this.create(createDocument());
    }
    this.active = this.items[0].id;
    this.persist();
    return structuredClone(this.items[0].document);
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

  /** 先写入作品列表，再记录当前编号 */
  private persist(): void {
    localStorage.setItem(ARCHIVE_KEY, JSON.stringify(this.items));
    localStorage.setItem(ACTIVE_KEY, this.active);
  }
}
