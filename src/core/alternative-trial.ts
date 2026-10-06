import { packItems } from './packing-engine';
import type {
  AlternativeCandidate,
  AlternativeChoice,
  AlternativeGroup,
  AlternativeTrial,
  PackingItem,
  PlanMode,
  Suitcase,
} from './models';

/** 组合评估预算：超过该数量时提前停止，只返回已找到的可行方案 */
export const TRIAL_BUDGET = 200;
const MAX_KEPT_CANDIDATES = 4;

/**
 * 清单指纹：覆盖行李箱、物品与替代分组。
 * 任何一处变化都会改变指纹，使已保存的推荐失效。
 */
export function alternativeFingerprint(suitcase: Suitcase, items: PackingItem[], groups: AlternativeGroup[]): string {
  const payload = JSON.stringify({
    suitcase,
    items: items
      .map((item) => [item.id, item.length, item.width, item.height, item.weight, item.priority, Number(item.mustHave)].join(','))
      .sort(),
    groups: groups.map((group) => [
      group.id,
      Number(group.required),
      ...group.members.map((member) => `${member.itemId}:${member.preference}`),
    ].join(',')),
  });
  let hash = 5381;
  for (let index = 0; index < payload.length; index += 1) {
    hash = ((hash << 5) + hash + payload.charCodeAt(index)) >>> 0;
  }
  return hash.toString(16);
}

/**
 * 按选择解析出待装清单。返回当前清单的独立副本，
 * 试算与正式装箱都不会改动原始物品数组。
 */
export function resolveSelection(items: PackingItem[], groups: AlternativeGroup[], choices: AlternativeChoice[]): PackingItem[] {
  const chosen = new Set(choices.map((choice) => choice.itemId).filter((id): id is string => id !== null));
  const grouped = new Set(groups.flatMap((group) => group.members.map((member) => member.itemId)));
  return items
    .filter((item) => !grouped.has(item.id) || chosen.has(item.id))
    .map((item) => ({ ...item }));
}

interface ScoredCandidate extends AlternativeCandidate {
  key: string;
  unsatisfied: string[];
}

function compareCandidates(a: ScoredCandidate, b: ScoredCandidate): number {
  // 先比必带满足，再比用户偏好，最后比重量余量
  return b.requiredSatisfied - a.requiredSatisfied
    || b.preferenceScore - a.preferenceScore
    || b.weightMargin - a.weightMargin
    || a.key.localeCompare(b.key);
}

function rejectionReason(candidate: ScoredCandidate, recommended: ScoredCandidate): string {
  if (candidate.requiredSatisfied !== recommended.requiredSatisfied) {
    return `必带组仅满足 ${candidate.requiredSatisfied}/${candidate.requiredTotal}，少于推荐方案的 ${recommended.requiredSatisfied}/${recommended.requiredTotal}`;
  }
  if (candidate.preferenceScore !== recommended.preferenceScore) {
    return `组内偏好得分 ${candidate.preferenceScore}，低于推荐方案的 ${recommended.preferenceScore}`;
  }
  if (candidate.weightMargin !== recommended.weightMargin) {
    return `重量余量 ${candidate.weightMargin.toFixed(2)} kg，小于推荐方案的 ${recommended.weightMargin.toFixed(2)} kg`;
  }
  return '各项指标与推荐方案相同，按确定顺序靠后';
}

export function trialAlternatives(
  suitcase: Suitcase,
  items: PackingItem[],
  groups: AlternativeGroup[],
  mode: PlanMode,
  budget = TRIAL_BUDGET,
): AlternativeTrial {
  const fingerprint = alternativeFingerprint(suitcase, items, groups);
  const active = groups.filter((group) => group.members.length > 0);
  const requiredTotal = active.filter((group) => group.required).length;
  // 每组最多选一件；可选组额外提供“不携带”选项。选项按组内偏好排序，
  // 超出预算提前停止时，已评估的都是更受偏好的组合。
  const options = active.map((group) => {
    const ids: Array<string | null> = [...group.members]
      .sort((a, b) => a.preference - b.preference)
      .map((member) => member.itemId);
    return group.required ? ids : [...ids, null];
  });
  const totalCombinations = options.reduce((total, groupOptions) => total * groupOptions.length, 1);

  const kept: ScoredCandidate[] = [];
  let evaluated = 0;
  const indices = options.map(() => 0);

  for (;;) {
    if (evaluated >= budget) break;
    const choices: AlternativeChoice[] = indices.map((optionIndex, groupIndex) => ({
      groupId: active[groupIndex].id,
      itemId: options[groupIndex][optionIndex],
    }));

    const plan = packItems(suitcase, resolveSelection(items, active, choices), mode);
    const placed = new Set(plan.placements.map((placement) => placement.itemId));
    const unsatisfied: string[] = [];
    let requiredSatisfied = 0;
    let preferenceScore = 0;
    for (const group of active) {
      const satisfied = group.members.some((member) => placed.has(member.itemId));
      if (group.required) {
        if (satisfied) requiredSatisfied += 1;
        else unsatisfied.push(group.name);
      }
      const chosen = group.members.find((member) => member.itemId === choices.find((choice) => choice.groupId === group.id)?.itemId);
      if (chosen && placed.has(chosen.itemId)) preferenceScore += group.members.length - chosen.preference + 1;
    }
    const candidate: ScoredCandidate = {
      choices,
      requiredSatisfied,
      requiredTotal,
      preferenceScore,
      weightMargin: Math.round((suitcase.maxWeight - plan.totalWeight) * 1000) / 1000,
      reason: '',
      key: choices.map((choice) => `${choice.groupId}:${choice.itemId ?? '-'}`).join('|'),
      unsatisfied,
    };
    const position = kept.findIndex((existing) => compareCandidates(candidate, existing) < 0);
    if (position >= 0) kept.splice(position, 0, candidate);
    else kept.push(candidate);
    if (kept.length > MAX_KEPT_CANDIDATES) kept.pop();
    evaluated += 1;

    let cursor = indices.length - 1;
    while (cursor >= 0) {
      indices[cursor] += 1;
      if (indices[cursor] < options[cursor].length) break;
      indices[cursor] = 0;
      cursor -= 1;
    }
    if (cursor < 0) break;
  }

  const [best, ...rest] = kept;
  const recommended: AlternativeCandidate | null = best ? {
    choices: best.choices,
    requiredSatisfied: best.requiredSatisfied,
    requiredTotal: best.requiredTotal,
    preferenceScore: best.preferenceScore,
    weightMargin: best.weightMargin,
    reason: `必带组满足 ${best.requiredSatisfied}/${best.requiredTotal} · 偏好得分 ${best.preferenceScore} · 重量余量 ${best.weightMargin.toFixed(2)} kg`,
  } : null;

  return {
    fingerprint,
    mode,
    exhaustive: evaluated >= totalCombinations,
    evaluated,
    totalCombinations,
    recommended,
    rejected: rest.map((candidate) => ({
      choices: candidate.choices,
      requiredSatisfied: candidate.requiredSatisfied,
      requiredTotal: candidate.requiredTotal,
      preferenceScore: candidate.preferenceScore,
      weightMargin: candidate.weightMargin,
      reason: rejectionReason(candidate, best),
    })),
    unsatisfiedGroups: best?.unsatisfied ?? [],
    confirmed: false,
  };
}
