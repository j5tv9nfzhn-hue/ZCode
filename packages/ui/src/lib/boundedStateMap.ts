/**
 * 有界键值表：给「按渲染实例记忆用户选择」这类模块级状态用。
 *
 * 这些表的键是 toolId、行 id 之类的渲染实例标识，会随长会话、跨会话切换单调增长，
 * 而它们保存的只是一个布尔选择——条目被淘汰后重新读到默认值，语义上等价于
 * 「用户没有在这条上做过选择」，所以这里只需要限制规模，不需要另造一套失效协议。
 *
 * 淘汰策略是近似 LRU：命中时把键移到队尾，超限时弹出最久未使用的一键。
 */
export interface BoundedStateMap<T> {
  get: (key: string) => T | undefined;
  has: (key: string) => boolean;
  set: (key: string, value: T) => void;
  readonly size: number;
}

export function createBoundedStateMap<T>(maxEntries: number): BoundedStateMap<T> {
  const entries = new Map<string, T>();

  return {
    get: (key) => entries.get(key),
    has: (key) => entries.has(key),
    set(key, value) {
      if (entries.has(key)) {
        // Map 的 set 不会重排插入序，要刷新「最近使用」必须先删后插。
        entries.delete(key);
      } else if (entries.size >= maxEntries) {
        const oldest = entries.keys().next();
        if (!oldest.done) {
          entries.delete(oldest.value);
        }
      }
      entries.set(key, value);
    },
    get size() {
      return entries.size;
    },
  };
}