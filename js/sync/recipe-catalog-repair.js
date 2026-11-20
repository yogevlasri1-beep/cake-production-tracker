/**
 * מחזיר קבוצות וקטגוריות מתכונים שנמחקו בטעות,
 * כשהמתכונים החיים עדיין מצביעים עליהן. לא מנפיק UUID חדש.
 */

export const RESTORED_RECIPE_GROUPS = {
  '9d3bb784-1661-4f22-a514-68b78ca1a707': {
    name: 'מפעל',
    sortOrder: 1,
    linkedCategoryGroupId: null,
  },
  '5c3efd60-32ef-47f8-8e0c-76dff602ea6f': {
    name: 'בחושות',
    sortOrder: 4,
    linkedCategoryGroupId: '264f7960-59db-4c33-a104-eafcfabd5777',
  },
  '832dbe68-98bb-440c-bd96-f334496dc724': {
    name: 'שטרודל',
    sortOrder: 2,
    linkedCategoryGroupId: '83a4516b-5ede-4a9c-8232-0ceb437888fa',
  },
  '93c38134-1d98-4397-8e30-5427f6856911': {
    name: 'רונדו ליין',
    sortOrder: 3,
    linkedCategoryGroupId: 'ebd40187-297c-4d50-a44d-30ac747f6b1d',
  },
  'e43901a2-89a8-439e-b04c-d58e79ed2f50': {
    name: 'ייבוא Word',
    sortOrder: 5,
    linkedCategoryGroupId: null,
  },
};

/** רק מה שהמשתמש הגדיר — בלי ברירות מחדל של האפליקציה. */
export const USER_RECIPE_GROUP_NAMES = new Set(['מפעל', 'שטרודל', 'רונדו ליין', 'בחושות', 'ייבוא Word']);
export const USER_RECIPE_CATEGORY_NAMES = new Set(['בצק', 'מילית', 'תוספות', 'תוספת לשטרודל', 'ראשי', 'ללא סיווג']);

export const RESTORED_RECIPE_CATEGORIES = {
  '35b6399a-d7e9-4b1b-927d-1723c558e271': {
    name: 'בצק',
    groupId: '9d3bb784-1661-4f22-a514-68b78ca1a707',
    sortOrder: 1,
  },
  '6fd155e3-b8f6-4bc3-b2eb-5ec1d227c406': {
    name: 'מילית',
    groupId: '9d3bb784-1661-4f22-a514-68b78ca1a707',
    sortOrder: 2,
  },
  'd5d50198-5a6b-4236-bdef-6e52b57c1b75': {
    name: 'תוספת לשטרודל',
    groupId: '9d3bb784-1661-4f22-a514-68b78ca1a707',
    sortOrder: 4,
  },
  'c2736dac-f41e-4bd9-b5eb-fc55e8069353': {
    name: 'תוספות',
    groupId: '9d3bb784-1661-4f22-a514-68b78ca1a707',
    sortOrder: 5,
  },
  '61083dba-a181-4125-bd99-85ad5830f496': {
    name: 'ראשי',
    groupId: '5c3efd60-32ef-47f8-8e0c-76dff602ea6f',
    sortOrder: 1,
  },
  'e499d3db-bca6-4f92-a281-c6467e3ab856': {
    name: 'ללא סיווג',
    groupId: 'e43901a2-89a8-439e-b04c-d58e79ed2f50',
    sortOrder: 1,
  },
};

/** כפילויות מזהה — משאירים את הקטגוריה הראשית, לא פותחים שנייה. */
export const RECIPE_CATEGORY_TWINS = {
  '784c148c-78ff-4d35-aeb6-ad1130b58dda': '35b6399a-d7e9-4b1b-927d-1723c558e271',
  '344e0613-f17c-4730-acfc-9f8adee68626': '6fd155e3-b8f6-4bc3-b2eb-5ec1d227c406',
};

function rowName(row) {
  return String(row?.payload?.name || row?.name || '').trim();
}

function recipeCategoryId(row) {
  return row?.payload?.categoryId || row?.categoryId || null;
}

export const DEFAULT_RECIPE_SORT_GROUP_NAME = 'סידור';
export const EMPTY_DEFAULT_RECIPE_TYPE_NAMES = new Set(['קרם', 'רטבים', 'אחר']);

/** שיוך לפי הגיבוי החי — לא ממציאים שמות חדשים. */
export const RECIPE_CATEGORY_NAME_BY_RECIPE = {
  'בורקיטס': 'בצק',
  'בצק בייגל אמריקאי': 'בצק',
  'בצק עלים': 'בצק',
  'בצק פריך': 'בצק',
  'בצק פרסבורגר': 'בצק',
  'בצק שטרודל': 'בצק',
  'בצק שמרים מאפים': 'בצק',
  'בצק שמרים קראנץ': 'בצק',
  'גבינה מלוח': 'מילית',
  'גלייז שוקולד': 'תוספות',
  'לקח לבן': 'תוספת לשטרודל',
  'לקח לבן ללא סוכר': 'תוספת לשטרודל',
  'לקח קקאו ללא סוכר(שחור)': 'תוספת לשטרודל',
  'לקח קקאו(שחור)': 'תוספת לשטרודל',
  'מאפינס וניל': 'ראשי',
  'מאפינס שוקולד': 'ראשי',
  'מאפינס תפוז': 'ראשי',
  'מי סוכר': 'תוספות',
  'מילוי גבינה מתוק לקראנץ': 'מילית',
  'מילוי גבינה מתוק- ללא סוכר': 'מילית',
  'מילוי גבינה מתוק- עם סוכר': 'מילית',
  'מילוי פירורים- עם סוכר': 'תוספת לשטרודל',
  'מילוי פרג ללא סוכר': 'מילית',
  'מילוי פרג- עם סוכר': 'מילית',
  'מילוי פרג- עם סוכר לפרסבורגר/קראנץ': 'מילית',
  'מילוי תפוחים- ללא סוכר': 'מילית',
  'מילוי תפוחים- עם סוכר': 'מילית',
  'מילית תפו': 'מילית',
  'עוגת דבש': 'ראשי',
  'פלטה סולת': 'ראשי',
  'פלטת גזר': 'ראשי',
  'רוגלך פלטת שוקולד': 'תוספות',
  'שטרוייזל': 'תוספות',
  'שטרוייזל קקאו': 'תוספות',
  'תערובת שמנים- עם סוכר': 'תוספת לשטרודל',
};

export function recipeNameKey(name) {
  return String(name || '').trim().replace(/:+\s*$/g, '').replace(/\s+/g, ' ');
}

export function inferRecipeCategoryName(recipeNames = []) {
  const blob = (recipeNames || []).join(' ');
  if (/מאפינס|פלטה|פלטת|עוגת דבש/.test(blob) && !/רוגלך/.test(blob)) return 'ראשי';
  if (/לקח|פירורים|תערובת שמנים/.test(blob)) return 'תוספת לשטרודל';
  if (/שטרוייזל|גלייז|מי סוכר|רוגלך/.test(blob)) return 'תוספות';
  if (/מילוי|מילית|גבינה/.test(blob)) return 'מילית';
  if (/בצק|בורקיטס/.test(blob)) return 'בצק';
  return '';
}

export function categoryNameForRecipe(name) {
  const key = recipeNameKey(name);
  return RECIPE_CATEGORY_NAME_BY_RECIPE[key] || inferRecipeCategoryName([key]) || '';
}

export function restoredCategoryIdForName(categoryName) {
  const wanted = String(categoryName || '').trim();
  if (!wanted) return null;
  const hit = Object.entries(RESTORED_RECIPE_CATEGORIES).find(([, row]) => row.name === wanted);
  return hit ? hit[0] : null;
}

export function canonicalRecipeCategoryId(categoryId) {
  const id = String(categoryId || '');
  return RECIPE_CATEGORY_TWINS[id] || id || null;
}

export function planMissingRecipeCategoryRestore({
  cloudCategories = [],
  cloudRecipes = [],
} = {}) {
  const liveIds = new Set(
    (cloudCategories || []).filter((row) => row && !row.deleted_at).map((row) => String(row.id)),
  );
  const deleted = new Map(
    (cloudCategories || []).filter((row) => row?.deleted_at && row.id).map((row) => [String(row.id), row]),
  );
  const buckets = new Map();
  for (const recipe of cloudRecipes || []) {
    if (recipe?.deleted_at) continue;
    const rawId = recipeCategoryId(recipe);
    const catId = canonicalRecipeCategoryId(rawId);
    if (!catId || liveIds.has(String(catId))) continue;
    if (!deleted.has(String(catId)) && !RESTORED_RECIPE_CATEGORIES[String(catId)]) continue;
    if (!buckets.has(String(catId))) {
      buckets.set(String(catId), {
        categoryId: String(catId),
        recipeNames: [],
        cloudCategory: deleted.get(String(catId)) || null,
      });
    }
    const name = rowName(recipe);
    if (name) buckets.get(String(catId)).recipeNames.push(name);
  }
  return [...buckets.values()].map((row) => {
    const known = RESTORED_RECIPE_CATEGORIES[row.categoryId];
    return {
      ...row,
      inferredName: known?.name || inferRecipeCategoryName(row.recipeNames) || rowName(row.cloudCategory) || 'ללא סיווג',
      groupId: known?.groupId || row.cloudCategory?.payload?.groupId || null,
      sortOrder: known?.sortOrder || Number(row.cloudCategory?.payload?.sortOrder) || 1,
    };
  });
}

export function planMissingRecipeGroupRestore({
  cloudGroups = [],
  restoredCategories = [],
} = {}) {
  const liveIds = new Set(
    (cloudGroups || []).filter((row) => row && !row.deleted_at).map((row) => String(row.id)),
  );
  const deleted = new Map(
    (cloudGroups || []).filter((row) => row?.deleted_at && row.id).map((row) => [String(row.id), row]),
  );
  const needed = new Set();
  for (const cat of restoredCategories || []) {
    if (cat?.groupId) needed.add(String(cat.groupId));
  }
  for (const id of Object.keys(RESTORED_RECIPE_GROUPS)) {
    if (!liveIds.has(id) && (deleted.has(id) || needed.has(id))) needed.add(id);
  }
  return [...needed].flatMap((groupId) => {
    if (liveIds.has(groupId)) return [];
    const known = RESTORED_RECIPE_GROUPS[groupId];
    const cloudGroup = deleted.get(groupId) || null;
    const name = known?.name || rowName(cloudGroup);
    if (!name) return [];
    return [{
      groupId,
      inferredName: name,
      sortOrder: known?.sortOrder || Number(cloudGroup?.payload?.sortOrder) || 1,
      linkedCategoryGroupId: known?.linkedCategoryGroupId ?? cloudGroup?.payload?.linkedCategoryGroupId ?? null,
      cloudGroup,
    }];
  });
}

export function planRecipeCategoryTwinRetarget(cloudRecipes = []) {
  return (cloudRecipes || []).flatMap((row) => {
    if (row?.deleted_at || !row?.id) return [];
    const from = String(recipeCategoryId(row) || '');
    const to = RECIPE_CATEGORY_TWINS[from];
    if (!to) return [];
    return [{ recipeId: String(row.id), fromCategoryId: from, toCategoryId: to }];
  });
}

/** שורות שכבר חיות בענן — להחזיר אותן גם במכשיר, בלי UUID חדש. */
export function planEnsureLiveRestoredRecipeCatalog({
  cloudGroups = [],
  cloudCategories = [],
} = {}) {
  const liveGroups = new Map((cloudGroups || []).filter((row) => row && !row.deleted_at && row.id).map((row) => [String(row.id), row]));
  const liveCats = new Map((cloudCategories || []).filter((row) => row && !row.deleted_at && row.id).map((row) => [String(row.id), row]));
  const groups = Object.entries(RESTORED_RECIPE_GROUPS).flatMap(([id, known]) => {
    const row = liveGroups.get(id);
    if (!row) return [];
    return [{
      groupId: id,
      inferredName: rowName(row) || known.name,
      sortOrder: known.sortOrder || Number(row.payload?.sortOrder) || 1,
      linkedCategoryGroupId: known.linkedCategoryGroupId ?? row.payload?.linkedCategoryGroupId ?? null,
    }];
  });
  const cats = Object.entries(RESTORED_RECIPE_CATEGORIES).flatMap(([id, known]) => {
    const row = liveCats.get(id);
    if (!row) return [];
    return [{
      categoryId: id,
      inferredName: rowName(row) || known.name,
      groupId: row.payload?.groupId || known.groupId,
      sortOrder: known.sortOrder || Number(row.payload?.sortOrder) || 1,
    }];
  });
  return { groups, cats };
}

export function planRecipeLocalCategoryRemap(cloudRecipes = []) {
  return (cloudRecipes || []).flatMap((row) => {
    if (row?.deleted_at || !row?.id) return [];
    const catId = canonicalRecipeCategoryId(recipeCategoryId(row));
    if (!catId) return [];
    return [{ recipeId: String(row.id), categoryId: String(catId) }];
  });
}

export function planAssignLocalRecipesToRestoredCategories({
  localRecipes = [],
  cloudRecipes = [],
} = {}) {
  const cloudByName = new Map();
  for (const row of cloudRecipes || []) {
    if (row?.deleted_at) continue;
    const key = recipeNameKey(rowName(row));
    if (!key) continue;
    const catId = canonicalRecipeCategoryId(recipeCategoryId(row));
    if (catId) cloudByName.set(key, String(catId));
  }
  return (localRecipes || []).flatMap((local) => {
    if (local?.parentRecipeId || local?.id == null) return [];
    const key = recipeNameKey(local.name);
    const catId = cloudByName.get(key) || restoredCategoryIdForName(categoryNameForRecipe(key));
    if (!catId) return [];
    return [{ localRecipeId: local.id, categoryId: String(catId), recipeName: key }];
  });
}

export function isUserRecipeGroupName(name) {
  return USER_RECIPE_GROUP_NAMES.has(String(name || '').trim());
}

export function isUserRecipeCategoryName(name) {
  return USER_RECIPE_CATEGORY_NAMES.has(String(name || '').trim());
}

export function pickPreferredRecipeSubCategory(categoryName, groups = [], subCategories = []) {
  const wanted = String(categoryName || '').trim();
  if (!wanted || !isUserRecipeCategoryName(wanted)) return null;
  const matches = (subCategories || []).filter((sub) => (
    sub
    && isUserRecipeCategoryName(sub.name)
    && String(sub.name || '').trim() === wanted
    && !String(sub.id || '').startsWith('__')
  ));
  if (!matches.length) return null;
  const groupById = new Map((groups || []).map((group) => [String(group.id), group]));
  return matches.find((sub) => {
    const group = groupById.get(String(sub.groupId));
    return group && isUserRecipeGroupName(group.name) && !String(group.id || '').startsWith('__');
  }) || matches[0];
}

export function assignOrphanRecipesToCategories(orphans = [], groups = [], subCategories = []) {
  const still = [];
  for (const recipe of orphans || []) {
    const sub = pickPreferredRecipeSubCategory(
      categoryNameForRecipe(recipe?.name),
      groups,
      subCategories,
    );
    if (sub) {
      if (!Array.isArray(sub.recipes)) sub.recipes = [];
      sub.recipes.push(recipe);
    } else {
      still.push(recipe);
    }
  }
  if (!still.length) return [];
  const fallback = pickPreferredRecipeSubCategory('ללא סיווג', groups, subCategories);
  if (!fallback) return still;
  if (!Array.isArray(fallback.recipes)) fallback.recipes = [];
  fallback.recipes.push(...still);
  return [];
}

export function filterRestoredRecipeCatalogLayout(groups = []) {
  return (groups || []).flatMap((group) => {
    if (!group || String(group.id || '').startsWith('__')) return [];
    if (!isUserRecipeGroupName(group.name)) return [];
    const categories = (group.categories || []).filter((cat) => (
      cat && !String(cat.id || '').startsWith('__') && isUserRecipeCategoryName(cat.name)
    ));
    return [{ ...group, categories }];
  });
}

export function planExtraLocalRecipeCatalogRows({
  localGroups = [],
  localCategories = [],
  recipes = [],
} = {}) {
  const used = new Set((recipes || []).map((row) => Number(row.categoryId)).filter((id) => Number.isFinite(id) && id > 0));
  const extraCats = (localCategories || []).filter((cat) => {
    if (!cat?.id) return false;
    if (isUserRecipeCategoryName(cat.name)) return false;
    if (used.has(Number(cat.id))) return false;
    return true;
  });
  const extraCatIds = new Set(extraCats.map((cat) => Number(cat.id)));
  const extraGroups = (localGroups || []).filter((group) => {
    if (!group?.id) return false;
    if (isUserRecipeGroupName(group.name)) return false;
    const keepChildren = (localCategories || []).filter((cat) => (
      Number(cat.groupId) === Number(group.id) && !extraCatIds.has(Number(cat.id))
    ));
    if (keepChildren.some((cat) => used.has(Number(cat.id)) || isUserRecipeCategoryName(cat.name))) return false;
    return true;
  });
  return { extraGroups, extraCats };
}
