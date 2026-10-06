import type { PackingSnapshot } from './models';

type GroupFields = 'alternativeGroups' | 'alternativeSelection';
type StoredSnapshot = Omit<PackingSnapshot, GroupFields> & Partial<Pick<PackingSnapshot, GroupFields>>;

/** 兼容旧版本地数据：缺少分组字段时补默认值 */
export function normalizeSnapshot(snapshot: StoredSnapshot): PackingSnapshot {
  return {
    ...snapshot,
    alternativeGroups: snapshot.alternativeGroups ?? [],
    alternativeSelection: snapshot.alternativeSelection ?? [],
  };
}
