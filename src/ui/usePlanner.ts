import { computed, reactive, ref } from 'vue';
import { createSampleSnapshot } from '../core/sample-data';
import { generatePlans } from '../core/plan-service';
import { detectRisks } from '../core/risk-engine';
import { alternativeFingerprint, resolveSelection, trialAlternatives } from '../core/alternative-trial';
import type { AlternativeGroup, PackingItem, PackingSnapshot, PlanMode, Suitcase } from '../core/models';
import type { PlannerRepository } from '../ports/planner-repository.port';
import type { PrintPort } from '../ports/print.port';

export interface PlannerDependencies { repository: PlannerRepository; printPort: PrintPort }

function resequence(group: AlternativeGroup) {
  [...group.members]
    .sort((a, b) => a.preference - b.preference)
    .forEach((member, index) => { member.preference = index + 1; });
}

export function usePlanner({ repository, printPort }: PlannerDependencies) {
  const loaded = repository.load();
  const state = reactive<PackingSnapshot>(loaded.value);
  const notice = ref(loaded.warning ?? '');
  const isStale = ref(false);

  /** 清单（物品、分组、行李箱）变化后，已保存的推荐即失效 */
  const trialInvalid = computed(() => !!state.alternativeTrial
    && state.alternativeTrial.fingerprint !== alternativeFingerprint(state.suitcase, state.items, state.alternativeGroups));

  /** 已确认且未失效的推荐会替换各组物品；否则使用原始清单 */
  function effectiveItems(): PackingItem[] {
    const trial = state.alternativeTrial;
    if (trial?.confirmed && trial.recommended && !trialInvalid.value) {
      return resolveSelection(state.items, state.alternativeGroups, trial.recommended.choices);
    }
    return state.items;
  }

  const plans = ref(generatePlans(state.suitcase, effectiveItems()));
  const currentPlan = computed(() => plans.value[state.selectedPlan]);
  const risks = computed(() => detectRisks(currentPlan.value, state.suitcase, state.items));

  const save = () => repository.save(JSON.parse(JSON.stringify(state)) as PackingSnapshot);
  const markStale = () => { isStale.value = true; save(); };

  function addItem(item: PackingItem) { state.items.push(item); markStale(); }
  function updateItem(id: string, patch: Partial<PackingItem>) {
    const index = state.items.findIndex((item) => item.id === id);
    if (index >= 0) state.items[index] = { ...state.items[index], ...patch } as PackingItem;
    if (patch.mustHave) {
      // 单件已标必带时，所在组不得保持可选
      const group = state.alternativeGroups.find((entry) => entry.members.some((member) => member.itemId === id));
      if (group && !group.required) group.required = true;
    }
    markStale();
  }
  function removeItem(id: string) {
    state.items = state.items.filter((item) => item.id !== id);
    for (const group of state.alternativeGroups) {
      group.members = group.members.filter((member) => member.itemId !== id);
      resequence(group);
    }
    markStale();
  }
  function updateSuitcase(patch: Partial<Suitcase>) { Object.assign(state.suitcase, patch); markStale(); }
  function regenerate() { plans.value = generatePlans(state.suitcase, effectiveItems()); isStale.value = false; notice.value = '三套方案已重新计算'; save(); }
  function selectPlan(mode: PlanMode) { state.selectedPlan = mode; save(); }
  function resetSample() {
    const sample = createSampleSnapshot();
    Object.assign(state, sample);
    plans.value = generatePlans(state.suitcase, state.items);
    isStale.value = false;
    notice.value = '已恢复登机箱示例';
    save();
  }

  function addGroup(name: string) {
    state.alternativeGroups.push({
      id: `group-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: name.trim() || '未命名组合',
      required: false,
      members: [],
    });
    markStale();
  }
  function removeGroup(id: string) {
    state.alternativeGroups = state.alternativeGroups.filter((group) => group.id !== id);
    markStale();
  }
  function setGroupRequired(id: string, required: boolean) {
    const group = state.alternativeGroups.find((entry) => entry.id === id);
    if (!group) return;
    if (!required && group.members.some((member) => state.items.find((item) => item.id === member.itemId)?.mustHave)) {
      notice.value = '组内存在已标必带的物品，该组不能改为可选';
      return;
    }
    group.required = required;
    markStale();
  }
  function addItemToGroup(groupId: string, itemId: string) {
    const group = state.alternativeGroups.find((entry) => entry.id === groupId);
    const item = state.items.find((entry) => entry.id === itemId);
    if (!group || !item) return;
    // 一件物品最多归属一个组
    for (const entry of state.alternativeGroups) {
      entry.members = entry.members.filter((member) => member.itemId !== itemId);
      resequence(entry);
    }
    group.members.push({ itemId, preference: group.members.length + 1 });
    if (item.mustHave) group.required = true;
    markStale();
  }
  function removeFromGroup(groupId: string, itemId: string) {
    const group = state.alternativeGroups.find((entry) => entry.id === groupId);
    if (!group) return;
    group.members = group.members.filter((member) => member.itemId !== itemId);
    resequence(group);
    markStale();
  }
  function moveMember(groupId: string, itemId: string, delta: number) {
    const group = state.alternativeGroups.find((entry) => entry.id === groupId);
    if (!group) return;
    const ordered = [...group.members].sort((a, b) => a.preference - b.preference);
    const index = ordered.findIndex((member) => member.itemId === itemId);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= ordered.length) return;
    [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
    ordered.forEach((member, position) => { member.preference = position + 1; });
    markStale();
  }

  function runTrial() {
    if (!state.alternativeGroups.some((group) => group.members.length > 0)) {
      notice.value = '请先创建替代组合并加入物品';
      return;
    }
    state.alternativeTrial = trialAlternatives(state.suitcase, state.items, state.alternativeGroups, state.selectedPlan);
    notice.value = state.alternativeTrial.exhaustive ? '替代组合试算完成' : '组合数超出预算，已返回预算内最优可行方案';
    save();
  }
  function confirmTrial() {
    const trial = state.alternativeTrial;
    if (!trial?.recommended) return;
    if (trialInvalid.value) {
      notice.value = '清单已变化，旧推荐已失效，请重新试算';
      return;
    }
    trial.confirmed = true;
    plans.value = generatePlans(state.suitcase, effectiveItems());
    isStale.value = false;
    notice.value = '已采用推荐组合，三套方案已据此生成';
    save();
  }

  return {
    state, notice, isStale, plans, currentPlan, risks, trialInvalid,
    addItem, updateItem, removeItem, updateSuitcase, regenerate, selectPlan, resetSample,
    addGroup, removeGroup, setGroupRequired, addItemToGroup, removeFromGroup, moveMember,
    runTrial, confirmTrial,
    print: () => printPort.print(),
  };
}
