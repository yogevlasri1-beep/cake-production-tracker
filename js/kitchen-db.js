import { db, ValidationError, sanitizeRawMaterialsCostSource, pickDbTables } from './db.js?v=337';
import {
  sanitizeName, sanitizeProductId, sanitizeMoney, sanitizeQuantity, sanitizeRecipeQuantity,
  sanitizePortionSize, sanitizePortionCount,
} from './validators.js?v=337';
import { weekStartISO, todayISO, roundDecimal, formatDecimal } from './utils.js?v=337';

const DEFAULT_RECIPE_YIELD = 1;

export const RECIPE_WEIGHT_UNITS = [
  { id: 'kg', label: 'ק"ג' },
  { id: 'g', label: 'גרם' },
  { id: 'l', label: 'ליטר' },
];

function roundQty(n) {
  return roundDecimal(n);
}

export function formatRecipeQuantity(qty) {
  return formatDecimal(qty);
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

function sanitizeBakeParamTemp(raw) {
  return raw != null && raw !== ''
    ? sanitizeQuantity(raw, { min: 1, max: 500 })
    : null;
}

function sanitizeBakeParamMinutes(raw) {
  return raw != null && raw !== ''
    ? sanitizeQuantity(raw, { allowZero: true, max: 10_000 })
    : null;
}

function sanitizeBakeParamSeconds(raw) {
  return raw != null && raw !== ''
    ? sanitizeQuantity(raw, { allowZero: true, max: 86_400 })
    : null;
}

function readOvenBakeParams(raw, prefix, useLegacyFallback = false) {
  const pick = (field, legacyField) => {
    const dualKey = `${prefix}${field}`;
    if (raw[dualKey] != null && raw[dualKey] !== '') return raw[dualKey];
    if (useLegacyFallback && legacyField && raw[legacyField] != null && raw[legacyField] !== '') {
      return raw[legacyField];
    }
    return null;
  };
  return {
    bakeTempC: sanitizeBakeParamTemp(pick('BakeTempC', 'bakeTempC')),
    bakeTimeMinutes: sanitizeBakeParamMinutes(pick('BakeTimeMinutes', 'bakeTimeMinutes')),
    bakeSteamSeconds: sanitizeBakeParamSeconds(pick('BakeSteamSeconds', 'bakeSteamSeconds')),
    bakeDryMinutes: sanitizeBakeParamMinutes(pick('BakeDryMinutes', 'bakeDryMinutes')),
  };
}

function profileHasDualOvenFields(raw) {
  if (!raw) return false;
  return raw.ovenLargeEnabled != null
    || raw.ovenSmallEnabled != null
    || raw.largeBakeTempC != null
    || raw.smallBakeTempC != null
    || raw.largeBakeTimeMinutes != null
    || raw.smallBakeTimeMinutes != null;
}

/** Normalize profile storage: optional large + small ovens with separate params. */
export function normalizeBakingProfileFields(raw) {
  const name = sanitizeName(raw.name, 60);
  if (!name) throw new ValidationError('שם פרופיל לא תקין');

  let ovenLargeEnabled;
  let ovenSmallEnabled;
  let legacyFallbackLarge = false;
  let legacyFallbackSmall = false;

  if (profileHasDualOvenFields(raw)) {
    ovenLargeEnabled = !!raw.ovenLargeEnabled;
    ovenSmallEnabled = !!raw.ovenSmallEnabled;
  } else {
    // Migrate legacy single-oven profile
    if (raw.bakeOvenType === 'small') {
      ovenLargeEnabled = false;
      ovenSmallEnabled = true;
      legacyFallbackSmall = true;
    } else {
      ovenLargeEnabled = true;
      ovenSmallEnabled = false;
      legacyFallbackLarge = true;
    }
  }

  if (!ovenLargeEnabled && !ovenSmallEnabled) {
    throw new ValidationError('יש לבחור לפחות תנור אחד (גדול או קטן)');
  }

  const large = ovenLargeEnabled
    ? readOvenBakeParams(raw, 'large', legacyFallbackLarge)
    : { bakeTempC: null, bakeTimeMinutes: null, bakeSteamSeconds: null, bakeDryMinutes: null };
  const small = ovenSmallEnabled
    ? readOvenBakeParams(raw, 'small', legacyFallbackSmall)
    : { bakeTempC: null, bakeTimeMinutes: null, bakeSteamSeconds: null, bakeDryMinutes: null };

  // Legacy flat fields for older UI paths — prefer large when both enabled
  const primary = ovenLargeEnabled ? { ovenType: 'large', ...large } : { ovenType: 'small', ...small };

  return {
    name,
    notes: String(raw.notes || '').trim().slice(0, 500),
    ovenLargeEnabled,
    ovenSmallEnabled,
    largeBakeTempC: large.bakeTempC,
    largeBakeTimeMinutes: large.bakeTimeMinutes,
    largeBakeSteamSeconds: large.bakeSteamSeconds,
    largeBakeDryMinutes: large.bakeDryMinutes,
    smallBakeTempC: small.bakeTempC,
    smallBakeTimeMinutes: small.bakeTimeMinutes,
    smallBakeSteamSeconds: small.bakeSteamSeconds,
    smallBakeDryMinutes: small.bakeDryMinutes,
    bakeOvenType: primary.ovenType,
    bakeTempC: primary.bakeTempC,
    bakeTimeMinutes: primary.bakeTimeMinutes,
    bakeSteamSeconds: primary.bakeSteamSeconds,
    bakeDryMinutes: primary.bakeDryMinutes,
  };
}

/** Hydrate a stored profile (incl. legacy) into dual-oven shape without writing. */
export function ensureDualOvenProfile(profile) {
  if (!profile) return null;
  try {
    const normalized = normalizeBakingProfileFields(profile);
    return { ...profile, ...normalized };
  } catch {
    return {
      ...profile,
      ovenLargeEnabled: true,
      ovenSmallEnabled: false,
      largeBakeTempC: profile.bakeTempC ?? null,
      largeBakeTimeMinutes: profile.bakeTimeMinutes ?? null,
      largeBakeSteamSeconds: profile.bakeSteamSeconds ?? null,
      largeBakeDryMinutes: profile.bakeDryMinutes ?? null,
      smallBakeTempC: null,
      smallBakeTimeMinutes: null,
      smallBakeSteamSeconds: null,
      smallBakeDryMinutes: null,
    };
  }
}

export function getEnabledBakingOvens(profile) {
  const p = ensureDualOvenProfile(profile);
  if (!p) return [];
  const ovens = [];
  if (p.ovenLargeEnabled) {
    ovens.push({
      ovenType: 'large',
      label: RECIPE_OVEN_TYPES.large,
      bakeTempC: p.largeBakeTempC,
      bakeTimeMinutes: p.largeBakeTimeMinutes,
      bakeSteamSeconds: p.largeBakeSteamSeconds,
      bakeDryMinutes: p.largeBakeDryMinutes,
    });
  }
  if (p.ovenSmallEnabled) {
    ovens.push({
      ovenType: 'small',
      label: RECIPE_OVEN_TYPES.small,
      bakeTempC: p.smallBakeTempC,
      bakeTimeMinutes: p.smallBakeTimeMinutes,
      bakeSteamSeconds: p.smallBakeSteamSeconds,
      bakeDryMinutes: p.smallBakeDryMinutes,
    });
  }
  return ovens;
}

export function formatOvenBakeParamsLine(oven) {
  if (!oven) return '';
  const parts = [];
  if (oven.bakeTempC) parts.push(`${oven.bakeTempC}°C`);
  if (oven.bakeTimeMinutes != null && oven.bakeTimeMinutes !== '') {
    parts.push(`${oven.bakeTimeMinutes} דק׳`);
  }
  if (oven.bakeSteamSeconds != null && oven.bakeSteamSeconds !== '') {
    parts.push(`קיטור ${oven.bakeSteamSeconds} שנ׳`);
  }
  if (oven.bakeDryMinutes != null && oven.bakeDryMinutes !== '') {
    parts.push(`יבוש ${oven.bakeDryMinutes} דק׳`);
  }
  return parts.join(' · ') || 'ללא פרטים';
}

export function formatBakingProfileOvensSummary(profile) {
  const ovens = getEnabledBakingOvens(profile);
  if (!ovens.length) return 'ללא תנור';
  return ovens.map((o) => `${o.label}: ${formatOvenBakeParamsLine(o)}`).join(' · ');
}

export function formatRecipeBakingParamsLine(recipe, profileOrMap) {
  const baking = resolveRecipeBaking(recipe, profileOrMap);
  if (!baking.hasBaking) return '';
  if (baking.ovens?.length) {
    return baking.ovens.map((o) => `${o.label}: ${formatOvenBakeParamsLine(o)}`).join(' · ');
  }
  return formatOvenBakeParamsLine(baking) || 'ללא פרטים';
}

export function resolveRecipeBaking(recipe, profileOrMap) {
  if (!recipe) return normalizeRecipeBakingFields({ hasBaking: false, bakingProfileId: null });

  let profile = null;
  if (profileOrMap) {
    if (profileOrMap instanceof Map) {
      profile = recipe.bakingProfileId ? profileOrMap.get(Number(recipe.bakingProfileId)) : null;
    } else {
      profile = profileOrMap;
    }
  }

  if (profile) {
    const hydrated = ensureDualOvenProfile(profile);
    const ovens = getEnabledBakingOvens(hydrated);
    const primary = ovens[0] || {};
    return {
      hasBaking: true,
      bakingProfileId: Number(recipe.bakingProfileId) || null,
      profileName: hydrated.name,
      bakeOvenType: primary.ovenType ?? hydrated.bakeOvenType ?? null,
      bakeTempC: primary.bakeTempC ?? null,
      bakeTimeMinutes: primary.bakeTimeMinutes ?? null,
      bakeSteamSeconds: primary.bakeSteamSeconds ?? null,
      bakeDryMinutes: primary.bakeDryMinutes ?? null,
      profileNotes: hydrated.notes || '',
      ovens,
      ovenLargeEnabled: !!hydrated.ovenLargeEnabled,
      ovenSmallEnabled: !!hydrated.ovenSmallEnabled,
    };
  }

  return {
    ...normalizeRecipeBakingFields(recipe),
    bakingProfileId: recipe.bakingProfileId ? Number(recipe.bakingProfileId) : null,
    ovens: [],
  };
}

export const BAKING_SCOPE_GROUP = 'group';
export const BAKING_SCOPE_CATEGORY = 'category';

export async function getBakingProfiles() {
  const rows = await db.bakingProfiles.toArray();
  rows.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id);
  return rows.map((p) => ensureDualOvenProfile(p));
}

export async function getBakingProfile(id) {
  const pid = sanitizeProductId(id);
  if (!pid) return null;
  const row = await db.bakingProfiles.get(pid);
  return row ? ensureDualOvenProfile(row) : null;
}

export async function addBakingProfile(fields) {
  const data = normalizeBakingProfileFields(fields);
  const existing = await getBakingProfiles();
  if (existing.some((p) => p.name === data.name)) throw new ValidationError('פרופיל בשם זה כבר קיים');
  const maxOrder = existing.reduce((m, p) => Math.max(m, p.sortOrder ?? 0), 0);
  return db.bakingProfiles.add({ ...data, sortOrder: maxOrder + 1 });
}

export async function updateBakingProfile(id, patch) {
  const pid = sanitizeProductId(id);
  if (!pid) throw new ValidationError('פרופיל לא תקין');
  const current = await db.bakingProfiles.get(pid);
  if (!current) throw new ValidationError('פרופיל לא נמצא');
  const merged = normalizeBakingProfileFields({ ...current, ...patch });
  if (merged.name !== current.name) {
    const existing = await getBakingProfiles();
    if (existing.some((p) => p.id !== pid && p.name === merged.name)) {
      throw new ValidationError('פרופיל בשם זה כבר קיים');
    }
  }
  await db.bakingProfiles.update(pid, merged);
}

export async function deleteBakingProfile(id) {
  const pid = sanitizeProductId(id);
  if (!pid) return;
  await db.transaction('rw', ...pickDbTables('bakingProfiles', 'bakingProfileProducts', 'bakingProfileScopes', 'recipes'), async () => {
    await db.bakingProfileProducts.where('bakingProfileId').equals(pid).delete();
    await db.bakingProfileScopes.where('bakingProfileId').equals(pid).delete();
    const recipes = await db.recipes.filter((r) => Number(r.bakingProfileId) === pid).toArray();
    for (const recipe of recipes) {
      await db.recipes.update(recipe.id, normalizeRecipeBakingFields({ hasBaking: false }));
    }
    await db.bakingProfiles.delete(pid);
  });
}

export async function setBakingProfileOrder(orderedIds) {
  await db.transaction('rw', ...pickDbTables('bakingProfiles'), async () => {
    for (let i = 0; i < orderedIds.length; i++) {
      await db.bakingProfiles.update(Number(orderedIds[i]), { sortOrder: i + 1 });
    }
  });
}

export async function countRecipesUsingBakingProfile(profileId) {
  const pid = sanitizeProductId(profileId);
  if (!pid) return 0;
  const recipes = await db.recipes.toArray();
  return recipes.filter((r) => Number(r.bakingProfileId) === pid).length;
}

export async function countProductsUsingBakingProfile(profileId) {
  const pid = sanitizeProductId(profileId);
  if (!pid) return 0;
  const { countByProfileId } = await buildProductBakingIndex();
  return countByProfileId.get(pid) || 0;
}

/** Resolve baking for all active products in one pass (product → category → group). */
export async function buildProductBakingIndex() {
  const [products, profiles, productLinks, scopes, categories, groups] = await Promise.all([
    db.products.toArray(),
    db.bakingProfiles.toArray(),
    db.bakingProfileProducts.toArray(),
    db.bakingProfileScopes.toArray(),
    db.categories.toArray(),
    db.categoryGroups.toArray(),
  ]);
  const profileMap = new Map(profiles.map((p) => {
    const hydrated = ensureDualOvenProfile(p);
    return [Number(hydrated.id), hydrated];
  }));
  const directByProduct = new Map();
  for (const link of productLinks) {
    directByProduct.set(Number(link.productId), link);
  }
  const catById = new Map(categories.map((c) => [Number(c.id), c]));
  const groupById = new Map(groups.map((g) => [Number(g.id), g]));

  const byProductId = new Map();
  const byCategoryId = new Map();
  const byGroupId = new Map();
  const countByProfileId = new Map();

  for (const scope of scopes) {
    const profile = profileMap.get(Number(scope.bakingProfileId));
    if (!profile) continue;
    if (scope.scopeType === BAKING_SCOPE_CATEGORY) {
      const category = catById.get(Number(scope.scopeId));
      byCategoryId.set(Number(scope.scopeId), {
        profile,
        source: 'category',
        scopeType: BAKING_SCOPE_CATEGORY,
        scopeId: Number(scope.scopeId),
        scopeName: category?.name || null,
      });
    } else if (scope.scopeType === BAKING_SCOPE_GROUP) {
      const group = groupById.get(Number(scope.scopeId));
      byGroupId.set(Number(scope.scopeId), {
        profile,
        source: 'group',
        scopeType: BAKING_SCOPE_GROUP,
        scopeId: Number(scope.scopeId),
        scopeName: group?.name || null,
      });
    }
  }

  for (const product of products) {
    if (product.active === false) continue;
    let resolved = null;

    const direct = directByProduct.get(Number(product.id));
    if (direct) {
      const profile = profileMap.get(Number(direct.bakingProfileId));
      if (profile) {
        resolved = {
          profile,
          source: 'product',
          scopeType: null,
          scopeId: null,
          scopeName: null,
        };
      }
    }

    if (!resolved) {
      const catResolved = byCategoryId.get(Number(product.categoryId));
      if (catResolved) resolved = { ...catResolved };
    }

    if (!resolved) {
      const category = catById.get(Number(product.categoryId));
      if (category?.groupId) {
        const groupResolved = byGroupId.get(Number(category.groupId));
        if (groupResolved) resolved = { ...groupResolved };
      }
    }

    if (!resolved) continue;
    byProductId.set(Number(product.id), { product, ...resolved });
    const pid = Number(resolved.profile.id);
    countByProfileId.set(pid, (countByProfileId.get(pid) || 0) + 1);
  }

  return { byProductId, byCategoryId, byGroupId, countByProfileId, profileMap };
}

export async function getBakingProfileScopes(profileId) {
  const pid = sanitizeProductId(profileId);
  if (!pid) return { groups: [], categories: [] };
  const scopes = await db.bakingProfileScopes.where('bakingProfileId').equals(pid).toArray();
  scopes.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id);
  const groups = [];
  const categories = [];
  for (const scope of scopes) {
    if (scope.scopeType === BAKING_SCOPE_GROUP) {
      const group = await db.categoryGroups.get(Number(scope.scopeId));
      if (group) groups.push({ ...scope, group });
    } else if (scope.scopeType === BAKING_SCOPE_CATEGORY) {
      const category = await db.categories.get(Number(scope.scopeId));
      if (category) categories.push({ ...scope, category });
    }
  }
  return { groups, categories };
}

export async function linkBakingProfileScope(profileId, scopeType, scopeId) {
  const pid = sanitizeProductId(profileId);
  const sid = sanitizeProductId(scopeId);
  if (!pid || !sid) throw new ValidationError('שיוך לא תקין');
  if (scopeType !== BAKING_SCOPE_GROUP && scopeType !== BAKING_SCOPE_CATEGORY) {
    throw new ValidationError('סוג טווח לא תקין');
  }
  const profile = await db.bakingProfiles.get(pid);
  if (!profile) throw new ValidationError('פרופיל לא נמצא');
  if (scopeType === BAKING_SCOPE_GROUP) {
    const group = await db.categoryGroups.get(sid);
    if (!group) throw new ValidationError('קבוצה לא נמצאה');
  } else {
    const category = await db.categories.get(sid);
    if (!category) throw new ValidationError('קטגוריה לא נמצאה');
  }
  const existing = await db.bakingProfileScopes
    .where('[bakingProfileId+scopeType+scopeId]')
    .equals([pid, scopeType, sid])
    .first();
  if (existing) return existing.id;
  await db.bakingProfileScopes.where('[scopeType+scopeId]').equals([scopeType, sid]).delete();
  const all = await db.bakingProfileScopes.where('bakingProfileId').equals(pid).toArray();
  const maxOrder = all.reduce((m, row) => Math.max(m, row.sortOrder ?? 0), 0);
  return db.bakingProfileScopes.add({
    bakingProfileId: pid,
    scopeType,
    scopeId: sid,
    sortOrder: maxOrder + 1,
  });
}

export async function unlinkBakingProfileScope(profileId, scopeType, scopeId) {
  const pid = sanitizeProductId(profileId);
  const sid = sanitizeProductId(scopeId);
  if (!pid || !sid) return;
  await db.bakingProfileScopes
    .where('[bakingProfileId+scopeType+scopeId]')
    .equals([pid, scopeType, sid])
    .delete();
}

export async function resolveBakingProfileForProduct(productId) {
  const pid = sanitizeProductId(productId);
  if (!pid) return null;

  const directLink = await db.bakingProfileProducts.where('productId').equals(pid).first();
  if (directLink) {
    const profile = await db.bakingProfiles.get(directLink.bakingProfileId);
    if (profile) {
      return {
        profile,
        source: 'product',
        scopeType: null,
        scopeId: null,
        scopeName: null,
        link: directLink,
      };
    }
  }

  const product = await db.products.get(pid);
  if (!product) return null;

  const catScope = await db.bakingProfileScopes
    .where('[scopeType+scopeId]')
    .equals([BAKING_SCOPE_CATEGORY, product.categoryId])
    .first();
  if (catScope) {
    const profile = await db.bakingProfiles.get(catScope.bakingProfileId);
    const category = await db.categories.get(product.categoryId);
    if (profile) {
      return {
        profile,
        source: 'category',
        scopeType: BAKING_SCOPE_CATEGORY,
        scopeId: product.categoryId,
        scopeName: category?.name || null,
        link: null,
      };
    }
  }

  const category = await db.categories.get(product.categoryId);
  if (category?.groupId) {
    const groupScope = await db.bakingProfileScopes
      .where('[scopeType+scopeId]')
      .equals([BAKING_SCOPE_GROUP, category.groupId])
      .first();
    if (groupScope) {
      const profile = await db.bakingProfiles.get(groupScope.bakingProfileId);
      const group = await db.categoryGroups.get(category.groupId);
      if (profile) {
        return {
          profile,
          source: 'group',
          scopeType: BAKING_SCOPE_GROUP,
          scopeId: category.groupId,
          scopeName: group?.name || null,
          link: null,
        };
      }
    }
  }

  return null;
}

export async function getProductsForBakingProfile(profileId) {
  const pid = sanitizeProductId(profileId);
  if (!pid) return [];
  const links = await db.bakingProfileProducts.where('bakingProfileId').equals(pid).toArray();
  links.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id);
  const products = [];
  for (const link of links) {
    const product = await db.products.get(Number(link.productId));
    if (product) products.push({ ...product, linkId: link.id });
  }
  return products;
}

export async function getRecipesForBakingProfile(profileId) {
  const pid = sanitizeProductId(profileId);
  if (!pid) return [];
  const recipes = await db.recipes.filter((r) => Number(r.bakingProfileId) === pid).toArray();
  return recipes.sort((a, b) => a.name.localeCompare(b.name, 'he'));
}

export async function linkProductToBakingProfile(profileId, productId) {
  const pid = sanitizeProductId(profileId);
  const prodId = sanitizeProductId(productId);
  if (!pid || !prodId) throw new ValidationError('שיוך לא תקין');
  const profile = await db.bakingProfiles.get(pid);
  if (!profile) throw new ValidationError('פרופיל לא נמצא');
  const product = await db.products.get(prodId);
  if (!product) throw new ValidationError('מוצר לא נמצא');
  const existing = await db.bakingProfileProducts
    .where('[bakingProfileId+productId]')
    .equals([pid, prodId])
    .first();
  if (existing) return existing.id;
  await db.bakingProfileProducts.where('productId').equals(prodId).delete();
  const all = await db.bakingProfileProducts.where('bakingProfileId').equals(pid).toArray();
  const maxOrder = all.reduce((m, row) => Math.max(m, row.sortOrder ?? 0), 0);
  return db.bakingProfileProducts.add({
    bakingProfileId: pid,
    productId: prodId,
    sortOrder: maxOrder + 1,
  });
}

export async function unlinkProductFromBakingProfile(profileId, productId) {
  const pid = sanitizeProductId(profileId);
  const prodId = sanitizeProductId(productId);
  if (!pid || !prodId) return;
  await db.bakingProfileProducts.where('[bakingProfileId+productId]').equals([pid, prodId]).delete();
}

export async function linkRecipeToBakingProfile(profileId, recipeId) {
  const pid = sanitizeProductId(profileId);
  const rid = sanitizeProductId(recipeId);
  if (!pid || !rid) throw new ValidationError('שיוך לא תקין');
  const profile = await db.bakingProfiles.get(pid);
  if (!profile) throw new ValidationError('פרופיל לא נמצא');
  const recipe = await db.recipes.get(rid);
  if (!recipe) throw new ValidationError('מתכון לא נמצא');
  await db.recipes.update(rid, normalizeRecipeBakingFields({ hasBaking: true, bakingProfileId: pid }));
}

export async function unlinkRecipeFromBakingProfile(recipeId) {
  const rid = sanitizeProductId(recipeId);
  if (!rid) return;
  await db.recipes.update(rid, normalizeRecipeBakingFields({ hasBaking: false }));
}

function normalizeBakeOvenType(raw) {
  if (raw == null || raw === '') return null;
  const t = String(raw).trim();
  if (t === 'large' || t === 'small') return t;
  return sanitizeName(t, 40) || null;
}

export function normalizeRecipeBakingFields(raw) {
  const profileId = raw.bakingProfileId != null && raw.bakingProfileId !== ''
    ? sanitizeProductId(raw.bakingProfileId)
    : null;
  const hasBaking = !!raw.hasBaking || !!profileId;
  if (!hasBaking) {
    return {
      hasBaking: false,
      bakingProfileId: null,
      bakeTempC: null,
      bakeTimeMinutes: null,
      bakeSteamSeconds: null,
      bakeDryMinutes: null,
      bakeOvenType: null,
    };
  }
  if (profileId) {
    return {
      hasBaking: true,
      bakingProfileId: profileId,
      bakeTempC: null,
      bakeTimeMinutes: null,
      bakeSteamSeconds: null,
      bakeDryMinutes: null,
      bakeOvenType: null,
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
  return {
    hasBaking: true,
    bakingProfileId: null,
    bakeTempC: temp,
    bakeTimeMinutes: bakeMin,
    bakeSteamSeconds: steamSec,
    bakeDryMinutes: dryMin,
    bakeOvenType: oven,
  };
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
  const [groups, subCats, allRecipes, allLinks, allCatLinks, allGroupLinks] = await Promise.all([
    getRecipeGroups(),
    getRecipeSubCategories(null),
    db.recipes.toArray(),
    db.recipeProductLinks.toArray(),
    db.recipeProductCategoryLinks?.toArray?.() ?? Promise.resolve([]),
    db.recipeProductGroupLinks?.toArray?.() ?? Promise.resolve([]),
  ]);
  const linksByRecipe = new Map();
  for (const link of allLinks) {
    if (!linksByRecipe.has(link.recipeId)) linksByRecipe.set(link.recipeId, []);
    linksByRecipe.get(link.recipeId).push(link.productId);
  }
  const catLinksByRecipe = new Map();
  for (const link of allCatLinks) {
    if (!catLinksByRecipe.has(link.recipeId)) catLinksByRecipe.set(link.recipeId, []);
    catLinksByRecipe.get(link.recipeId).push(link.categoryId);
  }
  const groupLinksByRecipe = new Map();
  for (const link of allGroupLinks) {
    if (!groupLinksByRecipe.has(link.recipeId)) groupLinksByRecipe.set(link.recipeId, []);
    groupLinksByRecipe.get(link.recipeId).push(link.groupId);
  }
  const map = new Map(subCats.map((s) => [s.id, { ...s, recipes: [] }]));
  const subRecipesByParent = new Map();
  const enrichRecipeRow = (r) => ({
    ...r,
    linkedProductIds: linksByRecipe.get(r.id) || (r.linkedProductId ? [r.linkedProductId] : []),
    linkedProductCategoryIds: catLinksByRecipe.get(r.id) || (r.linkedProductCategoryId ? [r.linkedProductCategoryId] : []),
    linkedProductGroupIds: groupLinksByRecipe.get(r.id) || (r.linkedProductGroupId ? [r.linkedProductGroupId] : []),
  });
  for (const r of allRecipes) {
    if (r.parentRecipeId) {
      const parentId = Number(r.parentRecipeId);
      if (!subRecipesByParent.has(parentId)) subRecipesByParent.set(parentId, []);
      subRecipesByParent.get(parentId).push(enrichRecipeRow(r));
    }
  }
  for (const r of allRecipes) {
    if (r.parentRecipeId) continue;
    const sub = map.get(r.categoryId);
    if (sub) {
      const entry = enrichRecipeRow(r);
      entry.subRecipes = (subRecipesByParent.get(r.id) || [])
        .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id);
      sub.recipes.push(entry);
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

export async function getRecipeSubRecipes(parentRecipeId) {
  const pid = sanitizeProductId(parentRecipeId);
  if (!pid || !db.recipes) return [];
  const rows = await db.recipes.where('parentRecipeId').equals(pid).toArray();
  return rows.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id);
}

async function copyRecipeProductScopeFromParent(childId, parent) {
  const cid = sanitizeProductId(childId);
  if (!cid || !parent) return;
  const pids = parent.linkedProductIds?.length
    ? parent.linkedProductIds
    : (parent.linkedProductId ? [parent.linkedProductId] : []);
  const catIds = parent.linkedProductCategoryIds?.length
    ? parent.linkedProductCategoryIds
    : (parent.linkedProductCategoryId ? [parent.linkedProductCategoryId] : []);
  const groupIds = parent.linkedProductGroupIds?.length
    ? parent.linkedProductGroupIds
    : (parent.linkedProductGroupId ? [parent.linkedProductGroupId] : []);
  if (pids.length) await setRecipeProductLinks(cid, pids);
  else await setRecipeProductLinks(cid, []);
  if (catIds.length) await setRecipeProductCategoryLinks(cid, catIds);
  else await setRecipeProductCategoryLinks(cid, []);
  if (groupIds.length) await setRecipeProductGroupLinks(cid, groupIds);
  else await setRecipeProductGroupLinks(cid, []);
}

export async function syncSubRecipesProductLinks(parentRecipeId) {
  const parent = await getRecipe(parentRecipeId);
  if (!parent) return;
  const subs = await getRecipeSubRecipes(parentRecipeId);
  for (const sub of subs) {
    await copyRecipeProductScopeFromParent(sub.id, parent);
  }
}

export async function addSubRecipe(parentRecipeId, { name } = {}) {
  const parent = await getRecipe(parentRecipeId);
  if (!parent) throw new ValidationError('מתכון לא נמצא');
  if (parent.parentRecipeId) throw new ValidationError('לא ניתן להוסיף תת מתכון לתת מתכון');
  const subs = await getRecipeSubRecipes(parentRecipeId);
  const trimmed = sanitizeName(name, 80) || `${parent.name} — תוספת`;
  const recipeId = await db.recipes.add({
    categoryId: parent.categoryId,
    parentRecipeId: parent.id,
    name: trimmed,
    linkedProductId: null,
    linkedProductCategoryId: null,
    linkedProductGroupId: null,
    yieldPortions: DEFAULT_RECIPE_YIELD,
    portionWeightGrams: null,
    showTotalAsPortions: false,
    notes: '',
    sortOrder: subs.length + 1,
    hasBaking: false,
    bakingProfileId: null,
    bakeTempC: null,
    bakeTimeMinutes: null,
    bakeSteamSeconds: null,
    bakeDryMinutes: null,
    bakeOvenType: null,
  });
  await copyRecipeProductScopeFromParent(recipeId, parent);
  await syncRecipePortionPresets(recipeId);
  return recipeId;
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
  await syncRecipePortionPresets(rid);
  await syncSubRecipesProductLinks(rid);
}

export async function getRecipeProductCategoryLinks(recipeId) {
  const rid = sanitizeProductId(recipeId);
  if (!rid) return [];
  const links = await db.recipeProductCategoryLinks.where('recipeId').equals(rid).toArray();
  return links.map((l) => l.categoryId);
}

export async function setRecipeProductCategoryLinks(recipeId, categoryIds) {
  const rid = sanitizeProductId(recipeId);
  if (!rid) throw new ValidationError('מתכון לא תקין');
  const ids = [...new Set((categoryIds || []).map((id) => sanitizeProductId(id)).filter(Boolean))];
  await db.transaction('rw', db.recipeProductCategoryLinks, db.recipes, async () => {
    await db.recipeProductCategoryLinks.where('recipeId').equals(rid).delete();
    for (const cid of ids) {
      await db.recipeProductCategoryLinks.add({ recipeId: rid, categoryId: cid });
    }
    await db.recipes.update(rid, { linkedProductCategoryId: null });
  });
  await syncRecipePortionPresets(rid);
  await syncSubRecipesProductLinks(rid);
}

export async function getRecipeProductGroupLinks(recipeId) {
  const rid = sanitizeProductId(recipeId);
  if (!rid) return [];
  const links = await db.recipeProductGroupLinks.where('recipeId').equals(rid).toArray();
  return links.map((l) => l.groupId);
}

export async function setRecipeProductGroupLinks(recipeId, groupIds) {
  const rid = sanitizeProductId(recipeId);
  if (!rid) throw new ValidationError('מתכון לא תקין');
  const ids = [...new Set((groupIds || []).map((id) => sanitizeProductId(id)).filter(Boolean))];
  await db.transaction('rw', db.recipeProductGroupLinks, db.recipes, async () => {
    await db.recipeProductGroupLinks.where('recipeId').equals(rid).delete();
    for (const gid of ids) {
      await db.recipeProductGroupLinks.add({ recipeId: rid, groupId: gid });
    }
    await db.recipes.update(rid, { linkedProductGroupId: null });
  });
  await syncRecipePortionPresets(rid);
  await syncSubRecipesProductLinks(rid);
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
  const [ingredients, linkedProductIds, linkedProductCategoryIds, linkedProductGroupIds] = await Promise.all([
    db.recipeIngredients.where('recipeId').equals(recipe.id).toArray(),
    getRecipeProductLinks(recipe.id),
    getRecipeProductCategoryLinks(recipe.id),
    getRecipeProductGroupLinks(recipe.id),
  ]);
  ingredients.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id);
  return {
    ...recipe,
    ingredients,
    linkedProductIds,
    linkedProductCategoryIds,
    linkedProductGroupIds,
  };
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
  categoryId, name, linkedProductId, linkedProductIds, linkedProductCategoryId, linkedProductCategoryIds,
  linkedProductGroupId, linkedProductGroupIds,
  yieldPortions, portionWeightGrams, showTotalAsPortions, notes,
  hasBaking, bakingProfileId, bakeTempC, bakeTimeMinutes, bakeSteamSeconds, bakeDryMinutes, bakeOvenType,
}) {
  const cid = sanitizeProductId(categoryId);
  const trimmed = sanitizeName(name, 80);
  if (!cid) throw new ValidationError('קטגוריה לא תקינה');
  if (!trimmed) throw new ValidationError('שם מתכון לא תקין');
  const inCat = await getRecipes(cid);
  const maxOrder = inCat.reduce((m, r) => Math.max(m, r.sortOrder ?? 0), 0);
  const portionG = portionWeightGrams != null && portionWeightGrams !== ''
    ? sanitizeQuantity(portionWeightGrams, { allowZero: false })
    : null;
  const baking = normalizeRecipeBakingFields({
    hasBaking, bakingProfileId, bakeTempC, bakeTimeMinutes, bakeSteamSeconds, bakeDryMinutes, bakeOvenType,
  });
  const recipeId = await db.recipes.add({
    categoryId: cid,
    name: trimmed,
    linkedProductId: null,
    linkedProductCategoryId: null,
    linkedProductGroupId: null,
    yieldPortions: DEFAULT_RECIPE_YIELD,
    portionWeightGrams: portionG,
    showTotalAsPortions: false,
    notes: String(notes || '').trim().slice(0, 4000),
    sortOrder: maxOrder + 1,
    ...baking,
  });
  const catIds = linkedProductCategoryIds?.length
    ? linkedProductCategoryIds
    : (linkedProductCategoryId ? [linkedProductCategoryId] : []);
  const groupIds = linkedProductGroupIds?.length
    ? linkedProductGroupIds
    : (linkedProductGroupId ? [linkedProductGroupId] : []);
  const pids = linkedProductIds?.length
    ? linkedProductIds
    : (linkedProductId ? [linkedProductId] : []);
  if (catIds.length) await setRecipeProductCategoryLinks(recipeId, catIds);
  if (groupIds.length) await setRecipeProductGroupLinks(recipeId, groupIds);
  if (pids.length) await setRecipeProductLinks(recipeId, pids);
  await syncRecipePortionPresets(recipeId);
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
  if ('linkedProductCategoryIds' in data) {
    await setRecipeProductCategoryLinks(rid, data.linkedProductCategoryIds);
    delete data.linkedProductCategoryIds;
    data.linkedProductCategoryId = null;
  } else if ('linkedProductCategoryId' in data) {
    data.linkedProductCategoryId = data.linkedProductCategoryId
      ? sanitizeProductId(data.linkedProductCategoryId)
      : null;
  }
  if ('linkedProductGroupIds' in data) {
    await setRecipeProductGroupLinks(rid, data.linkedProductGroupIds);
    delete data.linkedProductGroupIds;
    data.linkedProductGroupId = null;
  } else if ('linkedProductGroupId' in data) {
    data.linkedProductGroupId = data.linkedProductGroupId
      ? sanitizeProductId(data.linkedProductGroupId)
      : null;
  }
  if ('portionWeightGrams' in data) {
    data.portionWeightGrams = data.portionWeightGrams != null && data.portionWeightGrams !== ''
      ? sanitizeQuantity(data.portionWeightGrams, { allowZero: false })
      : null;
  }
  data.yieldPortions = DEFAULT_RECIPE_YIELD;
  data.showTotalAsPortions = false;
  if ('hasBaking' in data || 'bakingProfileId' in data) {
    Object.assign(data, normalizeRecipeBakingFields(data));
  }
  if ('notes' in data) data.notes = String(data.notes || '').trim().slice(0, 4000);
  if (Object.keys(data).length) await db.recipes.update(rid, data);
  await syncRecipePortionPresets(rid);
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

/** תצוגת משקל יחידת חלוקה — ק"ג מעל 1 ק"ג, אחרת גרם */
export function formatSubdivisionWeight(grams) {
  const g = Number(grams) || 0;
  if (g <= 0) return '';
  if (g >= 1000) return `${roundQty(g / 1000)} ק"ג`;
  return `${Math.round(g)} גרם`;
}

/** המרת משקל חלוקה מק"ג לשמירה בגרמים */
export function gramsFromSubdivisionKg(kg) {
  const n = Number(kg);
  if (!n || n <= 0) return null;
  return sanitizeQuantity(n * 1000, { allowZero: false });
}

/** סיכום משקל: כולל (יבשים+נוזלים כק"ג), פירוט יבש/נוזל */
export function getRecipeWeightSummary(ingredients, options = {}) {
  const { totalKg, totalLiters } = computeRecipeIngredientsTotal(ingredients, options);
  const totalRecipeKg = roundQty(totalKg + totalLiters);
  const recipe = options.recipe;
  const weightText = totalRecipeKg > 0 ? formatKgWeight(totalRecipeKg) : '';
  const mainText = weightText
    ? (recipe ? `מנה אחת — ${weightText}` : weightText)
    : '';
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

/** כמה יחידות חלוקה יוצאות ממנה אחת — לפי משקל יחידה */
export function computeRecipeProductUnits(totalRecipeKg, yieldPortions, unitWeightGrams) {
  const totalG = (Number(totalRecipeKg) || 0) * 1000;
  const unitG = Number(unitWeightGrams) || 0;
  const yieldP = Number(yieldPortions) || 1;
  if (totalG <= 0 || unitG <= 0 || yieldP <= 0) return null;
  const totalUnits = totalG / unitG;
  return {
    totalUnits: roundQty(totalUnits),
    unitsPerPortion: roundQty(totalUnits / yieldP),
  };
}

/** תשואת חלוקה למתכון — מנה אחת (משקל כולל) ויחידות לפי portionWeightGrams */
export function getRecipeProductYieldInfo(recipe, ingredients) {
  const summary = getRecipeWeightSummary(ingredients, { recipe });
  const unitG = Number(recipe?.portionWeightGrams) || 0;
  const yieldP = 1;
  const units = unitG > 0 && summary.totalRecipeKg > 0
    ? computeRecipeProductUnits(summary.totalRecipeKg, yieldP, unitG)
    : null;
  return { summary, unitG, yieldP, units };
}

/** יחס הקפצה לפי מספר יחידות חלוקה רצוי (בלי עיגול ביניים של totalUnits) */
export function recipeScaleRatioForProductCount(recipe, ingredients, targetProductCount) {
  const unitG = Number(recipe?.portionWeightGrams) || 0;
  const target = Number(targetProductCount);
  const totalG = recipeTotalWeightGrams(ingredients);
  if (!unitG || !Number.isFinite(target) || target <= 0 || totalG <= 0) return null;
  const exactTotalUnits = totalG / unitG;
  if (!Number.isFinite(exactTotalUnits) || exactTotalUnits <= 0) return null;
  const ratio = target / exactTotalUnits;
  return Number.isFinite(ratio) && ratio > 0 ? ratio : null;
}

/** הקפצת כמויות חומרי גלם לפי מספר מוצרים רצוי */
export function scaleRecipeIngredientsForProductCount(ingredients, recipe, targetProductCount) {
  const ratio = recipeScaleRatioForProductCount(recipe, ingredients, targetProductCount);
  if (ratio == null) return null;
  return (ingredients || []).map((ing) => ({
    ...ing,
    scaledQuantity: roundQty(Number(ing.quantity) * ratio),
  }));
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
  let skippedDuplicate = 0;
  let quantitiesUpdated = 0;
  let failed = 0;
  let rawMaterialsAdded = 0;
  const existingMaterials = addRawMaterials ? await db.rawMaterials.toArray() : [];
  const materialNames = new Set(existingMaterials.map((m) => m.name));
  const dbExistingKeys = skipDuplicates ? await getExistingRecipeNameKeys() : new Set();
  const batchNameKeys = new Set();

  const resolveImportRecipeName = (rawTitle) => {
    let base = sanitizeName(rawTitle, 80) || 'מתכון ללא שם';
    let candidate = base;
    let key = normalizeRecipeImportKey(candidate);
    let n = 2;
    while (batchNameKeys.has(key)) {
      const suffix = ` (${n})`;
      const maxBase = Math.max(1, 80 - suffix.length);
      base = (sanitizeName(rawTitle, maxBase) || 'מתכון ללא שם').slice(0, maxBase);
      candidate = `${base}${suffix}`;
      key = normalizeRecipeImportKey(candidate);
      n += 1;
    }
    batchNameKeys.add(key);
    return candidate;
  };

  for (const item of parsedRecipes) {
    try {
      const nameKey = normalizeRecipeImportKey(item.title);
      const existsInDb = nameKey && dbExistingKeys.has(nameKey);
      if (existsInDb && updateExistingQuantities) {
        const result = await updateRecipeQuantitiesFromParsed(item);
        if (result.ingredientsUpdated + result.ingredientsAdded > 0) quantitiesUpdated += 1;
        else skipped += 1;
        continue;
      }
      if (skipDuplicates && existsInDb) {
        skippedDuplicate += 1;
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

      const recipeName = resolveImportRecipeName(item.title);
      const recipeId = await addRecipe({
        categoryId: subId,
        name: recipeName,
        notes: item.notes || '',
      });
      for (let ingIdx = 0; ingIdx < (item.ingredients || []).length; ingIdx++) {
        const ing = item.ingredients[ingIdx];
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
          sortOrder: ingIdx + 1,
        });
      }
      imported += 1;
    } catch (err) {
      failed += 1;
      console.error('importParsedRecipes item failed:', item?.title, err);
    }
  }
  return { imported, skipped, skippedDuplicate, rawMaterialsAdded, quantitiesUpdated, failed };
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
  const childRecipes = await getRecipeSubRecipes(rid);
  for (const child of childRecipes) {
    await deleteRecipe(child.id);
  }
  const recipePresets = await db.groupPortionPresets.filter((p) => p.sourceRecipeId === rid).toArray();
  await db.transaction(
    'rw',
    db.recipes,
    db.recipeIngredients,
    db.recipeProductLinks,
    db.recipeProductCategoryLinks,
    db.recipeProductGroupLinks,
    db.groupPortionPresets,
    db.portionPresetIngredientSettings,
    async () => {
    await db.recipeIngredients.where('recipeId').equals(rid).delete();
    await db.recipeProductLinks.where('recipeId').equals(rid).delete();
    await db.recipeProductCategoryLinks.where('recipeId').equals(rid).delete();
    await db.recipeProductGroupLinks.where('recipeId').equals(rid).delete();
    for (const p of recipePresets) {
      if (db.portionPresetIngredientSettings) {
        await db.portionPresetIngredientSettings.where('portionPresetId').equals(p.id).delete();
      }
      await db.groupPortionPresets.delete(p.id);
    }
    await db.recipes.delete(rid);
  });
  await syncRawMaterialsActiveFromRecipes();
}

/** מוחק את כל המתכונים (רכיבים וקישורים) — קטגוריות וקבוצות נשארות */
export async function deleteAllRecipes() {
  await db.transaction('rw', db.recipes, db.recipeIngredients, db.recipeProductLinks, db.recipeProductCategoryLinks, db.recipeProductGroupLinks, async () => {
    await db.recipeIngredients.clear();
    await db.recipeProductLinks.clear();
    await db.recipeProductCategoryLinks.clear();
    await db.recipeProductGroupLinks.clear();
    await db.recipes.clear();
  });
  await syncRawMaterialsActiveFromRecipes();
}

export async function updateRecipeIngredient(id, patch) {
  const iid = sanitizeProductId(id);
  if (!iid) return;
  const data = { ...patch };
  if ('name' in data) data.name = sanitizeName(data.name, 80);
  if ('quantity' in data) data.quantity = sanitizeRecipeQuantity(data.quantity, { allowZero: false });
  if ('unitKind' in data) {
    data.unitKind = normalizeRecipeUnitKind(data.unitKind);
    data.unit = formatRecipeUnitKind(data.unitKind);
  }
  if ('unit' in data && !('unitKind' in data)) {
    data.unitKind = normalizeRecipeUnitKind(data.unit);
    data.unit = formatRecipeUnitKind(data.unitKind);
  }
  if ('priceSource' in data) {
    data.priceSource = data.priceSource === 'supplier' ? 'supplier' : 'max';
    if (data.priceSource === 'max') data.rawMaterialId = null;
  }
  if ('rawMaterialId' in data) {
    data.rawMaterialId = data.rawMaterialId ? sanitizeProductId(data.rawMaterialId) : null;
  }
  await db.recipeIngredients.update(iid, data);
  const ing = await db.recipeIngredients.get(iid);
  if (ing?.recipeId) await syncRecipePortionPresets(ing.recipeId);
  await syncRawMaterialsActiveFromRecipes();
}

export function getIngredientPriceSource(ing) {
  if (ing?.priceSource === 'max' || ing?.priceSource === 'supplier') return ing.priceSource;
  return ing?.rawMaterialId ? 'supplier' : 'max';
}

export function buildMaterialsByNameKey(materials) {
  const map = new Map();
  const add = (key, m) => {
    if (!key) return;
    if (!map.has(key)) map.set(key, []);
    const list = map.get(key);
    if (!list.some((x) => x.id === m.id)) list.push(m);
  };
  for (const m of materials || []) {
    add(normalizeMaterialKey(m.name), m);
    for (const syn of getMaterialSynonyms(m)) {
      add(normalizeMaterialKey(syn), m);
    }
  }
  return map;
}

/** מזהי חומרי גלם שמופיעים במתכונים (לפי שיוך ישיר או התאמת שם) */
export async function getRecipeLinkedRawMaterialIds() {
  const [ings, materials] = await Promise.all([
    db.recipeIngredients.toArray(),
    db.rawMaterials.toArray(),
  ]);
  const byNameKey = buildMaterialsByNameKey(materials);
  const ids = new Set();
  for (const ing of ings) {
    if (ing.rawMaterialId) ids.add(Number(ing.rawMaterialId));
    const key = normalizeMaterialKey(ing.name);
    if (!key) continue;
    for (const m of byNameKey.get(key) || []) ids.add(m.id);
  }
  return ids;
}

/** מסמן חומרי גלם כפעילים אם הם במתכונים; אריזות תמיד פעילות */
export async function syncRawMaterialsActiveFromRecipes() {
  const [linkedIds, materials, categories] = await Promise.all([
    getRecipeLinkedRawMaterialIds(),
    db.rawMaterials.toArray(),
    getSupplierCategories(),
  ]);
  const packagingCatIds = new Set(
    categories.filter((c) => isPackagingSupplierCategory(c)).map((c) => c.id),
  );
  const updates = [];
  for (const m of materials) {
    const isPackaging = packagingCatIds.has(m.supplierCategoryId) || !!m.packagingKind;
    const shouldBeActive = isPackaging || linkedIds.has(m.id);
    if (m.active !== shouldBeActive) {
      updates.push(db.rawMaterials.update(m.id, { active: shouldBeActive }));
    }
  }
  if (updates.length) await Promise.all(updates);
}

export function sanitizeProcessedPricePerKg(value) {
  if (value == null || value === '') return null;
  const n = sanitizeMoney(value);
  return n > 0 ? n : null;
}

export function getMaterialPurchasePricePerKg(mat) {
  const ppk = computePricePerKg(mat?.unitPrice, mat?.packageWeightGrams);
  if (ppk != null) return ppk;
  const unitPrice = Number(mat?.unitPrice) || 0;
  return unitPrice > 0 ? unitPrice : null;
}

export function getMaterialEffectivePricePerKg(mat) {
  const processed = sanitizeProcessedPricePerKg(mat?.processedPricePerKg);
  if (processed != null) return processed;
  return getMaterialPurchasePricePerKg(mat);
}

function materialComparisonPrice(mat) {
  return getMaterialEffectivePricePerKg(mat) ?? 0;
}

export function pickHighestPricedMaterial(offers) {
  if (!offers?.length) return null;
  return offers.reduce((best, m) => (
    materialComparisonPrice(m) > materialComparisonPrice(best) ? m : best
  ), offers[0]);
}

/** הצעת ספק שמסומנת כברירת מחדל למתכונים */
export function pickRecipeDefaultMaterial(offers) {
  if (!offers?.length) return null;
  return offers.find((m) => m.isRecipeDefault) || null;
}

/**
 * פותר חומר גלם לשורת מתכון.
 * priceSource=max → ברירת מחדל לספק אם סומנה, אחרת המחיר הגבוה ביותר.
 * priceSource=supplier → הצעה ספציפית (עקיפה במתכון).
 */
export function resolveRecipeIngredientMaterial(ing, { matById, byNameKey }) {
  const source = getIngredientPriceSource(ing);
  if (source === 'supplier' && ing.rawMaterialId) {
    const mat = matById.get(Number(ing.rawMaterialId));
    if (mat) return { mat, priceSource: 'supplier' };
  }
  const key = normalizeMaterialKey(ing.name);
  const offers = byNameKey.get(key) || [];
  const preferred = pickRecipeDefaultMaterial(offers);
  let mat = preferred || pickHighestPricedMaterial(offers);
  if (!mat && ing.rawMaterialId) mat = matById.get(Number(ing.rawMaterialId)) || null;
  return {
    mat,
    priceSource: 'max',
    usedRecipeDefault: !!preferred && mat && preferred.id === mat.id,
  };
}

/** מסמן / מבטל הצעת ספק כברירת מחדל למתכונים (רק אחת לכל שם חומר) */
export async function setRawMaterialRecipeDefault(materialId, enabled = true) {
  const mid = sanitizeProductId(materialId);
  if (!mid) throw new ValidationError('חומר לא תקין');
  const mat = await db.rawMaterials.get(mid);
  if (!mat) throw new ValidationError('חומר לא נמצא');

  const key = normalizeMaterialKey(mat.name);
  const all = await db.rawMaterials.toArray();
  const siblings = all.filter((m) => normalizeMaterialKey(m.name) === key);

  await db.transaction('rw', db.rawMaterials, async () => {
    for (const sibling of siblings) {
      const next = enabled && sibling.id === mid;
      if (!!sibling.isRecipeDefault !== next) {
        await db.rawMaterials.update(sibling.id, { isRecipeDefault: next });
      }
    }
  });
  return mid;
}

export function computeIngredientLineCost(ing, mat) {
  const qty = Number(ing?.quantity) || 0;
  if (!mat || qty <= 0) return 0;
  const kind = ing.unitKind || normalizeRecipeUnitKind(ing.unit);
  const unitPrice = Number(mat.unitPrice) || 0;
  const perKg = getMaterialEffectivePricePerKg(mat);
  if (kind === 'g') {
    const rate = perKg ?? unitPrice;
    return roundQty((qty / 1000) * rate);
  }
  if (kind === 'kg') {
    const rate = perKg ?? unitPrice;
    return roundQty(qty * rate);
  }
  return roundQty(qty * unitPrice);
}

export async function computeRecipeMaterialsCost(ingredients, materials) {
  const mats = materials || await getRawMaterials();
  const matById = new Map(mats.map((m) => [m.id, m]));
  const byNameKey = buildMaterialsByNameKey(mats);
  let total = 0;
  for (const ing of ingredients || []) {
    const { mat } = resolveRecipeIngredientMaterial(ing, { matById, byNameKey });
    total += computeIngredientLineCost(ing, mat);
  }
  return roundQty(total);
}

export async function getMaterialsByIngredientName(name) {
  const key = normalizeMaterialKey(name);
  if (!key) return [];
  const all = await db.rawMaterials.toArray();
  return all.filter((m) => {
    if (normalizeMaterialKey(m.name) === key) return true;
    return getMaterialSynonyms(m).some((s) => normalizeMaterialKey(s) === key);
  });
}

async function syncRecipesAffectedByMaterial(materialId) {
  const mat = await db.rawMaterials.get(Number(materialId));
  if (!mat) return;
  const key = normalizeMaterialKey(mat.name);
  const allIngs = await db.recipeIngredients.toArray();
  const recipeIds = new Set();
  for (const ing of allIngs) {
    if (Number(ing.rawMaterialId) === Number(materialId)) recipeIds.add(ing.recipeId);
    else if (getIngredientPriceSource(ing) === 'max' && normalizeMaterialKey(ing.name) === key) {
      recipeIds.add(ing.recipeId);
    }
  }
  for (const rid of recipeIds) {
    try {
      await syncProductCostFromRecipe(rid);
    } catch {
      /* no linked products */
    }
  }
  const affectedProductIds = new Set();
  const components = await db.productRecipeComponents.toArray();
  for (const comp of components) {
    if (recipeIds.has(comp.recipeId)) affectedProductIds.add(comp.productId);
  }
  for (const pid of affectedProductIds) {
    try {
      await syncProductCostIfRecipesMode(pid);
    } catch {
      /* no product */
    }
  }
}

export async function addRecipeIngredient(recipeId, { rawMaterialId, name, quantity, unit, unitKind, sortOrder, priceSource }) {
  const rid = sanitizeProductId(recipeId);
  const trimmed = sanitizeName(name, 80);
  if (!rid) throw new ValidationError('מתכון לא תקין');
  if (!trimmed) throw new ValidationError('שם חומר לא תקין');
  const qty = sanitizeRecipeQuantity(quantity, { allowZero: false });
  const existing = await db.recipeIngredients.where('recipeId').equals(rid).toArray();
  const maxOrder = existing.reduce((m, r) => Math.max(m, r.sortOrder ?? 0), 0);
  const matId = rawMaterialId ? sanitizeProductId(rawMaterialId) : null;
  const kind = unitKind ? normalizeRecipeUnitKind(unitKind) : normalizeRecipeUnitKind(unit);
  const order = Number.isFinite(sortOrder) && sortOrder > 0 ? sortOrder : maxOrder + 1;
  const src = priceSource === 'supplier' ? 'supplier' : 'max';
  const ingId = await db.recipeIngredients.add({
    recipeId: rid,
    rawMaterialId: src === 'supplier' && matId ? matId : null,
    name: trimmed,
    quantity: qty,
    unit: formatRecipeUnitKind(kind),
    unitKind: kind,
    sortOrder: order,
    priceSource: src,
  });
  await syncRecipePortionPresets(rid);
  await syncRawMaterialsActiveFromRecipes();
  return ingId;
}

export async function deleteRecipeIngredient(id) {
  const iid = sanitizeProductId(id);
  if (!iid) return;
  const ing = await db.recipeIngredients.get(iid);
  await db.recipeIngredients.delete(iid);
  if (ing?.recipeId) await syncRecipePortionPresets(ing.recipeId);
  await syncRawMaterialsActiveFromRecipes();
}

/** מנה בקטלוג בלבד — מתכון בלי שיוך לקבוצת מוצרים (לא מופיע בתזרים לפי קבוצה) */
export const PORTION_CATALOG_ONLY_GROUP_ID = 0;

/** קבוצות מוצרים (קטגוריות כלליות) המושפעות משיוך מתכון למוצרים / קטגוריית מתכון */
export async function resolveCategoryGroupIdsForRecipe(recipe) {
  if (!recipe) return [];
  const groupIds = new Set();

  const directGroupIds = recipe.linkedProductGroupIds?.length
    ? recipe.linkedProductGroupIds
    : (recipe.linkedProductGroupId ? [recipe.linkedProductGroupId] : []);
  for (const gid of directGroupIds) {
    const n = Number(gid);
    if (n) groupIds.add(n);
  }

  const catIds = recipe.linkedProductCategoryIds?.length
    ? recipe.linkedProductCategoryIds
    : (recipe.linkedProductCategoryId ? [recipe.linkedProductCategoryId] : []);
  for (const cid of catIds) {
    const cat = await db.categories.get(Number(cid));
    if (cat?.groupId) groupIds.add(Number(cat.groupId));
  }

  const productIds = recipe.linkedProductIds?.length
    ? recipe.linkedProductIds
    : (recipe.linkedProductId ? [recipe.linkedProductId] : []);
  for (const pid of productIds) {
    const prod = await db.products.get(Number(pid));
    if (!prod?.categoryId) continue;
    const cat = await db.categories.get(prod.categoryId);
    if (cat?.groupId) groupIds.add(Number(cat.groupId));
  }

  // נפילה לקטגוריית המתכון עצמה (קישור לקבוצת מוצרים / קטגוריית מוצר)
  if (recipe.categoryId) {
    const recipeCat = await db.recipeCategories.get(Number(recipe.categoryId));
    if (recipeCat) {
      if (recipeCat.linkedCategoryId) {
        const productCat = await db.categories.get(Number(recipeCat.linkedCategoryId));
        if (productCat?.groupId) groupIds.add(Number(productCat.groupId));
      }
      if (recipeCat.groupId) {
        const recipeGroup = await db.recipeGroups.get(Number(recipeCat.groupId));
        if (recipeGroup?.linkedCategoryGroupId) {
          groupIds.add(Number(recipeGroup.linkedCategoryGroupId));
        }
      }
    }
  }

  return [...groupIds];
}

/** בניית שדות מנה לתזרים ממתכון — המתכון כולו = מנה אחת (גם בלי משקל מחושב) */
export function buildRecipePortionPresetFields(recipe, ingredients = []) {
  if (!recipe) return null;
  const totalG = recipeTotalWeightGrams(ingredients);
  let weightKg = totalG > 0 ? sanitizePortionSize(totalG / 1000) : null;
  if (weightKg == null) weightKg = 0.001;
  const unitG = Number(recipe.portionWeightGrams) || 0;
  let extra = recipe.parentRecipeId ? 'תת מתכון' : 'מנה אחת';
  if (totalG <= 0) {
    extra = recipe.parentRecipeId ? 'תת מתכון · ללא משקל' : 'ללא משקל מחושב';
  } else if (unitG > 0) {
    const units = computeRecipeProductUnits(weightKg, 1, unitG);
    const countStr = units
      ? formatRecipeQuantity(units.totalUnits)
      : formatRecipeQuantity(totalG / unitG);
    const unitPart = `${countStr} יחידות × ${formatSubdivisionWeight(unitG)}`;
    extra = recipe.parentRecipeId ? `תת מתכון · ${unitPart}` : unitPart;
  }
  return {
    name: recipe.name,
    weight: weightKg,
    extra,
  };
}

/** סנכרון מנות מתכון לרשימת המנות — כל מתכון מקבל מנה בקטלוג */
export async function syncRecipePortionPresets(recipeId) {
  const rid = sanitizeProductId(recipeId);
  if (!rid) return;
  const recipe = await getRecipe(rid);
  if (!recipe) return;

  const groupIds = await resolveCategoryGroupIdsForRecipe(recipe);
  const presetData = buildRecipePortionPresetFields(recipe, recipe.ingredients);
  if (!presetData) return;

  const existing = await db.groupPortionPresets.filter((p) => p.sourceRecipeId === rid).toArray();
  const targetGroups = groupIds.length
    ? new Set(groupIds)
    : new Set([PORTION_CATALOG_ONLY_GROUP_ID]);

  for (const row of existing) {
    if (!targetGroups.has(Number(row.categoryGroupId))) {
      await deletePortionPresetIngredientSettings(row.id);
      await db.groupPortionPresets.delete(row.id);
    }
  }

  const freshExisting = await db.groupPortionPresets.filter((p) => p.sourceRecipeId === rid).toArray();
  for (const gid of targetGroups) {
    const row = freshExisting.find((p) => Number(p.categoryGroupId) === Number(gid));
    if (row) {
      await db.groupPortionPresets.update(row.id, { ...presetData, sourceRecipeId: rid });
    } else {
      const groupPresets = await db.groupPortionPresets
        .where('categoryGroupId')
        .equals(gid)
        .toArray();
      const maxOrder = groupPresets.reduce((m, p) => Math.max(m, p.sortOrder ?? 0), 0);
      await db.groupPortionPresets.add({
        categoryGroupId: gid,
        ...presetData,
        sourceRecipeId: rid,
        sortOrder: maxOrder + 1,
      });
    }
  }
}

/** סנכרון כל המתכונים — לשדרוג / תיקון נתונים */
export async function syncAllRecipePortionPresets() {
  const recipes = await db.recipes.toArray();
  for (const r of recipes) {
    await syncRecipePortionPresets(r.id);
  }
}

export async function deletePortionPresetIngredientSettings(portionPresetId) {
  const pid = Number(portionPresetId);
  if (!pid || !db.portionPresetIngredientSettings) return;
  await db.portionPresetIngredientSettings.where('portionPresetId').equals(pid).delete();
}

/** נתוני טופס רכיבי מנה — רכיבי מתכון + ספקים אפשריים + הגדרות שמורות */
export async function getPortionPresetIngredientsFormData(portionPresetId) {
  const preset = await db.groupPortionPresets.get(Number(portionPresetId));
  if (!preset?.sourceRecipeId) throw new ValidationError('מנה לא מקושרת למתכון');

  const rid = Number(preset.sourceRecipeId);
  const [ingredients, materials, suppliers, existingSettings] = await Promise.all([
    db.recipeIngredients.where('recipeId').equals(rid).toArray(),
    getRawMaterials(),
    getSuppliers(),
    db.portionPresetIngredientSettings
      ? db.portionPresetIngredientSettings.where('portionPresetId').equals(preset.id).toArray()
      : Promise.resolve([]),
  ]);

  ingredients.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id);
  const supMap = new Map(suppliers.map((s) => [s.id, s.name]));
  const byNameKey = buildMaterialsByNameKey(materials);
  const settingsMap = new Map(existingSettings.map((s) => [Number(s.recipeIngredientId), s]));
  const ingredientIds = new Set(ingredients.map((i) => i.id));

  return {
    presetName: preset.name,
    rows: ingredients.map((ing) => {
    const key = normalizeMaterialKey(ing.name);
    const offers = (byNameKey.get(key) || [])
      .filter((m) => m.active !== false)
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id);
    const setting = settingsMap.get(ing.id) || {};
    const supplierOptions = offers.map((m) => ({
      id: m.id,
      supplierId: m.supplierId,
      supplierName: supMap.get(m.supplierId) || 'ללא ספק',
      label: `${supMap.get(m.supplierId) || 'ללא ספק'} — ${m.name}`,
    }));
    let rawMaterialId = setting.rawMaterialId ? Number(setting.rawMaterialId) : null;
    if (rawMaterialId && !offers.some((m) => m.id === rawMaterialId)) rawMaterialId = null;
    if (!rawMaterialId && ing.rawMaterialId && offers.some((m) => m.id === Number(ing.rawMaterialId))) {
      rawMaterialId = Number(ing.rawMaterialId);
    }
    if (!rawMaterialId && offers.length === 1) rawMaterialId = offers[0].id;
    return {
      recipeIngredientId: ing.id,
      name: ing.name,
      quantity: ing.quantity,
      unit: ing.unit || '',
      packagingPortionCount: setting.packagingPortionCount ?? '',
      rawMaterialId,
      supplierOptions,
    };
  }),
  };
}

export async function savePortionPresetIngredientSettings(portionPresetId, rows) {
  const pid = Number(portionPresetId);
  const preset = await db.groupPortionPresets.get(pid);
  if (!preset?.sourceRecipeId) throw new ValidationError('מנה לא מקושרת למתכון');
  if (!db.portionPresetIngredientSettings) return;

  const validIngredientIds = new Set(
    (await db.recipeIngredients.where('recipeId').equals(Number(preset.sourceRecipeId)).toArray())
      .map((i) => i.id),
  );
  const materials = await getRawMaterials();
  const matIds = new Set(materials.map((m) => m.id));

  await db.transaction('rw', db.portionPresetIngredientSettings, async () => {
    await db.portionPresetIngredientSettings.where('portionPresetId').equals(pid).delete();
    for (const row of rows || []) {
      const recipeIngredientId = Number(row.recipeIngredientId);
      if (!validIngredientIds.has(recipeIngredientId)) continue;
      const packagingRaw = row.packagingPortionCount;
      const packagingPortionCount = packagingRaw === '' || packagingRaw == null
        ? null
        : sanitizePortionCount(packagingRaw, { min: 0.1 });
      let rawMaterialId = row.rawMaterialId ? Number(row.rawMaterialId) : null;
      if (rawMaterialId && !matIds.has(rawMaterialId)) rawMaterialId = null;
      if (packagingPortionCount == null && !rawMaterialId) continue;
      await db.portionPresetIngredientSettings.add({
        portionPresetId: pid,
        recipeIngredientId,
        packagingPortionCount,
        rawMaterialId,
      });
    }
  });
}

/** מזהי מוצרים המקושרים למתכון — לפי קבוצה / קטגוריה / מוצרים ספציפיים */
export async function resolveRecipeLinkedProductIds(recipe, productCatalog = null) {
  if (!recipe) return [];
  const groupIds = recipe.linkedProductGroupIds?.length
    ? recipe.linkedProductGroupIds
    : (recipe.linkedProductGroupId ? [recipe.linkedProductGroupId] : []);
  if (groupIds.length) {
    const ids = new Set();
    for (const gid of groupIds) {
      if (productCatalog) {
        collectProductIdsFromCatalogScope(productCatalog, { groupId: gid }).forEach((id) => ids.add(id));
      } else {
        const categories = await db.categories.where('groupId').equals(Number(gid)).toArray();
        for (const cat of categories) {
          const prods = await db.products.where('categoryId').equals(cat.id).toArray();
          for (const p of prods) {
            if (p.active !== false) ids.add(p.id);
          }
        }
      }
    }
    return [...ids];
  }
  const catIds = recipe.linkedProductCategoryIds?.length
    ? recipe.linkedProductCategoryIds
    : (recipe.linkedProductCategoryId ? [recipe.linkedProductCategoryId] : []);
  if (catIds.length) {
    const ids = new Set();
    for (const cid of catIds) {
      if (productCatalog) {
        collectProductIdsFromCatalogScope(productCatalog, { categoryId: cid }).forEach((id) => ids.add(id));
      } else {
        const prods = await db.products.where('categoryId').equals(Number(cid)).toArray();
        for (const p of prods) {
          if (p.active !== false) ids.add(p.id);
        }
      }
    }
    return [...ids];
  }
  const links = recipe.linkedProductIds?.length
    ? recipe.linkedProductIds
    : (recipe.linkedProductId ? [recipe.linkedProductId] : []);
  return links.map(Number).filter(Boolean);
}

export function collectProductIdsFromCatalogScope(productCatalog, { groupId, categoryId } = {}) {
  const ids = [];
  const pushCat = (cat) => {
    if (categoryId && Number(cat.id) !== Number(categoryId)) return;
    for (const p of cat.products || []) ids.push(p.id);
  };
  if (groupId) {
    const group = productCatalog.groups.find((g) => Number(g.id) === Number(groupId));
    if (group) for (const cat of group.categories) pushCat(cat);
    return ids;
  }
  if (categoryId) {
    for (const group of productCatalog.groups) {
      for (const cat of group.categories) pushCat(cat);
    }
    for (const cat of productCatalog.ungrouped || []) pushCat(cat);
  }
  return ids;
}

export function inferRecipeProductLinkScope(recipe) {
  if (recipe?.linkedProductGroupIds?.length) return 'group';
  if (recipe?.linkedProductCategoryIds?.length) return 'category';
  if (recipe?.linkedProductIds?.length) return 'product';
  if (recipe?.linkedProductGroupId) return 'group';
  if (recipe?.linkedProductCategoryId) return 'category';
  return '';
}

export function isProductRecipesCostSource(product) {
  return sanitizeRawMaterialsCostSource(product?.rawMaterialsCostSource) === 'recipes';
}

/** סנכרון מחיר חומרי גלם במוצר מסכום המתכון */
export async function syncProductCostFromRecipe(recipeId) {
  const recipe = await getRecipe(recipeId);
  const productIds = await resolveRecipeLinkedProductIds(recipe);
  if (!productIds.length) throw new ValidationError('אין מוצרים מקושרים');
  const cost = await computeRecipeMaterialsCost(recipe.ingredients);
  for (const pid of productIds) {
    const product = await db.products.get(pid);
    if (!isProductRecipesCostSource(product)) continue;
    await db.products.update(pid, { rawMaterialsCost: cost });
  }
  return cost;
}

/** משקל כולל של מתכון בגרמים (יבשים + נוזלים כק"ג) */
export function recipeTotalWeightGrams(ingredients, { useScaled = false } = {}) {
  const { totalKg, totalLiters } = computeRecipeIngredientsTotal(ingredients, { useScaled });
  return Math.round((totalKg + totalLiters) * 1000);
}

/** קנה מידה לרכיבי מתכון לפי משקל יעד בגרמים */
export function scaleIngredientsToTargetGrams(ingredients, targetGrams) {
  const totalG = recipeTotalWeightGrams(ingredients);
  if (!totalG || !targetGrams || targetGrams <= 0) {
    return (ingredients || []).map((ing) => ({ ...ing, scaledQuantity: ing.quantity }));
  }
  const ratio = targetGrams / totalG;
  return (ingredients || []).map((ing) => ({
    ...ing,
    scaledQuantity: roundQty(Number(ing.quantity) * ratio),
  }));
}

function ingredientsWithScaledQuantity(ingredients) {
  return (ingredients || []).map((ing) => (
    ing.scaledQuantity != null ? { ...ing, quantity: ing.scaledQuantity } : ing
  ));
}

/** עלות חומרי גלם — אופציונלית רק מחירי ספק */
export async function computeRecipeMaterialsCostFiltered(ingredients, materials, { supplierOnly = false } = {}) {
  const mats = materials || await getRawMaterials();
  const matById = new Map(mats.map((m) => [m.id, m]));
  const byNameKey = buildMaterialsByNameKey(mats);
  let total = 0;
  for (const ing of ingredientsWithScaledQuantity(ingredients)) {
    const source = getIngredientPriceSource(ing);
    if (supplierOnly && source !== 'supplier') continue;
    const { mat, priceSource } = resolveRecipeIngredientMaterial(ing, { matById, byNameKey });
    if (supplierOnly && priceSource !== 'supplier') continue;
    if (supplierOnly && (!mat || !(Number(mat.unitPrice) > 0))) continue;
    total += computeIngredientLineCost(ing, mat);
  }
  return roundQty(total);
}

export async function getProductRecipeComponents(productId) {
  const pid = sanitizeProductId(productId);
  if (!pid) return [];
  const rows = await db.productRecipeComponents.where('productId').equals(pid).toArray();
  rows.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id);
  return rows;
}

export async function addProductRecipeComponent({ productId, recipeId, weightGrams, notes }) {
  const pid = sanitizeProductId(productId);
  const rid = sanitizeProductId(recipeId);
  if (!pid || !rid) throw new ValidationError('שיוך לא תקין');
  const recipe = await db.recipes.get(rid);
  if (!recipe) throw new ValidationError('מתכון לא נמצא');
  const dup = await db.productRecipeComponents
    .where('[productId+recipeId]')
    .equals([pid, rid])
    .first();
  if (dup) throw new ValidationError('מתכון כבר ברכיבי המוצר');
  const existing = await getProductRecipeComponents(pid);
  const maxOrder = existing.reduce((m, r) => Math.max(m, r.sortOrder ?? 0), 0);
  const wg = weightGrams != null && weightGrams !== ''
    ? sanitizeQuantity(weightGrams, { allowZero: false })
    : null;
  return db.productRecipeComponents.add({
    productId: pid,
    recipeId: rid,
    weightGrams: wg,
    notes: String(notes || '').trim().slice(0, 500),
    sortOrder: maxOrder + 1,
  });
}

export async function updateProductRecipeComponent(id, patch) {
  const cid = sanitizeProductId(id);
  if (!cid) return;
  const data = { ...patch };
  if ('weightGrams' in data) {
    data.weightGrams = data.weightGrams != null && data.weightGrams !== ''
      ? sanitizeQuantity(data.weightGrams, { allowZero: false })
      : null;
  }
  if ('notes' in data) data.notes = String(data.notes || '').trim().slice(0, 500);
  if (Object.keys(data).length) await db.productRecipeComponents.update(cid, data);
}

export async function deleteProductRecipeComponent(id) {
  const cid = sanitizeProductId(id);
  if (cid) await db.productRecipeComponents.delete(cid);
}

export async function getRecipesForProduct(productId) {
  const pid = sanitizeProductId(productId);
  if (!pid) return [];
  const recipeIds = new Set();
  const links = await db.recipeProductLinks.where('productId').equals(pid).toArray();
  for (const l of links) recipeIds.add(l.recipeId);
  const legacy = await db.recipes.where('linkedProductId').equals(pid).toArray();
  for (const r of legacy) recipeIds.add(r.id);

  const product = await db.products.get(pid);
  if (product?.categoryId) {
    const catLinks = await db.recipeProductCategoryLinks.where('categoryId').equals(product.categoryId).toArray();
    for (const l of catLinks) recipeIds.add(l.recipeId);
    const catRecipes = await db.recipes.where('linkedProductCategoryId').equals(product.categoryId).toArray();
    for (const r of catRecipes) recipeIds.add(r.id);
    const cat = await db.categories.get(product.categoryId);
    if (cat?.groupId) {
      const groupLinks = await db.recipeProductGroupLinks.where('groupId').equals(cat.groupId).toArray();
      for (const l of groupLinks) recipeIds.add(l.recipeId);
      const groupRecipes = await db.recipes.where('linkedProductGroupId').equals(cat.groupId).toArray();
      for (const r of groupRecipes) recipeIds.add(r.id);
    }
  }

  const recipes = [];
  for (const rid of recipeIds) {
    const recipe = await getRecipe(rid);
    if (recipe) recipes.push(recipe);
  }
  recipes.sort((a, b) => a.name.localeCompare(b.name, 'he'));
  return recipes;
}

export async function getProductBakingProfileLink(productId) {
  const resolved = await resolveBakingProfileForProduct(productId);
  if (!resolved?.profile) return null;
  const { profile, source, scopeType, scopeId, scopeName, link } = resolved;
  if (source === 'product' && link) {
    return { ...link, profile, source, scopeType, scopeId, scopeName };
  }
  return {
    bakingProfileId: profile.id,
    productId: sanitizeProductId(productId),
    profile,
    source,
    scopeType,
    scopeId,
    scopeName,
  };
}

export async function getProductDetail(productId) {
  const pid = sanitizeProductId(productId);
  if (!pid) throw new ValidationError('מוצר לא תקין');
  const product = await db.products.get(pid);
  if (!product) throw new ValidationError('מוצר לא נמצא');

  const [components, linkedRecipes, bakingLink, materials, profiles, category] = await Promise.all([
    getProductRecipeComponents(pid),
    getRecipesForProduct(pid),
    getProductBakingProfileLink(pid),
    getRawMaterials(),
    getBakingProfiles(),
    db.categories.get(product.categoryId),
  ]);
  const profileMap = new Map(profiles.map((p) => [p.id, p]));

  let totalWeightGrams = 0;
  let recommendedCost = 0;
  let fullCost = 0;
  const enrichedComponents = [];

  for (const comp of components) {
    const recipe = await getRecipe(comp.recipeId);
    if (!recipe) continue;
    const recipeTotalG = recipeTotalWeightGrams(recipe.ingredients);
    const targetG = comp.weightGrams != null && comp.weightGrams > 0 ? comp.weightGrams : recipeTotalG;
    const scaledIngredients = targetG > 0 && recipeTotalG > 0
      ? scaleIngredientsToTargetGrams(recipe.ingredients, targetG)
      : recipe.ingredients;

    const lineSupplierCost = await computeRecipeMaterialsCostFiltered(
      scaledIngredients, materials, { supplierOnly: true },
    );
    const lineFullCost = await computeRecipeMaterialsCost(
      ingredientsWithScaledQuantity(scaledIngredients), materials,
    );

    totalWeightGrams += targetG || 0;
    recommendedCost += lineSupplierCost;
    fullCost += lineFullCost;

    enrichedComponents.push({
      ...comp,
      recipe,
      recipeTotalGrams: recipeTotalG,
      effectiveWeightGrams: targetG,
      scaledIngredients,
      supplierCost: lineSupplierCost,
      fullCost: lineFullCost,
      bakingLine: formatRecipeBakingParamsLine(recipe, profileMap),
    });
  }

  const rawMaterialsCostSource = sanitizeRawMaterialsCostSource(product.rawMaterialsCostSource);
  const effectiveRawCost = rawMaterialsCostSource === 'recipes'
    ? roundQty(recommendedCost)
    : (product.rawMaterialsCost || 0);
  const totalCost = effectiveRawCost + (product.packagingCost || 0) + (product.additionalCosts || 0);
  const unitPrice = Number(product.unitPrice) || 0;

  return {
    product,
    category,
    components: enrichedComponents,
    linkedRecipes,
    bakingProfileLink: bakingLink,
    bakingProfile: bakingLink?.profile || null,
    totalWeightGrams,
    recommendedCost: roundQty(recommendedCost),
    fullCost: roundQty(fullCost),
    currentCosts: {
      rawMaterialsCost: effectiveRawCost,
      rawMaterialsCostSource,
      packagingCost: product.packagingCost || 0,
      additionalCosts: product.additionalCosts || 0,
      unitPrice,
      totalCost: roundQty(totalCost),
    },
    margin: unitPrice > 0 ? roundQty(unitPrice - totalCost) : null,
  };
}

/** סנכרון עלות חומרי גלם במוצר מסכום הרכיבים (מחירי ספק) */
export async function syncProductCostFromComposition(productId, { setSource = false } = {}) {
  const pid = sanitizeProductId(productId);
  if (!pid) throw new ValidationError('מוצר לא תקין');
  const product = await db.products.get(pid);
  if (!product) throw new ValidationError('מוצר לא נמצא');

  let recommendedCost = 0;
  const components = await getProductRecipeComponents(pid);
  const materials = await getRawMaterials();
  for (const comp of components) {
    const recipe = await getRecipe(comp.recipeId);
    if (!recipe) continue;
    const recipeTotalG = recipeTotalWeightGrams(recipe.ingredients);
    const targetG = comp.weightGrams != null && comp.weightGrams > 0 ? comp.weightGrams : recipeTotalG;
    const scaledIngredients = targetG > 0 && recipeTotalG > 0
      ? scaleIngredientsToTargetGrams(recipe.ingredients, targetG)
      : recipe.ingredients;
    recommendedCost += await computeRecipeMaterialsCostFiltered(
      scaledIngredients, materials, { supplierOnly: true },
    );
  }
  const cost = roundQty(recommendedCost);
  const patch = { rawMaterialsCost: cost };
  if (setSource) patch.rawMaterialsCostSource = 'recipes';
  await db.products.update(pid, patch);
  return cost;
}

/** סנכרון עלות מרכיבים רק כשמקור העלות הוא מתכונים */
export async function syncProductCostIfRecipesMode(productId) {
  const pid = sanitizeProductId(productId);
  if (!pid) return null;
  const product = await db.products.get(pid);
  if (!isProductRecipesCostSource(product)) return null;
  return syncProductCostFromComposition(pid);
}

/* ── קטגוריות ספקים / אריזות ── */

export const PACKAGING_KIND_CARTON = 'carton';
export const PACKAGING_KIND_PLASTIC = 'plastic';

export function getPackagingKindLabel(kind) {
  if (kind === PACKAGING_KIND_CARTON) return 'קרטון';
  if (kind === PACKAGING_KIND_PLASTIC) return 'פלסטיק';
  return '';
}

export function isPackagingSupplierCategory(cat) {
  return !!cat?.isPackaging;
}

function sanitizePackagingKind(value) {
  if (value === PACKAGING_KIND_CARTON || value === PACKAGING_KIND_PLASTIC) return value;
  return null;
}

function sanitizePackCount(value, { defaultValue = 1 } = {}) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n < 1) return defaultValue;
  return Math.min(n, 100000);
}

export function computePackagingCostPerProduct(material) {
  if (!material?.packagingKind) return null;
  const price = Number(material.unitPrice) || 0;
  if (price <= 0) return null;
  const unitsInPack = sanitizePackCount(material.packUnitsCount);
  const pricePerUnit = price / unitsInPack;
  if (material.packagingKind === PACKAGING_KIND_CARTON) {
    const productsPerUnit = sanitizePackCount(material.packProductsPerUnit);
    return Math.round((pricePerUnit / productsPerUnit) * 100) / 100;
  }
  return Math.round(pricePerUnit * 100) / 100;
}

function normalizePackagingFields(raw, { categoryIsPackaging = false } = {}) {
  if (!categoryIsPackaging && !raw?.packagingKind) {
    return {
      packagingKind: null,
      packUnitsCount: null,
      packProductsPerUnit: null,
    };
  }
  const kind = sanitizePackagingKind(raw?.packagingKind) || PACKAGING_KIND_CARTON;
  const packUnitsCount = sanitizePackCount(raw?.packUnitsCount);
  const packProductsPerUnit = kind === PACKAGING_KIND_CARTON
    ? sanitizePackCount(raw?.packProductsPerUnit)
    : null;
  return { packagingKind: kind, packUnitsCount, packProductsPerUnit };
}

export async function getSupplierCategories() {
  const rows = await db.supplierCategories.toArray();
  rows.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id);
  return rows;
}

export async function addSupplierCategory(name, { isPackaging = false } = {}) {
  const trimmed = sanitizeName(name, 40);
  if (!trimmed) throw new ValidationError('שם קטגוריה לא תקין');
  const existing = await getSupplierCategories();
  if (existing.some((c) => c.name === trimmed)) throw new ValidationError('קטגוריה כבר קיימת');
  const maxOrder = existing.reduce((m, c) => Math.max(m, c.sortOrder ?? 0), 0);
  return db.supplierCategories.add({
    name: trimmed,
    sortOrder: maxOrder + 1,
    isPackaging: !!isPackaging,
  });
}

export async function updateSupplierCategory(id, patch) {
  const cid = sanitizeProductId(id);
  if (!cid) return;
  const data = { ...patch };
  if ('name' in data) {
    data.name = sanitizeName(data.name, 40);
    if (!data.name) throw new ValidationError('שם קטגוריה לא תקין');
    const existing = await getSupplierCategories();
    if (existing.some((c) => c.id !== cid && c.name === data.name)) {
      throw new ValidationError('קטגוריה כבר קיימת');
    }
  }
  if ('isPackaging' in data) data.isPackaging = !!data.isPackaging;
  if (Object.keys(data).length) await db.supplierCategories.update(cid, data);
  if ('isPackaging' in data) await syncRawMaterialsActiveFromRecipes();
}

export async function setSupplierCategoryOrder(orderedIds) {
  await db.transaction('rw', db.supplierCategories, async () => {
    for (let i = 0; i < orderedIds.length; i++) {
      await db.supplierCategories.update(Number(orderedIds[i]), { sortOrder: i + 1 });
    }
  });
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
  const prev = await db.suppliers.get(sid);
  await db.suppliers.update(sid, data);
  if (prev && 'categoryId' in data && data.categoryId && data.categoryId !== prev.categoryId) {
    const mats = await db.rawMaterials.where('supplierId').equals(sid).toArray();
    for (const m of mats) {
      await db.rawMaterials.update(m.id, { supplierCategoryId: data.categoryId });
    }
  }
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

function sanitizePackageWeightGrams(val) {
  if (val == null || val === '') return null;
  const n = Number(val);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100) / 100;
}

export function computePricePerKg(unitPrice, packageWeightGrams) {
  const price = sanitizeMoney(unitPrice);
  const grams = sanitizePackageWeightGrams(packageWeightGrams);
  if (!grams || price <= 0) return null;
  return Math.round((price / (grams / 1000)) * 100) / 100;
}

export function packageWeightKgFromGrams(packageWeightGrams) {
  const grams = sanitizePackageWeightGrams(packageWeightGrams);
  if (!grams) return null;
  return Math.round((grams / 1000) * 1000) / 1000;
}

export function packageWeightGramsFromKg(packageWeightKg) {
  if (packageWeightKg == null || packageWeightKg === '') return null;
  const kg = Number(packageWeightKg);
  if (!Number.isFinite(kg) || kg <= 0) return null;
  return sanitizePackageWeightGrams(kg * 1000);
}

export function computePackagePrice(pricePerKg, packageWeightKg) {
  const perKg = sanitizeMoney(pricePerKg);
  const kg = Number(packageWeightKg);
  if (!Number.isFinite(kg) || kg <= 0 || perKg <= 0) return null;
  return Math.round(perKg * kg * 100) / 100;
}

export function rawMaterialPricingFromPerKg({ pricePerKg, packageWeightKg } = {}) {
  const perKg = sanitizeMoney(pricePerKg);
  const grams = packageWeightGramsFromKg(packageWeightKg);
  const unitPrice = grams != null
    ? (computePackagePrice(perKg, packageWeightKg) ?? 0)
    : perKg;
  return { unitPrice, packageWeightGrams: grams };
}

export async function addRawMaterial({
  supplierCategoryId, name, unit, unitPrice, supplierId, packageWeightGrams,
  processedPricePerKg,
  packagingKind, packUnitsCount, packProductsPerUnit,
  synonyms,
}) {
  const cid = sanitizeProductId(supplierCategoryId);
  const trimmed = sanitizeName(name, 80);
  if (!cid) throw new ValidationError('קטגוריה לא תקינה');
  if (!trimmed) throw new ValidationError('שם חומר לא תקין');
  const category = await db.supplierCategories.get(cid);
  const inCat = await getRawMaterials(cid);
  const maxOrder = inCat.reduce((m, r) => Math.max(m, r.sortOrder ?? 0), 0);
  const price = sanitizeMoney(unitPrice);
  const sid = supplierId ? sanitizeProductId(supplierId) : null;
  const pkg = sanitizePackageWeightGrams(packageWeightGrams);
  const packaging = normalizePackagingFields(
    { packagingKind, packUnitsCount, packProductsPerUnit },
    { categoryIsPackaging: isPackagingSupplierCategory(category) },
  );
  const id = await db.rawMaterials.add({
    supplierCategoryId: cid,
    name: trimmed,
    unit: String(unit || (isPackagingSupplierCategory(category) ? 'חבילה' : 'ק"ג')).trim().slice(0, 20),
    unitPrice: price,
    supplierId: sid,
    packageWeightGrams: isPackagingSupplierCategory(category) ? null : pkg,
    processedPricePerKg: isPackagingSupplierCategory(category)
      ? null
      : sanitizeProcessedPricePerKg(processedPricePerKg),
    synonyms: sanitizeMaterialSynonyms(synonyms),
    ...packaging,
    active: isPackagingSupplierCategory(category),
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
  if ('packageWeightGrams' in data) data.packageWeightGrams = sanitizePackageWeightGrams(data.packageWeightGrams);
  if ('processedPricePerKg' in data) {
    data.processedPricePerKg = sanitizeProcessedPricePerKg(data.processedPricePerKg);
  }
  if ('synonyms' in data) data.synonyms = sanitizeMaterialSynonyms(data.synonyms);
  if ('packagingKind' in data || 'packUnitsCount' in data || 'packProductsPerUnit' in data) {
    const current = await db.rawMaterials.get(mid);
    const category = current
      ? await db.supplierCategories.get(current.supplierCategoryId)
      : null;
    const packaging = normalizePackagingFields(
      {
        packagingKind: 'packagingKind' in data ? data.packagingKind : current?.packagingKind,
        packUnitsCount: 'packUnitsCount' in data ? data.packUnitsCount : current?.packUnitsCount,
        packProductsPerUnit: 'packProductsPerUnit' in data ? data.packProductsPerUnit : current?.packProductsPerUnit,
      },
      { categoryIsPackaging: isPackagingSupplierCategory(category) },
    );
    Object.assign(data, packaging);
  }
  if (Object.keys(data).length) {
    await db.rawMaterials.update(mid, data);
    if ('name' in data) await syncRawMaterialsActiveFromRecipes();
  }
}

export async function deleteRawMaterial(id) {
  const mid = sanitizeProductId(id);
  if (!mid) return;
  await db.rawMaterialPriceHistory.where('rawMaterialId').equals(mid).delete();
  await db.rawMaterials.delete(mid);
  await syncRawMaterialsActiveFromRecipes();
}

export function sanitizeMaterialSynonyms(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const s = sanitizeName(String(item || ''), 80);
    if (!s) continue;
    const key = s.toLocaleLowerCase('he');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
    if (out.length >= 24) break;
  }
  return out;
}

export function getMaterialSynonyms(material) {
  return sanitizeMaterialSynonyms(material?.synonyms);
}

/** חיפוש חומר גלם לפי שם, מילים נרדפות או שם ספק */
export function materialMatchesSearch(material, query, { supplierName = '' } = {}) {
  const q = String(query || '').trim().toLocaleLowerCase('he');
  if (!q) return true;
  const name = String(material?.name || '').toLocaleLowerCase('he');
  if (name.includes(q)) return true;
  const sup = String(supplierName || '').toLocaleLowerCase('he');
  if (sup && sup.includes(q)) return true;
  return getMaterialSynonyms(material).some((s) => s.toLocaleLowerCase('he').includes(q));
}

export function normalizeMaterialKey(name) {
  const s = sanitizeName(name, 80);
  return s ? s.toLocaleLowerCase('he') : '';
}

async function priceHistoryEntryExists(rawMaterialId, effectiveDate, price) {
  const rows = await db.rawMaterialPriceHistory
    .where('[rawMaterialId+effectiveDate]')
    .equals([rawMaterialId, effectiveDate])
    .toArray();
  const p = sanitizeMoney(price);
  return rows.some((r) => sanitizeMoney(r.price) === p);
}

export async function getMasterMaterialsList(supplierCategoryId) {
  let rows = await db.rawMaterials.toArray();
  const cid = supplierCategoryId ? sanitizeProductId(supplierCategoryId) : null;
  if (cid) rows = rows.filter((m) => m.supplierCategoryId === cid);

  const byKey = new Map();
  for (const m of rows) {
    const key = normalizeMaterialKey(m.name);
    if (!key) continue;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(m);
  }

  const list = [];
  for (const [key, offers] of byKey.entries()) {
    offers.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id);
    const supplierIds = new Set(offers.filter((o) => o.supplierId).map((o) => o.supplierId));
    const recipeDefault = offers.find((o) => o.isRecipeDefault) || null;
    list.push({
      key,
      name: offers[0].name,
      supplierCategoryId: offers[0].supplierCategoryId,
      offers,
      primaryId: offers[0].id,
      supplierCount: supplierIds.size,
      recipeDefaultId: recipeDefault?.id || null,
      recipeDefaultSupplierId: recipeDefault?.supplierId || null,
    });
  }
  list.sort((a, b) => a.name.localeCompare(b.name, 'he'));
  return list;
}

export async function getCombinedPriceHistory(materialId) {
  const mats = await getMaterialsWithSameName(materialId);
  if (!mats.length) return [];
  const suppliers = await getSuppliers();
  const supMap = new Map(suppliers.map((s) => [s.id, s.name]));
  const matById = new Map(mats.map((m) => [m.id, m]));

  const rows = [];
  for (const mat of mats) {
    const history = await getPriceHistory(mat.id);
    for (const h of history) {
      rows.push({
        ...h,
        rawMaterialId: mat.id,
        supplierName: mat.supplierId ? supMap.get(mat.supplierId) || '' : '',
        pricePerKg: computePricePerKg(h.price, mat.packageWeightGrams),
      });
    }
  }
  rows.sort((a, b) => {
    const d = b.effectiveDate.localeCompare(a.effectiveDate);
    if (d !== 0) return d;
    return (b.createdAt || '').localeCompare(a.createdAt || '');
  });
  return rows;
}

export async function assignMaterialToSupplier({
  name, supplierCategoryId, supplierId, unitPrice, packageWeightGrams, unit,
}) {
  const trimmed = sanitizeName(name, 80);
  const cid = sanitizeProductId(supplierCategoryId);
  const sid = sanitizeProductId(supplierId);
  if (!trimmed) throw new ValidationError('שם חומר לא תקין');
  if (!cid) throw new ValidationError('קטגוריה לא תקינה');
  if (!sid) throw new ValidationError('ספק לא תקין');

  const all = await db.rawMaterials.toArray();
  const key = normalizeMaterialKey(trimmed);
  const sameKey = all.filter((m) => normalizeMaterialKey(m.name) === key);
  const canonicalName = sameKey.length ? sameKey[0].name : trimmed;

  let mat = await findRawMaterialBySupplierAndName(sid, canonicalName);
  if (mat) {
    const patch = {};
    if (unit) patch.unit = unit;
    if (packageWeightGrams != null && packageWeightGrams !== '') {
      patch.packageWeightGrams = packageWeightGrams;
    }
    if (Object.keys(patch).length) await updateRawMaterial(mat.id, patch);
    if (unitPrice != null && unitPrice !== '') {
      const price = sanitizeMoney(unitPrice);
      if (price >= 0) {
        await addRawMaterialPriceEntry(mat.id, { price, effectiveDate: todayISO() }, { skipDuplicate: true });
      }
    }
    return mat.id;
  }

  return addRawMaterial({
    supplierCategoryId: cid,
    name: canonicalName,
    unit: unit || 'ק"ג',
    unitPrice: unitPrice ?? 0,
    supplierId: sid,
    packageWeightGrams,
  });
}

export async function getDuplicateMaterialGroups() {
  const all = await db.rawMaterials.toArray();
  const byKey = new Map();
  for (const m of all) {
    const key = normalizeMaterialKey(m.name);
    if (!key) continue;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(m);
  }
  return Array.from(byKey.entries())
    .filter(([, mats]) => mats.length > 1)
    .map(([key, materials]) => ({
      key,
      name: materials[0].name,
      materials: materials.sort((a, b) => a.id - b.id),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'he'));
}

/** בונה מילים נרדפות לאיחוד — שמות/מילים נרדפות של הרשומות המאוחדות (בלי שם היעד) */
export function buildMergedMaterialSynonyms(keep, others = []) {
  if (!keep) return [];
  const keepKey = normalizeMaterialKey(keep.name);
  const collected = [...getMaterialSynonyms(keep)];
  for (const m of others || []) {
    if (!m) continue;
    const nameKey = normalizeMaterialKey(m.name);
    if (nameKey && nameKey !== keepKey) collected.push(m.name);
    collected.push(...getMaterialSynonyms(m));
  }
  return sanitizeMaterialSynonyms(
    collected.filter((s) => normalizeMaterialKey(s) !== keepKey),
  );
}

function materialFieldFillPatch(keep, others) {
  const patch = {};
  if (!keep.packageWeightGrams) {
    const from = others.find((o) => o.packageWeightGrams);
    if (from) patch.packageWeightGrams = from.packageWeightGrams;
  }
  if (sanitizeProcessedPricePerKg(keep.processedPricePerKg) == null) {
    const from = others.find((o) => sanitizeProcessedPricePerKg(o.processedPricePerKg) != null);
    if (from) patch.processedPricePerKg = from.processedPricePerKg;
  }
  if (!keep.supplierId) {
    const from = others.find((o) => o.supplierId);
    if (from) patch.supplierId = from.supplierId;
  }
  if (!String(keep.unit || '').trim()) {
    const from = others.find((o) => String(o.unit || '').trim());
    if (from) patch.unit = from.unit;
  }
  if (!keep.supplierCategoryId) {
    const from = others.find((o) => o.supplierCategoryId);
    if (from) patch.supplierCategoryId = from.supplierCategoryId;
  }
  if (!keep.isRecipeDefault && others.some((o) => o.isRecipeDefault)) {
    patch.isRecipeDefault = true;
  }
  if ((Number(keep.unitPrice) || 0) <= 0) {
    const from = others.find((o) => (Number(o.unitPrice) || 0) > 0);
    if (from) patch.unitPrice = from.unitPrice;
  }
  return patch;
}

async function renameRecipeIngredientsMaterialName(fromName, toName) {
  const fromKey = normalizeMaterialKey(fromName);
  const to = sanitizeName(toName, 80);
  if (!fromKey || !to || fromKey === normalizeMaterialKey(to)) return;
  const ings = await db.recipeIngredients.toArray();
  for (const ing of ings) {
    if (normalizeMaterialKey(ing.name) === fromKey) {
      await db.recipeIngredients.update(ing.id, { name: to });
    }
  }
}

export async function mergeDuplicateMaterials(keepId, mergeIds) {
  const keep = sanitizeProductId(keepId);
  if (!keep) throw new ValidationError('חומר לא תקין');
  const ids = (mergeIds || []).map(sanitizeProductId).filter((id) => id && id !== keep);
  if (!ids.length) return;

  await db.transaction('rw', db.rawMaterials, db.rawMaterialPriceHistory, db.recipeIngredients, async () => {
    for (const mid of ids) {
      await mergeMaterialIntoKeep(keep, mid);
    }
  });
  await syncRawMaterialLatestPrice(keep);
  await syncRawMaterialsActiveFromRecipes();
}

async function mergeMaterialIntoKeep(keep, mid) {
  if (!keep || !mid || keep === mid) return;
  const ings = await db.recipeIngredients.where('rawMaterialId').equals(mid).toArray();
  for (const ing of ings) {
    await db.recipeIngredients.update(ing.id, { rawMaterialId: keep });
  }
  const history = await db.rawMaterialPriceHistory.where('rawMaterialId').equals(mid).toArray();
  for (const h of history) {
    const exists = await priceHistoryEntryExists(keep, h.effectiveDate, h.price);
    if (exists) {
      await db.rawMaterialPriceHistory.delete(h.id);
    } else {
      await db.rawMaterialPriceHistory.update(h.id, { rawMaterialId: keep });
    }
  }
  await db.rawMaterials.delete(mid);
}

/**
 * איחוד ידני של חומרי גלם נבחרים (גם עם שמות שונים).
 * שם היעד נשאר; שמות אחרים + מילים נרדפות מאוחדים לרשימת מילים נרדפות.
 */
export async function mergeSelectedRawMaterials(keepId, mergeIds) {
  const keep = sanitizeProductId(keepId);
  if (!keep) throw new ValidationError('חומר לא תקין');
  const ids = [...new Set((mergeIds || []).map(sanitizeProductId).filter((id) => id && id !== keep))];
  if (!ids.length) throw new ValidationError('בחר לפחות חומר נוסף לאיחוד');

  const keepMat = await db.rawMaterials.get(keep);
  if (!keepMat) throw new ValidationError('חומר היעד לא נמצא');
  const others = [];
  for (const mid of ids) {
    const mat = await db.rawMaterials.get(mid);
    if (mat) others.push(mat);
  }
  if (!others.length) throw new ValidationError('לא נמצאו חומרים לאיחוד');

  const synonyms = buildMergedMaterialSynonyms(keepMat, others);
  const fillPatch = materialFieldFillPatch(keepMat, others);
  const shouldSetDefault = !!fillPatch.isRecipeDefault;

  await db.transaction('rw', db.rawMaterials, db.rawMaterialPriceHistory, db.recipeIngredients, async () => {
    for (const mat of others) {
      await renameRecipeIngredientsMaterialName(mat.name, keepMat.name);
      await mergeMaterialIntoKeep(keep, mat.id);
    }
    const patch = { ...fillPatch, synonyms };
    delete patch.isRecipeDefault;
    await db.rawMaterials.update(keep, patch);
  });

  if (shouldSetDefault) {
    await setRawMaterialRecipeDefault(keep, true);
  }
  await syncRawMaterialLatestPrice(keep);
  await syncRawMaterialsActiveFromRecipes();
  await syncRecipesAffectedByMaterial(keep);
  return keep;
}

/** שומר מספר רשומות (ספקים) — לא מסומנות מאוחדות לרשומת יעד מתאימה */
export async function mergeDuplicateMaterialsKeeping(keepIds, mergeIds) {
  const keeps = [...new Set((keepIds || []).map(sanitizeProductId).filter(Boolean))];
  if (!keeps.length) throw new ValidationError('סמן לפחות רשומה אחת לשמירה');
  const primary = keeps[0];
  const ids = (mergeIds || []).map(sanitizeProductId).filter((id) => id && !keeps.includes(id));
  if (!ids.length) throw new ValidationError('אין רשומות לאיחוד');

  const keepMats = (await Promise.all(keeps.map((id) => db.rawMaterials.get(id)))).filter(Boolean);
  const keepBySupplier = new Map();
  for (const m of keepMats) {
    if (m.supplierId && !keepBySupplier.has(m.supplierId)) keepBySupplier.set(m.supplierId, m.id);
  }

  const touched = new Set();
  await db.transaction('rw', db.rawMaterials, db.rawMaterialPriceHistory, db.recipeIngredients, async () => {
    for (const mid of ids) {
      const mat = await db.rawMaterials.get(mid);
      if (!mat) continue;
      let target = mat.supplierId ? keepBySupplier.get(mat.supplierId) : null;
      if (!target || !keeps.includes(target)) target = primary;
      await mergeMaterialIntoKeep(target, mid);
      touched.add(target);
    }
  });
  for (const kid of touched) {
    await syncRawMaterialLatestPrice(kid);
  }
  await syncRawMaterialsActiveFromRecipes();
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
  await syncRecipesAffectedByMaterial(rawMaterialId);
}

export async function addRawMaterialPriceEntry(rawMaterialId, { price, effectiveDate } = {}, { skipDuplicate } = {}) {
  const mid = sanitizeProductId(rawMaterialId);
  if (!mid) throw new ValidationError('חומר לא תקין');
  const p = sanitizeMoney(price);
  const date = effectiveDate && /^\d{4}-\d{2}-\d{2}$/.test(String(effectiveDate))
    ? String(effectiveDate)
    : todayISO();
  if (skipDuplicate && await priceHistoryEntryExists(mid, date, p)) return null;
  const id = await db.rawMaterialPriceHistory.add({
    rawMaterialId: mid,
    price: p,
    effectiveDate: date,
    createdAt: new Date().toISOString(),
  });
  await syncRawMaterialLatestPrice(mid);
  return id;
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
  await syncRawMaterialsActiveFromRecipes();
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
    list.sort((a, b) => {
      const aActive = a.active === true;
      const bActive = b.active === true;
      if (aActive !== bActive) return aActive ? -1 : 1;
      return (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id;
    });
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

export async function importSupplierExcelEntries(entries, { defaultCategoryId, fileHint } = {}) {
  if (!entries?.length) throw new ValidationError('אין נתונים לייבוא');
  let defaultCatId = sanitizeProductId(defaultCategoryId);
  if (!defaultCatId) {
    const cats = await getSupplierCategories();
    defaultCatId = cats[0]?.id;
    if (!defaultCatId) defaultCatId = await addSupplierCategory('ייבוא Excel');
  }

  const stats = { suppliersAdded: 0, materialsAdded: 0, priceEntries: 0 };
  const undo = {
    importId: `sup-${Date.now()}`,
    createdAt: new Date().toISOString(),
    fileHint: fileHint || '',
    priceHistoryIds: [],
    createdMaterialIds: [],
    createdSupplierIds: [],
    createdCategoryIds: [],
    materialPatches: [],
  };
  const supplierCache = new Map();
  const existingCategoryIds = new Set((await getSupplierCategories()).map((c) => c.id));
  const patchedMaterialIds = new Set();

  for (const entry of entries) {
    const materialName = sanitizeName(entry.materialName, 80);
    const supplierName = sanitizeName(entry.supplierName, 60);
    if (!materialName || !supplierName) continue;

    let catId = defaultCatId;
    if (entry.categoryName) {
      const beforeCats = await getSupplierCategories();
      catId = await findOrCreateSupplierCategory(entry.categoryName);
      if (!existingCategoryIds.has(catId)) {
        const wasNew = !beforeCats.some((c) => c.id === catId);
        if (wasNew) {
          undo.createdCategoryIds.push(catId);
          existingCategoryIds.add(catId);
        }
      }
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
        undo.createdSupplierIds.push(supplierId);
      }
      supplierCache.set(supKey, supplierId);
    }

    const hadMat = await findRawMaterialBySupplierAndName(supplierId, materialName);
    const existingMat = hadMat ? await db.rawMaterials.get(hadMat.id) : null;
    if (existingMat && !patchedMaterialIds.has(existingMat.id)) {
      patchedMaterialIds.add(existingMat.id);
      undo.materialPatches.push({
        id: existingMat.id,
        unitPrice: existingMat.unitPrice,
        packageWeightGrams: existingMat.packageWeightGrams ?? null,
        unit: existingMat.unit,
      });
    }

    const mid = await assignMaterialToSupplier({
      name: materialName,
      supplierCategoryId: catId,
      supplierId,
      unit: entry.unit || 'ק"ג',
      packageWeightGrams: entry.packageWeightGrams,
    });
    const mat = await db.rawMaterials.get(mid);
    if (!hadMat && mat) {
      stats.materialsAdded += 1;
      undo.createdMaterialIds.push(mat.id);
    }
    if (entry.unit && mat && entry.unit !== mat.unit) {
      await updateRawMaterial(mat.id, { unit: entry.unit });
    }
    if (entry.packageWeightGrams != null && mat) {
      await updateRawMaterial(mat.id, { packageWeightGrams: entry.packageWeightGrams });
    }

    const price = entry.price != null ? sanitizeMoney(entry.price) : null;
    if (price != null && price >= 0 && mat) {
      const effDate = entry.effectiveDate || todayISO();
      const histId = await addRawMaterialPriceEntry(mat.id, {
        price,
        effectiveDate: effDate,
      }, { skipDuplicate: true });
      if (histId) {
        stats.priceEntries += 1;
        undo.priceHistoryIds.push(histId);
      }
    }
  }

  await saveSupplierImportUndo(undo);
  await syncRawMaterialsActiveFromRecipes();
  return { stats, undo };
}

const SUPPLIER_IMPORT_UNDO_KEY = 'supplierImportUndo';

export async function saveSupplierImportUndo(undo) {
  await db.settings.put({ key: SUPPLIER_IMPORT_UNDO_KEY, value: undo });
}

export async function getSupplierImportUndo() {
  const row = await db.settings.get(SUPPLIER_IMPORT_UNDO_KEY);
  return row?.value || null;
}

export async function clearSupplierImportUndo() {
  await db.settings.delete(SUPPLIER_IMPORT_UNDO_KEY);
}

/** ביטול ייבוא אחרון — לא מוחק חומרים שמקושרים למתכונים */
export async function undoSupplierImport() {
  const undo = await getSupplierImportUndo();
  if (!undo) throw new ValidationError('אין ייבוא לביטול');

  let keptForRecipes = 0;

  await db.transaction(
    'rw',
    db.rawMaterials,
    db.rawMaterialPriceHistory,
    db.suppliers,
    db.supplierCategories,
    db.recipeIngredients,
    async () => {
      for (const hid of undo.priceHistoryIds || []) {
        await db.rawMaterialPriceHistory.delete(hid);
      }

      const patchedIds = new Set();
      for (const patch of undo.materialPatches || []) {
        if (patchedIds.has(patch.id)) continue;
        patchedIds.add(patch.id);
        const updates = {};
        if ('unitPrice' in patch) updates.unitPrice = patch.unitPrice;
        if ('packageWeightGrams' in patch) updates.packageWeightGrams = patch.packageWeightGrams;
        if ('unit' in patch) updates.unit = patch.unit;
        await db.rawMaterials.update(patch.id, updates);
        await syncRawMaterialLatestPrice(patch.id);
      }

      for (const mid of undo.createdMaterialIds || []) {
        const linked = await db.recipeIngredients.where('rawMaterialId').equals(mid).count();
        if (linked > 0) {
          keptForRecipes += 1;
          await syncRawMaterialLatestPrice(mid);
          continue;
        }
        await db.rawMaterialPriceHistory.where('rawMaterialId').equals(mid).delete();
        await db.rawMaterials.delete(mid);
      }

      for (const sid of undo.createdSupplierIds || []) {
        const mats = await db.rawMaterials.where('supplierId').equals(sid).count();
        if (mats === 0) await db.suppliers.delete(sid);
      }

      for (const cid of undo.createdCategoryIds || []) {
        const mats = await db.rawMaterials.where('supplierCategoryId').equals(cid).count();
        const sups = await db.suppliers.where('categoryId').equals(cid).count();
        if (mats === 0 && sups === 0) await db.supplierCategories.delete(cid);
      }
    },
  );

  await clearSupplierImportUndo();
  return { keptForRecipes };
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
    const scale = Number(item.plannedPortions);

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

/* ── חוסרים לפי ספק ── */

export async function getSupplierShortages() {
  const rows = await db.supplierShortages.toArray();
  rows.sort((a, b) => (a.supplierId - b.supplierId)
    || (a.sortOrder ?? 0) - (b.sortOrder ?? 0)
    || a.id - b.id);
  return rows;
}

export async function getSupplierShortagesGrouped() {
  const [items, suppliers, materials] = await Promise.all([
    getSupplierShortages(),
    getSuppliers(),
    getRawMaterials(),
  ]);
  const supMap = new Map(suppliers.map((s) => [s.id, s]));
  const matMap = new Map(materials.map((m) => [m.id, m]));
  const groups = new Map();

  for (const item of items) {
    if (!groups.has(item.supplierId)) {
      groups.set(item.supplierId, {
        supplier: supMap.get(item.supplierId) || null,
        items: [],
      });
    }
    const mat = item.rawMaterialId ? matMap.get(item.rawMaterialId) : null;
    groups.get(item.supplierId).items.push({
      ...item,
      displayName: mat?.name || item.name || '—',
      unit: item.unit || mat?.unit || '',
    });
  }

  return [...groups.values()].sort((a, b) =>
    (a.supplier?.name || '').localeCompare(b.supplier?.name || '', 'he'));
}

export async function addSupplierShortage({
  supplierId, rawMaterialId, name, orderQuantity, unit, notes,
}) {
  const sid = sanitizeProductId(supplierId);
  if (!sid) throw new ValidationError('בחר ספק');
  const sup = await db.suppliers.get(sid);
  if (!sup) throw new ValidationError('ספק לא נמצא');

  let matId = rawMaterialId ? Number(rawMaterialId) : null;
  let label = sanitizeName(name, 80);
  if (matId) {
    const mat = await db.rawMaterials.get(matId);
    if (!mat) throw new ValidationError('חומר גלם לא נמצא');
    label = mat.name;
  } else if (!label) {
    throw new ValidationError('הזן שם חומר או בחר מהמחסן');
  }

  const inSupplier = (await getSupplierShortages()).filter((i) => i.supplierId === sid);
  const dup = inSupplier.some((i) =>
    (matId && i.rawMaterialId === matId) || (!matId && i.name === label));
  if (dup) throw new ValidationError('פריט זה כבר ברשימה');

  const maxOrder = inSupplier.reduce((m, i) => Math.max(m, i.sortOrder ?? 0), 0);
  let qty = null;
  if (orderQuantity !== '' && orderQuantity != null) {
    qty = sanitizeQuantity(orderQuantity, { allowZero: false });
    if (qty == null) throw new ValidationError('כמות הזמנה לא תקינה');
  }

  return db.supplierShortages.add({
    supplierId: sid,
    rawMaterialId: matId,
    name: label,
    orderQuantity: qty,
    unit: unit ? String(unit).trim().slice(0, 24) : '',
    notes: notes ? String(notes).trim().slice(0, 200) : '',
    done: false,
    sortOrder: maxOrder + 1,
  });
}

export async function updateSupplierShortage(id, patch) {
  const rowId = sanitizeProductId(id);
  if (!rowId) throw new ValidationError('פריט לא תקין');
  const row = await db.supplierShortages.get(rowId);
  if (!row) throw new ValidationError('פריט לא נמצא');
  const next = {};
  if (patch.orderQuantity !== undefined) {
    next.orderQuantity = patch.orderQuantity === '' || patch.orderQuantity == null
      ? null
      : sanitizeQuantity(patch.orderQuantity, { allowZero: false });
  }
  if (patch.unit !== undefined) next.unit = String(patch.unit || '').trim().slice(0, 24);
  if (patch.notes !== undefined) next.notes = String(patch.notes || '').trim().slice(0, 200);
  if (patch.done !== undefined) next.done = !!patch.done;
  if (!Object.keys(next).length) return;
  await db.supplierShortages.update(rowId, next);
}

export async function deleteSupplierShortage(id) {
  const rowId = sanitizeProductId(id);
  if (!rowId) return;
  await db.supplierShortages.delete(rowId);
}

export async function clearDoneSupplierShortages() {
  const done = await db.supplierShortages.filter((i) => i.done).toArray();
  await db.transaction('rw', db.supplierShortages, async () => {
    for (const row of done) await db.supplierShortages.delete(row.id);
  });
  return done.length;
}

export function formatSupplierShortagesText(grouped, { includeDone = false } = {}) {
  const lines = ['*רשימת חוסרים*', ''];
  let hasAny = false;
  for (const { supplier, items } of grouped) {
    const active = includeDone ? items : items.filter((i) => !i.done);
    if (!active.length) continue;
    hasAny = true;
    lines.push(`*${supplier?.name || 'ספק'}*`);
    for (const item of active) {
      const qtyPart = item.orderQuantity != null
        ? ` — ${formatDecimal(item.orderQuantity)}${item.unit ? ` ${item.unit}` : ''}`
        : '';
      lines.push(`• ${item.displayName}${qtyPart}`);
      if (item.notes) lines.push(`  _${item.notes}_`);
    }
    lines.push('');
  }
  if (!hasAny) return 'אין חוסרים ברשימה';
  lines.push('_נוצר מאפליקציית מעקב יצור_');
  return lines.join('\n').trim();
}

export const MACHINE_MEASURE_WEIGHT = 'weight';
export const MACHINE_MEASURE_LENGTH = 'length';
export const MACHINE_MEASURE_SPEED = 'speed';

export const MACHINE_TARGET_PRODUCT = 'product';
export const MACHINE_TARGET_CATEGORY = 'category';
export const MACHINE_TARGET_GROUP = 'group';

export const MACHINE_UNIT_OPTIONS = {
  [MACHINE_MEASURE_WEIGHT]: [
    { id: 'kg', label: 'ק"ג' },
    { id: 'g', label: 'גרם' },
  ],
  [MACHINE_MEASURE_LENGTH]: [
    { id: 'mm', label: 'מ"מ' },
    { id: 'cm', label: 'ס"מ' },
  ],
  [MACHINE_MEASURE_SPEED]: [
    { id: 's', label: 'שניות' },
    { id: 'ms', label: 'מילי-שניות' },
  ],
};

export function getMachineMeasureLabel(measureKind) {
  if (measureKind === MACHINE_MEASURE_LENGTH) return 'אורך';
  if (measureKind === MACHINE_MEASURE_SPEED) return 'מהירות';
  return 'משקל';
}

export function getMachineUnitLabel(measureKind, unit) {
  const opts = MACHINE_UNIT_OPTIONS[measureKind] || MACHINE_UNIT_OPTIONS[MACHINE_MEASURE_WEIGHT];
  return opts.find((o) => o.id === unit)?.label || unit || '';
}

function normalizeMachineMeasureKind(measureKind) {
  if (measureKind === MACHINE_MEASURE_LENGTH) return MACHINE_MEASURE_LENGTH;
  if (measureKind === MACHINE_MEASURE_SPEED) return MACHINE_MEASURE_SPEED;
  return MACHINE_MEASURE_WEIGHT;
}

function normalizeMachineFieldInput({ name, measureKind, unit }) {
  const cleanName = sanitizeName(name, 80);
  if (!cleanName) throw new ValidationError('שם פרמטר לא תקין');
  const kind = normalizeMachineMeasureKind(measureKind);
  const allowed = (MACHINE_UNIT_OPTIONS[kind] || []).map((o) => o.id);
  const u = allowed.includes(unit) ? unit : allowed[0];
  return { name: cleanName, measureKind: kind, unit: u };
}

function sanitizeMachineValue(raw) {
  if (raw == null || raw === '') return null;
  const n = Number(String(raw).replace(',', '.'));
  if (!Number.isFinite(n)) throw new ValidationError('ערך לא תקין');
  return Math.round(n * 1000) / 1000;
}

function normalizeMachineTargetInput(raw = {}) {
  const targetType = raw.targetType === MACHINE_TARGET_CATEGORY
    ? MACHINE_TARGET_CATEGORY
    : raw.targetType === MACHINE_TARGET_GROUP
      ? MACHINE_TARGET_GROUP
      : MACHINE_TARGET_PRODUCT;
  if (targetType === MACHINE_TARGET_GROUP) {
    const categoryGroupId = Number(raw.categoryGroupId);
    if (!categoryGroupId) throw new ValidationError('בחר קטגוריה כללית');
    return { targetType, productId: null, categoryId: null, categoryGroupId, recipeId: null };
  }
  if (targetType === MACHINE_TARGET_CATEGORY) {
    const categoryId = Number(raw.categoryId);
    if (!categoryId) throw new ValidationError('בחר קטגוריה');
    return { targetType, productId: null, categoryId, categoryGroupId: null, recipeId: null };
  }
  const productId = Number(raw.productId);
  if (!productId) throw new ValidationError('בחר מוצר');
  return { targetType, productId, categoryId: null, categoryGroupId: null, recipeId: null };
}

function inferMachineTargetType(row) {
  if (row?.targetType === MACHINE_TARGET_CATEGORY || row?.targetType === MACHINE_TARGET_GROUP) {
    return row.targetType;
  }
  return MACHINE_TARGET_PRODUCT;
}

async function findDuplicateMachineAssignment(machineId, target) {
  const mid = Number(machineId);
  if (target.targetType === MACHINE_TARGET_GROUP) {
    return db.productionMachineProducts
      .where('[machineId+targetType+categoryGroupId]')
      .equals([mid, MACHINE_TARGET_GROUP, target.categoryGroupId])
      .first();
  }
  if (target.targetType === MACHINE_TARGET_CATEGORY) {
    return db.productionMachineProducts
      .where('[machineId+targetType+categoryId]')
      .equals([mid, MACHINE_TARGET_CATEGORY, target.categoryId])
      .first();
  }
  return db.productionMachineProducts
    .where('[machineId+targetType+productId]')
    .equals([mid, MACHINE_TARGET_PRODUCT, target.productId])
    .first();
}

export function getMachineTargetKindLabel(targetType) {
  if (targetType === MACHINE_TARGET_GROUP) return 'קטגוריה כללית';
  if (targetType === MACHINE_TARGET_CATEGORY) return 'קטגוריה';
  return 'מוצר';
}

export function collectProductsForMachineAssignment(rule, products, productCatalog) {
  const active = (products || []).filter((p) => p.active !== false);
  const targetType = inferMachineTargetType(rule);
  if (targetType === MACHINE_TARGET_PRODUCT) {
    const pid = Number(rule.productId);
    return pid ? active.filter((p) => p.id === pid) : [];
  }
  if (targetType === MACHINE_TARGET_CATEGORY) {
    const cid = Number(rule.categoryId);
    return cid ? active.filter((p) => p.categoryId === cid) : [];
  }
  const gid = Number(rule.categoryGroupId);
  if (!gid) return [];
  const catIds = new Set(
    (productCatalog?.allCategories || [])
      .filter((c) => Number(c.groupId) === gid)
      .map((c) => c.id),
  );
  return active.filter((p) => catIds.has(p.categoryId));
}

export async function countEffectiveMachineProducts(machineId, productCatalog) {
  const mid = Number(machineId);
  if (!mid) return 0;
  const [assignments, products] = await Promise.all([
    db.productionMachineProducts.where('machineId').equals(mid).toArray(),
    db.products.toArray(),
  ]);
  const covered = new Set();
  for (const rule of assignments) {
    for (const p of collectProductsForMachineAssignment(rule, products, productCatalog)) {
      covered.add(p.id);
    }
  }
  return covered.size;
}

export async function getProductionMachines() {
  const rows = await db.productionMachines.toArray();
  rows.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id);
  return rows;
}

export async function getProductionMachine(id) {
  const mid = Number(id);
  if (!mid) return null;
  return db.productionMachines.get(mid);
}

export async function addProductionMachine({ name, notes } = {}) {
  const cleanName = sanitizeName(name, 80);
  if (!cleanName) throw new ValidationError('שם מכונה לא תקין');
  const existing = await getProductionMachines();
  const maxOrder = existing.reduce((m, row) => Math.max(m, row.sortOrder ?? 0), 0);
  return db.productionMachines.add({
    name: cleanName,
    notes: String(notes || '').trim().slice(0, 500),
    sortOrder: maxOrder + 1,
  });
}

export async function updateProductionMachine(id, { name, notes } = {}) {
  const mid = Number(id);
  const current = await db.productionMachines.get(mid);
  if (!current) throw new ValidationError('מכונה לא נמצאה');
  const patch = {};
  if (name != null) {
    const cleanName = sanitizeName(name, 80);
    if (!cleanName) throw new ValidationError('שם מכונה לא תקין');
    patch.name = cleanName;
  }
  if (notes !== undefined) patch.notes = String(notes || '').trim().slice(0, 500);
  if (!Object.keys(patch).length) return;
  await db.productionMachines.update(mid, patch);
}

export async function deleteProductionMachine(id) {
  const mid = Number(id);
  if (!mid) return;
  await db.transaction('rw', ...pickDbTables(
    'productionMachines', 'productionMachineFields', 'productionMachineProducts', 'productionMachineProductValues',
  ), async () => {
    const assignments = await db.productionMachineProducts.where('machineId').equals(mid).toArray();
    for (const a of assignments) {
      await db.productionMachineProductValues.where('assignmentId').equals(a.id).delete();
    }
    await db.productionMachineProducts.where('machineId').equals(mid).delete();
    await db.productionMachineFields.where('machineId').equals(mid).delete();
    await db.productionMachines.delete(mid);
  });
}

export async function getProductionMachineFields(machineId) {
  const mid = Number(machineId);
  if (!mid) return [];
  const rows = await db.productionMachineFields.where('machineId').equals(mid).toArray();
  rows.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id);
  return rows;
}

export async function addProductionMachineField(machineId, { name, measureKind, unit } = {}) {
  const mid = Number(machineId);
  const machine = await db.productionMachines.get(mid);
  if (!machine) throw new ValidationError('מכונה לא נמצאה');
  const field = normalizeMachineFieldInput({ name, measureKind, unit });
  const existing = await getProductionMachineFields(mid);
  const maxOrder = existing.reduce((m, row) => Math.max(m, row.sortOrder ?? 0), 0);
  return db.productionMachineFields.add({ machineId: mid, ...field, sortOrder: maxOrder + 1 });
}

export async function updateProductionMachineField(id, { name, measureKind, unit } = {}) {
  const fid = Number(id);
  const current = await db.productionMachineFields.get(fid);
  if (!current) throw new ValidationError('פרמטר לא נמצא');
  const patch = {};
  if (name != null) {
    const cleanName = sanitizeName(name, 80);
    if (!cleanName) throw new ValidationError('שם פרמטר לא תקין');
    patch.name = cleanName;
  }
  if (measureKind != null || unit != null) {
    const merged = normalizeMachineFieldInput({
      name: patch.name ?? current.name,
      measureKind: measureKind ?? current.measureKind,
      unit: unit ?? current.unit,
    });
    patch.measureKind = merged.measureKind;
    patch.unit = merged.unit;
  }
  if (!Object.keys(patch).length) return;
  await db.productionMachineFields.update(fid, patch);
}

export async function deleteProductionMachineField(id) {
  const fid = Number(id);
  if (!fid) return;
  await db.transaction('rw', ...pickDbTables('productionMachineFields', 'productionMachineProductValues'), async () => {
    const values = await db.productionMachineProductValues.where('fieldId').equals(fid).toArray();
    for (const v of values) await db.productionMachineProductValues.delete(v.id);
    await db.productionMachineFields.delete(fid);
  });
}

async function resolveRecipeIdForProduct(productId) {
  const recipe = await getRecipeForProduct(productId);
  return recipe?.id ?? null;
}

export async function getProductionMachineAssignments(machineId, { productCatalog } = {}) {
  const mid = Number(machineId);
  if (!mid) return [];
  const [assignments, fields, products, recipes, categories, groups] = await Promise.all([
    db.productionMachineProducts.where('machineId').equals(mid).toArray(),
    getProductionMachineFields(mid),
    db.products.toArray(),
    db.recipes.toArray(),
    db.categories.toArray(),
    db.categoryGroups.toArray(),
  ]);
  assignments.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id);
  const productMap = new Map(products.map((p) => [p.id, p]));
  const recipeMap = new Map(recipes.map((r) => [r.id, r]));
  const categoryMap = new Map(categories.map((c) => [c.id, c]));
  const groupMap = new Map(groups.map((g) => [g.id, g]));

  const result = [];
  for (const row of assignments) {
    const values = await db.productionMachineProductValues.where('assignmentId').equals(row.id).toArray();
    const valueMap = new Map(values.map((v) => [v.fieldId, v.value]));
    const targetType = inferMachineTargetType(row);
    let targetLabel = '';
    let targetPath = '';
    let productCount = 0;
    if (targetType === MACHINE_TARGET_GROUP) {
      const group = groupMap.get(Number(row.categoryGroupId));
      targetLabel = group?.name || '';
      targetPath = 'כל המוצרים בקטגוריה כללית';
      productCount = collectProductsForMachineAssignment(row, products, productCatalog).length;
    } else if (targetType === MACHINE_TARGET_CATEGORY) {
      const category = categoryMap.get(Number(row.categoryId));
      targetLabel = category?.name || '';
      const group = category?.groupId ? groupMap.get(Number(category.groupId)) : null;
      targetPath = group ? `${group.name} › ${category?.name || ''}` : (category?.name || 'כל המוצרים בקטגוריה');
      productCount = collectProductsForMachineAssignment(row, products, productCatalog).length;
    } else {
      const product = productMap.get(Number(row.productId));
      targetLabel = product?.name || '';
      const category = product ? categoryMap.get(product.categoryId) : null;
      const group = category?.groupId ? groupMap.get(Number(category.groupId)) : null;
      targetPath = group && category
        ? `${group.name} › ${category.name}`
        : (category?.name || '');
      productCount = product ? 1 : 0;
    }
    result.push({
      ...row,
      targetType,
      targetLabel,
      targetPath,
      targetKindLabel: getMachineTargetKindLabel(targetType),
      productCount,
      productName: targetType === MACHINE_TARGET_PRODUCT ? targetLabel : '',
      recipeName: targetType === MACHINE_TARGET_PRODUCT && row.recipeId
        ? (recipeMap.get(row.recipeId)?.name || '')
        : '',
      fields: fields.map((f) => ({
        ...f,
        value: valueMap.get(f.id) ?? null,
        unitLabel: getMachineUnitLabel(f.measureKind, f.unit),
        measureLabel: getMachineMeasureLabel(f.measureKind),
      })),
    });
  }
  return result;
}

export async function addProductionMachineAssignment(machineId, targetOrProductId, values = {}) {
  const mid = Number(machineId);
  if (!mid) throw new ValidationError('מכונה לא תקינה');
  const machine = await db.productionMachines.get(mid);
  if (!machine) throw new ValidationError('מכונה לא נמצאה');

  const rawTarget = typeof targetOrProductId === 'object'
    ? targetOrProductId
    : { targetType: MACHINE_TARGET_PRODUCT, productId: targetOrProductId };
  let target = normalizeMachineTargetInput(rawTarget);

  if (target.targetType === MACHINE_TARGET_PRODUCT) {
    const product = await db.products.get(target.productId);
    if (!product) throw new ValidationError('מוצר לא נמצא');
    target = { ...target, recipeId: await resolveRecipeIdForProduct(target.productId) };
  } else if (target.targetType === MACHINE_TARGET_CATEGORY) {
    const category = await db.categories.get(target.categoryId);
    if (!category) throw new ValidationError('קטגוריה לא נמצאה');
  } else {
    const group = await db.categoryGroups.get(target.categoryGroupId);
    if (!group) throw new ValidationError('קטגוריה כללית לא נמצאה');
  }

  const existing = await findDuplicateMachineAssignment(mid, target);
  if (existing) throw new ValidationError('שיוך זה כבר קיים למכונה');

  const fields = await getProductionMachineFields(mid);
  const existingRows = await db.productionMachineProducts.where('machineId').equals(mid).toArray();
  const maxOrder = existingRows.reduce((m, row) => Math.max(m, row.sortOrder ?? 0), 0);

  return db.transaction('rw', ...pickDbTables('productionMachineProducts', 'productionMachineProductValues'), async () => {
    const assignmentId = await db.productionMachineProducts.add({
      machineId: mid,
      ...target,
      sortOrder: maxOrder + 1,
    });
    for (const field of fields) {
      const val = sanitizeMachineValue(values[field.id]);
      if (val == null) continue;
      await db.productionMachineProductValues.add({
        assignmentId,
        fieldId: field.id,
        value: val,
      });
    }
    return assignmentId;
  });
}

export async function updateProductionMachineAssignment(id, { target, productId, values } = {}) {
  const aid = Number(id);
  const row = await db.productionMachineProducts.get(aid);
  if (!row) throw new ValidationError('שיוך לא נמצא');
  const patch = {};

  if (target || productId != null) {
    const rawTarget = target || { targetType: MACHINE_TARGET_PRODUCT, productId };
    let normalized = normalizeMachineTargetInput({
      targetType: rawTarget.targetType ?? inferMachineTargetType(row),
      productId: rawTarget.productId ?? productId ?? row.productId,
      categoryId: rawTarget.categoryId ?? row.categoryId,
      categoryGroupId: rawTarget.categoryGroupId ?? row.categoryGroupId,
    });

    if (normalized.targetType === MACHINE_TARGET_PRODUCT) {
      const product = await db.products.get(normalized.productId);
      if (!product) throw new ValidationError('מוצר לא נמצא');
      normalized = { ...normalized, recipeId: await resolveRecipeIdForProduct(normalized.productId) };
    } else if (normalized.targetType === MACHINE_TARGET_CATEGORY) {
      const category = await db.categories.get(normalized.categoryId);
      if (!category) throw new ValidationError('קטגוריה לא נמצאה');
      normalized.recipeId = null;
    } else {
      const group = await db.categoryGroups.get(normalized.categoryGroupId);
      if (!group) throw new ValidationError('קטגוריה כללית לא נמצאה');
      normalized.recipeId = null;
    }

    const dup = await findDuplicateMachineAssignment(row.machineId, normalized);
    if (dup && dup.id !== aid) throw new ValidationError('שיוך זה כבר קיים למכונה');
    Object.assign(patch, normalized);
  }

  await db.transaction('rw', ...pickDbTables('productionMachineProducts', 'productionMachineProductValues'), async () => {
    if (Object.keys(patch).length) await db.productionMachineProducts.update(aid, patch);
    if (values && typeof values === 'object') {
      const fields = await getProductionMachineFields(row.machineId);
      for (const field of fields) {
        if (!(field.id in values)) continue;
        const val = sanitizeMachineValue(values[field.id]);
        const existing = await db.productionMachineProductValues
          .where('[assignmentId+fieldId]')
          .equals([aid, field.id])
          .first();
        if (val == null) {
          if (existing) await db.productionMachineProductValues.delete(existing.id);
        } else if (existing) {
          await db.productionMachineProductValues.update(existing.id, { value: val });
        } else {
          await db.productionMachineProductValues.add({ assignmentId: aid, fieldId: field.id, value: val });
        }
      }
    }
  });
}

export async function deleteProductionMachineAssignment(id) {
  const aid = Number(id);
  if (!aid) return;
  await db.transaction('rw', ...pickDbTables('productionMachineProducts', 'productionMachineProductValues'), async () => {
    await db.productionMachineProductValues.where('assignmentId').equals(aid).delete();
    await db.productionMachineProducts.delete(aid);
  });
}

export async function exportKitchenTables() {
  const [
    recipeGroups, recipeCategories, recipes, recipeIngredients, recipeProductLinks,
    recipeProductCategoryLinks, recipeProductGroupLinks,
    productRecipeComponents,
    productionMachines, productionMachineFields, productionMachineProducts, productionMachineProductValues,
    bakingProfiles, bakingProfileProducts, bakingProfileScopes,
    supplierCategories, suppliers, rawMaterials, rawMaterialPriceHistory, supplierShortages,
    weeklyProductionPlans, weeklyProductionPlanItems,
  ] = await Promise.all([
    db.recipeGroups.toArray(),
    db.recipeCategories.toArray(),
    db.recipes.toArray(),
    db.recipeIngredients.toArray(),
    db.recipeProductLinks.toArray(),
    db.recipeProductCategoryLinks?.toArray?.() ?? Promise.resolve([]),
    db.recipeProductGroupLinks?.toArray?.() ?? Promise.resolve([]),
    db.productRecipeComponents?.toArray?.() ?? Promise.resolve([]),
    db.productionMachines?.toArray?.() ?? Promise.resolve([]),
    db.productionMachineFields?.toArray?.() ?? Promise.resolve([]),
    db.productionMachineProducts?.toArray?.() ?? Promise.resolve([]),
    db.productionMachineProductValues?.toArray?.() ?? Promise.resolve([]),
    db.bakingProfiles.toArray(),
    db.bakingProfileProducts?.toArray?.() ?? Promise.resolve([]),
    db.bakingProfileScopes?.toArray?.() ?? Promise.resolve([]),
    db.supplierCategories.toArray(),
    db.suppliers.toArray(),
    db.rawMaterials.toArray(),
    db.rawMaterialPriceHistory.toArray(),
    db.supplierShortages?.toArray?.() ?? Promise.resolve([]),
    db.weeklyProductionPlans.toArray(),
    db.weeklyProductionPlanItems.toArray(),
  ]);
  return {
    recipeGroups,
    recipeCategories,
    recipes,
    recipeIngredients,
    recipeProductLinks,
    recipeProductCategoryLinks,
    recipeProductGroupLinks,
    productRecipeComponents,
    productionMachines,
    productionMachineFields,
    productionMachineProducts,
    productionMachineProductValues,
    bakingProfiles,
    bakingProfileProducts,
    bakingProfileScopes,
    supplierCategories,
    suppliers,
    rawMaterials,
    rawMaterialPriceHistory,
    supplierShortages,
    weeklyProductionPlans,
    weeklyProductionPlanItems,
  };
}

export async function importKitchenTables(payload) {
  const tables = [
    'recipeGroups', 'recipeCategories', 'recipes', 'recipeIngredients', 'recipeProductLinks',
    'recipeProductCategoryLinks', 'recipeProductGroupLinks',
    'productRecipeComponents',
    'productionMachines', 'productionMachineFields', 'productionMachineProducts', 'productionMachineProductValues',
    'bakingProfiles', 'bakingProfileProducts', 'bakingProfileScopes',
    'supplierCategories', 'suppliers', 'rawMaterials', 'rawMaterialPriceHistory', 'supplierShortages',
    'weeklyProductionPlans', 'weeklyProductionPlanItems',
  ];
  const stores = tables.map((t) => db[t]).filter(Boolean);
  if (!stores.length) return;
  await db.transaction('rw', ...stores, async () => {
    for (const t of tables) {
      await db[t].clear();
      const rows = payload[t];
      if (Array.isArray(rows) && rows.length) await db[t].bulkPut(rows);
    }
    await ensureRecipeHierarchyInTx(db);
    for (const r of await db.recipes.toArray()) {
      const patch = {};
      if (r.linkedProductCategoryId) {
        const existing = await db.recipeProductCategoryLinks
          .where('[recipeId+categoryId]')
          .equals([r.id, r.linkedProductCategoryId])
          .first();
        if (!existing) {
          await db.recipeProductCategoryLinks.add({ recipeId: r.id, categoryId: r.linkedProductCategoryId });
        }
        patch.linkedProductCategoryId = null;
      }
      if (r.linkedProductGroupId) {
        const existing = await db.recipeProductGroupLinks
          .where('[recipeId+groupId]')
          .equals([r.id, r.linkedProductGroupId])
          .first();
        if (!existing) {
          await db.recipeProductGroupLinks.add({ recipeId: r.id, groupId: r.linkedProductGroupId });
        }
        patch.linkedProductGroupId = null;
      }
      if (Object.keys(patch).length) await db.recipes.update(r.id, patch);
    }
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
  const tableNames = [
    'recipeGroups', 'recipeCategories', 'recipes', 'recipeIngredients', 'recipeProductLinks',
    'productRecipeComponents',
    'productionMachines', 'productionMachineFields', 'productionMachineProducts', 'productionMachineProductValues',
    'bakingProfiles', 'bakingProfileProducts', 'bakingProfileScopes',
    'supplierCategories', 'suppliers', 'rawMaterials', 'rawMaterialPriceHistory', 'supplierShortages',
    'weeklyProductionPlans', 'weeklyProductionPlanItems',
  ];
  const stores = tableNames.map((t) => db[t]).filter(Boolean);
  if (!stores.length) return;
  await db.transaction('rw', ...stores, async () => {
      await db.weeklyProductionPlanItems.clear();
      await db.weeklyProductionPlans.clear();
      await db.recipeIngredients.clear();
      await db.recipeProductLinks.clear();
      await db.productRecipeComponents.clear();
      await db.productionMachineProductValues?.clear?.();
      await db.productionMachineProducts?.clear?.();
      await db.productionMachineFields?.clear?.();
      await db.productionMachines?.clear?.();
      await db.recipes.clear();
      await db.recipeCategories.clear();
      await db.recipeGroups.clear();
      await db.bakingProfileProducts?.clear?.();
      await db.bakingProfileScopes?.clear?.();
      if (db.bakingProfiles) await db.bakingProfiles.clear();
      await db.rawMaterialPriceHistory.clear();
      await db.supplierShortages?.clear?.();
      await db.rawMaterials.clear();
      await db.suppliers.clear();
      await db.supplierCategories.clear();
    });
}
