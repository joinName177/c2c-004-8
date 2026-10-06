export type Dimensions = Readonly<{ length: number; width: number; height: number }>;
export type PlanMode = 'minimal' | 'comfort' | 'shopping';
export type RiskSeverity = 'critical' | 'warning' | 'info';

export interface Suitcase extends Dimensions {
  maxWeight: number;
}

export interface PackingItem extends Dimensions {
  id: string;
  name: string;
  category: string;
  weight: number;
  priority: 1 | 2 | 3;
  mustHave: boolean;
  fragile?: boolean;
}

export interface Placement {
  itemId: string;
  x: number;
  y: number;
  z: number;
  dimensions: Dimensions;
}

export interface PackingPlan {
  id: PlanMode;
  name: string;
  placements: Placement[];
  unplaced: Array<{ item: PackingItem; reason: string }>;
  totalWeight: number;
  usedVolume: number;
  capacityRatio: number;
}

export interface Risk {
  id: string;
  severity: RiskSeverity;
  title: string;
  message: string;
  itemId?: string;
}

export interface AlternativeGroup {
  id: string;
  name: string;
  /** 组内物品按偏好从强到弱排列，装箱时每组最多选一件 */
  itemIds: string[];
  /** 必带组必须有一件实际装入；可选组允许一件都不带 */
  required: boolean;
}

export interface AlternativeSelection {
  groupId: string;
  /** 选中的物品；null 表示该可选组本次不携带 */
  itemId: string | null;
}

export interface TrialCandidate {
  selection: AlternativeSelection[];
  plan: PackingPlan;
  requiredSatisfied: number;
  requiredTotal: number;
  mustHavePlaced: number;
  mustHaveTotal: number;
  preferenceScore: number;
  weightMargin: number;
  unsatisfiedGroups: string[];
  /** 非推荐方案被放弃的原因 */
  dropReason?: string;
}

export interface TrialResult {
  id: string;
  mode: PlanMode;
  /** 试算时清单、分组与行李箱的指纹，用于检测推荐是否失效 */
  fingerprint: string;
  /** false 表示达到计算预算，结果只是已找到的最优可行方案而非全局最优 */
  exhaustive: boolean;
  evaluatedCount: number;
  totalCount: number;
  recommended: TrialCandidate | null;
  candidates: TrialCandidate[];
  complete: boolean;
  unsatisfiedGroups: string[];
}

export interface PackingSnapshot {
  suitcase: Suitcase;
  items: PackingItem[];
  selectedPlan: PlanMode;
  alternativeGroups: AlternativeGroup[];
  alternativeSelection: AlternativeSelection[];
}

export function itemVolume(item: Dimensions): number {
  return item.length * item.width * item.height;
}

export function suitcaseVolume(suitcase: Dimensions): number {
  return suitcase.length * suitcase.width * suitcase.height;
}
