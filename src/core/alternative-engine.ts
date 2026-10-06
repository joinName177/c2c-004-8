import { packItems } from './packing-engine';
import type {
  AlternativeGroup,
  AlternativeSelection,
  PackingItem,
  PlanMode,
  Suitcase,
  TrialCandidate,
  TrialResult,
} from './models';

/** 单次试算最多评估的组合数；超出后返回已找到的最优可行方案，但不声称全局最优 */
export const TRIAL_BUDGET = 400;

export function validateGroupDraft(draft: AlternativeGroup, items: PackingItem[], groups: AlternativeGroup[]): string[] {
  const errors: string[] = [];
  if (!draft.name.trim()) errors.push('请为分组命名');
  const members = draft.itemIds.filter((id, index) => draft.itemIds.indexOf(id) === index);
  if (members.length < 2) errors.push('替代分组至少需要两件物品');
  for (const id of members) {
    if (!items.some((item) => item.id === id)) errors.push('分组包含清单中不存在的物品');
    const holder = groups.find((group) => group.id !== draft.id && group.itemIds.includes(id));
    if (holder) errors.push(`物品已属于分组「${holder.name}」`);
  }
  if (!draft.required && members.some((id) => items.find((item) => item.id === id)?.mustHave)) {
    errors.push('组内已有必带物品，分组不能设为可选');
  }
  return errors;
}

/** 未确认选择前，每组默认携带偏好最强的成员 */
export function defaultSelection(groups: AlternativeGroup[]): AlternativeSelection[] {
  return groups.map((group) => ({ groupId: group.id, itemId: group.itemIds[0] ?? null }));
}

/** 实际参与装箱的清单：未分组物品 + 每组选中的一件（可选组可不选），返回独立副本 */
export function effectiveItems(items: PackingItem[], groups: AlternativeGroup[], selection: AlternativeSelection[]): PackingItem[] {
  const chosen = new Map(selection.map((entry) => [entry.groupId, entry.itemId]));
  const groupedIds = new Set(groups.flatMap((group) => group.itemIds));
  const result = items.filter((item) => !groupedIds.has(item.id)).map((item) => ({ ...item }));
  for (const group of groups) {
    const itemId = chosen.has(group.id) ? chosen.get(group.id) : group.itemIds[0] ?? null;
    const item = itemId ? items.find((entry) => entry.id === itemId) : undefined;
    if (item) result.push({ ...item });
  }
  return result;
}

/** 清单、分组或行李箱一旦变化，旧的试算推荐即失效 */
export function fingerprintOf(suitcase: Suitcase, items: PackingItem[], groups: AlternativeGroup[]): string {
  return JSON.stringify({
    suitcase,
    items: items.map((item) => [item.id, item.length, item.width, item.height, item.weight, item.priority, Number(item.mustHave)]),
    groups: groups.map((group) => [group.id, group.name, Number(group.required), group.itemIds]),
  });
}

/** 物品删除后清理分组：移除已不存在的成员，解散不足两件的分组，并同步选择 */
export function pruneGroups(groups: AlternativeGroup[], selection: AlternativeSelection[], items: PackingItem[]) {
  const existing = new Set(items.map((item) => item.id));
  const nextGroups = groups
    .map((group) => ({ ...group, itemIds: group.itemIds.filter((id) => existing.has(id)) }))
    .filter((group) => group.itemIds.length >= 2);
  const dissolved = groups.filter((group) => !nextGroups.some((next) => next.id === group.id)).map((group) => group.name);
  const nextSelection = selection.filter((entry) => {
    const group = nextGroups.find((next) => next.id === entry.groupId);
    return !!group && (entry.itemId === null || group.itemIds.includes(entry.itemId));
  });
  return { groups: nextGroups, selection: nextSelection, dissolved };
}

function* combinationsOf(optionLists: Array<Array<string | null>>): Generator<Array<string | null>> {
  const indices = optionLists.map(() => 0);
  for (;;) {
    yield optionLists.map((options, groupIndex) => options[indices[groupIndex]]);
    let position = optionLists.length - 1;
    while (position >= 0) {
      indices[position] += 1;
      if (indices[position] < optionLists[position].length) break;
      indices[position] = 0;
      position -= 1;
    }
    if (position < 0) return;
  }
}

function signatureOf(selection: AlternativeSelection[]): string {
  return selection.map((entry) => entry.itemId ?? '∅').join('|');
}

/** 比较顺序：必带满足 → 用户偏好 → 重量余量，最后按选择签名保证确定性 */
function compareCandidates(a: TrialCandidate, b: TrialCandidate): number {
  return b.requiredSatisfied - a.requiredSatisfied
    || b.mustHavePlaced - a.mustHavePlaced
    || b.preferenceScore - a.preferenceScore
    || b.weightMargin - a.weightMargin
    || signatureOf(a.selection).localeCompare(signatureOf(b.selection));
}

function explainDrop(candidate: TrialCandidate, recommended: TrialCandidate): string {
  if (candidate.requiredSatisfied !== recommended.requiredSatisfied) {
    return `必带组满足 ${candidate.requiredSatisfied}/${candidate.requiredTotal}，推荐方案满足 ${recommended.requiredSatisfied}/${recommended.requiredTotal}`;
  }
  if (candidate.mustHavePlaced !== recommended.mustHavePlaced) {
    return `必带物品装入 ${candidate.mustHavePlaced}/${candidate.mustHaveTotal} 件，推荐方案装入 ${recommended.mustHavePlaced}/${recommended.mustHaveTotal} 件`;
  }
  if (candidate.preferenceScore !== recommended.preferenceScore) {
    return `组内偏好得分 ${candidate.preferenceScore}，低于推荐方案的 ${recommended.preferenceScore}`;
  }
  if (candidate.weightMargin.toFixed(6) !== recommended.weightMargin.toFixed(6)) {
    return `重量余量 ${candidate.weightMargin.toFixed(1)} kg，小于推荐方案的 ${recommended.weightMargin.toFixed(1)} kg`;
  }
  return '各项指标与推荐方案一致，按组内偏好顺序取舍';
}

/**
 * 在每组最多选一件的约束下枚举组合，用当前策略试装并排序。
 * 所有组合都基于当前清单的独立副本，不改动原清单。
 */
export function evaluateAlternatives(
  suitcase: Suitcase,
  items: PackingItem[],
  groups: AlternativeGroup[],
  mode: PlanMode,
  budget: number = TRIAL_BUDGET,
): TrialResult {
  const optionLists = groups.map((group) => (group.required ? [...group.itemIds] : [...group.itemIds, null]));
  const totalCount = optionLists.reduce((total, options) => Math.min(total * options.length, Number.MAX_SAFE_INTEGER), 1);
  const byId = new Map(items.map((item) => [item.id, item]));
  const groupedIds = new Set(groups.flatMap((group) => group.itemIds));
  const fixedItems = items.filter((item) => !groupedIds.has(item.id));
  const candidates: TrialCandidate[] = [];
  let evaluatedCount = 0;

  for (const combo of combinationsOf(optionLists)) {
    if (evaluatedCount >= budget) break;
    evaluatedCount += 1;
    const selection = combo.map<AlternativeSelection>((itemId, index) => ({ groupId: groups[index].id, itemId }));
    const chosenItems = selection
      .filter((entry) => entry.itemId !== null)
      .map((entry) => byId.get(entry.itemId as string))
      .filter((item): item is PackingItem => !!item);
    const trialItems = [...fixedItems, ...chosenItems].map((item) => ({ ...item }));
    const plan = packItems(suitcase, trialItems, mode);
    const placedIds = new Set(plan.placements.map((placement) => placement.itemId));

    let requiredSatisfied = 0;
    let requiredTotal = 0;
    const unsatisfiedGroups: string[] = [];
    groups.forEach((group, index) => {
      if (!group.required) return;
      requiredTotal += 1;
      const chosen = combo[index];
      if (chosen && placedIds.has(chosen)) requiredSatisfied += 1;
      else unsatisfiedGroups.push(group.name);
    });
    const mustHaveItems = trialItems.filter((item) => item.mustHave);
    const preferenceScore = groups.reduce((score, group, index) => {
      const chosen = combo[index];
      return chosen ? score + group.itemIds.length - group.itemIds.indexOf(chosen) : score;
    }, 0);

    candidates.push({
      selection,
      plan,
      requiredSatisfied,
      requiredTotal,
      mustHavePlaced: mustHaveItems.filter((item) => placedIds.has(item.id)).length,
      mustHaveTotal: mustHaveItems.length,
      preferenceScore,
      weightMargin: suitcase.maxWeight - plan.totalWeight,
      unsatisfiedGroups,
    });
  }

  candidates.sort(compareCandidates);
  const recommended = candidates[0] ?? null;
  if (recommended) {
    for (const candidate of candidates.slice(1)) candidate.dropReason = explainDrop(candidate, recommended);
  }

  return {
    id: `trial-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    mode,
    fingerprint: fingerprintOf(suitcase, items, groups),
    exhaustive: evaluatedCount >= totalCount,
    evaluatedCount,
    totalCount,
    recommended,
    candidates,
    complete: recommended ? recommended.unsatisfiedGroups.length === 0 : false,
    unsatisfiedGroups: recommended ? recommended.unsatisfiedGroups : groups.filter((group) => group.required).map((group) => group.name),
  };
}
