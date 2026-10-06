import { describe, expect, it } from 'vitest';
import { createSampleSnapshot } from '../../core/sample-data';
import { usePlanner } from '../usePlanner';
import type { PackingSnapshot } from '../../core/models';
import type { PlannerRepository } from '../../ports/planner-repository.port';

class MemoryRepository implements PlannerRepository {
  saved?: PackingSnapshot;
  constructor(private snapshot = createSampleSnapshot()) {}
  load() { return { value: structuredClone(this.snapshot) }; }
  save(snapshot: PackingSnapshot) { this.saved = structuredClone(snapshot); }
}

describe('usePlanner', () => {
  it('adds, updates and removes items while marking results stale', () => {
    const repository = new MemoryRepository();
    const planner = usePlanner({ repository, printPort: { print() {} } });
    const initial = planner.state.items.length;
    planner.addItem({ id: 'new', name: '帽子', category: '衣物', length: 12, width: 12, height: 5, weight: 0.2, priority: 2, mustHave: false });
    expect(planner.state.items).toHaveLength(initial + 1);
    expect(planner.isStale.value).toBe(true);
    planner.updateItem('new', { name: '遮阳帽' });
    expect(planner.state.items.find((item) => item.id === 'new')?.name).toBe('遮阳帽');
    planner.removeItem('new');
    expect(planner.state.items).toHaveLength(initial);
  });

  it('regenerates plans and persists the selected mode', () => {
    const repository = new MemoryRepository();
    const planner = usePlanner({ repository, printPort: { print() {} } });
    planner.updateSuitcase({ maxWeight: 12 });
    expect(planner.isStale.value).toBe(true);
    planner.regenerate();
    planner.selectPlan('shopping');
    expect(planner.isStale.value).toBe(false);
    expect(planner.plans.value.shopping.name).toBe('购物版');
    expect(repository.saved?.selectedPlan).toBe('shopping');
  });

  it('keeps a group required while any member is marked must-have', () => {
    const planner = usePlanner({ repository: new MemoryRepository(), printPort: { print() {} } });
    planner.addGroup('外套组合');
    const groupId = planner.state.alternativeGroups[0].id;
    planner.addItemToGroup(groupId, 'jacket'); // 示例中 jacket 已标必带
    expect(planner.state.alternativeGroups[0].required).toBe(true);
    planner.setGroupRequired(groupId, false);
    expect(planner.state.alternativeGroups[0].required).toBe(true);
    expect(planner.notice.value).toContain('必带');
  });

  it('forces the group required when a member becomes must-have', () => {
    const planner = usePlanner({ repository: new MemoryRepository(), printPort: { print() {} } });
    planner.addGroup('数码组合');
    const groupId = planner.state.alternativeGroups[0].id;
    planner.addItemToGroup(groupId, 'camera');
    expect(planner.state.alternativeGroups[0].required).toBe(false);
    planner.updateItem('camera', { mustHave: true });
    expect(planner.state.alternativeGroups[0].required).toBe(true);
  });

  it('confirms a trial and applies the selection to all three plans', () => {
    const repository = new MemoryRepository();
    const planner = usePlanner({ repository, printPort: { print() {} } });
    planner.addGroup('随身二选一');
    const groupId = planner.state.alternativeGroups[0].id;
    planner.addItemToGroup(groupId, 'camera');
    planner.addItemToGroup(groupId, 'book');
    planner.runTrial();
    expect(planner.state.alternativeTrial?.recommended?.choices).toEqual([{ groupId, itemId: 'camera' }]);
    planner.confirmTrial();
    expect(planner.state.alternativeTrial?.confirmed).toBe(true);
    for (const mode of ['minimal', 'comfort', 'shopping'] as const) {
      const placed = planner.plans.value[mode].placements.map((placement) => placement.itemId);
      expect(placed).toContain('camera');
      expect(placed).not.toContain('book');
    }
    expect(repository.saved?.alternativeTrial?.confirmed).toBe(true);
  });

  it('invalidates the saved recommendation once the list changes', () => {
    const planner = usePlanner({ repository: new MemoryRepository(), printPort: { print() {} } });
    planner.addGroup('随身二选一');
    const groupId = planner.state.alternativeGroups[0].id;
    planner.addItemToGroup(groupId, 'camera');
    planner.addItemToGroup(groupId, 'book');
    planner.runTrial();
    planner.confirmTrial();
    expect(planner.trialInvalid.value).toBe(false);
    planner.addItem({ id: 'hat', name: '帽子', category: '衣物', length: 12, width: 12, height: 5, weight: 0.2, priority: 2, mustHave: false });
    expect(planner.trialInvalid.value).toBe(true);
    planner.confirmTrial();
    expect(planner.notice.value).toContain('失效');
  });

  it('removes deleted items from their groups and resequences preferences', () => {
    const planner = usePlanner({ repository: new MemoryRepository(), printPort: { print() {} } });
    planner.addGroup('随身二选一');
    const groupId = planner.state.alternativeGroups[0].id;
    planner.addItemToGroup(groupId, 'camera');
    planner.addItemToGroup(groupId, 'book');
    planner.removeItem('camera');
    expect(planner.state.alternativeGroups[0].members).toEqual([{ itemId: 'book', preference: 1 }]);
  });
});
