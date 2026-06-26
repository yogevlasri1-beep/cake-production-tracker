function refreshOrderNumbers(list) {
  list.querySelectorAll('.product-list-item').forEach((item, i) => {
    const num = item.querySelector('.product-order-num');
    if (!num) return;
    num.textContent = String(i + 1);
    num.setAttribute('aria-label', `מיקום ${i + 1}`);
  });
}

function getOrderedIds(list) {
  return [...list.querySelectorAll('.product-list-item')].map((el) => Number(el.dataset.productId));
}

function moveDraggedItem(list, dragged, clientY, itemSelector = '.product-list-item') {
  const others = [...list.querySelectorAll(itemSelector)].filter((el) => el !== dragged);
  if (!others.length) return;

  let insertBefore = null;
  for (const item of others) {
    const rect = item.getBoundingClientRect();
    const mid = rect.top + rect.height / 2;
    if (clientY < mid) {
      insertBefore = item;
      break;
    }
  }

  if (insertBefore) {
    if (dragged.nextElementSibling !== insertBefore) {
      list.insertBefore(dragged, insertBefore);
    }
    return;
  }

  if (list.lastElementChild !== dragged) {
    list.appendChild(dragged);
  }
}

function bindProductList(list, categoryId, saveOrder) {
  let drag = null;

  const resetUi = () => {
    document.body.classList.remove('product-drag-active');
    list.classList.remove('is-sorting');
    list.querySelectorAll('.product-list-item.is-dragging').forEach((el) => {
      el.classList.remove('is-dragging');
    });
  };

  const clearDocumentListeners = () => {
    document.removeEventListener('pointermove', onDocumentPointerMove);
    document.removeEventListener('pointerup', onDocumentPointerUp);
    document.removeEventListener('pointercancel', onDocumentPointerUp);
  };

  const finishDrag = (shouldSave) => {
    if (!drag) return;

    const { item, handle, pointerId, orderBefore } = drag;
    drag = null;
    clearDocumentListeners();

    item.classList.remove('is-dragging');
    resetUi();
    refreshOrderNumbers(list);

    try {
      if (handle.hasPointerCapture?.(pointerId)) handle.releasePointerCapture(pointerId);
    } catch {
      /* ignore */
    }

    if (!shouldSave) return;

    const newOrder = getOrderedIds(list);
    if (JSON.stringify(orderBefore) === JSON.stringify(newOrder)) return;

    saveOrder(categoryId, newOrder).catch(() => {});
  };

  function onDocumentPointerMove(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    e.preventDefault();
    moveDraggedItem(list, drag.item, e.clientY);
    refreshOrderNumbers(list);
  }

  function onDocumentPointerUp(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    e.preventDefault();
    finishDrag(true);
  }

  list.addEventListener('pointerdown', (e) => {
    const handle = e.target.closest('.product-drag-handle');
    if (!handle || !list.contains(handle)) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;

    const item = handle.closest('.product-list-item');
    if (!item || drag) return;

    e.preventDefault();
    e.stopPropagation();

    try {
      handle.setPointerCapture(e.pointerId);
    } catch {
      return;
    }

    drag = {
      item,
      handle,
      pointerId: e.pointerId,
      orderBefore: getOrderedIds(list),
    };

    item.classList.add('is-dragging');
    list.classList.add('is-sorting');
    document.body.classList.add('product-drag-active');

    document.addEventListener('pointermove', onDocumentPointerMove, { passive: false });
    document.addEventListener('pointerup', onDocumentPointerUp);
    document.addEventListener('pointercancel', onDocumentPointerUp);
  });
}

export function bindProductDragLists(container, saveOrder) {
  container.querySelectorAll('.product-list[data-category-id]').forEach((list) => {
    bindProductList(list, Number(list.dataset.categoryId), saveOrder);
  });
}

function refreshCategoryOrderNumbers(list) {
  list.querySelectorAll('.category-card').forEach((item, i) => {
    const num = item.querySelector('.category-order-num');
    if (!num) return;
    num.textContent = String(i + 1);
    num.setAttribute('aria-label', `מיקום ${i + 1}`);
  });
}

function getCategoryOrderedIds(list) {
  return [...list.querySelectorAll('.category-card')].map((el) => Number(el.dataset.categoryId));
}

function bindCategoryList(list, saveOrder) {
  let drag = null;

  const resetUi = () => {
    document.body.classList.remove('category-drag-active');
    list.classList.remove('is-sorting');
    list.querySelectorAll('.category-card.is-dragging').forEach((el) => {
      el.classList.remove('is-dragging');
    });
  };

  const clearDocumentListeners = () => {
    document.removeEventListener('pointermove', onDocumentPointerMove);
    document.removeEventListener('pointerup', onDocumentPointerUp);
    document.removeEventListener('pointercancel', onDocumentPointerUp);
  };

  const finishDrag = (shouldSave) => {
    if (!drag) return;

    const { item, handle, pointerId, orderBefore } = drag;
    drag = null;
    clearDocumentListeners();

    item.classList.remove('is-dragging');
    resetUi();
    refreshCategoryOrderNumbers(list);

    try {
      if (handle.hasPointerCapture?.(pointerId)) handle.releasePointerCapture(pointerId);
    } catch {
      /* ignore */
    }

    if (!shouldSave) return;

    const newOrder = getCategoryOrderedIds(list);
    if (JSON.stringify(orderBefore) === JSON.stringify(newOrder)) return;

    saveOrder(newOrder).catch(() => {});
  };

  function onDocumentPointerMove(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    e.preventDefault();
    moveDraggedItem(list, drag.item, e.clientY, '.category-card');
    refreshCategoryOrderNumbers(list);
  }

  function onDocumentPointerUp(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    e.preventDefault();
    finishDrag(true);
  }

  list.addEventListener('pointerdown', (e) => {
    const handle = e.target.closest('.category-drag-handle');
    if (!handle || !list.contains(handle)) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;

    const item = handle.closest('.category-card');
    if (!item || drag) return;

    e.preventDefault();
    e.stopPropagation();

    try {
      handle.setPointerCapture(e.pointerId);
    } catch {
      return;
    }

    drag = {
      item,
      handle,
      pointerId: e.pointerId,
      orderBefore: getCategoryOrderedIds(list),
    };

    item.classList.add('is-dragging');
    list.classList.add('is-sorting');
    document.body.classList.add('category-drag-active');

    document.addEventListener('pointermove', onDocumentPointerMove, { passive: false });
    document.addEventListener('pointerup', onDocumentPointerUp);
    document.addEventListener('pointercancel', onDocumentPointerUp);
  });
}

export function bindCategoryDragList(container, saveOrder) {
  container.querySelectorAll('.category-list').forEach((list) => {
    const groupId = list.dataset.groupId || null;
    bindCategoryList(list, (categoryIds) => saveOrder(categoryIds, groupId));
  });
}

function getGroupOrderedIds(list) {
  return [...list.querySelectorAll('.category-group-card')].map((el) => Number(el.dataset.groupId));
}

function bindCategoryGroupList(list, saveOrder) {
  let drag = null;

  const resetUi = () => {
    document.body.classList.remove('category-drag-active');
    list.classList.remove('is-sorting');
    list.querySelectorAll('.category-group-card.is-dragging').forEach((el) => {
      el.classList.remove('is-dragging');
    });
  };

  const clearDocumentListeners = () => {
    document.removeEventListener('pointermove', onDocumentPointerMove);
    document.removeEventListener('pointerup', onDocumentPointerUp);
    document.removeEventListener('pointercancel', onDocumentPointerUp);
  };

  const finishDrag = (shouldSave) => {
    if (!drag) return;
    const { item, handle, pointerId, orderBefore } = drag;
    drag = null;
    clearDocumentListeners();
    item.classList.remove('is-dragging');
    resetUi();
    list.querySelectorAll('.category-group-card').forEach((card, i) => {
      const num = card.querySelector('.category-group-order-num');
      if (num) num.textContent = String(i + 1);
    });
    try {
      if (handle.hasPointerCapture?.(pointerId)) handle.releasePointerCapture(pointerId);
    } catch { /* ignore */ }
    if (!shouldSave) return;
    const newOrder = getGroupOrderedIds(list);
    if (JSON.stringify(orderBefore) === JSON.stringify(newOrder)) return;
    saveOrder(newOrder).catch(() => {});
  };

  function onDocumentPointerMove(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    e.preventDefault();
    moveDraggedItem(list, drag.item, e.clientY, '.category-group-card');
  }

  function onDocumentPointerUp(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    e.preventDefault();
    finishDrag(true);
  }

  list.addEventListener('pointerdown', (e) => {
    const handle = e.target.closest('.category-group-drag-handle');
    if (!handle || !list.contains(handle)) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const item = handle.closest('.category-group-card');
    if (!item || drag) return;
    e.preventDefault();
    e.stopPropagation();
    try {
      handle.setPointerCapture(e.pointerId);
    } catch {
      return;
    }
    drag = {
      item,
      handle,
      pointerId: e.pointerId,
      orderBefore: getGroupOrderedIds(list),
    };
    item.classList.add('is-dragging');
    list.classList.add('is-sorting');
    document.body.classList.add('category-drag-active');
    document.addEventListener('pointermove', onDocumentPointerMove, { passive: false });
    document.addEventListener('pointerup', onDocumentPointerUp);
    document.addEventListener('pointercancel', onDocumentPointerUp);
  });
}

export function bindRecipeDragList(container, categoryId, saveOrder) {
  bindRecipeDragLists(container, (ids, subId) => saveOrder(ids, subId ?? categoryId));
}

export function bindRecipeDragLists(container, saveOrder) {
  container.querySelectorAll('.recipe-list[data-sub-id]').forEach((list) => {
    bindGenericDragList(list, {
      itemSelector: '.recipe-list-item',
      handleSelector: '.recipe-drag-handle',
      idAttr: 'recipeId',
      orderNumSelector: '.recipe-order-num',
      bodyClass: 'recipe-drag-active',
      saveOrder: (ids) => saveOrder(ids, Number(list.dataset.subId)),
    });
  });
}

export function bindSupplierDragList(container, categoryId, saveOrder) {
  const list = container.querySelector('.supplier-list');
  if (!list) return;
  bindGenericDragList(list, {
    itemSelector: '.supplier-list-item',
    handleSelector: '.supplier-drag-handle',
    idAttr: 'supplierId',
    orderNumSelector: '.supplier-order-num',
    bodyClass: 'supplier-drag-active',
    saveOrder: (ids) => saveOrder(ids, categoryId),
  });
}

export function bindMaterialDragList(container, categoryId, saveOrder) {
  const list = container.querySelector('.material-list');
  if (!list) return;
  bindGenericDragList(list, {
    itemSelector: '.material-list-item',
    handleSelector: '.material-drag-handle',
    idAttr: 'materialId',
    orderNumSelector: '.material-order-num',
    bodyClass: 'material-drag-active',
    saveOrder: (ids) => saveOrder(ids, categoryId),
  });
}

function bindGenericDragList(list, {
  itemSelector,
  handleSelector,
  idAttr,
  orderNumSelector,
  bodyClass,
  saveOrder,
}) {
  let drag = null;

  const getOrderedIds = () => [...list.querySelectorAll(itemSelector)].map(
    (el) => Number(el.dataset[idAttr]),
  );

  const refreshOrderNumbers = () => {
    list.querySelectorAll(itemSelector).forEach((item, i) => {
      const num = item.querySelector(orderNumSelector);
      if (!num) return;
      num.textContent = String(i + 1);
      num.setAttribute('aria-label', `מיקום ${i + 1}`);
    });
  };

  const resetUi = () => {
    document.body.classList.remove(bodyClass);
    list.classList.remove('is-sorting');
    list.querySelectorAll(`${itemSelector}.is-dragging`).forEach((el) => {
      el.classList.remove('is-dragging');
    });
  };

  const clearDocumentListeners = () => {
    document.removeEventListener('pointermove', onDocumentPointerMove);
    document.removeEventListener('pointerup', onDocumentPointerUp);
    document.removeEventListener('pointercancel', onDocumentPointerUp);
  };

  const finishDrag = (shouldSave) => {
    if (!drag) return;
    const { item, handle, pointerId, orderBefore } = drag;
    drag = null;
    clearDocumentListeners();
    item.classList.remove('is-dragging');
    resetUi();
    refreshOrderNumbers();
    try {
      if (handle.hasPointerCapture?.(pointerId)) handle.releasePointerCapture(pointerId);
    } catch { /* ignore */ }
    if (!shouldSave) return;
    const newOrder = getOrderedIds();
    if (JSON.stringify(orderBefore) === JSON.stringify(newOrder)) return;
    saveOrder(newOrder).catch(() => {});
  };

  function onDocumentPointerMove(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    e.preventDefault();
    moveDraggedItem(list, drag.item, e.clientY, itemSelector);
    refreshOrderNumbers();
  }

  function onDocumentPointerUp(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    e.preventDefault();
    finishDrag(true);
  }

  list.addEventListener('pointerdown', (e) => {
    const handle = e.target.closest(handleSelector);
    if (!handle || !list.contains(handle)) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const item = handle.closest(itemSelector);
    if (!item || drag) return;
    e.preventDefault();
    e.stopPropagation();
    try {
      handle.setPointerCapture(e.pointerId);
    } catch {
      return;
    }
    drag = {
      item,
      handle,
      pointerId: e.pointerId,
      orderBefore: getOrderedIds(),
    };
    item.classList.add('is-dragging');
    list.classList.add('is-sorting');
    document.body.classList.add(bodyClass);
    document.addEventListener('pointermove', onDocumentPointerMove, { passive: false });
    document.addEventListener('pointerup', onDocumentPointerUp);
    document.addEventListener('pointercancel', onDocumentPointerUp);
  });
}

export function bindCategoryGroupDragList(container, saveOrder) {
  const list = container.querySelector('.category-group-list');
  if (list) bindCategoryGroupList(list, saveOrder);
}
