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

export interface AlternativeGroupMember {
  itemId: string;
  /** 组内偏好，1 表示最偏好 */
  preference: number;
}

export interface AlternativeGroup {
  id: string;
  name: string;
  /** true = 必带组（必须实际装入一件），false = 可选组 */
  required: boolean;
  members: AlternativeGroupMember[];
}

export interface AlternativeChoice {
  groupId: string;
  /** null 表示该可选组不携带任何物品 */
  itemId: string | null;
}

export interface AlternativeCandidate {
  choices: AlternativeChoice[];
  requiredSatisfied: number;
  requiredTotal: number;
  preferenceScore: number;
  weightMargin: number;
  reason: string;
}

export interface AlternativeTrial {
  /** 试算时清单的指纹，清单变化后旧推荐失效 */
  fingerprint: string;
  mode: PlanMode;
  /** false 表示组合数超出预算，结果只是预算内最优可行方案，并非全局最优 */
  exhaustive: boolean;
  evaluated: number;
  totalCombinations: number;
  recommended: AlternativeCandidate | null;
  rejected: AlternativeCandidate[];
  /** 推荐方案中仍未满足的必带组名称 */
  unsatisfiedGroups: string[];
  confirmed: boolean;
}

export interface PackingSnapshot {
  suitcase: Suitcase;
  items: PackingItem[];
  selectedPlan: PlanMode;
  alternativeGroups: AlternativeGroup[];
  alternativeTrial: AlternativeTrial | null;
}

export function itemVolume(item: Dimensions): number {
  return item.length * item.width * item.height;
}

export function suitcaseVolume(suitcase: Dimensions): number {
  return suitcase.length * suitcase.width * suitcase.height;
}
