import { db, ValidationError, sanitizeRawMaterialsCostSource, pickDbTables } from './db.js?v=471';
import {
  sanitizeName, sanitizeProductId, sanitizeMoney, sanitizeQuantity, sanitizeRecipeQuantity,
  sanitizePortionSize, sanitizePortionCount,
} from './validators.js?v=471';
import { weekStartISO, todayISO, roundDecimal, formatDecimal } from './utils.js?v=471';
import { logAuditEvent } from './audit.js?v=471';
import { markMetaDeleted } from './sync/id-map.js?v=471';

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
  if (parent.parentRecipeId) throw new ValidationError('לא ניתן להוסיף תוספת לאחר הכנה לתוספת אחרת');
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
  // התוספת נכללת במנת המתכון הראשי — לא יוצרים מנה נפרדת
  await syncRecipePortionPresets(parent.id);
  return recipeId;
}

export async function getRecipeProductLinks(recipeId) {
  const rid = sanitizeProductId(recipeId);
  if (!rid) return [];
  const links = await db.recipeProductLinks.where('recipeId').equals(rid).toArray();
  return [...new Set(links.map((l) => Number(l.productId)).filter(Boolean))];
}

/** מוודא שיוך מתכון↔מוצר (בלי למחוק שיוכים קיימים) */
export async function ensureRecipeProductLink(recipeId, productId, { syncPortions = true } = {}) {
  const rid = sanitizeProductId(recipeId);
  const pid = sanitizeProductId(productId);
  if (!rid || !pid || !db.recipeProductLinks) return false;
  const existing = await db.recipeProductLinks.where('[recipeId+productId]').equals([rid, pid]).first();
  if (existing) return false;
  const siblings = await db.recipeProductLinks.where('recipeId').equals(rid).toArray();
  if (siblings.some((l) => Number(l.productId) === pid)) return false;
  await db.recipeProductLinks.add({ recipeId: rid, productId: pid });
  const recipe = await db.recipes.get(rid);
  if (recipe && !recipe.linkedProductId) {
    await db.recipes.update(rid, { linkedProductId: pid });
  }
  if (syncPortions) await syncRecipePortionPresets(rid);
  return true;
}

/**
 * משחזר שיוכי recipeProductLinks מתוך הרכב מוצר (productRecipeComponents)
 * לרשומות ישנות שנשמרו רק בהרכב.
 */
export async function repairRecipeProductLinksFromComposition() {
  if (!db.productRecipeComponents || !db.recipeProductLinks) return { added: 0 };
  const rows = await db.productRecipeComponents.toArray();
  let added = 0;
  const touchedRecipes = new Set();
  for (const row of rows) {
    const rid = sanitizeProductId(row.recipeId);
    const pid = sanitizeProductId(row.productId);
    if (!rid || !pid) continue;
    // Normalize string FKs left by older sync pulls
    if (Number(row.recipeId) !== rid || Number(row.productId) !== pid) {
      await db.productRecipeComponents.update(row.id, { recipeId: rid, productId: pid });
    }
    const created = await ensureRecipeProductLink(rid, pid, { syncPortions: false });
    if (created) {
      added++;
      touchedRecipes.add(rid);
    }
  }
  for (const rid of touchedRecipes) {
    await syncRecipePortionPresets(rid);
  }
  return { added };
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

export async function getRecipe(id, { versionId = null, useDefaultVersion = true } = {}) {
  const recipe = await db.recipes.get(Number(id));
  if (!recipe) return null;

  let versions = [];
  let activeVersion = null;
  if (db.recipeVersions) {
    versions = await listRecipeVersions(recipe.id);
    if (!versions.length && !recipe.parentRecipeId) {
      activeVersion = await ensureDefaultRecipeVersion(recipe.id);
      versions = await listRecipeVersions(recipe.id);
    } else if (versionId) {
      activeVersion = versions.find((v) => Number(v.id) === Number(versionId)) || null;
    } else if (useDefaultVersion) {
      activeVersion = versions.find((v) => v.isDefault) || versions[0] || null;
    }
  }

  const allIngredients = await db.recipeIngredients.where('recipeId').equals(recipe.id).toArray();
  let ingredients = allIngredients;
  if (activeVersion) {
    ingredients = allIngredients.filter((ing) =>
      Number(ing.recipeVersionId) === Number(activeVersion.id)
      || (!ing.recipeVersionId && activeVersion.isDefault));
  }
  ingredients.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id);

  const [linkedProductIds, linkedProductCategoryIds, linkedProductGroupIds, compositionRows] = await Promise.all([
    getRecipeProductLinks(recipe.id),
    getRecipeProductCategoryLinks(recipe.id),
    getRecipeProductGroupLinks(recipe.id),
    db.productRecipeComponents
      ? db.productRecipeComponents.where('recipeId').equals(recipe.id).toArray()
      : Promise.resolve([]),
  ]);
  const fromComposition = (compositionRows || [])
    .map((c) => Number(c.productId))
    .filter(Boolean);
  const mergedProductIds = [...new Set([
    ...linkedProductIds.map(Number).filter(Boolean),
    ...(recipe.linkedProductId ? [Number(recipe.linkedProductId)] : []),
    ...fromComposition,
  ].filter(Boolean))];
  return {
    ...recipe,
    ingredients,
    versions,
    activeVersionId: activeVersion?.id || null,
    activeVersion,
    linkedProductIds: mergedProductIds,
    linkedProductCategoryIds: linkedProductCategoryIds.length
      ? linkedProductCategoryIds.map(Number).filter(Boolean)
      : (recipe.linkedProductCategoryId ? [Number(recipe.linkedProductCategoryId)] : []),
    linkedProductGroupIds: linkedProductGroupIds.length
      ? linkedProductGroupIds.map(Number).filter(Boolean)
      : (recipe.linkedProductGroupId ? [Number(recipe.linkedProductGroupId)] : []),
  };
}

export async function listRecipeVersions(recipeId) {
  const rid = Number(recipeId);
  if (!rid || !db.recipeVersions) return [];
  const rows = await db.recipeVersions.where('recipeId').equals(rid).toArray();
  rows.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id);
  return rows;
}

export async function ensureDefaultRecipeVersion(recipeId) {
  const rid = Number(recipeId);
  if (!rid || !db.recipeVersions) return null;
  const existing = await listRecipeVersions(rid);
  if (existing.length) return existing.find((v) => v.isDefault) || existing[0];

  const verId = await db.recipeVersions.add({
    recipeId: rid,
    name: 'גרסה 1',
    sortOrder: 1,
    isDefault: true,
    createdAt: new Date().toISOString(),
  });
  const ings = await db.recipeIngredients.where('recipeId').equals(rid).toArray();
  for (const ing of ings) {
    if (!ing.recipeVersionId) {
      await db.recipeIngredients.update(ing.id, { recipeVersionId: verId });
    }
  }
  return db.recipeVersions.get(verId);
}

export async function setDefaultRecipeVersion(recipeId, versionId) {
  const rid = Number(recipeId);
  const vid = Number(versionId);
  if (!rid || !vid) throw new ValidationError('גרסת מתכון לא תקינה');
  const versions = await listRecipeVersions(rid);
  if (!versions.some((v) => Number(v.id) === vid)) {
    throw new ValidationError('גרסה לא נמצאה במתכון');
  }
  const prevDefault = versions.find((v) => v.isDefault) || versions[0] || null;
  await db.transaction('rw', db.recipeVersions, async () => {
    for (const v of versions) {
      await db.recipeVersions.update(v.id, { isDefault: Number(v.id) === vid });
    }
  });
  if (prevDefault && Number(prevDefault.id) !== vid) {
    await remapPortionPresetSettingsByIngredientName(rid, prevDefault.id, vid);
  }
  await syncRecipePortionPresets(rid);
  logAuditEvent({
    entityTable: 'recipeVersions',
    entityId: vid,
    action: 'update',
    snapshot: { recipeId: rid, name: versions.find((v) => Number(v.id) === vid)?.name, isDefault: true },
  });
  return listRecipeVersions(rid);
}

/**
 * מעתיק הגדרות אריזה/ספק לפי שם רכיב כשעוברים לגרסת ברירת מחדל אחרת.
 */
export async function remapPortionPresetSettingsByIngredientName(recipeId, fromVersionId, toVersionId) {
  const rid = Number(recipeId);
  const fromId = Number(fromVersionId);
  const toId = Number(toVersionId);
  if (!rid || !fromId || !toId || fromId === toId || !db.portionPresetIngredientSettings) return 0;

  const [fromRecipe, toRecipe] = await Promise.all([
    getRecipe(rid, { versionId: fromId, useDefaultVersion: false }),
    getRecipe(rid, { versionId: toId, useDefaultVersion: false }),
  ]);
  const nameToNewId = new Map();
  for (const ing of toRecipe?.ingredients || []) {
    const key = normalizeMaterialKey(ing.name);
    if (key && !nameToNewId.has(key)) nameToNewId.set(key, Number(ing.id));
  }
  const oldIdToName = new Map(
    (fromRecipe?.ingredients || []).map((ing) => [Number(ing.id), normalizeMaterialKey(ing.name)]),
  );

  const presets = await db.groupPortionPresets.filter((p) => Number(p.sourceRecipeId) === rid).toArray();
  let remapped = 0;
  for (const preset of presets) {
    const settings = await db.portionPresetIngredientSettings
      .where('portionPresetId').equals(preset.id).toArray();
    if (!settings.length) continue;
    const nextRows = [];
    for (const s of settings) {
      const key = oldIdToName.get(Number(s.recipeIngredientId));
      const newIngId = key ? nameToNewId.get(key) : null;
      if (!newIngId) continue;
      nextRows.push({
        recipeIngredientId: newIngId,
        packagingPortionCount: s.packagingPortionCount ?? null,
        rawMaterialId: s.rawMaterialId ?? null,
      });
    }
    if (!nextRows.length) continue;
    await savePortionPresetIngredientSettings(preset.id, nextRows);
    remapped += nextRows.length;
  }
  return remapped;
}

/** השוואת שתי גרסאות מתכון לפי שם רכיב */
export async function compareRecipeVersions(recipeId, versionIdA, versionIdB) {
  const rid = Number(recipeId);
  const aId = Number(versionIdA);
  const bId = Number(versionIdB);
  if (!rid || !aId || !bId) throw new ValidationError('גרסאות להשוואה לא תקינות');
  const [left, right, versions] = await Promise.all([
    getRecipe(rid, { versionId: aId, useDefaultVersion: false }),
    getRecipe(rid, { versionId: bId, useDefaultVersion: false }),
    listRecipeVersions(rid),
  ]);
  if (!left || !right) throw new ValidationError('גרסה לא נמצאה');

  const leftMap = new Map();
  for (const ing of left.ingredients || []) {
    const key = normalizeMaterialKey(ing.name) || String(ing.id);
    leftMap.set(key, ing);
  }
  const rightMap = new Map();
  for (const ing of right.ingredients || []) {
    const key = normalizeMaterialKey(ing.name) || String(ing.id);
    rightMap.set(key, ing);
  }
  const keys = [...new Set([...leftMap.keys(), ...rightMap.keys()])];
  const rows = keys.map((key) => {
    const a = leftMap.get(key);
    const b = rightMap.get(key);
    const qtyA = a != null ? Number(a.quantity) : null;
    const qtyB = b != null ? Number(b.quantity) : null;
    let status = 'same';
    if (a && !b) status = 'removed';
    else if (!a && b) status = 'added';
    else if (qtyA !== qtyB || String(a?.unit || '') !== String(b?.unit || '')) status = 'changed';
    return {
      name: a?.name || b?.name || key,
      qtyA,
      unitA: a?.unit || '',
      qtyB,
      unitB: b?.unit || '',
      status,
    };
  }).sort((x, y) => x.name.localeCompare(y.name, 'he'));

  return {
    recipeId: rid,
    left: {
      versionId: aId,
      name: versions.find((v) => Number(v.id) === aId)?.name || left.activeVersion?.name || 'גרסה א',
    },
    right: {
      versionId: bId,
      name: versions.find((v) => Number(v.id) === bId)?.name || right.activeVersion?.name || 'גרסה ב',
    },
    rows,
  };
}

export async function renameRecipeVersion(versionId, name) {
  const vid = Number(versionId);
  const trimmed = sanitizeName(name, 40);
  if (!vid) throw new ValidationError('גרסה לא תקינה');
  if (!trimmed) throw new ValidationError('שם גרסה לא תקין');
  await db.recipeVersions.update(vid, { name: trimmed });
  return db.recipeVersions.get(vid);
}

export async function addRecipeVersion(recipeId, {
  name = '',
  copyFromVersionId = null,
  ingredients = null,
  setAsDefault = false,
} = {}) {
  const rid = Number(recipeId);
  if (!rid) throw new ValidationError('מתכון לא תקין');
  const recipe = await db.recipes.get(rid);
  if (!recipe) throw new ValidationError('מתכון לא נמצא');
  if (recipe.parentRecipeId) throw new ValidationError('לא ניתן ליצור גרסאות לתוספת לאחר הכנה');

  await ensureDefaultRecipeVersion(rid);
  const versions = await listRecipeVersions(rid);
  const nextOrder = versions.reduce((m, v) => Math.max(m, v.sortOrder ?? 0), 0) + 1;
  const label = sanitizeName(name, 40) || `גרסה ${nextOrder}`;

  const verId = await db.recipeVersions.add({
    recipeId: rid,
    name: label,
    sortOrder: nextOrder,
    isDefault: false,
    createdAt: new Date().toISOString(),
  });

  let sourceIngs = ingredients;
  if (!sourceIngs && copyFromVersionId) {
    const src = await getRecipe(rid, { versionId: copyFromVersionId, useDefaultVersion: false });
    sourceIngs = src?.ingredients || [];
  } else if (!sourceIngs) {
    const def = await getRecipe(rid);
    sourceIngs = def?.ingredients || [];
  }

  let order = 0;
  for (const ing of sourceIngs) {
    const qty = ing.scaledQuantity != null ? Number(ing.scaledQuantity) : Number(ing.quantity);
    if (!Number.isFinite(qty) || qty <= 0) continue;
    order += 1;
    const kind = ing.unitKind || normalizeRecipeUnitKind(ing.unit);
    await db.recipeIngredients.add({
      recipeId: rid,
      recipeVersionId: verId,
      rawMaterialId: ing.rawMaterialId || null,
      name: sanitizeName(ing.name, 80) || 'חומר',
      quantity: roundQty(qty),
      unit: formatRecipeUnitKind(kind),
      unitKind: kind,
      sortOrder: order,
      priceSource: ing.priceSource === 'supplier' ? 'supplier' : 'max',
    });
  }

  if (setAsDefault) {
    await setDefaultRecipeVersion(rid, verId);
  }
  logAuditEvent({
    entityTable: 'recipeVersions',
    entityId: verId,
    action: 'create',
    snapshot: { recipeId: rid, name: label, setAsDefault: !!setAsDefault },
  });
  return verId;
}

/** שמירת כמויות מחושבות ממחשבון יחס כגרסה חדשה (הגרסה הישנה נשארת) */
export async function createRecipeVersionFromScaled(recipeId, scaledIngredients, {
  name = '',
  setAsDefault = false,
} = {}) {
  if (!scaledIngredients?.length) throw new ValidationError('אין חומרים לשמירה');
  return addRecipeVersion(recipeId, {
    name,
    ingredients: scaledIngredients,
    setAsDefault,
  });
}

export async function deleteRecipeVersion(recipeId, versionId) {
  const rid = Number(recipeId);
  const vid = Number(versionId);
  const versions = await listRecipeVersions(rid);
  if (versions.length <= 1) throw new ValidationError('לא ניתן למחוק את הגרסה היחידה');
  const target = versions.find((v) => Number(v.id) === vid);
  if (!target) throw new ValidationError('גרסה לא נמצאה');

  await db.transaction('rw', db.recipeVersions, db.recipeIngredients, async () => {
    const ings = await db.recipeIngredients
      .where('recipeId').equals(rid)
      .filter((i) => Number(i.recipeVersionId) === vid)
      .toArray();
    for (const ing of ings) await db.recipeIngredients.delete(ing.id);
    await db.recipeVersions.delete(vid);
  });

  if (target.isDefault) {
    const remaining = await listRecipeVersions(rid);
    if (remaining[0]) await setDefaultRecipeVersion(rid, remaining[0].id);
  } else {
    await syncRecipePortionPresets(rid);
  }
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
  await ensureDefaultRecipeVersion(recipeId);
  await syncRecipePortionPresets(recipeId);
  logAuditEvent({
    entityTable: 'recipes',
    entityId: recipeId,
    action: 'create',
    snapshot: { name: trimmed, categoryId: cid },
  });
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
  const next = await db.recipes.get(rid);
  logAuditEvent({
    entityTable: 'recipes',
    entityId: rid,
    action: 'update',
    snapshot: { name: next?.name, categoryId: next?.categoryId },
  });
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
  const exact = cats.find((c) => String(c.name || '').trim() === IMPORT_MATERIALS_CAT);
  if (exact) return exact.id;
  // כפילות בשם דומה («יבוא ממתכון») — לא ליצור שורה חדשה
  const loose = cats.find((c) => {
    const n = String(c.name || '').trim();
    return /יי?בוא/.test(n) && /מתכו/.test(n);
  });
  if (loose) {
    if (String(loose.name || '').trim() !== IMPORT_MATERIALS_CAT) {
      await db.supplierCategories.update(loose.id, { name: IMPORT_MATERIALS_CAT });
    }
    return loose.id;
  }
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
  const recipe = await db.recipes.get(rid);
  const parentId = recipe?.parentRecipeId ? Number(recipe.parentRecipeId) : null;
  const childRecipes = await getRecipeSubRecipes(rid);
  for (const child of childRecipes) {
    await deleteRecipe(child.id);
  }
  const recipePresets = await db.groupPortionPresets.filter((p) => p.sourceRecipeId === rid).toArray();
  await db.transaction(
    'rw',
    db.recipes,
    db.recipeIngredients,
    db.recipeVersions,
    db.recipeProductLinks,
    db.recipeProductCategoryLinks,
    db.recipeProductGroupLinks,
    db.groupPortionPresets,
    db.portionPresetIngredientSettings,
    async () => {
    await db.recipeIngredients.where('recipeId').equals(rid).delete();
    if (db.recipeVersions) await db.recipeVersions.where('recipeId').equals(rid).delete();
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
  // אחרי מחיקת תוספת — מעדכנים את מנת המתכון הראשי
  if (parentId) await syncRecipePortionPresets(parentId);
  logAuditEvent({
    entityTable: 'recipes',
    entityId: rid,
    action: 'delete',
    snapshot: { name: recipe?.name || null },
  });
}

/** מוחק את כל המתכונים (רכיבים וקישורים) — קטגוריות וקבוצות נשארות */
export async function deleteAllRecipes() {
  await db.transaction('rw', db.recipes, db.recipeVersions, db.recipeIngredients, db.recipeProductLinks, db.recipeProductCategoryLinks, db.recipeProductGroupLinks, async () => {
    await db.recipeIngredients.clear();
    await db.recipeVersions?.clear?.();
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
  if (ing?.recipeId) {
    await syncRecipePortionPresets(ing.recipeId);
    try {
      await syncProductCostFromRecipe(ing.recipeId);
    } catch {
      /* המתכון אינו משמש בהרכב מוצר */
    }
  }
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

/** מסמן חומרי גלם כפעילים אם הם במתכונים; אריזות וחומרי ניקיון תמיד פעילים */
export async function syncRawMaterialsActiveFromRecipes() {
  const [linkedIds, materials, categories] = await Promise.all([
    getRecipeLinkedRawMaterialIds(),
    db.rawMaterials.toArray(),
    getSupplierCategories(),
  ]);
  const alwaysActiveCatIds = new Set(
    categories.filter((c) => isNonRecipeSupplierCategory(c)).map((c) => Number(c.id)),
  );
  const updates = [];
  for (const m of materials) {
    const alwaysActive = alwaysActiveCatIds.has(Number(m.supplierCategoryId)) || !!m.packagingKind;
    const shouldBeActive = alwaysActive || linkedIds.has(m.id);
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

/** חומרים כמו מים וקרח — עלות אפס אמיתית, לא מחיר חסר */
export function isFreeMaterial(mat) {
  return !!mat?.isFree;
}

export function getMaterialEffectivePricePerKg(mat) {
  if (isFreeMaterial(mat)) return 0;
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
  // A litre is billed as a kilo. At the densities in use here the gap is a few percent,
  // while charging unitPrice per litre would be off by the size of the whole package.
  const rate = getMaterialEffectivePricePerKg(mat) ?? (Number(mat.unitPrice) || 0);
  return roundQty(kind === 'g' ? (qty / 1000) * rate : qty * rate);
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

export async function addRecipeIngredient(recipeId, {
  rawMaterialId, name, quantity, unit, unitKind, sortOrder, priceSource, recipeVersionId = null,
}) {
  const rid = sanitizeProductId(recipeId);
  const trimmed = sanitizeName(name, 80);
  if (!rid) throw new ValidationError('מתכון לא תקין');
  if (!trimmed) throw new ValidationError('שם חומר לא תקין');
  const qty = sanitizeRecipeQuantity(quantity, { allowZero: false });
  let verId = recipeVersionId ? Number(recipeVersionId) : null;
  if (!verId) {
    const def = await ensureDefaultRecipeVersion(rid);
    verId = def?.id || null;
  }
  const existing = await db.recipeIngredients.where('recipeId').equals(rid).toArray();
  const inVersion = verId
    ? existing.filter((r) => Number(r.recipeVersionId) === Number(verId))
    : existing;
  const maxOrder = inVersion.reduce((m, r) => Math.max(m, r.sortOrder ?? 0), 0);
  const matId = rawMaterialId ? sanitizeProductId(rawMaterialId) : null;
  const kind = unitKind ? normalizeRecipeUnitKind(unitKind) : normalizeRecipeUnitKind(unit);
  const order = Number.isFinite(sortOrder) && sortOrder > 0 ? sortOrder : maxOrder + 1;
  const src = priceSource === 'supplier' ? 'supplier' : 'max';
  const ingId = await db.recipeIngredients.add({
    recipeId: rid,
    recipeVersionId: verId,
    rawMaterialId: src === 'supplier' && matId ? matId : null,
    name: trimmed,
    quantity: qty,
    unit: formatRecipeUnitKind(kind),
    unitKind: kind,
    sortOrder: order,
    priceSource: src,
  });
  await syncRecipePortionPresets(rid);
  try {
    await syncProductCostFromRecipe(rid);
  } catch {
    /* המתכון אינו משמש בהרכב מוצר */
  }
  await syncRawMaterialsActiveFromRecipes();
  return ingId;
}

export async function deleteRecipeIngredient(id) {
  const iid = sanitizeProductId(id);
  if (!iid) return;
  const ing = await db.recipeIngredients.get(iid);
  await db.recipeIngredients.delete(iid);
  if (ing?.recipeId) {
    await syncRecipePortionPresets(ing.recipeId);
    try {
      await syncProductCostFromRecipe(ing.recipeId);
    } catch {
      /* המתכון אינו משמש בהרכב מוצר */
    }
  }
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

/** בניית שדות מנה לתזרים ממתכון — המתכון + תוספות לאחר הכנה = מנה אחת */
export function buildRecipePortionPresetFields(recipe, ingredients = [], { hasAdditions = false } = {}) {
  if (!recipe) return null;
  const totalG = recipeTotalWeightGrams(ingredients);
  let weightKg = totalG > 0 ? sanitizePortionSize(totalG / 1000) : null;
  if (weightKg == null) weightKg = 0.001;
  const unitG = Number(recipe.portionWeightGrams) || 0;
  let extra = hasAdditions ? 'מנה אחת · כולל תוספת לאחר הכנה' : 'מנה אחת';
  if (totalG <= 0) {
    extra = hasAdditions ? 'מנה אחת · כולל תוספת · ללא משקל' : 'ללא משקל מחושב';
  } else if (unitG > 0) {
    const units = computeRecipeProductUnits(weightKg, 1, unitG);
    const countStr = units
      ? formatRecipeQuantity(units.totalUnits)
      : formatRecipeQuantity(totalG / unitG);
    const unitPart = `${countStr} יחידות × ${formatSubdivisionWeight(unitG)}`;
    extra = hasAdditions ? `מנה אחת · כולל תוספת · ${unitPart}` : unitPart;
  }
  return {
    name: recipe.name,
    weight: weightKg,
    extra,
  };
}

async function clearRecipePortionPresets(recipeId) {
  const rid = sanitizeProductId(recipeId);
  if (!rid) return;
  const existing = await db.groupPortionPresets
    .filter((p) => Number(p.sourceRecipeId) === rid)
    .toArray();
  for (const row of existing) {
    await deletePortionPresetIngredientSettings(row.id);
    if (db.portionPresetLinks) {
      await db.portionPresetLinks.where('portionPresetId').equals(row.id).delete();
    }
    await db.groupPortionPresets.delete(row.id);
  }
}

/** סנכרון מנות מתכון לרשימת המנות — מתכון ראשי + תוספות = מנה אחת */
export async function syncRecipePortionPresets(recipeId) {
  const rid = sanitizeProductId(recipeId);
  if (!rid) return;
  const recipe = await getRecipe(rid);
  if (!recipe) return;

  // תוספת לאחר הכנה אינה מנה נפרדת — נכללת במנת המתכון הראשי
  if (recipe.parentRecipeId) {
    await clearRecipePortionPresets(rid);
    await syncRecipePortionPresets(recipe.parentRecipeId);
    return;
  }

  const additions = await getRecipeSubRecipes(rid);
  const costingIngredients = await getRecipeCostingIngredients(recipe);
  const groupIds = await resolveCategoryGroupIdsForRecipe(recipe);
  const presetData = buildRecipePortionPresetFields(recipe, costingIngredients, {
    hasAdditions: additions.length > 0,
  });
  if (!presetData) return;

  const existing = await db.groupPortionPresets.filter((p) => p.sourceRecipeId === rid).toArray();
  const targetGroups = groupIds.length
    ? new Set(groupIds)
    : new Set([PORTION_CATALOG_ONLY_GROUP_ID]);

  for (const row of existing) {
    if (!targetGroups.has(Number(row.categoryGroupId))) {
      await deletePortionPresetIngredientSettings(row.id);
      if (db.portionPresetLinks) {
        await db.portionPresetLinks.where('portionPresetId').equals(row.id).delete();
      }
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
  // קודם מנקים מנות נפרדות של תוספות, ואז מסנכרנים רק מתכונים ראשיים
  for (const r of recipes) {
    if (r.parentRecipeId) await clearRecipePortionPresets(r.id);
  }
  for (const r of recipes) {
    if (!r.parentRecipeId) await syncRecipePortionPresets(r.id);
  }
}

export async function deletePortionPresetIngredientSettings(portionPresetId) {
  const pid = Number(portionPresetId);
  if (!pid || !db.portionPresetIngredientSettings) return;
  await db.portionPresetIngredientSettings.where('portionPresetId').equals(pid).delete();
}

/** נתוני טופס רכיבי מנה — רכיבי מתכון (כולל תוספות לאחר הכנה) + ספקים + הגדרות */
export async function getPortionPresetIngredientsFormData(portionPresetId) {
  const preset = await db.groupPortionPresets.get(Number(portionPresetId));
  if (!preset?.sourceRecipeId) throw new ValidationError('מנה לא מקושרת למתכון');

  const rid = Number(preset.sourceRecipeId);
  const recipe = await getRecipe(rid);
  const costingIngredients = recipe
    ? await getRecipeCostingIngredients(recipe)
    : await db.recipeIngredients.where('recipeId').equals(rid).toArray();
  const [materials, suppliers, existingSettings] = await Promise.all([
    getRawMaterials(),
    getSuppliers(),
    db.portionPresetIngredientSettings
      ? db.portionPresetIngredientSettings.where('portionPresetId').equals(preset.id).toArray()
      : Promise.resolve([]),
  ]);

  const ingredients = costingIngredients.slice().sort((a, b) =>
    (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id);
  const supMap = new Map(suppliers.map((s) => [s.id, s.name]));
  const byNameKey = buildMaterialsByNameKey(materials);
  const settingsMap = new Map(existingSettings.map((s) => [Number(s.recipeIngredientId), s]));

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

  const recipe = await getRecipe(Number(preset.sourceRecipeId));
  const costingIngredients = recipe
    ? await getRecipeCostingIngredients(recipe)
    : await db.recipeIngredients.where('recipeId').equals(Number(preset.sourceRecipeId)).toArray();
  const validIngredientIds = new Set(costingIngredients.map((i) => i.id));
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

/**
 * מסנכרן מוצרים שמשתמשים במתכון לפי הרכב המוצר ומשקל הרכיב.
 * אין לשמור את עלות המתכון המלאה ישירות במוצר: אותו מתכון עשוי להיכלל
 * במוצר בכמות חלקית, ולעיתים המוצר מורכב מכמה מתכונים.
 */
export async function syncProductCostFromRecipe(recipeId) {
  const recipe = await getRecipe(recipeId);
  if (!recipe) throw new ValidationError('מתכון לא נמצא');
  const productIds = new Set(await resolveRecipeLinkedProductIds(recipe));
  const components = await db.productRecipeComponents.where('recipeId').equals(recipe.id).toArray();
  for (const component of components) productIds.add(component.productId);
  if (!productIds.size) throw new ValidationError('אין מוצרים מקושרים');

  let lastCost = 0;
  for (const pid of productIds) {
    const product = await db.products.get(pid);
    if (!isProductRecipesCostSource(product)) continue;
    lastCost = await syncProductCostFromComposition(pid);
  }
  return lastCost;
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

/** חומרי המתכון לחישוב משקל/עלות, כולל תוספות לאחר הכנה. */
export async function getRecipeCostingIngredients(recipe) {
  const ingredients = [...(recipe?.ingredients || [])];
  if (!recipe?.id || recipe.parentRecipeId) return ingredients;
  const additions = await getRecipeSubRecipes(recipe.id);
  for (const addition of additions) {
    const fullAddition = await getRecipe(addition.id);
    ingredients.push(...(fullAddition?.ingredients || []));
  }
  return ingredients;
}

/** עלות חומרי גלם — אופציונלית רק מחירי ספק */
export async function computeRecipeMaterialsCostFiltered(ingredients, materials, { supplierOnly = false } = {}) {
  const mats = materials || await getRawMaterials();
  const matById = new Map(mats.map((m) => [m.id, m]));
  const byNameKey = buildMaterialsByNameKey(mats);
  let total = 0;
  for (const ing of ingredientsWithScaledQuantity(ingredients)) {
    const { mat } = resolveRecipeIngredientMaterial(ing, { matById, byNameKey });
    // supplierOnly used to skip any line whose ingredient wasn't explicitly pinned to a
    // specific supplier offer (priceSource==='supplier') — but ingredients are added
    // without pinning a supplier by default (js/screens/recipes.js add-ingredient flow
    // always saves priceSource:'max', rawMaterialId:null), so this silently zeroed or
    // partially-omitted the "recommended cost" for nearly every recipe. That total is
    // written straight into product.rawMaterialsCost by the "apply recommended cost"
    // button, so it understated real material cost / overstated margin. Use the same
    // auto-selected material price as the full cost for any unpinned line instead of
    // dropping it — recommended cost now only differs from full cost when a line's
    // manually pinned supplier price differs from the auto-selected one.
    if (!mat) continue;
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
  const maxOrder = await nextProductCompositionSortOrder(pid);
  const wg = weightGrams != null && weightGrams !== ''
    ? sanitizeQuantity(weightGrams, { allowZero: false })
    : null;
  const id = await db.productRecipeComponents.add({
    productId: pid,
    recipeId: rid,
    weightGrams: wg,
    notes: String(notes || '').trim().slice(0, 500),
    sortOrder: maxOrder,
  });
  // Keep recipe↔product association in sync so links show in recipes / portions / flows
  await ensureRecipeProductLink(rid, pid);
  return id;
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

export async function getProductPortionComponents(productId) {
  const pid = sanitizeProductId(productId);
  if (!pid || !db.productPortionComponents) return [];
  const rows = await db.productPortionComponents.where('productId').equals(pid).toArray();
  rows.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id);
  return rows;
}

async function nextProductCompositionSortOrder(productId) {
  const [recipes, portions] = await Promise.all([
    getProductRecipeComponents(productId),
    getProductPortionComponents(productId),
  ]);
  return Math.max(
    0,
    ...recipes.map((r) => r.sortOrder ?? 0),
    ...portions.map((r) => r.sortOrder ?? 0),
  ) + 1;
}

export function portionMaterialDefaultWeightGrams(mat) {
  const kg = Number(mat?.portionWeightKg);
  if (!Number.isFinite(kg) || kg <= 0) return null;
  return Math.round(kg * 1000);
}

export function computePortionComponentCost(mat, weightGrams) {
  const grams = Number(weightGrams) || 0;
  if (grams <= 0 || !mat) return 0;
  const perKg = getMaterialEffectivePricePerKg(mat);
  if (perKg == null) return 0;
  return roundQty((grams / 1000) * perKg);
}

export async function addProductPortionComponent({ productId, rawMaterialId, weightGrams, notes }) {
  const pid = sanitizeProductId(productId);
  const mid = sanitizeProductId(rawMaterialId);
  if (!pid || !mid) throw new ValidationError('שיוך לא תקין');
  if (!db.productPortionComponents) throw new ValidationError('טבלת מנות לא זמינה — רענן את האפליקציה');
  const mat = await db.rawMaterials.get(mid);
  if (!mat) throw new ValidationError('חומר גלם לא נמצא');
  if (!mat.isPortion) throw new ValidationError('החומר אינו מסומן כמנה');
  const dup = await db.productPortionComponents
    .where('[productId+rawMaterialId]')
    .equals([pid, mid])
    .first();
  if (dup) throw new ValidationError('מנה כבר ברכיבי המוצר');
  const defaultG = portionMaterialDefaultWeightGrams(mat);
  const wg = weightGrams != null && weightGrams !== ''
    ? sanitizeQuantity(weightGrams, { allowZero: false })
    : defaultG;
  if (wg == null || wg <= 0) throw new ValidationError('הגדר משקל מנה (גרם או ק"ג)');
  const sortOrder = await nextProductCompositionSortOrder(pid);
  return db.productPortionComponents.add({
    productId: pid,
    rawMaterialId: mid,
    weightGrams: wg,
    notes: String(notes || '').trim().slice(0, 500),
    sortOrder,
  });
}

export async function updateProductPortionComponent(id, patch) {
  const cid = sanitizeProductId(id);
  if (!cid || !db.productPortionComponents) return;
  const data = { ...patch };
  if ('weightGrams' in data) {
    data.weightGrams = data.weightGrams != null && data.weightGrams !== ''
      ? sanitizeQuantity(data.weightGrams, { allowZero: false })
      : null;
    if (data.weightGrams == null) throw new ValidationError('הגדר משקל מנה (ק"ג)');
  }
  if ('notes' in data) data.notes = String(data.notes || '').trim().slice(0, 500);
  if (Object.keys(data).length) await db.productPortionComponents.update(cid, data);
}

export async function deleteProductPortionComponent(id) {
  const cid = sanitizeProductId(id);
  if (cid && db.productPortionComponents) await db.productPortionComponents.delete(cid);
}

export async function getRecipesForProduct(productId) {
  const pid = sanitizeProductId(productId);
  if (!pid) return [];
  const recipeIds = new Set();
  const links = await db.recipeProductLinks.where('productId').equals(pid).toArray();
  for (const l of links) recipeIds.add(Number(l.recipeId));
  const legacy = await db.recipes.where('linkedProductId').equals(pid).toArray();
  for (const r of legacy) recipeIds.add(Number(r.id));

  if (db.productRecipeComponents) {
    const comps = await db.productRecipeComponents.where('productId').equals(pid).toArray();
    for (const c of comps) {
      const rid = Number(c.recipeId);
      if (rid) recipeIds.add(rid);
    }
  }

  const product = await db.products.get(pid);
  if (product?.categoryId) {
    const catLinks = await db.recipeProductCategoryLinks.where('categoryId').equals(product.categoryId).toArray();
    for (const l of catLinks) recipeIds.add(Number(l.recipeId));
    const catRecipes = await db.recipes.where('linkedProductCategoryId').equals(product.categoryId).toArray();
    for (const r of catRecipes) recipeIds.add(Number(r.id));
    const cat = await db.categories.get(product.categoryId);
    if (cat?.groupId) {
      const groupLinks = await db.recipeProductGroupLinks.where('groupId').equals(cat.groupId).toArray();
      for (const l of groupLinks) recipeIds.add(Number(l.recipeId));
      const groupRecipes = await db.recipes.where('linkedProductGroupId').equals(cat.groupId).toArray();
      for (const r of groupRecipes) recipeIds.add(Number(r.id));
    }
  }

  const recipes = [];
  for (const rid of recipeIds) {
    if (!rid) continue;
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

/** אלרגנים למוצר — אותם מזהים כמו ב-HACCP (נספח סימון) */
export const PRODUCT_ALLERGENS = [
  { id: 'gluten', label: 'דגנים המכילים גלוטן' },
  { id: 'milk', label: 'חלב ומוצריו' },
  { id: 'eggs', label: 'ביצים' },
  { id: 'peanuts', label: 'בוטנים' },
  { id: 'tree_nuts', label: 'אגוזים' },
  { id: 'sesame', label: 'שומשום' },
  { id: 'soy', label: 'סויה' },
  { id: 'mustard', label: 'חרדל' },
  { id: 'celery', label: 'סלרי' },
  { id: 'lupin', label: 'תורמוס' },
  { id: 'fish', label: 'דגים' },
  { id: 'crustaceans', label: 'סרטנים' },
  { id: 'molluscs', label: 'רכיכות' },
  { id: 'sulphites', label: 'סולפיטים' },
];

/** תנאי אחסון למוצר — בחירה מרשימה בפרופיל */
export const PRODUCT_STORAGE_CONDITIONS = [
  { id: 'room', label: 'טמפרטורת חדר' },
  { id: 'cool', label: 'קירור' },
  { id: 'frozen', label: 'הקפאה' },
  { id: 'dry', label: 'מקום יבש' },
  { id: 'cool_dry', label: 'קירור ומקום יבש' },
  { id: 'room_dry', label: 'טמפרטורת חדר · יבש' },
];

/** יחידות חיי מדף */
export const PRODUCT_SHELF_LIFE_UNITS = [
  { id: 'day', label: 'ימים' },
  { id: 'month', label: 'חודשים' },
  { id: 'year', label: 'שנים' },
];

export function productStorageConditionLabel(id) {
  return PRODUCT_STORAGE_CONDITIONS.find((c) => c.id === id)?.label || '';
}

export function sanitizeProductStorageConditionId(raw) {
  const id = String(raw || '').trim();
  if (!id) return '';
  return PRODUCT_STORAGE_CONDITIONS.some((c) => c.id === id) ? id : '';
}

export function sanitizeProductShelfLifeUnit(raw) {
  const id = String(raw || '').trim();
  return PRODUCT_SHELF_LIFE_UNITS.some((u) => u.id === id) ? id : '';
}

export function sanitizeProductShelfLifeValue(raw) {
  if (raw == null || raw === '') return null;
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n < 1) return null;
  return Math.min(n, 9999);
}

export function shelfLifeUnitWord(unit, value) {
  const n = Number(value) || 0;
  if (unit === 'day') return n === 1 ? 'יום' : 'ימים';
  if (unit === 'month') return n === 1 ? 'חודש' : 'חודשים';
  if (unit === 'year') return n === 1 ? 'שנה' : 'שנים';
  return '';
}

/** מחרוזת תצוגה לחיי מדף (לקטלוג / ייצוא / השלמת פרופיל) */
export function formatProductShelfLife(value, unit) {
  const n = sanitizeProductShelfLifeValue(value);
  const u = sanitizeProductShelfLifeUnit(unit);
  if (!n || !u) return '';
  return `${n} ${shelfLifeUnitWord(u, n)}`;
}

/**
 * מחלץ ערך+יחידה ממוצר — מעדיף שדות מובנים, ואם חסר מנסה לפרסר shelfLife ישן.
 */
export function resolveProductShelfLifeFields(product) {
  const structuredValue = sanitizeProductShelfLifeValue(product?.shelfLifeValue);
  const structuredUnit = sanitizeProductShelfLifeUnit(product?.shelfLifeUnit);
  if (structuredValue && structuredUnit) {
    return { value: structuredValue, unit: structuredUnit };
  }
  const text = String(product?.shelfLife || '').trim();
  const m = text.match(/(\d+)\s*(ימים|יום|חודשים|חודש|שנים|שנה)/);
  if (!m) return { value: null, unit: '' };
  const value = sanitizeProductShelfLifeValue(m[1]);
  const word = m[2];
  let unit = '';
  if (word === 'יום' || word === 'ימים') unit = 'day';
  else if (word === 'חודש' || word === 'חודשים') unit = 'month';
  else if (word === 'שנה' || word === 'שנים') unit = 'year';
  return { value, unit };
}

/**
 * מזהה תנאי אחסון — מעדיף storageConditionId, אחרת התאמה לתווית/טקסט קיים.
 */
export function resolveProductStorageConditionId(product) {
  const byId = sanitizeProductStorageConditionId(product?.storageConditionId);
  if (byId) return byId;
  const text = String(product?.storageConditions || '').trim().toLocaleLowerCase('he');
  if (!text) return '';
  const exact = PRODUCT_STORAGE_CONDITIONS.find((c) => c.label.toLocaleLowerCase('he') === text);
  if (exact) return exact.id;
  // התאמות נפוצות מטקסט חופשי ישן
  if (text.includes('הקפא')) return 'frozen';
  if (text.includes('קירור') && text.includes('יבש')) return 'cool_dry';
  if (text.includes('קירור') || text.includes('מקרר')) return 'cool';
  if (text.includes('יבש')) return 'dry';
  if (text.includes('חדר') || text.includes('סביבה')) return 'room';
  return '';
}

/** רמזי שם בעברית לזיהוי אלרגן מחומר/רכיב */
export const ALLERGEN_NAME_HINTS = {
  gluten: ['קמח', 'גלוטן', 'חיטה', 'שיפון', 'שעורה', 'כוסמין', 'סולת', 'פירורי', 'בצק'],
  milk: ['חלב', 'חמאה', 'שמנת', 'גבינה', 'קוטג', 'ריקוטה', 'יוגורט', 'מארגרין'],
  eggs: ['ביצ', 'חלמון', 'חלבון ביצה'],
  peanuts: ['בוטן', 'בוטנים', 'חמאת בוטנים'],
  tree_nuts: ['אגוז', 'שקדים', 'שקדי', 'לוז', 'פקאן', 'קשיו', 'פיסטוק', 'מקדמיה'],
  sesame: ['שומשום', 'טחינה'],
  soy: ['סויה', 'טופו', 'לציטין'],
  mustard: ['חרדל'],
  celery: ['סלרי'],
  lupin: ['תורמוס'],
  fish: ['דגים', 'טונה', 'סלמון', 'אנשובי'],
  crustaceans: ['סרטן', 'שרימפ', 'חסילון'],
  molluscs: ['קלמרי', 'צדפה', 'רכיכ'],
  sulphites: ['סולפיט', 'גופרית'],
};

export function productAllergenLabel(id) {
  return PRODUCT_ALLERGENS.find((a) => a.id === id)?.label || id || '—';
}

export function sanitizeProductAllergenIds(raw) {
  const allowed = new Set(PRODUCT_ALLERGENS.map((a) => a.id));
  const list = Array.isArray(raw) ? raw : [];
  return [...new Set(list.map((x) => String(x || '').trim()).filter((id) => allowed.has(id)))];
}

export function sanitizeProductAllergensMode(raw) {
  return String(raw || '').trim() === 'manual' ? 'manual' : 'auto';
}

/** זיהוי אלרגנים משם חומר/רכיב */
export function inferAllergensFromName(name) {
  const n = String(name || '').trim().toLowerCase();
  if (!n) return [];
  const hits = [];
  for (const [id, hints] of Object.entries(ALLERGEN_NAME_HINTS)) {
    if (hints.some((h) => n.includes(String(h).toLowerCase()))) hits.push(id);
  }
  return hits;
}

/**
 * איחוד אלרגנים מהרכב מוצר:
 * חומרי גלם משויכים (שדה allergens) + זיהוי לפי שם רכיב/חומר.
 */
export async function computeProductAllergensFromComposition(productId) {
  const pid = sanitizeProductId(productId);
  if (!pid) return { allergenIds: [], sources: [] };

  const [recipeComps, portionComps, materials] = await Promise.all([
    getProductRecipeComponents(pid),
    getProductPortionComponents(pid),
    getRawMaterials(),
  ]);
  const matById = new Map(materials.map((m) => [m.id, m]));
  const byNameKey = buildMaterialsByNameKey(materials);
  const found = new Set();
  const sources = [];

  const addFromName = (label, name, extraIds = []) => {
    const inferred = [
      ...sanitizeProductAllergenIds(extraIds),
      ...inferAllergensFromName(name),
    ];
    if (!inferred.length) return;
    for (const id of inferred) found.add(id);
    sources.push({ label, name: name || label, allergenIds: inferred });
  };

  for (const comp of recipeComps) {
    const recipe = await getRecipe(comp.recipeId);
    if (!recipe) continue;
    const ings = await getRecipeCostingIngredients(recipe);
    for (const ing of ings) {
      const { mat } = resolveRecipeIngredientMaterial(ing, { matById, byNameKey });
      const matAllergens = sanitizeProductAllergenIds(mat?.allergens);
      addFromName(recipe.name, ing.name || mat?.name, matAllergens);
    }
  }

  for (const comp of portionComps) {
    const mat = matById.get(Number(comp.rawMaterialId));
    if (!mat) continue;
    addFromName(mat.name, mat.name, sanitizeProductAllergenIds(mat.allergens));
  }

  return {
    allergenIds: PRODUCT_ALLERGENS.map((a) => a.id).filter((id) => found.has(id)),
    sources,
  };
}

/**
 * ציון השלמות לפרופיל מוצר — מתכונים, מנות, מחיר, אפייה, משקל (+ תזרים/אריזה).
 * פונקציה טהורה לבדיקות + UI.
 */
export function buildProductProfileCompleteness({
  product = null,
  components = [],
  linkedRecipes = [],
  bakingProfile = null,
  totalWeightGrams = 0,
  portionPresets = [],
  linkedFlows = [],
  allergenIds = null,
} = {}) {
  const comps = components || [];
  const recipeComps = comps.filter((c) => c.kind !== 'portion');
  const portionComps = comps.filter((c) => c.kind === 'portion');
  const priceUnit = product?.priceUnit || 'unit';
  const needsUnitWeight = priceUnit === 'kg_units' || priceUnit === 'kg_with_units';
  const unitWeightKg = Number(product?.unitWeightKg) || 0;
  const unitPrice = Number(product?.unitPrice) || 0;
  const compositionKg = (Number(totalWeightGrams) || 0) / 1000;
  const allergens = allergenIds != null
    ? sanitizeProductAllergenIds(allergenIds)
    : sanitizeProductAllergenIds(product?.allergens);

  const items = [
    {
      id: 'composition',
      label: 'הרכב מוצר',
      done: recipeComps.length > 0 || portionComps.length > 0,
      detail: recipeComps.length || portionComps.length
        ? `${recipeComps.length} מתכונים · ${portionComps.length} מנות הרכב`
        : 'חסר מתכון או מנה בהרכב',
      required: true,
    },
    {
      id: 'recipes',
      label: 'שיוך למתכונים',
      done: (linkedRecipes || []).length > 0 || recipeComps.length > 0,
      detail: (linkedRecipes || []).length
        ? `${linkedRecipes.length} מקושרים`
        : (recipeComps.length ? 'דרך הרכב' : 'אין שיוך'),
      required: true,
    },
    {
      id: 'weight',
      label: 'משקל הרכב',
      done: compositionKg > 0,
      detail: compositionKg > 0 ? `${formatKgWeight(compositionKg)}` : 'אין משקל בהרכב',
      required: true,
    },
    {
      id: 'price',
      label: 'מחיר ללקוח',
      done: unitPrice > 0,
      detail: unitPrice > 0 ? `${unitPrice} ₪` : 'לא הוגדר',
      required: true,
    },
    {
      id: 'sell_weight',
      label: 'משקל ליחידה (מכירה)',
      done: !needsUnitWeight || unitWeightKg > 0,
      detail: needsUnitWeight
        ? (unitWeightKg > 0 ? `${unitWeightKg} ק"ג/יח'` : 'נדרש למצב תמחור זה')
        : 'לא נדרש במצב תמחור הנוכחי',
      required: needsUnitWeight,
    },
    {
      id: 'baking',
      label: 'פרופיל אפייה',
      done: !!bakingProfile,
      detail: bakingProfile?.name || 'לא שויך',
      required: true,
    },
    {
      id: 'portion_presets',
      label: 'מנות מתכון / תזרים',
      done: (portionPresets || []).length > 0 || portionComps.length > 0,
      detail: (portionPresets || []).length
        ? `${portionPresets.length} מנות משויכות`
        : (portionComps.length ? 'יש מנות בהרכב' : 'אופציונלי'),
      required: false,
    },
    {
      id: 'flows',
      label: 'תזרים ייצור',
      done: (linkedFlows || []).length > 0,
      detail: (linkedFlows || []).length
        ? `${linkedFlows.length} תזרימים`
        : 'אופציונלי — אפשר גם לפי קטגוריה',
      required: false,
    },
    {
      id: 'allergens',
      label: 'אלרגנים',
      done: allergens.length > 0,
      detail: allergens.length
        ? `${allergens.length} סומנו`
        : 'אופציונלי — ניתן לחשב מהרכב',
      required: false,
    },
    {
      id: 'shelf_life',
      label: 'חיי מדף / אחסון',
      done: !!(String(product?.shelfLife || '').trim() || String(product?.storageConditions || '').trim()
        || product?.shelfLifeValue || product?.storageConditionId),
      detail: [
        formatProductShelfLife(product?.shelfLifeValue, product?.shelfLifeUnit) || String(product?.shelfLife || '').trim(),
        productStorageConditionLabel(product?.storageConditionId) || String(product?.storageConditions || '').trim(),
      ].filter(Boolean).join(' · ') || 'אופציונלי',
      required: false,
    },
    {
      id: 'packaging',
      label: 'אריזה',
      done: !!product?.packagingMaterialId || Number(product?.packagingCost) > 0 || Number(product?.unitsPerCarton) > 0,
      detail: product?.unitsPerCarton
        ? `${product.unitsPerCarton} יח'/קרטון`
        : (product?.packagingMaterialId ? 'חומר אריזה משויך' : 'אופציונלי'),
      required: false,
    },
  ];

  const required = items.filter((i) => i.required);
  const doneRequired = required.filter((i) => i.done).length;
  const doneAll = items.filter((i) => i.done).length;
  const percent = required.length ? Math.round((doneRequired / required.length) * 100) : 0;

  return {
    percent,
    doneRequired,
    totalRequired: required.length,
    doneAll,
    totalAll: items.length,
    items,
    missingRequired: required.filter((i) => !i.done),
    ready: doneRequired === required.length,
  };
}

export async function getProductDetail(productId) {
  const pid = sanitizeProductId(productId);
  if (!pid) throw new ValidationError('מוצר לא תקין');
  const product = await db.products.get(pid);
  if (!product) throw new ValidationError('מוצר לא נמצא');

  const [totals, linkedRecipes, bakingLink, profiles, category, computedAllergens] = await Promise.all([
    computeProductCompositionCostTotals(pid),
    getRecipesForProduct(pid),
    getProductBakingProfileLink(pid),
    getBakingProfiles(),
    db.categories.get(product.categoryId),
    computeProductAllergensFromComposition(pid),
  ]);
  const profileMap = new Map(profiles.map((p) => [p.id, p]));

  const enrichedComponents = totals.components.map((comp) => {
    if (comp.kind === 'portion') return comp;
    return {
      ...comp,
      bakingLine: formatRecipeBakingParamsLine(comp.recipe, profileMap),
    };
  });

  const recommendedCost = sanitizeMoney(totals.recommendedCost);
  const fullCost = sanitizeMoney(totals.fullCost);
  const rawMaterialsCostSource = sanitizeRawMaterialsCostSource(product.rawMaterialsCostSource);

  // Keep stored cost aligned with live composition so the product list matches detail.
  if (rawMaterialsCostSource === 'recipes') {
    const stored = sanitizeMoney(product.rawMaterialsCost);
    if (stored !== recommendedCost) {
      await db.products.update(pid, { rawMaterialsCost: recommendedCost });
      product.rawMaterialsCost = recommendedCost;
    }
  }

  const allergensMode = sanitizeProductAllergensMode(product.allergensMode);
  let allergenIds = sanitizeProductAllergenIds(product.allergens);
  if (allergensMode === 'auto') {
    allergenIds = computedAllergens.allergenIds;
    // שמירה שקטה של תוצאת auto כדי שהרשימה/HACCP יוכלו להיעזר
    const prev = sanitizeProductAllergenIds(product.allergens).join(',');
    const next = allergenIds.join(',');
    if (prev !== next) {
      await db.products.update(pid, { allergens: allergenIds, allergensMode: 'auto' });
      product.allergens = allergenIds;
      product.allergensMode = 'auto';
    }
  }

  const effectiveRawCost = rawMaterialsCostSource === 'recipes'
    ? recommendedCost
    : sanitizeMoney(product.rawMaterialsCost);
  const packagingCost = sanitizeMoney(product.packagingCost);
  const additionalCosts = sanitizeMoney(product.additionalCosts);
  const totalCost = sanitizeMoney(effectiveRawCost + packagingCost + additionalCosts);
  const unitPrice = sanitizeMoney(product.unitPrice);

  return {
    product,
    category,
    components: enrichedComponents,
    linkedRecipes,
    bakingProfileLink: bakingLink,
    bakingProfile: bakingLink?.profile || null,
    totalWeightGrams: totals.totalWeightGrams,
    recommendedCost,
    fullCost,
    currentCosts: {
      rawMaterialsCost: effectiveRawCost,
      rawMaterialsCostSource,
      packagingCost,
      additionalCosts,
      unitPrice,
      totalCost,
    },
    margin: unitPrice > 0 ? sanitizeMoney(unitPrice - totalCost) : null,
    allergensMode,
    allergenIds,
    computedAllergens,
  };
}

/** מחשב עלות/משקל מהרכב המוצר (מתכונים + מנות) — מקור אמת יחיד לרשימה ולפרופיל */
export async function computeProductCompositionCostTotals(productId) {
  const pid = sanitizeProductId(productId);
  if (!pid) {
    return { recommendedCost: 0, fullCost: 0, totalWeightGrams: 0, components: [] };
  }

  const [recipeComponents, portionComponents, materials] = await Promise.all([
    getProductRecipeComponents(pid),
    getProductPortionComponents(pid),
    getRawMaterials(),
  ]);
  const matById = new Map(materials.map((m) => [m.id, m]));

  let totalWeightGrams = 0;
  let recommendedCost = 0;
  let fullCost = 0;
  const components = [];

  for (const comp of recipeComponents) {
    const recipe = await getRecipe(comp.recipeId);
    if (!recipe) continue;
    const costingIngredients = await getRecipeCostingIngredients(recipe);
    const recipeTotalG = recipeTotalWeightGrams(costingIngredients);
    const targetG = comp.weightGrams != null && comp.weightGrams > 0 ? comp.weightGrams : recipeTotalG;
    const scaledIngredients = targetG > 0 && recipeTotalG > 0
      ? scaleIngredientsToTargetGrams(costingIngredients, targetG)
      : costingIngredients;

    const lineSupplierCost = await computeRecipeMaterialsCostFiltered(
      scaledIngredients, materials, { supplierOnly: true },
    );
    const lineFullCost = await computeRecipeMaterialsCost(
      ingredientsWithScaledQuantity(scaledIngredients), materials,
    );

    totalWeightGrams += targetG || 0;
    recommendedCost += lineSupplierCost;
    fullCost += lineFullCost;

    components.push({
      ...comp,
      kind: 'recipe',
      recipe,
      recipeTotalGrams: recipeTotalG,
      effectiveWeightGrams: targetG,
      scaledIngredients,
      supplierCost: sanitizeMoney(lineSupplierCost),
      fullCost: sanitizeMoney(lineFullCost),
    });
  }

  for (const comp of portionComponents) {
    const mat = matById.get(Number(comp.rawMaterialId));
    if (!mat) continue;
    const defaultG = portionMaterialDefaultWeightGrams(mat) || 0;
    const targetG = comp.weightGrams != null && comp.weightGrams > 0 ? comp.weightGrams : defaultG;
    const lineCost = computePortionComponentCost(mat, targetG);
    totalWeightGrams += targetG || 0;
    recommendedCost += lineCost;
    fullCost += lineCost;
    components.push({
      ...comp,
      kind: 'portion',
      material: mat,
      portionDefaultGrams: defaultG,
      effectiveWeightGrams: targetG,
      supplierCost: sanitizeMoney(lineCost),
      fullCost: sanitizeMoney(lineCost),
    });
  }

  components.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id);

  return {
    recommendedCost: sanitizeMoney(recommendedCost),
    fullCost: sanitizeMoney(fullCost),
    totalWeightGrams,
    components,
  };
}

/** סנכרון עלות חומרי גלם במוצר מסכום הרכיבים (מחירי ספק) */
export async function syncProductCostFromComposition(productId, { setSource = false } = {}) {
  const pid = sanitizeProductId(productId);
  if (!pid) throw new ValidationError('מוצר לא תקין');
  const product = await db.products.get(pid);
  if (!product) throw new ValidationError('מוצר לא נמצא');

  const { recommendedCost } = await computeProductCompositionCostTotals(pid);
  const cost = sanitizeMoney(recommendedCost);
  const patch = { rawMaterialsCost: cost };
  if (setSource) patch.rawMaterialsCostSource = 'recipes';
  const storedCost = sanitizeMoney(product.rawMaterialsCost);
  const sourceChanged = setSource && product.rawMaterialsCostSource !== 'recipes';
  if (storedCost !== cost || sourceChanged) {
    await db.products.update(pid, patch);
  }
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

/** סנכרון עלות חומ״ג ממתכונים לכל המוצרים במצב recipes */
export async function syncAllProductsCostFromRecipes() {
  const products = await db.products.toArray();
  let synced = 0;
  for (const p of products) {
    if (!isProductRecipesCostSource(p)) continue;
    try {
      await syncProductCostFromComposition(p.id);
      synced += 1;
    } catch {
      /* מוצר בלי הרכב / שגיאה נקודתית */
    }
  }
  return synced;
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

/** קטגוריית חומרי ניקיון — לא קשורה למתכונים, מחיר פשוט ליחידה */
export function isCleaningSupplierCategory(cat) {
  return !!cat?.isCleaning;
}

/** קטגוריה שאינה חומרי גלם למתכונים (אריזות / חומרי ניקיון) — החומרים בה תמיד פעילים */
export function isNonRecipeSupplierCategory(cat) {
  return isPackagingSupplierCategory(cat) || isCleaningSupplierCategory(cat);
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
      packLinkedProductId: null,
      packLinkedCategoryId: null,
    };
  }
  const kind = sanitizePackagingKind(raw?.packagingKind) || PACKAGING_KIND_CARTON;
  const packUnitsCount = sanitizePackCount(raw?.packUnitsCount);
  const packProductsPerUnit = kind === PACKAGING_KIND_CARTON
    ? sanitizePackCount(raw?.packProductsPerUnit)
    : null;
  const linkedProductId = sanitizeProductId(raw?.packLinkedProductId) || null;
  const linkedCategoryId = linkedProductId
    ? null
    : (sanitizeProductId(raw?.packLinkedCategoryId) || null);
  return {
    packagingKind: kind,
    packUnitsCount,
    packProductsPerUnit,
    packLinkedProductId: linkedProductId,
    packLinkedCategoryId: linkedCategoryId,
  };
}

/** חומרי גלם מסוג אריזה (קטגוריית אריזות או packagingKind) */
export async function getPackagingMaterials() {
  const [mats, cats] = await Promise.all([getRawMaterials(), getSupplierCategories()]);
  const packCatIds = new Set(
    (cats || []).filter((c) => isPackagingSupplierCategory(c)).map((c) => Number(c.id)),
  );
  return (mats || [])
    .filter((m) => m.packagingKind || packCatIds.has(Number(m.supplierCategoryId)))
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'he'));
}

/**
 * אחרי שמירת אריזה — מסנכרן שיוך למוצר/קטגוריה וכמות בקרטון למוצר המשויך.
 */
export async function applyPackagingLinks(materialId, {
  linkedProductId = null,
  linkedCategoryId = null,
  productsPerCarton = null,
  syncProductCost = true,
} = {}) {
  const mid = sanitizeProductId(materialId);
  if (!mid) return;
  const mat = await db.rawMaterials.get(mid);
  if (!mat) return;

  const pid = sanitizeProductId(linkedProductId) || null;
  const cid = pid ? null : (sanitizeProductId(linkedCategoryId) || null);
  let qty = null;
  if (mat.packagingKind === PACKAGING_KIND_CARTON) {
    const raw = productsPerCarton ?? mat.packProductsPerUnit;
    if (raw != null && raw !== '') qty = sanitizePackCount(raw);
  }

  await db.rawMaterials.update(mid, {
    packLinkedProductId: pid,
    packLinkedCategoryId: cid,
    ...(qty != null ? { packProductsPerUnit: qty } : {}),
  });

  if (pid) {
    const patch = {
      packagingMaterialId: mid,
      ...(qty != null ? { unitsPerCarton: qty } : {}),
    };
    if (syncProductCost) {
      const cost = computePackagingCostPerProduct({
        ...mat,
        packProductsPerUnit: qty ?? mat.packProductsPerUnit,
      });
      if (cost != null) patch.packagingCost = cost;
    }
    await db.products.update(pid, patch);
  }
}

/**
 * אחרי שמירת מוצר — מסנכרן כמות בקרטון לאריזה המשויכת (אם קרטון).
 */
export async function syncProductPackagingToMaterial(productId, {
  packagingMaterialId = null,
  unitsPerCarton = null,
  syncCost = false,
} = {}) {
  const pid = sanitizeProductId(productId);
  if (!pid) return;
  const mid = sanitizeProductId(packagingMaterialId) || null;
  if (!mid) return;

  const mat = await db.rawMaterials.get(mid);
  if (!mat) return;

  const patch = {};
  if (mat.packagingKind === PACKAGING_KIND_CARTON
    && unitsPerCarton != null && unitsPerCarton !== '') {
    patch.packProductsPerUnit = sanitizePackCount(unitsPerCarton);
  }
  if (!mat.packLinkedProductId && !mat.packLinkedCategoryId) {
    patch.packLinkedProductId = pid;
    patch.packLinkedCategoryId = null;
  }
  if (Object.keys(patch).length) await db.rawMaterials.update(mid, patch);

  if (syncCost) {
    const cost = computePackagingCostPerProduct({
      ...mat,
      ...patch,
    });
    if (cost != null) await db.products.update(pid, { packagingCost: cost });
  }
}

export async function getSupplierCategories() {
  const rows = await db.supplierCategories.toArray();
  rows.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id);
  return rows;
}

export async function addSupplierCategory(name, { isPackaging = false, isCleaning = false } = {}) {
  const trimmed = sanitizeName(name, 40);
  if (!trimmed) throw new ValidationError('שם קטגוריה לא תקין');
  const existing = await getSupplierCategories();
  if (existing.some((c) => c.name === trimmed)) throw new ValidationError('קטגוריה כבר קיימת');
  const maxOrder = existing.reduce((m, c) => Math.max(m, c.sortOrder ?? 0), 0);
  return db.supplierCategories.add({
    name: trimmed,
    sortOrder: maxOrder + 1,
    isPackaging: !!isPackaging && !isCleaning,
    isCleaning: !!isCleaning,
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
  if ('isCleaning' in data) data.isCleaning = !!data.isCleaning;
  if (data.isCleaning) data.isPackaging = false;
  if (Object.keys(data).length) await db.supplierCategories.update(cid, data);
  if ('isPackaging' in data || 'isCleaning' in data) await syncRawMaterialsActiveFromRecipes();
}

/**
 * מוודא שקיימת קטגוריית חומרי ניקיון 🧹 — יוצר אחת אם אין,
 * או מסמן קטגוריה קיימת בשם/דגל ניקיון.
 * לא יוצר כפילות אם כבר יש isCleaning או שם עם «ניקיון».
 */
export async function ensureCleaningSupplierCategory() {
  const cats = await getSupplierCategories();
  if (cats.some((c) => isCleaningSupplierCategory(c))) return;
  const byName = cats.find((c) => {
    const n = String(c.name || '').trim();
    return n === 'חומרי ניקיון' || /ניקיון/.test(n);
  });
  if (byName) {
    await db.supplierCategories.update(byName.id, { isCleaning: true, isPackaging: false });
    return;
  }
  await addSupplierCategory('חומרי ניקיון', { isCleaning: true });
}

/**
 * מוודא שקיימות קטגוריות התפקיד: חומרי גלם / אריזות / חומרי ניקיון.
 * מחזיר Map role → category row.
 */
export async function ensureRoleSupplierCategories() {
  await ensureCleaningSupplierCategory();
  let cats = await getSupplierCategories();

  let packaging = cats.find((c) => isPackagingSupplierCategory(c) || /^אריז/.test(String(c.name || '').trim()));
  if (!packaging) {
    await addSupplierCategory('אריזות', { isPackaging: true });
  } else if (!packaging.isPackaging || packaging.isCleaning) {
    await db.supplierCategories.update(packaging.id, {
      isPackaging: true,
      isCleaning: false,
      name: String(packaging.name || '').trim() === 'אריזה' ? 'אריזות' : (packaging.name || 'אריזות'),
    });
  }

  cats = await getSupplierCategories();
  let raw = cats.find((c) => /^חומרי\s*גלם/.test(String(c.name || '').trim()));
  if (!raw) {
    await addSupplierCategory('חומרי גלם');
  } else if (raw.isPackaging || raw.isCleaning) {
    await db.supplierCategories.update(raw.id, {
      isPackaging: false,
      isCleaning: false,
    });
  } else if (String(raw.name || '').trim() === 'חומרי גלם יבשים') {
    await db.supplierCategories.update(raw.id, { name: 'חומרי גלם' });
  }

  cats = await getSupplierCategories();
  const cleaning = cats.find((c) => isCleaningSupplierCategory(c) || /ניקיון/.test(String(c.name || '')));
  packaging = cats.find((c) => isPackagingSupplierCategory(c) || /^אריז/.test(String(c.name || '').trim()));
  raw = cats.find((c) => /^חומרי\s*גלם/.test(String(c.name || '').trim()))
    || cats.find((c) => !c.isPackaging && !c.isCleaning
      && !/^אריז/.test(String(c.name || ''))
      && !/ניקיון/.test(String(c.name || '')));

  const byRole = new Map();
  if (raw) byRole.set('raw', raw);
  if (packaging) byRole.set('packaging', packaging);
  if (cleaning) byRole.set('cleaning', cleaning);
  return byRole;
}

/**
 * מסיק תפקיד לחומר.
 * חשוב: הוספה לקטגוריית אריזות ממלאת packagingKind=carton אוטומטית —
 * לכן לא סומכים על packagingKind לבד; דורשים גם שם שנראה כמו אריזה,
 * אחרת מחזירים לחומ״ג (או ניקיון לפי שם).
 */
export function inferRawMaterialSupplierRole(material, catById = null) {
  if (!material) return 'raw';
  const name = String(material.name || '');
  if (/ניקיון|אקונומיק|סבון|דטרגנט|מחטא|כלור|אקונומיה|ממחטות|מגבונ/.test(name)) {
    return 'cleaning';
  }
  const packagingName = /קרטון|קופס|מגש|שקית|ניילון|מדבק|סרט הדב|לוגו|מכסה|אלומינ|כפפ|מנשא|מיכל|תבנית|אריז|פלסטיק|פואל|פויל|רדיד/
    .test(name);
  if (material.packagingKind && packagingName) return 'packaging';
  if (material.packagingKind && !packagingName) {
    // packagingKind אוטומטי מקטגוריה — לא אריזה אמיתית
    return 'raw';
  }
  const cat = catById?.get?.(Number(material.supplierCategoryId));
  if (cat?.isCleaning || /ניקיון/.test(String(cat?.name || ''))) return 'cleaning';
  if (cat?.isPackaging || /^אריז/.test(String(cat?.name || '').trim())) return 'raw';
  if (/^חומרי\s*גלם/.test(String(cat?.name || ''))) return 'raw';
  if (/יי?בוא/.test(String(cat?.name || '')) && /מתכו/.test(String(cat?.name || ''))) return 'import';
  return 'raw';
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

/** השוואת מזהים אחרי סנכרון — Dexie יכול לשמור FK כמחרוזת ("12" מול 12) */
export function sameNumericId(a, b) {
  const na = Number(a);
  const nb = Number(b);
  return Number.isFinite(na) && Number.isFinite(nb) && na > 0 && na === nb;
}

function numericFkPatch(val) {
  if (val == null || val === '') return { changed: false, value: val == null ? null : val };
  if (typeof val === 'number' && Number.isFinite(val)) return { changed: false, value: val };
  if (typeof val === 'string' && /^\d+$/.test(val.trim())) {
    return { changed: true, value: Number(val.trim()) };
  }
  return { changed: false, value: val };
}

/**
 * מתקן FKs שנשמרו כמחרוזות אחרי גיבוי/סנכרון ישן —
 * אחרת סינון Dexie ו-Map של צפייה מפספסים ספקים/חומרים.
 */
export async function coerceSupplierNumericFks() {
  if (!db.suppliers || !db.rawMaterials) return 0;
  let fixed = 0;
  const suppliers = await db.suppliers.toArray();
  for (const s of suppliers) {
    const cat = numericFkPatch(s.categoryId);
    if (!cat.changed) continue;
    await db.suppliers.update(s.id, { categoryId: cat.value });
    fixed += 1;
  }
  const materials = await db.rawMaterials.toArray();
  for (const m of materials) {
    const patch = {};
    const cat = numericFkPatch(m.supplierCategoryId);
    if (cat.changed) patch.supplierCategoryId = cat.value;
    if (m.supplierId != null && m.supplierId !== '') {
      const sid = numericFkPatch(m.supplierId);
      if (sid.changed) patch.supplierId = sid.value;
    }
    if (!Object.keys(patch).length) continue;
    await db.rawMaterials.update(m.id, patch);
    fixed += 1;
  }
  if (db.rawMaterialPriceHistory) {
    const hist = await db.rawMaterialPriceHistory.toArray();
    for (const h of hist) {
      const mid = numericFkPatch(h.rawMaterialId);
      if (!mid.changed) continue;
      await db.rawMaterialPriceHistory.update(h.id, { rawMaterialId: mid.value });
      fixed += 1;
    }
  }
  return fixed;
}

/**
 * מיישר unitPrice לפי שורת ההיסטוריה האחרונה — אחרי pull המחיר בטבלת החומר
 * יכול להישאר ישן בזמן שההיסטוריה כבר עודכנה (או להפך).
 */
export async function reconcileRawMaterialPricesFromHistory() {
  if (!db.rawMaterials || !db.rawMaterialPriceHistory) return 0;
  const [mats, hist] = await Promise.all([
    db.rawMaterials.toArray(),
    db.rawMaterialPriceHistory.toArray(),
  ]);
  if (!hist.length) return 0;
  const latestByMat = new Map();
  for (const h of hist) {
    const mid = Number(h.rawMaterialId);
    if (!mid) continue;
    const cur = latestByMat.get(mid);
    if (!cur) {
      latestByMat.set(mid, h);
      continue;
    }
    const d = String(h.effectiveDate || '').localeCompare(String(cur.effectiveDate || ''));
    if (d > 0 || (d === 0 && String(h.createdAt || '') > String(cur.createdAt || ''))) {
      latestByMat.set(mid, h);
    }
  }
  let fixed = 0;
  for (const m of mats) {
    const latest = latestByMat.get(Number(m.id));
    if (!latest) continue;
    const hp = sanitizeMoney(latest.price);
    const up = sanitizeMoney(m.unitPrice);
    if (hp === up) continue;
    await db.rawMaterials.update(m.id, { unitPrice: hp });
    fixed += 1;
  }
  return fixed;
}

export async function getSuppliers(categoryId) {
  let rows = await db.suppliers.toArray();
  if (categoryId) rows = rows.filter((s) => sameNumericId(s.categoryId, categoryId));
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
    const newCat = await db.supplierCategories.get(data.categoryId);
    const isPack = isPackagingSupplierCategory(newCat);
    const isClean = isCleaningSupplierCategory(newCat);
    const mats = (await db.rawMaterials.toArray())
      .filter((m) => sameNumericId(m.supplierId, sid));
    for (const m of mats) {
      const patch = { supplierCategoryId: data.categoryId };
      if (!isPack) {
        patch.packagingKind = null;
        patch.packUnitsCount = null;
        patch.packProductsPerUnit = null;
        patch.packLinkedProductId = null;
        patch.packLinkedCategoryId = null;
      } else {
        Object.assign(patch, normalizePackagingFields(m, { categoryIsPackaging: true }));
      }
      if (isClean && m.packagingKind) {
        patch.packagingKind = null;
      }
      await db.rawMaterials.update(m.id, patch);
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
    rows = rows.filter((m) => sameNumericId(m.supplierCategoryId, supplierCategoryId));
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

/** ברקוד מוצר/אריזה (EAN וכו') — מחרוזת קצרה או null לניקוי */
export function sanitizeBarcode(value) {
  const s = String(value ?? '').trim();
  if (!s) return null;
  return s.slice(0, 64);
}

/** מק״ט / קוד פריט ספק — מחרוזת קצרה או null */
export function sanitizeSku(value) {
  const s = String(value ?? '').trim().replace(/\s+/g, ' ');
  if (!s) return null;
  return s.slice(0, 64);
}

/** הערות חומר גלם */
export function sanitizeMaterialNotes(value) {
  const s = String(value ?? '').trim();
  if (!s) return null;
  return s.slice(0, 500);
}

/** כמות הזמנה מינימלית (MOQ) — מספר חיובי או null */
export function sanitizeMinOrderQty(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 1000) / 1000;
}

export async function findRawMaterialsByBarcode(barcode, { excludeId = null } = {}) {
  const code = sanitizeBarcode(barcode);
  if (!code) return [];
  const exclude = excludeId ? Number(excludeId) : null;
  let rows = [];
  try {
    rows = await db.rawMaterials.where('barcode').equals(code).toArray();
  } catch {
    rows = (await db.rawMaterials.toArray()).filter((m) => sanitizeBarcode(m.barcode) === code);
  }
  if (exclude) rows = rows.filter((m) => Number(m.id) !== exclude);
  return rows;
}

/**
 * חומרים קיימים באותו שם (מכל קטגוריה/ספק) — לאזהרת כפילות לפני יצירת חומר חדש.
 * לא חוסם יצירה (ראה openDuplicateMaterialModal), רק מציע להשתמש בקיים.
 */
export async function findRawMaterialsByName(name, { excludeId = null } = {}) {
  const key = normalizeMaterialKey(name);
  if (!key) return [];
  const exclude = excludeId ? Number(excludeId) : null;
  const rows = (await db.rawMaterials.toArray())
    .filter((m) => normalizeMaterialKey(m.name) === key && (!exclude || Number(m.id) !== exclude));
  rows.sort((a, b) => a.id - b.id);
  return rows;
}

export async function addRawMaterial({
  supplierCategoryId, name, unit, unitPrice, supplierId, packageWeightGrams,
  processedPricePerKg, isFree,
  packagingKind, packUnitsCount, packProductsPerUnit,
  packLinkedProductId, packLinkedCategoryId,
  synonyms,
  allergens,
  barcode,
  sku,
  notes,
  minOrderQty,
}) {
  const cid = sanitizeProductId(supplierCategoryId);
  const trimmed = sanitizeName(name, 80);
  if (!cid) throw new ValidationError('קטגוריה לא תקינה');
  if (!trimmed) throw new ValidationError('שם חומר לא תקין');
  const category = await db.supplierCategories.get(cid);
  const isPack = isPackagingSupplierCategory(category);
  const isClean = isCleaningSupplierCategory(category);
  const simplePricing = isPack || isClean; // בלי משקל אריזה / מחיר לק"ג
  const inCat = await getRawMaterials(cid);
  const maxOrder = inCat.reduce((m, r) => Math.max(m, r.sortOrder ?? 0), 0);
  const price = sanitizeMoney(unitPrice);
  const sid = supplierId ? sanitizeProductId(supplierId) : null;
  const pkg = sanitizePackageWeightGrams(packageWeightGrams);
  const packaging = normalizePackagingFields(
    {
      packagingKind, packUnitsCount, packProductsPerUnit,
      packLinkedProductId, packLinkedCategoryId,
    },
    { categoryIsPackaging: isPack },
  );
  const code = sanitizeBarcode(barcode);
  if (code) {
    const conflicts = await findRawMaterialsByBarcode(code);
    if (conflicts.length) {
      throw new ValidationError(`הברקוד כבר משויך ל«${conflicts[0].name}»`);
    }
  }
  const id = await db.rawMaterials.add({
    supplierCategoryId: cid,
    name: trimmed,
    unit: String(unit || (isPack ? 'חבילה' : (isClean ? 'יח\'' : 'ק"ג'))).trim().slice(0, 20),
    unitPrice: price,
    supplierId: sid,
    packageWeightGrams: simplePricing ? null : pkg,
    processedPricePerKg: simplePricing
      ? null
      : sanitizeProcessedPricePerKg(processedPricePerKg),
    isFree: !simplePricing && !!isFree,
    synonyms: sanitizeMaterialSynonyms(synonyms),
    allergens: sanitizeProductAllergenIds(allergens),
    barcode: code,
    sku: sanitizeSku(sku),
    notes: sanitizeMaterialNotes(notes),
    minOrderQty: sanitizeMinOrderQty(minOrderQty),
    ...packaging,
    active: simplePricing,
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
  if ('isFree' in data) data.isFree = !!data.isFree;
  if ('synonyms' in data) data.synonyms = sanitizeMaterialSynonyms(data.synonyms);
  if ('allergens' in data) data.allergens = sanitizeProductAllergenIds(data.allergens);
  if ('barcode' in data) {
    const code = sanitizeBarcode(data.barcode);
    if (code) {
      const conflicts = await findRawMaterialsByBarcode(code, { excludeId: mid });
      if (conflicts.length) {
        throw new ValidationError(`הברקוד כבר משויך ל«${conflicts[0].name}»`);
      }
    }
    data.barcode = code;
  }
  if ('sku' in data) data.sku = sanitizeSku(data.sku);
  if ('notes' in data) data.notes = sanitizeMaterialNotes(data.notes);
  if ('minOrderQty' in data) data.minOrderQty = sanitizeMinOrderQty(data.minOrderQty);
  if ('packagingKind' in data || 'packUnitsCount' in data || 'packProductsPerUnit' in data
    || 'packLinkedProductId' in data || 'packLinkedCategoryId' in data) {
    const current = await db.rawMaterials.get(mid);
    const category = current
      ? await db.supplierCategories.get(current.supplierCategoryId)
      : null;
    const packaging = normalizePackagingFields(
      {
        packagingKind: 'packagingKind' in data ? data.packagingKind : current?.packagingKind,
        packUnitsCount: 'packUnitsCount' in data ? data.packUnitsCount : current?.packUnitsCount,
        packProductsPerUnit: 'packProductsPerUnit' in data ? data.packProductsPerUnit : current?.packProductsPerUnit,
        packLinkedProductId: 'packLinkedProductId' in data ? data.packLinkedProductId : current?.packLinkedProductId,
        packLinkedCategoryId: 'packLinkedCategoryId' in data ? data.packLinkedCategoryId : current?.packLinkedCategoryId,
      },
      { categoryIsPackaging: isPackagingSupplierCategory(category) },
    );
    Object.assign(data, packaging);
  }
  if (Object.keys(data).length) {
    await db.rawMaterials.update(mid, data);
    if ('name' in data) await syncRawMaterialsActiveFromRecipes();
    const after = await db.rawMaterials.get(mid);
    if (after?.isPortion) await syncRawMaterialPortionPreset(mid);
  }
}

export async function deleteRawMaterial(id) {
  const mid = sanitizeProductId(id);
  if (!mid) return;
  await clearRawMaterialPortionPresets(mid);
  if (db.productPortionComponents) {
    await db.productPortionComponents.where('rawMaterialId').equals(mid).delete();
  }
  await db.rawMaterialPriceHistory.where('rawMaterialId').equals(mid).delete();
  await db.rawMaterials.delete(mid);
  await syncRawMaterialsActiveFromRecipes();
}

async function clearRawMaterialPortionPresets(materialId) {
  const mid = Number(materialId);
  if (!mid) return;
  const existing = await db.groupPortionPresets
    .where('sourceRawMaterialId')
    .equals(mid)
    .toArray();
  for (const row of existing) {
    await deletePortionPresetIngredientSettings(row.id);
    if (db.portionPresetLinks) {
      await db.portionPresetLinks.where('portionPresetId').equals(row.id).delete();
    }
    await db.groupPortionPresets.delete(row.id);
  }
}

/** מזהי המוצרים המשויכים לחומר גלם שמסומן כמנה (תומך גם בשדה הישן היחיד) */
export function getMaterialPortionProductIds(mat) {
  const raw = Array.isArray(mat?.portionProductIds) && mat.portionProductIds.length
    ? mat.portionProductIds
    : (mat?.portionProductId ? [mat.portionProductId] : []);
  return [...new Set(raw.map(sanitizeProductId).filter(Boolean))];
}

/** סימון חומר גלם כמנה + שיוך למוצר אחד או יותר (לתזרים) + משקל מנה בק"ג */
export async function setRawMaterialAsPortion(materialId, {
  enabled = false,
  productId = null,
  productIds = null,
  weightKg = null,
} = {}) {
  const mid = sanitizeProductId(materialId);
  if (!mid) throw new ValidationError('חומר גלם לא תקין');
  const mat = await db.rawMaterials.get(mid);
  if (!mat) throw new ValidationError('חומר גלם לא נמצא');

  if (!enabled) {
    await db.rawMaterials.update(mid, {
      isPortion: false,
      portionProductId: null,
      portionProductIds: [],
      portionWeightKg: null,
    });
    await clearRawMaterialPortionPresets(mid);
    return;
  }

  const rawIds = Array.isArray(productIds) && productIds.length ? productIds : [productId];
  const pids = [...new Set(rawIds.map(sanitizeProductId).filter(Boolean))];
  if (!pids.length) throw new ValidationError('בחר לפחות מוצר אחד לשיוך המנה');
  for (const pid of pids) {
    const product = await db.products.get(pid);
    if (!product) throw new ValidationError('מוצר לא נמצא');
  }

  const w = sanitizePortionSize(weightKg);
  if (w == null) throw new ValidationError('הגדר משקל מנה (ק"ג)');

  await db.rawMaterials.update(mid, {
    isPortion: true,
    portionProductId: pids[0],
    portionProductIds: pids,
    portionWeightKg: w,
  });
  await syncRawMaterialPortionPreset(mid);
}

/** סנכרון מנה מתזרים מחומר גלם שמסומן כמנה — מנה לכל קבוצת קטגוריה של המוצרים */
export async function syncRawMaterialPortionPreset(materialId) {
  const mid = sanitizeProductId(materialId);
  if (!mid) return;
  const mat = await db.rawMaterials.get(mid);
  if (!mat?.isPortion) {
    await clearRawMaterialPortionPresets(mid);
    return;
  }

  const pids = getMaterialPortionProductIds(mat);
  const w = sanitizePortionSize(mat.portionWeightKg);
  if (!pids.length || w == null) {
    await clearRawMaterialPortionPresets(mid);
    return;
  }

  const productsByGroup = new Map();
  for (const pid of pids) {
    const product = await db.products.get(pid);
    if (!product) continue;
    let categoryGroupId = PORTION_CATALOG_ONLY_GROUP_ID;
    if (product.categoryId) {
      const cat = await db.categories.get(product.categoryId);
      if (cat?.groupId) categoryGroupId = Number(cat.groupId);
    }
    if (!productsByGroup.has(categoryGroupId)) productsByGroup.set(categoryGroupId, []);
    productsByGroup.get(categoryGroupId).push(pid);
  }
  if (!productsByGroup.size) {
    await clearRawMaterialPortionPresets(mid);
    return;
  }

  const presetData = {
    name: mat.name,
    weight: w,
    extra: 'חומר גלם · מנה',
    sourceRawMaterialId: mid,
    sourceRecipeId: null,
  };

  const existing = await db.groupPortionPresets
    .where('sourceRawMaterialId')
    .equals(mid)
    .toArray();

  for (const row of existing) {
    if (!productsByGroup.has(Number(row.categoryGroupId))) {
      await deletePortionPresetIngredientSettings(row.id);
      if (db.portionPresetLinks) {
        await db.portionPresetLinks.where('portionPresetId').equals(row.id).delete();
      }
      await db.groupPortionPresets.delete(row.id);
    }
  }

  const fresh = await db.groupPortionPresets
    .where('sourceRawMaterialId')
    .equals(mid)
    .toArray();

  for (const [categoryGroupId, groupPids] of productsByGroup.entries()) {
    let presetId = fresh.find((p) => Number(p.categoryGroupId) === Number(categoryGroupId))?.id;

    if (presetId) {
      await db.groupPortionPresets.update(presetId, presetData);
    } else {
      const groupPresets = await db.groupPortionPresets
        .where('categoryGroupId')
        .equals(categoryGroupId)
        .toArray();
      const maxOrder = groupPresets.reduce((m, p) => Math.max(m, p.sortOrder ?? 0), 0);
      const catalogMax = (await db.groupPortionPresets.toArray())
        .reduce((m, p) => Math.max(m, p.catalogSortOrder ?? 0), 0);
      presetId = await db.groupPortionPresets.add({
        categoryGroupId,
        ...presetData,
        sortOrder: maxOrder + 1,
        catalogSortOrder: catalogMax + 1,
      });
    }

    if (db.portionPresetLinks) {
      await db.portionPresetLinks.where('portionPresetId').equals(presetId).delete();
      let order = 1;
      for (const pid of groupPids) {
        await db.portionPresetLinks.add({
          portionPresetId: presetId,
          linkType: 'product',
          targetId: pid,
          sortOrder: order,
        });
        order += 1;
      }
    }
  }
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

/** חיפוש חומר גלם לפי שם, מילים נרדפות, ברקוד, מק״ט או שם ספק */
export function materialMatchesSearch(material, query, { supplierName = '' } = {}) {
  const q = String(query || '').trim().toLocaleLowerCase('he');
  if (!q) return true;
  const name = String(material?.name || '').toLocaleLowerCase('he');
  if (name.includes(q)) return true;
  const code = String(material?.barcode || '').toLocaleLowerCase('he');
  if (code && code.includes(q)) return true;
  const sku = String(material?.sku || '').toLocaleLowerCase('he');
  if (sku && sku.includes(q)) return true;
  const notes = String(material?.notes || '').toLocaleLowerCase('he');
  if (notes && notes.includes(q)) return true;
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
  if (cid) rows = rows.filter((m) => sameNumericId(m.supplierCategoryId, cid));

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

function stripHebrewNiqqud(s) {
  return s.replace(/[\u0591-\u05C7]/g, '');
}

/** נרמול «רך» להשוואת דמיון שמות — חזק יותר מ-normalizeMaterialKey: מסיר ניקוד, גרשיים/מקף עברי, רווחים כפולים */
function looseNameKey(name) {
  let s = stripHebrewNiqqud(String(name || ''));
  s = s.replace(/[׳״"'‘’“”]/g, '');
  s = s.replace(/[־\-_]/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  return s.toLocaleLowerCase('he');
}

function nameTokens(looseKey) {
  return looseKey.split(' ').filter(Boolean);
}

/** מרחק Levenshtein — נקרא רק על מחרוזות קצרות שכבר עברו סינון bucket, אז ה-O(n*m) זניח */
function levenshteinDistance(a, b) {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  const dp = new Array(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = tmp;
    }
  }
  return dp[n];
}

/** האם שני שמות (אחרי נרמול רך) דומים מספיק כדי להציע קיבוץ — לא זהים (זה טיפול «כפילויות») */
function looseNamesAreSimilar(a, b) {
  if (!a || !b || a === b) return false;
  const minLen = Math.min(a.length, b.length);
  if (minLen < 2) return false; // מגבלת רעש: שם קצר מדי בלי containment ברור
  if (a.includes(b) || b.includes(a)) return true;

  const aTokens = new Set(nameTokens(a));
  const bTokens = new Set(nameTokens(b));
  if (aTokens.size && bTokens.size) {
    const overlap = [...aTokens].filter((t) => t.length >= 2 && bTokens.has(t));
    const union = new Set([...aTokens, ...bTokens]);
    if (overlap.length && overlap.length / union.size >= 0.5) return true;
  }

  if (Math.max(a.length, b.length) <= 14) {
    const ratio = 1 - levenshteinDistance(a, b) / Math.max(a.length, b.length);
    if (ratio >= 0.72) return true;
  }
  return false;
}

/**
 * מקבץ חומרי גלם לפי דמיון שמות (לא רק זהות מדויקת) — להצעה בלבד, בלי איחוד אוטומטי.
 * יעיל על כמויות גדולות: משווה רק בתוך "דליים" (אותה מילה ראשונה / אותה אות ראשונה)
 * במקום O(n²) על כל הזוגות. אות ראשונה (לא 2) כי טעויות/חסרות אות תנועה מוקדמת
 * (למשל «סכר» מול «סוכר») כבר משנות את התו השני.
 */
export async function getSimilarMaterialNameGroups({ minGroupSize = 2 } = {}) {
  const all = await db.rawMaterials.toArray();
  const byKey = new Map(); // normalizeMaterialKey → materials[] (שם זהה — לא חלק מהתכונה הזו)
  for (const m of all) {
    const key = normalizeMaterialKey(m.name);
    if (!key) continue;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(m);
  }

  const entries = [...byKey.entries()].map(([key, materials]) => ({
    key,
    loose: looseNameKey(materials[0].name),
    materials,
  })).filter((e) => e.loose);

  // דליים: מילה ראשונה + אות ראשונה — מגבילים השוואות לזוגות שסביר שדומים
  const byFirstToken = new Map();
  const byPrefix = new Map();
  for (const e of entries) {
    const tokens = nameTokens(e.loose);
    const firstToken = tokens[0] || '';
    if (firstToken) {
      if (!byFirstToken.has(firstToken)) byFirstToken.set(firstToken, []);
      byFirstToken.get(firstToken).push(e);
    }
    const prefix = e.loose.slice(0, 1);
    if (prefix) {
      if (!byPrefix.has(prefix)) byPrefix.set(prefix, []);
      byPrefix.get(prefix).push(e);
    }
  }

  const parent = new Map(entries.map((e) => [e.key, e.key]));
  function find(k) {
    while (parent.get(k) !== k) {
      parent.set(k, parent.get(parent.get(k)));
      k = parent.get(k);
    }
    return k;
  }
  function union(a, b) {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  }

  for (const e of entries) {
    const tokens = nameTokens(e.loose);
    const candidates = new Set([
      ...(byFirstToken.get(tokens[0] || '') || []),
      ...(byPrefix.get(e.loose.slice(0, 1)) || []),
    ]);
    for (const other of candidates) {
      if (other.key === e.key) continue;
      if (looseNamesAreSimilar(e.loose, other.loose)) union(e.key, other.key);
    }
  }

  const clusters = new Map();
  for (const e of entries) {
    const root = find(e.key);
    if (!clusters.has(root)) clusters.set(root, []);
    clusters.get(root).push(e);
  }

  const groups = [];
  for (const members of clusters.values()) {
    if (members.length < minGroupSize) continue;
    const materials = members.flatMap((e) => e.materials).sort((a, b) => a.id - b.id);
    const names = [...new Set(members.map((e) => e.materials[0].name))];
    const suggestedTargetId = [...members]
      .sort((a, b) => (
        b.materials.length - a.materials.length
        || b.materials[0].name.length - a.materials[0].name.length
        || a.materials[0].id - b.materials[0].id
      ))[0].materials[0].id;
    groups.push({
      id: members.map((e) => e.key).sort().join('|'),
      names,
      materials,
      suggestedTargetId,
    });
  }
  groups.sort((a, b) => a.names[0].localeCompare(b.names[0], 'he'));
  return groups;
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

/** ממלא שדות חסרים ביעד מתוך רשומות מאוחדות — לא דורס ערכים קיימים ביעד */
export function materialFieldFillPatch(keep, others, { preserveCrossSupplierOffers = false } = {}) {
  const patch = {};
  const keepSup = Number(keep.supplierId) || 0;
  // כששומרים הצעות ספק נפרדות — ממלאים מחיר/אריזה/ספק רק מאותו ספק של היעד
  const sameSupplierOthers = (others || []).filter((o) => (Number(o.supplierId) || 0) === keepSup);
  const fillOthers = preserveCrossSupplierOffers ? sameSupplierOthers : (others || []);
  const fieldSources = fillOthers;

  if (!keep.packageWeightGrams) {
    const from = fieldSources.find((o) => o.packageWeightGrams);
    if (from) patch.packageWeightGrams = from.packageWeightGrams;
  }
  if (sanitizeProcessedPricePerKg(keep.processedPricePerKg) == null) {
    const from = fieldSources.find((o) => sanitizeProcessedPricePerKg(o.processedPricePerKg) != null);
    if (from) patch.processedPricePerKg = from.processedPricePerKg;
  }
  // אל תעתיק ספק מהצעה אחרת כששומרים הצעות ספקים נפרדות
  if (!keep.supplierId && !preserveCrossSupplierOffers) {
    const from = fillOthers.find((o) => o.supplierId);
    if (from) patch.supplierId = from.supplierId;
  }
  if (!String(keep.unit || '').trim()) {
    const from = fieldSources.find((o) => String(o.unit || '').trim());
    if (from) patch.unit = from.unit;
  }
  if (!keep.supplierCategoryId) {
    const from = (others || []).find((o) => o.supplierCategoryId) || fieldSources.find((o) => o.supplierCategoryId);
    if (from) patch.supplierCategoryId = from.supplierCategoryId;
  }
  if (!sanitizeBarcode(keep.barcode)) {
    const from = fieldSources.find((o) => sanitizeBarcode(o.barcode));
    if (from) patch.barcode = sanitizeBarcode(from.barcode);
  }
  if (!sanitizeSku(keep.sku)) {
    const from = fieldSources.find((o) => sanitizeSku(o.sku));
    if (from) patch.sku = sanitizeSku(from.sku);
  }
  if (!sanitizeMaterialNotes(keep.notes)) {
    const from = fieldSources.find((o) => sanitizeMaterialNotes(o.notes));
    if (from) patch.notes = sanitizeMaterialNotes(from.notes);
  }
  if (sanitizeMinOrderQty(keep.minOrderQty) == null) {
    const from = fieldSources.find((o) => sanitizeMinOrderQty(o.minOrderQty) != null);
    if (from) patch.minOrderQty = sanitizeMinOrderQty(from.minOrderQty);
  }
  {
    const mergedAllergens = sanitizeProductAllergenIds([
      ...(keep.allergens || []),
      ...(others || []).flatMap((o) => o.allergens || []),
    ]);
    const keepAllergens = sanitizeProductAllergenIds(keep.allergens);
    if (mergedAllergens.length && mergedAllergens.join(',') !== keepAllergens.join(',')) {
      patch.allergens = mergedAllergens;
    }
  }
  if ((Number(keep.unitPrice) || 0) <= 0) {
    // מחיר חי של יעד — רק מאותו ספק (או ממיזוג מלא), לא מהצעת ספק אחר
    const from = fillOthers.find((o) => (Number(o.unitPrice) || 0) > 0);
    if (from) patch.unitPrice = from.unitPrice;
  }
  if (!keep.packagingKind) {
    const from = fieldSources.find((o) => o.packagingKind);
    if (from) {
      patch.packagingKind = from.packagingKind;
      if (from.packUnitsCount != null) patch.packUnitsCount = from.packUnitsCount;
      if (from.packProductsPerUnit != null) patch.packProductsPerUnit = from.packProductsPerUnit;
      if (from.packLinkedProductId) patch.packLinkedProductId = from.packLinkedProductId;
      if (from.packLinkedCategoryId) patch.packLinkedCategoryId = from.packLinkedCategoryId;
    }
  } else {
    if (keep.packUnitsCount == null) {
      const from = fieldSources.find((o) => o.packUnitsCount != null);
      if (from) patch.packUnitsCount = from.packUnitsCount;
    }
    if (keep.packProductsPerUnit == null) {
      const from = fieldSources.find((o) => o.packProductsPerUnit != null);
      if (from) patch.packProductsPerUnit = from.packProductsPerUnit;
    }
    if (!keep.packLinkedProductId && !keep.packLinkedCategoryId) {
      const from = fieldSources.find((o) => o.packLinkedProductId || o.packLinkedCategoryId);
      if (from?.packLinkedProductId) patch.packLinkedProductId = from.packLinkedProductId;
      else if (from?.packLinkedCategoryId) patch.packLinkedCategoryId = from.packLinkedCategoryId;
    }
  }
  if (!keep.isPortion) {
    const from = fieldSources.find((o) => o.isPortion && getMaterialPortionProductIds(o).length);
    if (from) {
      const fromPids = getMaterialPortionProductIds(from);
      patch.isPortion = true;
      patch.portionProductId = fromPids[0];
      patch.portionProductIds = fromPids;
      if (from.portionWeightKg != null) patch.portionWeightKg = from.portionWeightKg;
    }
  } else if (keep.portionWeightKg == null) {
    const from = fieldSources.find((o) => o.portionWeightKg != null);
    if (from) patch.portionWeightKg = from.portionWeightKg;
  }
  return patch;
}

/**
 * האם רשומה שאינה יעד צריכה להישאר כהצעת ספק נפרדת תחת שם היעד.
 * רק כשיש ספק שונה מהיעד + מחיר — בלי מחיר אין טעם בהצעה נפרדת.
 * אם ליעד אין ספק — לא משאירים הצעות בנפרד בהתחלה (קודם סופגים ליעד כדי לצמצם כפילויות).
 */
export function shouldPreserveMaterialAsSupplierOffer(keep, other) {
  if (!keep || !other || keep.id === other.id) return false;
  const keepSup = Number(keep.supplierId) || 0;
  if (!keepSup) return false;
  const otherSup = Number(other.supplierId) || 0;
  if (!otherSup) return false;
  if ((Number(other.unitPrice) || 0) <= 0) return false;
  if (otherSup === keepSup) return false;
  return true;
}

/**
 * ממיין חומרים לאיחוד: ספיגה ליעד / הצעת ספק אחת לכל ספק אחר / ספיגה להצעה קיימת.
 * אם ליעד אין ספק — סופגים קודם את ההצעה הראשונה עם מחיר (היעד מקבל ספק+מחיר), והשאר לפי הכלל הרגיל.
 */
export function classifyMaterialsForMerge(keep, others = [], { existingOffers = [] } = {}) {
  const absorbIntoKeep = [];
  const preserve = [];
  const absorbIntoOffer = []; // { target, mat }
  if (!keep) return { absorbIntoKeep, preserve, absorbIntoOffer };

  let workingKeep = keep;
  const queue = [...(others || [])];

  // יעד בלי ספק: קודם סופגים הצעה אחת עם מחיר כדי שהיעד יהפוך לרשומה «אמיתית»
  if (!(Number(workingKeep.supplierId) || 0)) {
    const idx = queue.findIndex((m) => (Number(m.supplierId) || 0) > 0 && (Number(m.unitPrice) || 0) > 0);
    if (idx >= 0) {
      const [first] = queue.splice(idx, 1);
      absorbIntoKeep.push(first);
      workingKeep = {
        ...workingKeep,
        supplierId: first.supplierId,
        unitPrice: first.unitPrice || workingKeep.unitPrice,
      };
    }
  }

  const offerBySupplier = new Map();
  const keepSup = Number(workingKeep.supplierId) || 0;
  if (keepSup) offerBySupplier.set(keepSup, workingKeep);
  // הצעות שכבר תחת אותו שם במחסן (ספקים אחרים) — כדי לא ליצור כפילות ספק אחרי איחוד
  for (const offer of existingOffers || []) {
    if (!offer || offer.id === workingKeep.id) continue;
    const sup = Number(offer.supplierId) || 0;
    if (sup && !offerBySupplier.has(sup)) offerBySupplier.set(sup, offer);
  }

  for (const mat of queue) {
    if (!shouldPreserveMaterialAsSupplierOffer(workingKeep, mat)) {
      absorbIntoKeep.push(mat);
      continue;
    }
    const sup = Number(mat.supplierId);
    if (offerBySupplier.has(sup)) {
      const target = offerBySupplier.get(sup);
      if (target.id === workingKeep.id) absorbIntoKeep.push(mat);
      else absorbIntoOffer.push({ target, mat });
    } else {
      offerBySupplier.set(sup, mat);
      preserve.push(mat);
    }
  }

  return { absorbIntoKeep, preserve, absorbIntoOffer, workingKeep };
}

/** איזו רשומה תשמש ברירת מחדל למתכונים אחרי איחוד (מבין היעד + הצעות שנשמרו) */
export function pickMergeRecipeDefaultId(keep, others, { preservedIds = [] } = {}) {
  if (!keep) return null;
  const preserved = new Set((preservedIds || []).map(Number));
  if (keep.isRecipeDefault) return keep.id;
  for (const m of others || []) {
    if (m?.isRecipeDefault && preserved.has(Number(m.id))) return m.id;
  }
  if ((others || []).some((m) => m?.isRecipeDefault)) return keep.id;
  return null;
}

async function retargetMaterialRefs(fromId, toId, { productsCache } = {}) {
  if (!fromId || !toId || fromId === toId) return;
  if (db.products) {
    const products = productsCache || await db.products.toArray();
    for (const p of products) {
      if (Number(p.packagingMaterialId) === fromId) {
        await db.products.update(p.id, { packagingMaterialId: toId });
      }
    }
  }
  if (db.supplierShortages) {
    const shortages = await db.supplierShortages.where('rawMaterialId').equals(fromId).toArray();
    for (const row of shortages) {
      await db.supplierShortages.update(row.id, { rawMaterialId: toId });
    }
  }
  if (db.groupPortionPresets) {
    const presets = await db.groupPortionPresets.where('sourceRawMaterialId').equals(fromId).toArray();
    for (const row of presets) {
      await db.groupPortionPresets.update(row.id, { sourceRawMaterialId: toId });
    }
  }
  if (db.productPortionComponents) {
    const rows = await db.productPortionComponents.where('rawMaterialId').equals(fromId).toArray();
    for (const row of rows) {
      const dup = await db.productPortionComponents
        .where('[productId+rawMaterialId]')
        .equals([row.productId, toId])
        .first();
      if (dup) {
        await db.productPortionComponents.delete(row.id);
      } else {
        await db.productPortionComponents.update(row.id, { rawMaterialId: toId });
      }
    }
  }
  if (db.inventoryBalances) {
    const fromBal = await db.inventoryBalances.where('rawMaterialId').equals(fromId).first();
    if (fromBal) {
      const toBal = await db.inventoryBalances.where('rawMaterialId').equals(toId).first();
      if (toBal) {
        const qty = (Number(toBal.qtyOnHand) || 0) + (Number(fromBal.qtyOnHand) || 0);
        const minQty = toBal.minQty != null ? toBal.minQty : fromBal.minQty;
        await db.inventoryBalances.update(toBal.id, {
          qtyOnHand: qty,
          ...(minQty != null ? { minQty } : {}),
        });
        await db.inventoryBalances.delete(fromBal.id);
      } else {
        await db.inventoryBalances.update(fromBal.id, { rawMaterialId: toId });
      }
    }
  }
  if (db.inventoryMovements) {
    const moves = await db.inventoryMovements.where('rawMaterialId').equals(fromId).toArray();
    for (const row of moves) {
      await db.inventoryMovements.update(row.id, { rawMaterialId: toId });
    }
  }
  if (db.activeLots) {
    const lots = await db.activeLots.where('rawMaterialId').equals(fromId).toArray();
    for (const row of lots) {
      await db.activeLots.update(row.id, { rawMaterialId: toId });
    }
  }
}

/**
 * מעדכן recipeIngredients.name לשם היעד עבור כל השמות הישנים בבת אחת —
 * סריקה אחת של הטבלה (לא סריקה מלאה בנפרד לכל חומר שנספג באיחוד).
 */
async function renameRecipeIngredientsMaterialNames(fromNames, toName, ingredientsCache) {
  const to = sanitizeName(toName, 80);
  if (!to) return;
  const toKey = normalizeMaterialKey(to);
  const fromKeys = new Set(
    (fromNames || [])
      .map((n) => normalizeMaterialKey(n))
      .filter((k) => k && k !== toKey),
  );
  if (!fromKeys.size) return;
  const ings = ingredientsCache || await db.recipeIngredients.toArray();
  for (const ing of ings) {
    if (fromKeys.has(normalizeMaterialKey(ing.name))) {
      await db.recipeIngredients.update(ing.id, { name: to });
    }
  }
}

/** טבלאות שנכתבות בזמן איחוד חומרי גלם — חייבות להיות באותה טרנזקציה */
function materialMergeTxTables() {
  const tables = [db.rawMaterials, db.rawMaterialPriceHistory, db.recipeIngredients];
  if (db.products) tables.push(db.products);
  if (db.supplierShortages) tables.push(db.supplierShortages);
  if (db.groupPortionPresets) tables.push(db.groupPortionPresets);
  if (db.productPortionComponents) tables.push(db.productPortionComponents);
  if (db.inventoryBalances) tables.push(db.inventoryBalances);
  if (db.inventoryMovements) tables.push(db.inventoryMovements);
  if (db.activeLots) tables.push(db.activeLots);
  if (db.syncMeta) tables.push(db.syncMeta);
  return tables;
}

export async function mergeDuplicateMaterials(keepId, mergeIds) {
  const keep = sanitizeProductId(keepId);
  if (!keep) throw new ValidationError('חומר לא תקין');
  const ids = (mergeIds || []).map(sanitizeProductId).filter((id) => id && id !== keep);
  if (!ids.length) return;

  await db.transaction('rw', ...materialMergeTxTables(), async () => {
    const productsCache = db.products ? await db.products.toArray() : null;
    for (const mid of ids) {
      await mergeMaterialIntoKeep(keep, mid, { productsCache });
    }
  });
  await syncRawMaterialLatestPrice(keep);
  await syncRawMaterialsActiveFromRecipes();
}

/**
 * סופג רשומה ליעד: מעביר מרכיבי מתכון (רק החלפת מזהה — בלי מחיקת שורות),
 * היסטוריית מחירים וקישורים, ואז מוחק את הרשומה המאוחדת.
 */
async function mergeMaterialIntoKeep(keep, mid, { productsCache } = {}) {
  if (!keep || !mid || keep === mid) return;
  const fromMat = await db.rawMaterials.get(mid);
  if (!fromMat) return;

  const ings = await db.recipeIngredients.where('rawMaterialId').equals(mid).toArray();
  for (const ing of ings) {
    await db.recipeIngredients.update(ing.id, { rawMaterialId: keep });
  }

  const price = Number(fromMat.unitPrice) || 0;
  if (price > 0) {
    const date = todayISO();
    if (!(await priceHistoryEntryExists(keep, date, price))) {
      await db.rawMaterialPriceHistory.add({
        rawMaterialId: keep,
        price: sanitizeMoney(price),
        effectiveDate: date,
        createdAt: new Date().toISOString(),
      });
    }
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

  await retargetMaterialRefs(mid, keep, { productsCache });
  await db.rawMaterials.delete(mid);
  // Tombstone immediately so a live-sync pull can't resurrect the absorbed row
  // before pushDelete runs.
  try {
    await markMetaDeleted('rawMaterials', mid, new Date().toISOString());
  } catch { /* syncMeta optional in older DBs */ }
}

/**
 * ספקים שונים לאותו מוצר — משאירים הצעה נפרדת תחת שם היעד עם המחיר, כמות אריזה ושאר פרטי הספק.
 */
async function alignCrossSupplierMaterialOffer(keepMat, fromMat, { clearRecipeDefault = true } = {}) {
  if (!keepMat || !fromMat || keepMat.id === fromMat.id) return;
  const keepName = keepMat.name;
  const fromName = fromMat.name;
  const patch = {};
  if (normalizeMaterialKey(fromName) !== normalizeMaterialKey(keepName)) {
    patch.name = keepName;
  }
  if (clearRecipeDefault && fromMat.isRecipeDefault) {
    patch.isRecipeDefault = false;
  }
  // אותה קטגוריה כמו היעד — כדי שלא יופיע כרטיס נפרד במחסן לפי קטגוריה
  if (keepMat.supplierCategoryId
    && Number(fromMat.supplierCategoryId) !== Number(keepMat.supplierCategoryId)) {
    patch.supplierCategoryId = keepMat.supplierCategoryId;
  }
  if (Object.keys(patch).length) {
    await db.rawMaterials.update(fromMat.id, patch);
  }
  // recipeIngredients.name מעודכן בבת אחת ב-mergeSelectedRawMaterials (לא כאן — נמנע מסריקה חוזרת).
}

/**
 * איחוד ידני של חומרי גלם נבחרים (גם עם שמות שונים).
 * - שם היעד נשאר; שמות שאינם יעד → מילים נרדפות.
 * - ספק אחר עם מחיר → הצעה אחת תחת שם היעד (מחיר, כמות אריזה וכו').
 * - בלי מחיר / אותו ספק / כפילות לאותו ספק → נספג (בלי לשנות מבנה מתכון).
 * - ברירת מחדל למתכונים נשמרת על ההצעה המתאימה.
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

  const keepNameKey = normalizeMaterialKey(keepMat.name);
  const otherIds = new Set(others.map((m) => m.id));
  const existingOffers = (await db.rawMaterials.toArray()).filter((m) => (
    m.id !== keep
    && !otherIds.has(m.id)
    && normalizeMaterialKey(m.name) === keepNameKey
  ));

  const {
    absorbIntoKeep,
    preserve,
    absorbIntoOffer,
  } = classifyMaterialsForMerge(keepMat, others, { existingOffers });

  const synonyms = buildMergedMaterialSynonyms(keepMat, others);
  const fillPatch = materialFieldFillPatch(keepMat, absorbIntoKeep, {
    preserveCrossSupplierOffers: false,
  });
  delete fillPatch.isRecipeDefault;
  const preferredUnitPrice = fillPatch.unitPrice != null
    ? fillPatch.unitPrice
    : ((Number(keepMat.unitPrice) || 0) > 0 ? keepMat.unitPrice : null);

  const preservedOfferIds = [];
  const defaultId = pickMergeRecipeDefaultId(keepMat, others, {
    preservedIds: preserve.map((m) => m.id),
  });

  await db.transaction('rw', ...materialMergeTxTables(), async () => {
    // סריקה אחת של recipeIngredients לכל שמות היעד שהשתנו (במקום אחת לכל חומר נספג)
    const namesToRename = [
      ...absorbIntoKeep.map((mat) => mat.name),
      ...absorbIntoOffer.map(({ mat }) => mat.name),
      ...preserve.map((mat) => mat.name),
    ];
    const ingredientsCache = await db.recipeIngredients.toArray();
    await renameRecipeIngredientsMaterialNames(namesToRename, keepMat.name, ingredientsCache);
    const productsCache = db.products ? await db.products.toArray() : null;

    for (const mat of absorbIntoKeep) {
      await mergeMaterialIntoKeep(keep, mat.id, { productsCache });
    }
    for (const mat of preserve) {
      const keepDefaultOnOffer = defaultId === mat.id;
      await alignCrossSupplierMaterialOffer(keepMat, mat, {
        clearRecipeDefault: !keepDefaultOnOffer,
      });
      preservedOfferIds.push(mat.id);
    }
    for (const { target, mat } of absorbIntoOffer) {
      await mergeMaterialIntoKeep(target.id, mat.id, { productsCache });
    }

    const patch = { ...fillPatch, synonyms };
    if (Object.keys(patch).length) {
      await db.rawMaterials.update(keep, patch);
    }
  });

  if (defaultId) {
    const stillThere = await db.rawMaterials.get(defaultId);
    await setRawMaterialRecipeDefault(stillThere ? defaultId : keep, true);
  }
  await syncRawMaterialLatestPrice(keep);
  if (preferredUnitPrice != null) {
    await db.rawMaterials.update(keep, { unitPrice: preferredUnitPrice });
  }
  for (const oid of preservedOfferIds) {
    await syncRawMaterialLatestPrice(oid);
  }
  if (fillPatch.isPortion) {
    await syncRawMaterialPortionPreset(keep);
  }
  await syncRawMaterialsActiveFromRecipes();
  await syncRecipesAffectedByMaterial(keep);
  for (const oid of preservedOfferIds) {
    await syncRecipesAffectedByMaterial(oid);
  }
  return { keepId: keep, preservedOfferIds };
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

  const primaryMat = keepMats.find((m) => m.id === primary) || keepMats[0];
  const absorbMats = [];
  for (const mid of ids) {
    const mat = await db.rawMaterials.get(mid);
    if (mat) absorbMats.push(mat);
  }
  const synonymsByKeep = new Map();
  if (primaryMat && absorbMats.length) {
    synonymsByKeep.set(primary, buildMergedMaterialSynonyms(primaryMat, absorbMats));
  }

  const touched = new Set();
  await db.transaction('rw', ...materialMergeTxTables(), async () => {
    const targetName = primaryMat?.name;
    if (targetName) {
      const ingredientsCache = await db.recipeIngredients.toArray();
      await renameRecipeIngredientsMaterialNames(
        absorbMats.map((mat) => mat.name),
        targetName,
        ingredientsCache,
      );
    }
    const productsCache = db.products ? await db.products.toArray() : null;
    for (const mat of absorbMats) {
      let target = mat.supplierId ? keepBySupplier.get(mat.supplierId) : null;
      if (!target || !keeps.includes(target)) target = primary;
      await mergeMaterialIntoKeep(target, mat.id, { productsCache });
      touched.add(target);
    }
    for (const [kid, syns] of synonymsByKeep) {
      if (syns?.length) await db.rawMaterials.update(kid, { synonyms: syns });
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
  let rows = [];
  try {
    rows = await db.rawMaterialPriceHistory.where('rawMaterialId').equals(mid).toArray();
  } catch {
    rows = [];
  }
  if (!rows.length) {
    const all = await db.rawMaterialPriceHistory.toArray();
    rows = all.filter((r) => sameNumericId(r.rawMaterialId, mid));
  }
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
  const mats = await db.rawMaterials.toArray();
  return mats.find((m) => sameNumericId(m.supplierId, sid) && normalizeMaterialKey(m.name) === key) || null;
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
  const catIds = new Set(categories.map((c) => Number(c.id)));
  const matsBySupplier = new Map();
  const unassignedByCat = new Map();
  for (const m of materials) {
    const sid = Number(m.supplierId);
    if (sid) {
      if (!matsBySupplier.has(sid)) matsBySupplier.set(sid, []);
      matsBySupplier.get(sid).push(m);
      continue;
    }
    const cid = Number(m.supplierCategoryId) || 0;
    if (!unassignedByCat.has(cid)) unassignedByCat.set(cid, []);
    unassignedByCat.get(cid).push(m);
  }
  const sortMats = (list) => {
    list.sort((a, b) => {
      const aActive = a.active === true;
      const bActive = b.active === true;
      if (aActive !== bActive) return aActive ? -1 : 1;
      return (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id;
    });
  };
  for (const list of matsBySupplier.values()) sortMats(list);
  for (const list of unassignedByCat.values()) sortMats(list);
  const attach = (s) => ({
    ...s,
    materials: matsBySupplier.get(Number(s.id)) || [],
  });
  // Number() — מונע חוסר התאמה string/number אחרי סנכרון
  const grouped = categories.map((cat) => {
    const suppliersForCat = suppliers
      .filter((s) => Number(s.categoryId) === Number(cat.id))
      .map(attach);
    const orphansMats = unassignedByCat.get(Number(cat.id)) || [];
    if (orphansMats.length) {
      suppliersForCat.push({
        id: `none-${cat.id}`,
        name: 'ללא ספק',
        isUnassigned: true,
        materials: orphansMats,
      });
    }
    return { ...cat, suppliers: suppliersForCat };
  });
  // ספקים שקטגוריה שלהם נמחקה/לא קיימת — אחרת נעלמים מטאב «ספקים»
  const orphans = suppliers
    .filter((s) => {
      const cid = Number(s.categoryId);
      return !cid || !catIds.has(cid);
    })
    .map(attach);
  const leftoverUnassigned = [];
  for (const [cid, list] of unassignedByCat) {
    if (!cid || !catIds.has(cid)) leftoverUnassigned.push(...list);
  }
  if (leftoverUnassigned.length) {
    orphans.push({
      id: 'none-orphan',
      name: 'ללא ספק',
      isUnassigned: true,
      materials: leftoverUnassigned,
    });
  }
  if (orphans.length) {
    grouped.push({
      id: 'orphan',
      name: 'ללא קטגוריה',
      isPackaging: false,
      isCleaning: false,
      suppliers: orphans,
    });
  }
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

/* ── תחזית רכש שבועית (תוכנית ייצור לחישוב הזמנת חומרי גלם) ── */

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
    // recipe.ingredients quantities are per recipe BATCH, not per product unit —
    // plannedPortions is a count of product units. Scaling by plannedPortions directly
    // (old code) overstated every ingredient by a factor of "units per batch"
    // (e.g. a batch yielding 20 cakes made the order text ask for 20× too much flour).
    // recipeScaleRatioForProductCount converts unit-count → batch ratio, same as the
    // production-record inventory deduction (js/screens/record.js) already does.
    const ratio = recipeScaleRatioForProductCount(recipe, recipe.ingredients, item.plannedPortions);
    if (ratio == null) continue; // אין משקל יחידת חלוקה במתכון — לא ניתן לחשב יחס הקפצה

    for (const ing of recipe.ingredients) {
      const key = ing.rawMaterialId || `name:${ing.name}`;
      const qty = roundQty(Number(ing.quantity) * ratio);
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
    productRecipeComponents, productPortionComponents,
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
    db.productPortionComponents?.toArray?.() ?? Promise.resolve([]),
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
    productPortionComponents,
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
    'productRecipeComponents', 'productPortionComponents',
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
