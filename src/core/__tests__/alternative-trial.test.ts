import { describe, expect, it } from 'vitest';
import { alternativeFingerprint, resolveSelection, trialAlternatives } from '../alternative-trial';
import type { AlternativeGroup, PackingItem, Suitcase } from '../models';

const box: Suitcase = { length: 10, width: 10, height: 10, maxWeight: 10 };
const item = (id: string, overrides: Partial<PackingItem> = {}): PackingItem => ({
  id, name: id, category: '衣物', length: 4, width: 2, height: 2, weight: 1, priority: 1, mustHave: false, ...overrides,
});
const group = (id: string, required: boolean, ...itemIds: string[]): AlternativeGroup => ({
  id, name: id, required, members: itemIds.map((itemId, index) => ({ itemId, preference: index + 1 })),
});

describe('trialAlternatives', () => {
  it('selects at most one item per group and prefers the most preferred member', () => {
    const result = trialAlternatives(box, [item('thin'), item('thick')], [group('g1', true, 'thin', 'thick')], 'comfort');
    expect(result.exhaustive).toBe(true);
    expect(result.recommended?.choices).toEqual([{ groupId: 'g1', itemId: 'thin' }]);
    expect(result.recommended?.requiredSatisfied).toBe(1);
    expect(result.unsatisfiedGroups).toEqual([]);
  });

  it('falls back to a less preferred member when the preferred one cannot fit', () => {
    const items = [item('thin', { length: 20 }), item('thick')];
    const result = trialAlternatives(box, items, [group('g1', true, 'thin', 'thick')], 'comfort');
    expect(result.recommended?.choices).toEqual([{ groupId: 'g1', itemId: 'thick' }]);
    expect(result.recommended?.requiredSatisfied).toBe(1);
  });

  it('ranks required-group satisfaction above user preference', () => {
    // g1 最偏好的 oversized 装不下；g2 可选。推荐必须满足必带组，而不是追求偏好得分
    const items = [item('oversized', { length: 20 }), item('fits'), item('bonus')];
    const groups = [group('g1', true, 'oversized', 'fits'), group('g2', false, 'bonus')];
    const result = trialAlternatives(box, items, groups, 'comfort');
    expect(result.recommended?.choices).toContainEqual({ groupId: 'g1', itemId: 'fits' });
    expect(result.recommended?.requiredSatisfied).toBe(1);
    const rejected = result.rejected.find((candidate) => candidate.choices.some((choice) => choice.itemId === 'oversized'));
    expect(rejected?.reason).toContain('必带组');
  });

  it('marks unsatisfied required groups when no member can be packed', () => {
    const items = [item('huge-a', { length: 20 }), item('huge-b', { length: 30 })];
    const result = trialAlternatives(box, items, [group('g1', true, 'huge-a', 'huge-b')], 'comfort');
    expect(result.recommended?.requiredSatisfied).toBe(0);
    expect(result.unsatisfiedGroups).toEqual(['g1']);
  });

  it('breaks preference ties by larger weight margin', () => {
    // 两个可选组各一件，同时装会超空间；选轻的重量余量更大
    const items = [item('heavy', { length: 10, width: 10, height: 6, weight: 3 }), item('light', { length: 10, width: 10, height: 6, weight: 1 })];
    const result = trialAlternatives(box, items, [group('g1', false, 'heavy'), group('g2', false, 'light')], 'comfort');
    expect(result.recommended?.choices).toContainEqual({ groupId: 'g2', itemId: 'light' });
    expect(result.recommended?.weightMargin).toBeCloseTo(9, 5);
    const rejected = result.rejected.find((candidate) => candidate.choices.some((choice) => choice.itemId === 'heavy' && !candidate.choices.some((other) => other.itemId === 'light')));
    expect(rejected?.reason).toContain('重量余量');
  });

  it('stops at the combination budget without claiming an exhaustive result', () => {
    const items = Array.from({ length: 24 }, (_, index) => item(`item-${index}`));
    const groups = Array.from({ length: 8 }, (_, index) => group(`g${index}`, false, `item-${index * 3}`, `item-${index * 3 + 1}`, `item-${index * 3 + 2}`));
    const result = trialAlternatives(box, items, groups, 'comfort', 50);
    expect(result.totalCombinations).toBe(4 ** 8);
    expect(result.evaluated).toBe(50);
    expect(result.exhaustive).toBe(false);
    expect(result.recommended).not.toBeNull();
  });

  it('works on independent copies and never mutates the original list', () => {
    const items = [item('a'), item('b')];
    const groups = [group('g1', true, 'a', 'b')];
    const snapshot = JSON.stringify(items);
    const result = trialAlternatives(box, items, groups, 'comfort');
    expect(JSON.stringify(items)).toBe(snapshot);
    const resolved = resolveSelection(items, groups, result.recommended!.choices);
    expect(resolved).toHaveLength(1);
    expect(resolved[0]).not.toBe(items[0]);
    expect(resolved[0]).toEqual(items[0]);
  });
});

describe('alternativeFingerprint', () => {
  it('changes when items, groups or suitcase change', () => {
    const base = alternativeFingerprint(box, [item('a')], [group('g1', false, 'a')]);
    expect(alternativeFingerprint(box, [item('a', { weight: 2 })], [group('g1', false, 'a')])).not.toBe(base);
    expect(alternativeFingerprint(box, [item('a')], [group('g1', true, 'a')])).not.toBe(base);
    expect(alternativeFingerprint({ ...box, maxWeight: 12 }, [item('a')], [group('g1', false, 'a')])).not.toBe(base);
    expect(alternativeFingerprint(box, [item('a')], [group('g1', false, 'a')])).toBe(base);
  });
});
