/** 将未知输入收窄为普通对象，供文件和脚本读取结构化数据 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
