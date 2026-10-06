import { computed, reactive, ref } from 'vue';
import { createSampleSnapshot } from '../core/sample-data';
import { generatePlans } from '../core/plan-service';
import { detectRisks } from '../core/risk-engine';
import { normalizeSnapshot } from '../core/snapshot';
import { effectiveItems, evaluateAlternatives, fingerprintOf, pruneGroups, validateGroupDraft } from '../core/alternative-engine';
import type { AlternativeGroup, PackingItem, PackingSnapshot, PlanMode, Suitcase, TrialResult } from '../core/models';
import type { PlannerRepository } from '../ports/planner-repository.port';
import type { PrintPort } from '../ports/print.port';

export interface PlannerDependencies { repository: PlannerRepository; printPort: PrintPort }

export function usePlanner({ repository, printPort }: PlannerDependencies) {
  const loaded = repository.load();
  const state = reactive<PackingSnapshot>(normalizeSnapshot(loaded.value));
  const notice = ref(loaded.warning ?? '');
  const isStale = ref(false);
  const trial = ref<TrialResult | null>(null);
  const packingItems = computed(() => effectiveItems(state.items, state.alternativeGroups, state.alternativeSelection));
  const plans = ref(generatePlans(state.suitcase, packingItems.value));
  const currentPlan = computed(() => plans.value[state.selectedPlan]);
  const risks = computed(() => detectRisks(currentPlan.value, state.suitcase, packingItems.value));
  const trialStale = computed(() => !!trial.value && trial.value.fingerprint !== fingerprintOf(state.suitcase, state.items, state.alternativeGroups));

  const save = () => repository.save(JSON.parse(JSON.stringify(state)) as PackingSnapshot);
  const markStale = () => { isStale.value = true; save(); };

  function addItem(item: PackingItem) { state.items.push(item); markStale(); }
  function updateItem(id: string, patch: Partial<PackingItem>) {
    const index = state.items.findIndex((item) => item.id === id);
    if (index >= 0) state.items[index] = { ...state.items[index], ...patch } as PackingItem;
    if (patch.mustHave) {
      for (const group of state.alternativeGroups) {
        if (!group.required && group.itemIds.includes(id)) {
          group.required = true;
          notice.value = `「${group.name}」包含必带物品，已自动调整为必带组`;
        }
      }
    }
    markStale();
  }
  function removeItem(id: string) {
    state.items = state.items.filter((item) => item.id !== id);
    const pruned = pruneGroups(state.alternativeGroups, state.alternativeSelection, state.items);
    state.alternativeGroups = pruned.groups;
    state.alternativeSelection = pruned.selection;
    if (pruned.dissolved.length) notice.value = `分组「${pruned.dissolved.join('」「')}」成员不足两件，已解散`;
    markStale();
  }
  function updateSuitcase(patch: Partial<Suitcase>) { Object.assign(state.suitcase, patch); markStale(); }
  function regenerate() { plans.value = generatePlans(state.suitcase, packingItems.value); isStale.value = false; notice.value = '三套方案已重新计算'; save(); }
  function selectPlan(mode: PlanMode) { state.selectedPlan = mode; save(); }

  function saveGroup(draft: AlternativeGroup): string[] {
    const errors = validateGroupDraft(draft, state.items, state.alternativeGroups);
    if (errors.length) { notice.value = errors[0]; return errors; }
    const clean: AlternativeGroup = { ...draft, name: draft.name.trim(), itemIds: [...draft.itemIds] };
    const index = state.alternativeGroups.findIndex((group) => group.id === draft.id);
    if (index >= 0) state.alternativeGroups[index] = clean;
    else state.alternativeGroups.push(clean);
    state.alternativeSelection = pruneGroups(state.alternativeGroups, state.alternativeSelection, state.items).selection;
    markStale();
    return [];
  }
  function removeGroup(id: string) {
    state.alternativeGroups = state.alternativeGroups.filter((group) => group.id !== id);
    state.alternativeSelection = state.alternativeSelection.filter((entry) => entry.groupId !== id);
    markStale();
  }
  function runTrial() {
    if (!state.alternativeGroups.length) { notice.value = '请先创建替代分组再试算'; return; }
    trial.value = evaluateAlternatives(state.suitcase, state.items, state.alternativeGroups, state.selectedPlan);
    notice.value = trial.value.complete ? '试算完成，已给出推荐组合' : '试算完成，仍有必带组未满足';
  }
  function confirmTrial() {
    const result = trial.value;
    if (!result || !result.recommended || trialStale.value) return;
    state.alternativeSelection = result.recommended.selection.map((entry) => ({ ...entry }));
    plans.value = generatePlans(state.suitcase, packingItems.value);
    isStale.value = false;
    notice.value = '已保存分组与本次选择，三套方案已据此更新';
    save();
  }
  function resetSample() {
    const sample = createSampleSnapshot();
    Object.assign(state, sample);
    trial.value = null;
    plans.value = generatePlans(state.suitcase, packingItems.value);
    isStale.value = false;
    notice.value = '已恢复登机箱示例';
    save();
  }

  return { state, notice, isStale, plans, currentPlan, risks, trial, trialStale, packingItems, addItem, updateItem, removeItem, updateSuitcase, regenerate, selectPlan, saveGroup, removeGroup, runTrial, confirmTrial, resetSample, print: () => printPort.print() };
}
