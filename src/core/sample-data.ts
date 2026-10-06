import type { PackingItem, PackingSnapshot } from './models';

const seed = (id: string, name: string, category: string, dimensions: [number, number, number], weight: number, priority: 1 | 2 | 3, mustHave = false, fragile = false): PackingItem => ({
  id, name, category, length: dimensions[0], width: dimensions[1], height: dimensions[2], weight, priority, mustHave, fragile,
});

export function createSampleSnapshot(): PackingSnapshot {
  return {
    suitcase: { length: 52, width: 35, height: 23, maxWeight: 10 },
    selectedPlan: 'comfort',
    items: [
      seed('jacket', '轻薄外套', '衣物', [30, 24, 5], 0.65, 3, true),
      seed('coat-heavy', '厚外套', '衣物', [32, 26, 8], 1.1, 2),
      seed('shoes', '运动鞋', '鞋履', [31, 20, 12], 0.9, 3, true),
      seed('camera', '微单相机', '数码', [18, 14, 10], 0.72, 2, false, true),
      seed('phone-rig', '手机拍摄配件', '数码', [16, 10, 6], 0.3, 1),
      seed('toiletry', '洗漱包', '洗护', [22, 14, 8], 0.48, 3, true),
      seed('book', '旅行读物', '随身', [21, 15, 2], 0.38, 1),
      seed('gifts', '伴手礼预留盒', '预留', [24, 18, 9], 0.2, 1),
    ],
    alternativeGroups: [
      { id: 'grp-outerwear', name: '外套二选一', itemIds: ['jacket', 'coat-heavy'], required: true },
      { id: 'grp-photo', name: '拍照设备', itemIds: ['camera', 'phone-rig'], required: false },
    ],
    alternativeSelection: [
      { groupId: 'grp-outerwear', itemId: 'jacket' },
      { groupId: 'grp-photo', itemId: 'camera' },
    ],
  };
}
