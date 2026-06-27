import { db, ValidationError } from './db.js';
import {
  sanitizeName, sanitizeProductId, sanitizeMoney, sanitizeQuantity, sanitizeRecipeQuantity,
} from './validators.js';
import { weekStartISO, todayISO } from './utils.js';

const DEFAULT_RECIPE_YIELD = 1;

export const RECIPE_WEIGHT_UNITS = [
  { id: 'kg', label: 'ק"ג' },
  { id: 'g', label: 'גרם' },
];

function roundQty(n) {
  return Math.round(n * 1000) / 1000;
}

export function formatRecipeQuantity(qty) {
  const n = Number(qty);
  if (!Number.isFinite(n)) return '—';
  const r = roundQty(n);
  if (Math.abs(r - Math.round(r * 100) / 100) > 0.0004) return r.toFixed(3);
  if (Math.abs(r - Math.round(r * 10) / 10) > 0.004) return r.toFixed(2);
  if (Math.abs(r - Math.round(r)) > 0.04) return r.toFixed(1);
  return String(Math.round(r));
}

export function normalizeRecipeUnitKind(unit) {
  const u = String(unit || '').trim().toLowerCase();
  if (u === 'g' || u === 'gr' || u === 'גרם' || u === "ג'" || u === 'ג׳') return 'g';
  if (u === 'l' || u.includes('ליטר') || u === "ל'" || u === 'ל׳') return 'l';
  if (u === 'kg' || u.includes('ק') || u.includes('קג')) return 'kg';
  return 'kg';
}

export function formatRecipeUnitKind(kind) {
  if (kind === 'g') return 'גרם';
  if (kind === 'l') return 'ליטר';
  return 'ק"ג';
}

export const IMPORT_WORD_GROUP = 'ייבוא Word';
export const IMPORT_WORD_SUB = 'ללא סיווג';
export const IMPORT_MATERIALS_CAT = 'ייבוא ממתכונים';
export const RECIPE_SORT_GROUP_DEFAULT = 'סידור';
export const DEFAULT_RECIPE_TYPES = ['מילית', 'בצק', 'קרם', 'רטבים', 'תוספת', 'אחר'];

export const RECIPE_OVEN_TYPES = {
  large: 'תנור גדול',
  small: 'תנור קטן',
};

export function getRecipeOvenLabel(type) {
  if (!type) return 'ללא סוג תנור';
  return RECIPE_OVEN_TYPES[type] || type;
}

export function formatRecipeBakingParamsLine(recipe) {
  if (!recipe?.hasBaking) return '';
  const parts = [];
  if (recipe.bakeTempC) parts.push(`${recipe.bakeTempC}°C`);
  if (recipe.bakeTimeMinutes != null && recipe.bakeTimeMinutes !== '') {
    parts.push(`${recipe.bakeTimeMinutes} דק׳`);
  }
  if (recipe.bakeSteamSeconds != null && recipe.bakeSteamSeconds !== '') {
    parts.push(`קיטור ${recipe.bakeSteamSeconds} שנ׳`);
  }
  if (recipe.bakeDryMinutes != null && recipe.bakeDryMinutes !== '') {
    parts.push(`ליבוש ${recipe.bakeDryMinutes} דק׳`);
  }
  return parts.join(' · ') || 'ללא פרטים';
}

function normalizeBakeOvenType(raw) {
  if (raw == null || raw === '') return null;
  const t = String(raw).trim();
  if (t === 'large' || t === 'small') return t;
  return sanitizeName(t, 40) || null;
}

export function normalizeRecipeBakingFields(raw) {
  const hasBaking = !!raw.hasBaking;
  if (!hasBaking) {
    return {
      hasBaking: false,
      bakeTempC: null,
      bakeTimeMinutes: null,
      bakeSteamSeconds: null,
      bakeDryMinutes: null,
      bakeOvenType: null,
      bakePresetId: null,
    };
  }
  const oven = normalizeBakeOvenType(raw.bakeOvenType);
  const temp = raw.bakeTempC != null && raw.bakeTempC !== ''
    ? sanitizeQuantity(raw.bakeTempC, { min: 1, max: 500 })
    : null;
  const bakeMin = raw.bakeTimeMinutes != null && raw.bakeTimeMinutes !== ''
    ? sanitizeQuantity(raw.bakeTimeMinutes, { allowZero: true, max: 10_000 })
    : null;
  const steamSec = raw.bakeSteamSeconds != null && raw.bakeSteamSeconds !== ''
    ? sanitizeQuantity(raw.bakeSteamSeconds, { allowZero: true, max: 86_400 })
    : null;
  const dryMin = raw.bakeDryMinutes != null && raw.bakeDryMinutes !== ''
    ? sanitizeQuantity(raw.bakeDryMinutes, { allowZero: true, max: 10_000 })
    : null;
  const bakePresetId = raw.bakePresetId != null && raw.bakePresetId !== ''
    ? sanitizeProductId(raw.bakePresetId)
    : null;
  return {
    hasBaking: true,
    bakeTempC: temp,
    bakeTimeMinutes: bakeMin,
    bakeSteamSeconds: steamSec,
    bakeDryMinutes: dryMin,
    bakeOvenType: oven,
    bakePresetId,
  };
}

export function formatBakingPresetSummary(preset) {
  if (!preset) return '';
  const parts = [];
  if (preset.bakeOvenType) parts.push(getRecipeOvenLabel(preset.bakeOvenType));
  const params = formatRecipeBakingParamsLine({ hasBaking: true, ...preset });
  if (params) parts.push(params);
  return parts.join(' · ') || preset.name;
}

function normalizeBakingPresetPayload(raw) {
  const name = sanitizeName(raw.name, 60);
  if (!name) throw new ValidationError('שם אפייה לא תקין');
  const baking = normalizeRecipeBakingFields({ ...raw, hasBaking: true, bakePresetId: null });
  return { name, ...baking };
}

export async function getBakingPresets() {
  const rows = await db.bakingPresets.toArray();
  rows.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id);
  return rows;
}

export async function getBakingPreset(id) {
  const pid = sanitizeProductId(id);
  if (!pid) return null;
  return db.bakingPresets.get(pid);
}

export async function addBakingPreset(fields) {
  const data = normalizeBakingPresetPayload(fields);
  const existing = await getBakingPresets();
  const maxOrder = existing.reduce((m, p) => Math.max(m, p.sortOrder ?? 0), 0);
  return db.bakingPresets.add({ ...data, sortOrder: maxOrder + 1 });
}

export async function updateBakingPreset(id, patch) {
  const pid = sanitizeProductId(id);
  if (!pid) throw new ValidationError('אפייה לא תקינה');
  const current = await db.bakingPresets.get(pid);
  if (!current) throw new ValidationError('אפייה לא נמצאה');
  const merged = { ...current, ...patch };
  const data = normalizeBakingPresetPayload(merged);
  await db.bakingPresets.update(pid, data);
}

export async function deleteBakingPreset(id) {
  const pid = sanitizeProductId(id);
  if (!pid) return;
  const linked = await db.recipes.where('bakePresetId').equals(pid).toArray();
  await db.transaction('rw', db.bakingPresets, db.recipes, async () => {
    for (const recipe of linked) {
      await db.recipes.update(recipe.id, { bakePresetId: null });
    }
    await db.bakingPresets.delete(pid);
  });
}

export function bakingFieldsFromPreset(preset) {
  return normalizeRecipeBakingFields({
    hasBaking: true,
    bakePresetId: preset.id,
    bakeOvenType: preset.bakeOvenType,
    bakeTempC: preset.bakeTempC,
    bakeTimeMinutes: preset.bakeTimeMinutes,
    bakeSteamSeconds: preset.bakeSteamSeconds,
    bakeDryMinutes: preset.bakeDryMinutes,
  });
}

export async function assignBakingPresetToRecipe(recipeId, presetId) {
  const preset = await getBakingPreset(presetId);
  if (!preset) throw new ValidationError('אפייה לא נמצאה');
  await updateRecipe(recipeId, bakingFieldsFromPreset(preset));
}

/* ── קטגוריות כלליות (קבוצות) ── */

export async function getRecipeGroups() {
  const rows = await db.recipeGroups.toArray();
  rows.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id);
  return rows;
}

export async function addRecipeGroup({ name, linkedCategoryGroupId }) {
  const trimmed = sanitizeName(name, 40);
  if (!trimmed) throw new ValidationError('שם קטגוריה לא תקין');
  const existing = await getRecipeGroups();
  if (existing.some((g) => g.name === trimmed)) throw new ValidationError('קטגוריה כבר קיימת');
  const maxOrder = existing.reduce((m, g) => Math.max(m, g.sortOrder ?? 0), 0);
  const linkId = linkedCategoryGroupId ? sanitizeProductId(linkedCategoryGroupId) : null;
  const groupId = await db.recipeGroups.add({
    name: trimmed,
    sortOrder: maxOrder + 1,
    linkedCategoryGroupId: linkId,
  });
  return groupId;
}

export async function updateRecipeGroup(id, patch) {
  const gid = sanitizeProductId(id);
  if (!gid) return;
  const data = { ...patch };
  if ('name' in data) {
    data.name = sanitizeName(data.name, 40);
    if (!data.name) throw new ValidationError('שם לא תקין');
  }
  if (Object.keys(data).length) await db.recipeGroups.update(gid, data);
}

export async function updateRecipeSubCategory(id, patch) {
  const cid = sanitizeProductId(id);
  if (!cid) return;
  const data = { ...patch };
  if ('name' in data) {
    data.name = sanitizeName(data.name, 40);
    if (!data.name) throw new ValidationError('שם קטגוריה לא תקין');
  }
  if ('groupId' in data) {
    data.groupId = sanitizeProductId(data.groupId);
    if (!data.groupId) throw new ValidationError('קבוצת סידור לא תקינה');
  }
  if (Object.keys(data).length) await db.recipeCategories.update(cid, data);
}

export async function importRecipeGroupsFromProducts() {
  const productGroups = await db.categoryGroups.toArray();
  productGroups.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id);
  const existing = await getRecipeGroups();
  const linked = new Set(existing.map((g) => g.linkedCategoryGroupId).filter(Boolean));
  const names = new Set(existing.map((g) => g.name));
  let added = 0;

  for (const pg of productGroups) {
    if (linked.has(pg.id) || names.has(pg.name)) continue;
    await addRecipeGroup({ name: pg.name, linkedCategoryGroupId: pg.id });
    names.add(pg.name);
    added++;
  }
  return added;
}

export async function setRecipeGroupOrder(orderedIds) {
  await db.transaction('rw', db.recipeGroups, async () => {
    for (let i = 0; i < orderedIds.length; i++) {
      await db.recipeGroups.update(Number(orderedIds[i]), { sortOrder: i + 1 });
    }
  });
}

export async function deleteRecipeGroup(id) {
  const gid = sanitizeProductId(id);
  if (!gid) return;
  const subs = await db.recipeCategories.where('groupId').equals(gid).toArray();
  for (const sub of subs) {
    const count = await db.recipes.where('categoryId').equals(sub.id).count();
    if (count > 0) throw new ValidationError('יש מתכונים בקטגוריה — העבר או מחק אותם קודם');
  }
  await db.transaction('rw', db.recipeGroups, db.recipeCategories, async () => {
    for (const sub of subs) await db.recipeCategories.delete(sub.id);
    await db.recipeGroups.delete(gid);
  });
}

/* ── תת-קטגוריות מתכונים ── */

export async function getRecipeSubCategories(groupId) {
  let rows = await db.recipeCategories.toArray();
  if (groupId) rows = rows.filter((c) => c.groupId === Number(groupId));
  rows.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id);
  return rows;
}

/** @deprecated use getRecipeSubCategories */
export async function getRecipeCategories(groupId) {
  return getRecipeSubCategories(groupId);
}

export async function addRecipeSubCategory({ groupId, name, linkedCategoryId }) {
  const gid = sanitizeProductId(groupId);
  const trimmed = sanitizeName(name, 40);
  if (!gid) throw new ValidationError('קבוצת סידור לא תקינה');
  if (!trimmed) throw new ValidationError('שם תת-קטגוריה לא תקין');
  const existing = await getRecipeSubCategories(gid);
  if (existing.some((c) => c.name === trimmed)) throw new ValidationError('תת-קטגוריה כבר קיימת');
  const maxOrder = existing.reduce((m, c) => Math.max(m, c.sortOrder ?? 0), 0);
  const linkId = linkedCategoryId ? sanitizeProductId(linkedCategoryId) : null;
  return db.recipeCategories.add({
    groupId: gid,
    name: trimmed,
    sortOrder: maxOrder + 1,
    linkedCategoryId: linkId,
  });
}

/** @deprecated */
export async function addRecipeCategory(name) {
  const groups = await getRecipeGroups();
  let groupId = groups[0]?.id;
  if (!groupId) groupId = await addRecipeGroup({ name, linkedCategoryGroupId: null });
  return addRecipeSubCategory({ groupId, name, linkedCategoryId: null });
}

function resolveRecipeGroupForSub(sub, groups, groupByName, productGroups, productCats) {
  const trimmed = sub.name.trim();
  if (trimmed && trimmed !== 'ראשי') {
    const byName = groupByName.get(trimmed);
    if (byName) return byName;
  }
  let productCat = sub.linkedCategoryId
    ? productCats.find((c) => c.id === sub.linkedCategoryId)
    : null;
  if (!productCat && trimmed !== 'ראשי') {
    productCat = productCats.find((c) => c.name === trimmed);
  }
  if (productCat?.groupId) {
    const pg = productGroups.find((g) => g.id === productCat.groupId);
    if (pg) {
      return groupByName.get(pg.name) || groups.find((g) => g.linkedCategoryGroupId === pg.id) || null;
    }
  }
  return null;
}

async function mergeSubIntoTarget(misplacedSub, targetGroupId, subsInTx) {
  const destSubs = subsInTx.filter((s) => Number(s.groupId) === Number(targetGroupId));
  let destSub = destSubs.find((s) => s.name === misplacedSub.name && s.id !== misplacedSub.id)
    || destSubs.find((s) => s.name === 'ראשי');
  if (!destSub) {
    const newId = await db.recipeCategories.add({
      groupId: targetGroupId,
      name: 'ראשי',
      sortOrder: 1,
      linkedCategoryId: misplacedSub.linkedCategoryId || null,
    });
    destSub = { id: newId, groupId: targetGroupId, name: 'ראשי' };
    subsInTx.push(destSub);
  }
  const recipes = await db.recipes.where('categoryId').equals(misplacedSub.id).toArray();
  for (const r of recipes) {
    await db.recipes.update(r.id, { categoryId: destSub.id });
  }
  const remaining = await db.recipes.where('categoryId').equals(misplacedSub.id).count();
  if (remaining > 0) {
    await db.recipeCategories.update(misplacedSub.id, { groupId: targetGroupId });
    return true;
  }
  const siblingCount = await db.recipeCategories.where('groupId').equals(misplacedSub.groupId).count();
  if (siblingCount > 1) {
    await db.recipeCategories.delete(misplacedSub.id);
    const idx = subsInTx.findIndex((s) => s.id === misplacedSub.id);
    if (idx >= 0) subsInTx.splice(idx, 1);
  } else {
    await db.recipeCategories.update(misplacedSub.id, { groupId: targetGroupId });
  }
  return true;
}

/** מעבר למבנה: קבוצות סידור + קטגוריות חופשיות (מילית, בצק...) */
export async function migrateToRecipeTypeCatalog() {
  const flag = await db.settings.get('recipeCatalogV29');
  if (flag?.value === 'done') return false;

  const recipes = await db.recipes.toArray();
  const oldSubs = await db.recipeCategories.toArray();
  const oldSubById = new Map(oldSubs.map((s) => [s.id, s]));

  await db.transaction('rw', db.recipeGroups, db.recipeCategories, db.recipes, db.settings, async () => {
    await db.recipeCategories.clear();
    await db.recipeGroups.clear();

    const groupId = await db.recipeGroups.add({
      name: RECIPE_SORT_GROUP_DEFAULT,
      sortOrder: 1,
      linkedCategoryGroupId: null,
    });

    const typeIds = new Map();
    for (let i = 0; i < DEFAULT_RECIPE_TYPES.length; i++) {
      const typeName = DEFAULT_RECIPE_TYPES[i];
      const id = await db.recipeCategories.add({
        groupId,
        name: typeName,
        sortOrder: i + 1,
        linkedCategoryId: null,
      });
      typeIds.set(typeName, id);
    }

    const fallbackId = typeIds.get('אחר');

    for (const recipe of recipes) {
      const oldSub = oldSubById.get(recipe.categoryId);
      let targetId = fallbackId;
      if (oldSub) {
        const name = oldSub.name.trim();
        if (typeIds.has(name)) targetId = typeIds.get(name);
        else if (/מיל/i.test(name)) targetId = typeIds.get('מילית') || fallbackId;
        else if (/בצק/i.test(name)) targetId = typeIds.get('בצק') || fallbackId;
        else if (/קרם/i.test(name)) targetId = typeIds.get('קרם') || fallbackId;
        else if (/רטב|רוטב/i.test(name)) targetId = typeIds.get('רטבים') || fallbackId;
      }
      await db.recipes.update(recipe.id, { categoryId: targetId });
    }

    await db.settings.put({ key: 'recipeCatalogV29', value: 'done' });
  });
  return true;
}

export async function ensureRecipeTypeCatalog() {
  const groups = await getRecipeGroups();
  if (groups.length) return false;
  await db.transaction('rw', db.recipeGroups, db.recipeCategories, async () => {
    const groupId = await db.recipeGroups.add({
      name: RECIPE_SORT_GROUP_DEFAULT,
      sortOrder: 1,
      linkedCategoryGroupId: null,
    });
    for (let i = 0; i < DEFAULT_RECIPE_TYPES.length; i++) {
      await db.recipeCategories.add({
        groupId,
        name: DEFAULT_RECIPE_TYPES[i],
        sortOrder: i + 1,
        linkedCategoryId: null,
      });
    }
  });
  return true;
}

/** @deprecated — מבנה ישן; השתמש ב-migrateToRecipeTypeCatalog */
export async function repairRecipeCategoryPlacement() {
  await importRecipeGroupsFromProducts();

  const [groups, productGroups, productCats] = await Promise.all([
    getRecipeGroups(),
    db.categoryGroups.toArray(),
    db.categories.toArray(),
  ]);
  const groupByName = new Map(groups.map((g) => [g.name.trim(), g]));
  let fixes = 0;

  await db.transaction('rw', db.recipeCategories, db.recipes, db.recipeGroups, async () => {
    for (const rg of groups) {
      const pg = productGroups.find((p) => p.name === rg.name);
      if (pg && rg.linkedCategoryGroupId !== pg.id) {
        await db.recipeGroups.update(rg.id, { linkedCategoryGroupId: pg.id });
      }
    }

    const subsInTx = await db.recipeCategories.toArray();
    for (const sub of subsInTx.slice().sort((a, b) => a.id - b.id)) {
      const targetGroup = resolveRecipeGroupForSub(sub, groups, groupByName, productGroups, productCats);
      if (!targetGroup || Number(sub.groupId) === Number(targetGroup.id)) continue;
      const moved = await mergeSubIntoTarget(sub, targetGroup.id, subsInTx);
      if (moved) fixes += 1;
    }
  });

  return fixes;
}

export async function importRecipeSubCategoriesFromProducts(groupId) {
  const gid = sanitizeProductId(groupId);
  if (!gid) throw new ValidationError('קטגוריה לא תקינה');
  const group = await db.recipeGroups.get(gid);
  if (!group) throw new ValidationError('קטגוריה לא נמצאה');

  let productCats = await db.categories.toArray();
  if (group.linkedCategoryGroupId) {
    productCats = productCats.filter((c) => c.groupId === group.linkedCategoryGroupId);
  }
  productCats.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id);

  const existing = await getRecipeSubCategories(gid);
  const linked = new Set(existing.map((c) => c.linkedCategoryId).filter(Boolean));
  const names = new Set(existing.map((c) => c.name));
  let added = 0;

  for (const pc of productCats) {
    if (linked.has(pc.id) || names.has(pc.name)) continue;
    await addRecipeSubCategory({ groupId: gid, name: pc.name, linkedCategoryId: pc.id });
    names.add(pc.name);
    added++;
  }
  return added;
}

export async function setRecipeSubCategoryOrder(groupId, orderedIds) {
  const gid = sanitizeProductId(groupId);
  await db.transaction('rw', db.recipeCategories, async () => {
    for (let i = 0; i < orderedIds.length; i++) {
      await db.recipeCategories.update(Number(orderedIds[i]), { sortOrder: i + 1, groupId: gid });
    }
  });
}

export async function deleteRecipeSubCategory(id) {
  const cid = sanitizeProductId(id);
  if (!cid) return;
  const recipes = await db.recipes.where('categoryId').equals(cid).count();
  if (recipes > 0) throw new ValidationError('יש מתכונים בקטגוריה — העבר או מחק אותם קודם');
  const total = await db.recipeCategories.count();
  if (total <= 1) throw new ValidationError('חייבת להישאר לפחות קטגוריה אחת');
  await db.recipeCategories.delete(cid);
}

/** @deprecated */
export async function deleteRecipeCategory(id) {
  return deleteRecipeSubCategory(id);
}

export async function findOrCreateRecipeGroup(name) {
  const trimmed = sanitizeName(name, 40);
  if (!trimmed) {
    const groups = await getRecipeGroups();
    if (groups[0]?.id) return groups[0].id;
    return addRecipeGroup({ name: 'כללי', linkedCategoryGroupId: null });
  }
  const groups = await getRecipeGroups();
  const found = groups.find((g) => g.name === trimmed);
  if (found) return found.id;
  return addRecipeGroup({ name: trimmed, linkedCategoryGroupId: null });
}

export async function findOrCreateRecipeSubCategory(groupId, name) {
  const gid = sanitizeProductId(groupId);
  const trimmed = sanitizeName(name, 40) || 'ראשי';
  const subs = await getRecipeSubCategories(gid);
  const found = subs.find((s) => s.name === trimmed);
  if (found) return found.id;
  return addRecipeSubCategory({ groupId: gid, name: trimmed, linkedCategoryId: null });
}

/* ── מתכונים ── */

export async function getRecipesCatalogLayout() {
  const [groups, subCats, allRecipes, allLinks] = await Promise.all([
    getRecipeGroups(),
    getRecipeSubCategories(null),
    db.recipes.toArray(),
    db.recipeProductLinks.toArray(),
  ]);
  const linksByRecipe = new Map();
  for (const link of allLinks) {
    if (!linksByRecipe.has(link.recipeId)) linksByRecipe.set(link.recipeId, []);
    linksByRecipe.get(link.recipeId).push(link.productId);
  }
  const map = new Map(subCats.map((s) => [s.id, { ...s, recipes: [] }]));
  for (const r of allRecipes) {
    const sub = map.get(r.categoryId);
    if (sub) {
      sub.recipes.push({
        ...r,
        linkedProductIds: linksByRecipe.get(r.id) || (r.linkedProductId ? [r.linkedProductId] : []),
      });
    }
  }
  for (const sub of map.values()) {
    sub.recipes.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id);
  }
  const allSubCategories = subCats.map((s) => map.get(s.id)).filter(Boolean);
  const grouped = groups.map((group) => ({
    ...group,
    categories: allSubCategories.filter((s) => Number(s.groupId) === Number(group.id)),
  }));
  return { groups: grouped, allSubCategories };
}

export async function getRecipeProductLinks(recipeId) {
  const rid = sanitizeProductId(recipeId);
  if (!rid) return [];
  const links = await db.recipeProductLinks.where('recipeId').equals(rid).toArray();
  return links.map((l) => l.productId);
}

export async function setRecipeProductLinks(recipeId, productIds) {
  const rid = sanitizeProductId(recipeId);
  if (!rid) throw new ValidationError('מתכון לא תקין');
  const ids = [...new Set((productIds || []).map((id) => sanitizeProductId(id)).filter(Boolean))];
  await db.transaction('rw', db.recipeProductLinks, db.recipes, async () => {
    await db.recipeProductLinks.where('recipeId').equals(rid).delete();
    for (const pid of ids) {
      await db.recipeProductLinks.add({ recipeId: rid, productId: pid });
    }
    await db.recipes.update(rid, { linkedProductId: ids[0] || null });
  });
}

export async function getRecipes(categoryId) {
  let rows = await db.recipes.toArray();
  if (categoryId) {
    rows = rows.filter((r) => r.categoryId === Number(categoryId));
  }
  rows.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id);
  return rows;
}

export async function getRecipe(id) {
  const recipe = await db.recipes.get(Number(id));
  if (!recipe) return null;
  const [ingredients, linkedProductIds] = await Promise.all([
    db.recipeIngredients.where('recipeId').equals(recipe.id).toArray(),
    getRecipeProductLinks(recipe.id),
  ]);
  ingredients.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id);
  return { ...recipe, ingredients, linkedProductIds };
}

export async function getRecipeForProduct(productId) {
  const pid = sanitizeProductId(productId);
  if (!pid) return null;
  const link = await db.recipeProductLinks.where('productId').equals(pid).first();
  if (link) return getRecipe(link.recipeId);
  const legacy = await db.recipes.where('linkedProductId').equals(pid).first();
  if (!legacy) return null;
  return getRecipe(legacy.id);
}

export async function addRecipe({
  categoryId, name, linkedProductId, linkedProductIds, linkedProductCategoryId,
  yieldPortions, portionWeightGrams, notes,
  hasBaking, bakeTempC, bakeTimeMinutes, bakeSteamSeconds, bakeDryMinutes, bakeOvenType, bakePresetId,
}) {
  const cid = sanitizeProductId(categoryId);
  const trimmed = sanitizeName(name, 80);
  if (!cid) throw new ValidationError('קטגוריה לא תקינה');
  if (!trimmed) throw new ValidationError('שם מתכון לא תקין');
  const inCat = await getRecipes(cid);
  const maxOrder = inCat.reduce((m, r) => Math.max(m, r.sortOrder ?? 0), 0);
  const yp = yieldPortions != null && yieldPortions !== ''
    ? sanitizeQuantity(yieldPortions, { allowZero: false })
    : DEFAULT_RECIPE_YIELD;
  const linkCatId = linkedProductCategoryId ? sanitizeProductId(linkedProductCategoryId) : null;
  const portionG = portionWeightGrams != null && portionWeightGrams !== ''
    ? sanitizeQuantity(portionWeightGrams, { allowZero: false })
    : null;
  const baking = normalizeRecipeBakingFields({
    hasBaking, bakeTempC, bakeTimeMinutes, bakeSteamSeconds, bakeDryMinutes, bakeOvenType, bakePresetId,
  });
  const recipeId = await db.recipes.add({
    categoryId: cid,
    name: trimmed,
    linkedProductId: null,
    linkedProductCategoryId: linkCatId,
    yieldPortions: yp,
    portionWeightGrams: portionG,
    notes: String(notes || '').trim().slice(0, 2000),
    sortOrder: maxOrder + 1,
    ...baking,
  });
  const pids = linkedProductIds?.length
    ? linkedProductIds
    : (linkedProductId ? [linkedProductId] : []);
  if (pids.length) await setRecipeProductLinks(recipeId, pids);
  return recipeId;
}

export async function updateRecipe(id, patch) {
  const rid = sanitizeProductId(id);
  if (!rid) throw new ValidationError('מתכון לא תקין');
  const data = { ...patch };
  if ('name' in data) {
    data.name = sanitizeName(data.name, 80);
    if (!data.name) throw new ValidationError('שם מתכון לא תקין');
  }
  if ('categoryId' in data) {
    data.categoryId = sanitizeProductId(data.categoryId);
    if (!data.categoryId) throw new ValidationError('קטגוריה לא תקינה');
  }
  if ('linkedProductId' in data) {
    data.linkedProductId = data.linkedProductId ? sanitizeProductId(data.linkedProductId) : null;
  }
  if ('linkedProductIds' in data) {
    await setRecipeProductLinks(rid, data.linkedProductIds);
    delete data.linkedProductIds;
  }
  if ('linkedProductCategoryId' in data) {
    data.linkedProductCategoryId = data.linkedProductCategoryId
      ? sanitizeProductId(data.linkedProductCategoryId)
      : null;
  }
  if ('yieldPortions' in data) {
    data.yieldPortions = sanitizeQuantity(data.yieldPortions, { allowZero: false });
  }
  if ('portionWeightGrams' in data) {
    data.portionWeightGrams = data.portionWeightGrams != null && data.portionWeightGrams !== ''
      ? sanitizeQuantity(data.portionWeightGrams, { allowZero: false })
      : null;
  }
  if ('hasBaking' in data) {
    Object.assign(data, normalizeRecipeBakingFields(data));
  }
  if ('notes' in data) data.notes = String(data.notes || '').trim().slice(0, 2000);
  if (Object.keys(data).length) await db.recipes.update(rid, data);
}

export async function setRecipeOrder(categoryId, orderedIds) {
  const cid = sanitizeProductId(categoryId);
  await db.transaction('rw', db.recipes, async () => {
    for (let i = 0; i < orderedIds.length; i++) {
      await db.recipes.update(Number(orderedIds[i]), { sortOrder: i + 1, categoryId: cid });
    }
  });
}

export async function setRecipeIngredientOrder(recipeId, orderedIds) {
  const rid = sanitizeProductId(recipeId);
  await db.transaction('rw', db.recipeIngredients, async () => {
    for (let i = 0; i < orderedIds.length; i++) {
      await db.recipeIngredients.update(Number(orderedIds[i]), { sortOrder: i + 1, recipeId: rid });
    }
  });
}

export function scaleRecipeIngredients(ingredients, anchorIngredientId, targetQuantity) {
  const anchor = ingredients.find((i) => i.id === Number(anchorIngredientId));
  if (!anchor) throw new ValidationError('חומר בסיס לא נמצא');
  const baseQty = Number(anchor.quantity);
  const target = Number(targetQuantity);
  if (!baseQty || baseQty <= 0) throw new ValidationError('כמות בסיס לא תקינה');
  if (!target || target <= 0) throw new ValidationError('כמות יעד לא תקינה');
  const ratio = target / baseQty;
  return ingredients.map((ing) => ({
    ...ing,
    scaledQuantity: roundQty(Number(ing.quantity) * ratio),
  }));
}

/** @returns {{ totalKg: number, totalLiters: number }} */
export function computeRecipeIngredientsTotal(ingredients, { useScaled = false } = {}) {
  let totalKg = 0;
  let totalLiters = 0;
  for (const ing of ingredients || []) {
    const kind = ing.unitKind || normalizeRecipeUnitKind(ing.unit);
    const rawQty = useScaled && ing.scaledQuantity != null ? ing.scaledQuantity : ing.quantity;
    const qty = Number(rawQty);
    if (!qty || qty <= 0) continue;
    if (kind === 'g') totalKg += qty / 1000;
    else if (kind === 'l') totalLiters += qty;
    else totalKg += qty;
  }
  return { totalKg: roundQty(totalKg), totalLiters: roundQty(totalLiters) };
}

export function formatKgWeight(kg) {
  if (!kg || kg <= 0) return '';
  if (kg >= 1) return `${roundQty(kg)} ק"ג`;
  return `${Math.round(kg * 1000)} גרם`;
}

/** סיכום משקל: כולל (יבשים+נוזלים כק"ג), פירוט יבש/נוזל */
export function getRecipeWeightSummary(ingredients, options = {}) {
  const { totalKg, totalLiters } = computeRecipeIngredientsTotal(ingredients, options);
  const totalRecipeKg = roundQty(totalKg + totalLiters);
  const mainText = totalRecipeKg > 0 ? formatKgWeight(totalRecipeKg) : '';
  const breakdownParts = [];
  if (totalKg > 0) breakdownParts.push(`יבשים: ${formatKgWeight(totalKg)}`);
  if (totalLiters > 0) breakdownParts.push(`נוזלים: ${roundQty(totalLiters)} ליטר`);
  const breakdownText = breakdownParts.length ? `(${breakdownParts.join(' · ')})` : '';
  return {
    mainText,
    breakdownText,
    totalRecipeKg,
    dryKg: totalKg,
    liquidLiters: totalLiters,
  };
}

export function formatRecipeIngredientsTotal(ingredients, options) {
  const { mainText, breakdownText } = getRecipeWeightSummary(ingredients, options);
  if (!mainText) return '';
  return breakdownText ? `${mainText} ${breakdownText}` : mainText;
}

export async function findOrCreateWordImportCategory() {
  const groups = await getRecipeGroups();
  let group = groups.find((g) => g.name === IMPORT_WORD_GROUP);
  if (!group) {
    const groupId = await addRecipeGroup({ name: IMPORT_WORD_GROUP, linkedCategoryGroupId: null });
    group = { id: groupId };
  }
  const subs = await getRecipeSubCategories(group.id);
  let sub = subs.find((s) => s.name === IMPORT_WORD_SUB);
  if (!sub) {
    const subId = await addRecipeSubCategory({
      groupId: group.id,
      name: IMPORT_WORD_SUB,
      linkedCategoryId: null,
    });
    sub = { id: subId };
  }
  return { groupId: group.id, subCategoryId: sub.id };
}

export async function findOrCreateImportMaterialsCategory() {
  const cats = await getSupplierCategories();
  const found = cats.find((c) => c.name === IMPORT_MATERIALS_CAT);
  if (found) return found.id;
  return addSupplierCategory(IMPORT_MATERIALS_CAT);
}

export async function ensureRawMaterialByName(name, { supplierCategoryId, unit }) {
  const trimmed = sanitizeName(name, 80);
  if (!trimmed) return null;
  const all = await db.rawMaterials.toArray();
  const found = all.find((m) => m.name === trimmed);
  if (found) return found.id;
  return addRawMaterial({
    supplierCategoryId,
    name: trimmed,
    unit: String(unit || 'ק"ג').trim().slice(0, 20),
    unitPrice: 0,
    supplierId: null,
  });
}

export function normalizeRecipeImportKey(name) {
  const s = sanitizeName(name, 80);
  return s ? s.toLocaleLowerCase('he') : '';
}

export async function getExistingRecipeNameKeys() {
  const rows = await db.recipes.toArray();
  return new Set(rows.map((r) => normalizeRecipeImportKey(r.name)).filter(Boolean));
}

export async function findRecipeByImportName(title) {
  const key = normalizeRecipeImportKey(title);
  if (!key) return null;
  const rows = await db.recipes.toArray();
  return rows.find((r) => normalizeRecipeImportKey(r.name) === key) || null;
}

export async function updateRecipeQuantitiesFromParsed(item) {
  const recipe = await findRecipeByImportName(item.title);
  if (!recipe) return { recipeId: null, ingredientsUpdated: 0, ingredientsAdded: 0 };
  const existing = await db.recipeIngredients.where('recipeId').equals(recipe.id).toArray();
  let ingredientsUpdated = 0;
  let ingredientsAdded = 0;
  for (const parsedIng of item.ingredients || []) {
    const key = normalizeMaterialKey(parsedIng.name);
    if (!key) continue;
    const match = existing.find((e) => normalizeMaterialKey(e.name) === key);
    const unitKind = parsedIng.unitKind || normalizeRecipeUnitKind(parsedIng.unit);
    const qty = sanitizeRecipeQuantity(parsedIng.quantity, { allowZero: false });
    if (qty == null) continue;
    if (match) {
      const patch = { quantity: qty };
      if (parsedIng.unitKind || parsedIng.unit) {
        patch.unitKind = unitKind;
        patch.unit = parsedIng.unit || formatRecipeUnitKind(unitKind);
      }
      await updateRecipeIngredient(match.id, patch);
      ingredientsUpdated += 1;
    } else {
      await addRecipeIngredient(recipe.id, {
        name: parsedIng.name,
        quantity: qty,
        unitKind,
        unit: parsedIng.unit,
      });
      ingredientsAdded += 1;
    }
  }
  return { recipeId: recipe.id, ingredientsUpdated, ingredientsAdded };
}

export async function importParsedRecipes(parsedRecipes, {
  groupId, subCategoryId, addRawMaterials = true, skipDuplicates = true,
  updateExistingQuantities = false,
} = {}) {
  let materialsCategoryId = null;
  if (addRawMaterials) {
    materialsCategoryId = await findOrCreateImportMaterialsCategory();
  }

  const wordLoc = await findOrCreateWordImportCategory();
  let imported = 0;
  let skipped = 0;
  let quantitiesUpdated = 0;
  let rawMaterialsAdded = 0;
  const existingMaterials = addRawMaterials ? await db.rawMaterials.toArray() : [];
  const materialNames = new Set(existingMaterials.map((m) => m.name));
  const existingNames = (skipDuplicates || updateExistingQuantities)
    ? await getExistingRecipeNameKeys()
    : new Set();

  for (const item of parsedRecipes) {
    const nameKey = normalizeRecipeImportKey(item.title);
    const exists = nameKey && existingNames.has(nameKey);
    if (exists && updateExistingQuantities) {
      const result = await updateRecipeQuantitiesFromParsed(item);
      if (result.ingredientsUpdated + result.ingredientsAdded > 0) quantitiesUpdated += 1;
      else skipped += 1;
      continue;
    }
    if (skipDuplicates && exists) {
      skipped += 1;
      continue;
    }

    let gid = item.groupName
      ? await findOrCreateRecipeGroup(item.groupName)
      : (groupId || wordLoc.groupId);
    let subId = item.subName
      ? await findOrCreateRecipeSubCategory(gid, item.subName)
      : (subCategoryId || wordLoc.subCategoryId);
    if (!gid) gid = wordLoc.groupId;
    if (!subId) {
      const subs = await getRecipeSubCategories(gid);
      subId = subs[0]?.id || wordLoc.subCategoryId;
    }

    const recipeId = await addRecipe({
      categoryId: subId,
      name: item.title,
      notes: item.notes || '',
    });
    for (const ing of item.ingredients || []) {
      const unitKind = ing.unitKind || normalizeRecipeUnitKind(ing.unit);
      let rawMaterialId = null;
      if (addRawMaterials && materialsCategoryId) {
        const isNew = !materialNames.has(ing.name);
        rawMaterialId = await ensureRawMaterialByName(ing.name, {
          supplierCategoryId: materialsCategoryId,
          unit: ing.unit || formatRecipeUnitKind(unitKind),
        });
        if (isNew && rawMaterialId) {
          materialNames.add(ing.name);
          rawMaterialsAdded += 1;
        }
      }
      await addRecipeIngredient(recipeId, {
        rawMaterialId,
        name: ing.name,
        quantity: ing.quantity,
        unit: ing.unit || formatRecipeUnitKind(unitKind),
        unitKind,
      });
    }
    if (nameKey) existingNames.add(nameKey);
    imported += 1;
  }
  return { imported, skipped, rawMaterialsAdded, quantitiesUpdated };
}

export async function moveRecipesToCategory(recipeIds, categoryId) {
  const cid = sanitizeProductId(categoryId);
  if (!cid) throw new ValidationError('קטגוריה לא תקינה');
  const ids = [...new Set((recipeIds || []).map((id) => sanitizeProductId(id)).filter(Boolean))];
  if (!ids.length) throw new ValidationError('לא נבחרו מתכונים');
  await db.transaction('rw', db.recipes, async () => {
    const inCat = await getRecipes(cid);
    let maxOrder = inCat.reduce((m, r) => Math.max(m, r.sortOrder ?? 0), 0);
    for (const id of ids) {
      maxOrder += 1;
      await db.recipes.update(id, { categoryId: cid, sortOrder: maxOrder });
    }
  });
  return ids.length;
}

export async function deleteRecipe(id) {
  const rid = sanitizeProductId(id);
  if (!rid) return;
  await db.transaction('rw', db.recipes, db.recipeIngredients, db.recipeProductLinks, async () => {
    await db.recipeIngredients.where('recipeId').equals(rid).delete();
    await db.recipeProductLinks.where('recipeId').equals(rid).delete();
    await db.recipes.delete(rid);
  });
}

export async function updateRecipeIngredient(id, patch) {
  const iid = sanitizeProductId(id);
  if (!iid) return;
  const data = {};
  if ('name' in patch) data.name = sanitizeName(patch.name, 80);
  if ('quantity' in patch) data.quantity = patch.quantity;
  if ('unitKind' in patch) data.unitKind = patch.unitKind;
  if ('unit' in patch) data.unit = patch.unit;
  if ('rawMaterialId' in patch) data.rawMaterialId = patch.rawMaterialId;
  if ('sortOrder' in patch) data.sortOrder = patch.sortOrder;
  if (!Object.keys(data).length) return;
  if ('quantity' in data) {
    const qty = sanitizeRecipeQuantity(data.quantity, { allowZero: false });
    if (qty == null) throw new ValidationError('כמות לא תקינה');
    data.quantity = qty;
  }
  if ('unitKind' in data) {
    data.unitKind = normalizeRecipeUnitKind(data.unitKind);
    data.unit = formatRecipeUnitKind(data.unitKind);
  }
  if ('unit' in data && !('unitKind' in data)) {
    data.unitKind = normalizeRecipeUnitKind(data.unit);
    data.unit = formatRecipeUnitKind(data.unitKind);
  }
  await db.recipeIngredients.update(iid, data);
}

export async function addRecipeIngredient(recipeId, { rawMaterialId, name, quantity, unit, unitKind }) {
  const rid = sanitizeProductId(recipeId);
  const trimmed = sanitizeName(name, 80);
  if (!rid) throw new ValidationError('מתכון לא תקין');
  if (!trimmed) throw new ValidationError('שם חומר לא תקין');
  const qty = sanitizeRecipeQuantity(quantity, { allowZero: false });
  if (qty == null) throw new ValidationError('כמות לא תקינה');
  const existing = await db.recipeIngredients.where('recipeId').equals(rid).toArray();
  const maxOrder = existing.reduce((m, r) => Math.max(m, r.sortOrder ?? 0), 0);
  const matId = rawMaterialId ? sanitizeProductId(rawMaterialId) : null;
  const kind = unitKind ? normalizeRecipeUnitKind(unitKind) : normalizeRecipeUnitKind(unit);
  return db.recipeIngredients.add({
    recipeId: rid,
    rawMaterialId: matId,
    name: trimmed,
    quantity: qty,
    unit: formatRecipeUnitKind(kind),
    unitKind: kind,
    sortOrder: maxOrder + 1,
  });
}

export async function deleteRecipeIngredient(id) {
  const iid = sanitizeProductId(id);
  if (iid) await db.recipeIngredients.delete(iid);
}

/** סנכרון מחיר חומרי גלם במוצר מסכום המתכון */
export async function syncProductCostFromRecipe(recipeId) {
  const recipe = await getRecipe(recipeId);
  const productIds = recipe?.linkedProductIds?.length
    ? recipe.linkedProductIds
    : (recipe?.linkedProductId ? [recipe.linkedProductId] : []);
  if (!productIds.length) throw new ValidationError('אין מוצרים מקושרים');
  let total = 0;
  for (const ing of recipe.ingredients) {
    if (ing.rawMaterialId) {
      const mat = await db.rawMaterials.get(ing.rawMaterialId);
      if (mat?.unitPrice) total += Number(mat.unitPrice) * Number(ing.quantity);
    }
  }
  const cost = roundQty(total);
  for (const pid of productIds) {
    await db.products.update(pid, { rawMaterialsCost: cost });
  }
  return cost;
}

/* ── קטגוריות ספקים ── */

export async function getSupplierCategories() {
  const rows = await db.supplierCategories.toArray();
  rows.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id);
  return rows;
}

export async function addSupplierCategory(name) {
  const trimmed = sanitizeName(name, 40);
  if (!trimmed) throw new ValidationError('שם קטגוריה לא תקין');
  const existing = await getSupplierCategories();
  if (existing.some((c) => c.name === trimmed)) throw new ValidationError('קטגוריה כבר קיימת');
  const maxOrder = existing.reduce((m, c) => Math.max(m, c.sortOrder ?? 0), 0);
  return db.supplierCategories.add({ name: trimmed, sortOrder: maxOrder + 1 });
}

export async function deleteSupplierCategory(id) {
  const cid = sanitizeProductId(id);
  if (!cid) return;
  const mats = await db.rawMaterials.where('supplierCategoryId').equals(cid).count();
  const sups = await db.suppliers.where('categoryId').equals(cid).count();
  if (mats > 0 || sups > 0) throw new ValidationError('יש נתונים בקטגוריה — העבר או מחק קודם');
  await db.supplierCategories.delete(cid);
}

/* ── ספקים ── */

export async function getSuppliers(categoryId) {
  let rows = await db.suppliers.toArray();
  if (categoryId) rows = rows.filter((s) => s.categoryId === Number(categoryId));
  rows.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id);
  return rows;
}

export async function addSupplier({ categoryId, name, phone, whatsapp, notes }) {
  const cid = sanitizeProductId(categoryId);
  const trimmed = sanitizeName(name, 60);
  if (!cid) throw new ValidationError('קטגוריה לא תקינה');
  if (!trimmed) throw new ValidationError('שם ספק לא תקין');
  const inCat = await getSuppliers(cid);
  const maxOrder = inCat.reduce((m, s) => Math.max(m, s.sortOrder ?? 0), 0);
  return db.suppliers.add({
    categoryId: cid,
    name: trimmed,
    phone: String(phone || '').trim().slice(0, 30),
    whatsapp: String(whatsapp || phone || '').trim().slice(0, 30),
    notes: String(notes || '').trim().slice(0, 500),
    sortOrder: maxOrder + 1,
  });
}

export async function updateSupplier(id, patch) {
  const sid = sanitizeProductId(id);
  if (!sid) return;
  const data = { ...patch };
  if ('name' in data) data.name = sanitizeName(data.name, 60);
  if ('categoryId' in data) data.categoryId = sanitizeProductId(data.categoryId);
  if ('phone' in data) data.phone = String(data.phone || '').trim().slice(0, 30);
  if ('whatsapp' in data) data.whatsapp = String(data.whatsapp || '').trim().slice(0, 30);
  if ('notes' in data) data.notes = String(data.notes || '').trim().slice(0, 500);
  await db.suppliers.update(sid, data);
}

export async function deleteSupplier(id) {
  const sid = sanitizeProductId(id);
  if (!sid) return;
  await db.suppliers.delete(sid);
}

export async function setSupplierOrder(categoryId, orderedIds) {
  const cid = sanitizeProductId(categoryId);
  await db.transaction('rw', db.suppliers, async () => {
    for (let i = 0; i < orderedIds.length; i++) {
      await db.suppliers.update(Number(orderedIds[i]), { sortOrder: i + 1, categoryId: cid });
    }
  });
}

export async function setRawMaterialOrder(categoryId, orderedIds) {
  const cid = sanitizeProductId(categoryId);
  await db.transaction('rw', db.rawMaterials, async () => {
    for (let i = 0; i < orderedIds.length; i++) {
      await db.rawMaterials.update(Number(orderedIds[i]), { sortOrder: i + 1, supplierCategoryId: cid });
    }
  });
}

/* ── חומרי גלם ── */

export async function getRawMaterials(supplierCategoryId) {
  let rows = await db.rawMaterials.toArray();
  if (supplierCategoryId) {
    rows = rows.filter((m) => m.supplierCategoryId === Number(supplierCategoryId));
  }
  rows.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id);
  return rows;
}

export async function addRawMaterial({ supplierCategoryId, name, unit, unitPrice, supplierId }) {
  const cid = sanitizeProductId(supplierCategoryId);
  const trimmed = sanitizeName(name, 80);
  if (!cid) throw new ValidationError('קטגוריה לא תקינה');
  if (!trimmed) throw new ValidationError('שם חומר לא תקין');
  const inCat = await getRawMaterials(cid);
  const maxOrder = inCat.reduce((m, r) => Math.max(m, r.sortOrder ?? 0), 0);
  const price = sanitizeMoney(unitPrice);
  const sid = supplierId ? sanitizeProductId(supplierId) : null;
  const id = await db.rawMaterials.add({
    supplierCategoryId: cid,
    name: trimmed,
    unit: String(unit || 'ק"ג').trim().slice(0, 20),
    unitPrice: price,
    supplierId: sid,
    sortOrder: maxOrder + 1,
  });
  if (price > 0) {
    await db.rawMaterialPriceHistory.add({
      rawMaterialId: id,
      price,
      effectiveDate: todayISO(),
      createdAt: new Date().toISOString(),
    });
  }
  return id;
}

export async function updateRawMaterial(id, patch) {
  const mid = sanitizeProductId(id);
  if (!mid) return;
  const data = { ...patch };
  if ('name' in data) data.name = sanitizeName(data.name, 80);
  if ('supplierCategoryId' in data) data.supplierCategoryId = sanitizeProductId(data.supplierCategoryId);
  if ('unitPrice' in data) {
    const newPrice = sanitizeMoney(data.unitPrice);
    const current = await db.rawMaterials.get(mid);
    if (current && newPrice !== sanitizeMoney(current.unitPrice)) {
      await addRawMaterialPriceEntry(mid, { price: newPrice, effectiveDate: todayISO() });
      delete data.unitPrice;
    } else {
      data.unitPrice = newPrice;
    }
  }
  if ('supplierId' in data) data.supplierId = data.supplierId ? sanitizeProductId(data.supplierId) : null;
  if ('unit' in data) data.unit = String(data.unit || '').trim().slice(0, 20);
  if (Object.keys(data).length) await db.rawMaterials.update(mid, data);
}

export async function deleteRawMaterial(id) {
  const mid = sanitizeProductId(id);
  if (!mid) return;
  await db.rawMaterialPriceHistory.where('rawMaterialId').equals(mid).delete();
  await db.rawMaterials.delete(mid);
}

export function normalizeMaterialKey(name) {
  const s = sanitizeName(name, 80);
  return s ? s.toLocaleLowerCase('he') : '';
}

export async function getPriceHistory(rawMaterialId) {
  const mid = sanitizeProductId(rawMaterialId);
  if (!mid) return [];
  const rows = await db.rawMaterialPriceHistory.where('rawMaterialId').equals(mid).toArray();
  rows.sort((a, b) => {
    const d = b.effectiveDate.localeCompare(a.effectiveDate);
    if (d !== 0) return d;
    return (b.createdAt || '').localeCompare(a.createdAt || '');
  });
  return rows;
}

async function syncRawMaterialLatestPrice(rawMaterialId) {
  const history = await getPriceHistory(rawMaterialId);
  if (!history.length) return;
  await db.rawMaterials.update(rawMaterialId, { unitPrice: history[0].price });
}

export async function addRawMaterialPriceEntry(rawMaterialId, { price, effectiveDate } = {}) {
  const mid = sanitizeProductId(rawMaterialId);
  if (!mid) throw new ValidationError('חומר לא תקין');
  const p = sanitizeMoney(price);
  const date = effectiveDate && /^\d{4}-\d{2}-\d{2}$/.test(String(effectiveDate))
    ? String(effectiveDate)
    : todayISO();
  await db.rawMaterialPriceHistory.add({
    rawMaterialId: mid,
    price: p,
    effectiveDate: date,
    createdAt: new Date().toISOString(),
  });
  await syncRawMaterialLatestPrice(mid);
}

export async function setRawMaterialPrice(rawMaterialId, price, effectiveDate) {
  await addRawMaterialPriceEntry(rawMaterialId, { price, effectiveDate });
}

export async function findRawMaterialBySupplierAndName(supplierId, name) {
  const sid = sanitizeProductId(supplierId);
  const key = normalizeMaterialKey(name);
  if (!sid || !key) return null;
  const mats = await db.rawMaterials.where('supplierId').equals(sid).toArray();
  return mats.find((m) => normalizeMaterialKey(m.name) === key) || null;
}

export async function getMaterialsWithSameName(materialId) {
  const mat = await db.rawMaterials.get(Number(materialId));
  if (!mat) return [];
  const key = normalizeMaterialKey(mat.name);
  const all = await db.rawMaterials.toArray();
  return all.filter((m) => normalizeMaterialKey(m.name) === key);
}

export async function findOrCreateSupplierCategory(name) {
  const trimmed = sanitizeName(name, 40);
  if (!trimmed) throw new ValidationError('שם קטגוריה לא תקין');
  const existing = (await getSupplierCategories()).find((c) => c.name === trimmed);
  if (existing) return existing.id;
  return addSupplierCategory(trimmed);
}

export async function findOrCreateSupplier(categoryId, name) {
  const cid = sanitizeProductId(categoryId);
  const trimmed = sanitizeName(name, 60);
  if (!cid || !trimmed) throw new ValidationError('ספק לא תקין');
  const inCat = await getSuppliers(cid);
  const found = inCat.find((s) => s.name === trimmed);
  if (found) return found.id;
  return addSupplier({ categoryId: cid, name: trimmed });
}

export async function getSuppliersBrowseLayout() {
  const [categories, suppliers, materials] = await Promise.all([
    getSupplierCategories(),
    getSuppliers(),
    db.rawMaterials.toArray(),
  ]);
  const matsBySupplier = new Map();
  for (const m of materials) {
    if (!m.supplierId) continue;
    if (!matsBySupplier.has(m.supplierId)) matsBySupplier.set(m.supplierId, []);
    matsBySupplier.get(m.supplierId).push(m);
  }
  for (const list of matsBySupplier.values()) {
    list.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id);
  }
  const grouped = categories.map((cat) => ({
    ...cat,
    suppliers: suppliers
      .filter((s) => s.categoryId === cat.id)
      .map((s) => ({
        ...s,
        materials: matsBySupplier.get(s.id) || [],
      })),
  }));
  return { categories: grouped, allMaterials: materials };
}

export async function importSupplierExcelEntries(entries, { defaultCategoryId } = {}) {
  if (!entries?.length) throw new ValidationError('אין נתונים לייבוא');
  let defaultCatId = sanitizeProductId(defaultCategoryId);
  if (!defaultCatId) {
    const cats = await getSupplierCategories();
    defaultCatId = cats[0]?.id;
    if (!defaultCatId) defaultCatId = await addSupplierCategory('ייבוא Excel');
  }

  const stats = { suppliersAdded: 0, materialsAdded: 0, priceEntries: 0 };
  const supplierCache = new Map();

  for (const entry of entries) {
    const materialName = sanitizeName(entry.materialName, 80);
    const supplierName = sanitizeName(entry.supplierName, 60);
    if (!materialName || !supplierName) continue;

    let catId = defaultCatId;
    if (entry.categoryName) {
      catId = await findOrCreateSupplierCategory(entry.categoryName);
    }

    const supKey = `${catId}|${supplierName.toLocaleLowerCase('he')}`;
    let supplierId = supplierCache.get(supKey);
    if (!supplierId) {
      const inCat = await getSuppliers(catId);
      const existing = inCat.find((s) => s.name === supplierName);
      if (existing) {
        supplierId = existing.id;
      } else {
        supplierId = await addSupplier({ categoryId: catId, name: supplierName });
        stats.suppliersAdded += 1;
      }
      supplierCache.set(supKey, supplierId);
    }

    let mat = await findRawMaterialBySupplierAndName(supplierId, materialName);
    if (!mat) {
      const mid = await addRawMaterial({
        supplierCategoryId: catId,
        name: materialName,
        unit: entry.unit || 'ק"ג',
        unitPrice: 0,
        supplierId,
      });
      mat = await db.rawMaterials.get(mid);
      stats.materialsAdded += 1;
    } else if (entry.unit && entry.unit !== mat.unit) {
      await updateRawMaterial(mat.id, { unit: entry.unit });
    }

    const price = entry.price != null ? sanitizeMoney(entry.price) : null;
    if (price != null && price >= 0) {
      await addRawMaterialPriceEntry(mat.id, {
        price,
        effectiveDate: entry.effectiveDate || todayISO(),
      });
      stats.priceEntries += 1;
    }
  }
  return stats;
}

export async function backfillRawMaterialPriceHistory() {
  const count = await db.rawMaterialPriceHistory.count();
  if (count > 0) return;
  const mats = await db.rawMaterials.toArray();
  const today = todayISO();
  const now = new Date().toISOString();
  for (const m of mats) {
    if ((m.unitPrice || 0) <= 0) continue;
    await db.rawMaterialPriceHistory.add({
      rawMaterialId: m.id,
      price: m.unitPrice,
      effectiveDate: today,
      createdAt: now,
      source: 'migration',
    });
  }
}

/* ── תוכנית ייצור שבועית ── */

export async function getWeeklyPlan(weekStart) {
  const ws = weekStart || weekStartISO();
  let plan = await db.weeklyProductionPlans.where('weekStart').equals(ws).first();
  if (!plan) {
    const id = await db.weeklyProductionPlans.add({ weekStart: ws, notes: '' });
    plan = { id, weekStart: ws, notes: '' };
  }
  const items = await db.weeklyProductionPlanItems.where('planId').equals(plan.id).toArray();
  items.sort((a, b) => a.id - b.id);
  return { ...plan, items };
}

export async function setWeeklyPlanItem(planId, productId, plannedPortions) {
  const pid = sanitizeProductId(planId);
  const prodId = sanitizeProductId(productId);
  if (!pid || !prodId) throw new ValidationError('נתונים לא תקינים');
  const portions = plannedPortions === '' || plannedPortions == null
    ? 0
    : sanitizeQuantity(plannedPortions, { allowZero: true });
  const existing = await db.weeklyProductionPlanItems
    .where('[planId+productId]').equals([pid, prodId]).first();
  if (portions <= 0) {
    if (existing) await db.weeklyProductionPlanItems.delete(existing.id);
    return;
  }
  if (existing) {
    await db.weeklyProductionPlanItems.update(existing.id, { plannedPortions: portions });
  } else {
    await db.weeklyProductionPlanItems.add({ planId: pid, productId: prodId, plannedPortions: portions });
  }
}

/** חישוב כמויות חומרי גלם לפי תוכנית שבועית + מתכונים */
export async function computeWeeklyMaterialNeeds(weekStart) {
  const plan = await getWeeklyPlan(weekStart);
  const needsMap = new Map();

  for (const item of plan.items) {
    if (!item.plannedPortions || item.plannedPortions <= 0) continue;
    const recipe = await getRecipeForProduct(item.productId);
    if (!recipe?.ingredients?.length) continue;
    const scale = Number(item.plannedPortions) / (Number(recipe.yieldPortions) || 1);

    for (const ing of recipe.ingredients) {
      const key = ing.rawMaterialId || `name:${ing.name}`;
      const qty = roundQty(Number(ing.quantity) * scale);
      if (qty <= 0) continue;

      let mat = ing.rawMaterialId ? await db.rawMaterials.get(ing.rawMaterialId) : null;
      const catId = mat?.supplierCategoryId || 0;
      const cat = catId ? await db.supplierCategories.get(catId) : null;

      if (!needsMap.has(key)) {
        needsMap.set(key, {
          rawMaterialId: ing.rawMaterialId || null,
          name: mat?.name || ing.name,
          unit: mat?.unit || ing.unit || 'יח',
          supplierCategoryId: catId,
          supplierCategoryName: cat?.name || 'ללא קטגוריה',
          supplierId: mat?.supplierId || null,
          totalQty: 0,
          products: [],
        });
      }
      const row = needsMap.get(key);
      row.totalQty = roundQty(row.totalQty + qty);
      const product = await db.products.get(item.productId);
      if (product) row.products.push({ name: product.name, portions: item.plannedPortions });
    }
  }

  const byCategory = new Map();
  for (const need of needsMap.values()) {
    const ck = need.supplierCategoryId || 0;
    if (!byCategory.has(ck)) {
      byCategory.set(ck, {
        categoryId: ck,
        categoryName: need.supplierCategoryName,
        items: [],
      });
    }
    byCategory.get(ck).items.push(need);
  }

  const categories = [...byCategory.values()].sort(
    (a, b) => a.categoryName.localeCompare(b.categoryName, 'he'),
  );
  for (const cat of categories) {
    cat.items.sort((a, b) => a.name.localeCompare(b.name, 'he'));
  }
  return { plan, categories, allNeeds: [...needsMap.values()] };
}

export function formatWhatsAppOrderText({ weekStart, categories }) {
  const lines = [`📋 הזמנת חומרי גלם — שבוע ${weekStart}`, ''];
  if (!categories.length) {
    lines.push('אין פריטים — הגדר תוכנית ייצור ומתכונים מקושרים למוצרים.');
    return lines.join('\n');
  }
  for (const cat of categories) {
    lines.push(`*${cat.categoryName}*`);
    for (const item of cat.items) {
      lines.push(`• ${item.name}: ${item.totalQty} ${item.unit}`);
    }
    lines.push('');
  }
  lines.push('_נוצר מאפליקציית מעקב יצור_');
  return lines.join('\n');
}

export async function exportKitchenTables() {
  const [
    recipeGroups, recipeCategories, recipes, recipeIngredients, recipeProductLinks,
    bakingPresets,
    supplierCategories, suppliers, rawMaterials, rawMaterialPriceHistory,
    weeklyProductionPlans, weeklyProductionPlanItems,
  ] = await Promise.all([
    db.recipeGroups.toArray(),
    db.recipeCategories.toArray(),
    db.recipes.toArray(),
    db.recipeIngredients.toArray(),
    db.recipeProductLinks.toArray(),
    db.bakingPresets.toArray(),
    db.supplierCategories.toArray(),
    db.suppliers.toArray(),
    db.rawMaterials.toArray(),
    db.rawMaterialPriceHistory.toArray(),
    db.weeklyProductionPlans.toArray(),
    db.weeklyProductionPlanItems.toArray(),
  ]);
  return {
    recipeGroups,
    recipeCategories,
    recipes,
    recipeIngredients,
    recipeProductLinks,
    bakingPresets,
    supplierCategories,
    suppliers,
    rawMaterials,
    rawMaterialPriceHistory,
    weeklyProductionPlans,
    weeklyProductionPlanItems,
  };
}

export async function importKitchenTables(payload) {
  const tables = [
    'recipeGroups', 'recipeCategories', 'recipes', 'recipeIngredients', 'recipeProductLinks',
    'bakingPresets',
    'supplierCategories', 'suppliers', 'rawMaterials', 'rawMaterialPriceHistory',
    'weeklyProductionPlans', 'weeklyProductionPlanItems',
  ];
  await db.transaction('rw', ...tables.map((t) => db[t]), async () => {
    for (const t of tables) {
      await db[t].clear();
      const rows = payload[t];
      if (Array.isArray(rows) && rows.length) await db[t].bulkPut(rows);
    }
    await ensureRecipeHierarchyInTx(db);
  });
}

async function ensureRecipeHierarchyInTx(dbRef) {
  const groups = await dbRef.recipeGroups.count();
  if (groups > 0) return;
  const olds = await dbRef.recipeCategories.toArray();
  if (!olds.length || olds[0].groupId != null) return;
  const recipes = await dbRef.recipes.toArray();
  const catMap = new Map();
  await dbRef.recipeCategories.clear();
  for (const old of olds.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id)) {
    const groupId = await dbRef.recipeGroups.add({
      name: old.name,
      sortOrder: old.sortOrder ?? 0,
      linkedCategoryGroupId: null,
    });
    const subId = await dbRef.recipeCategories.add({
      groupId,
      name: 'ראשי',
      sortOrder: 1,
      linkedCategoryId: null,
    });
    catMap.set(old.id, subId);
  }
  for (const recipe of recipes) {
    const newCatId = catMap.get(recipe.categoryId);
    if (newCatId) await dbRef.recipes.update(recipe.id, { categoryId: newCatId });
  }
}

export async function clearKitchenTables() {
  await db.transaction('rw',
    db.recipeGroups, db.recipeCategories, db.recipes, db.recipeIngredients, db.recipeProductLinks,
    db.bakingPresets,
    db.supplierCategories, db.suppliers, db.rawMaterials, db.rawMaterialPriceHistory,
    db.weeklyProductionPlans, db.weeklyProductionPlanItems,
    async () => {
      await db.weeklyProductionPlanItems.clear();
      await db.weeklyProductionPlans.clear();
      await db.recipeIngredients.clear();
      await db.recipeProductLinks.clear();
      await db.recipes.clear();
      await db.recipeCategories.clear();
      await db.recipeGroups.clear();
      await db.bakingPresets.clear();
      await db.rawMaterialPriceHistory.clear();
      await db.rawMaterials.clear();
      await db.suppliers.clear();
      await db.supplierCategories.clear();
    });
}
