let onClose = null;
let activeModalClass = null;

export function openModal({ title, bodyHTML, footerHTML, onCloseCallback, modalClass }) {
  const modalEl = document.querySelector('#modal-overlay .modal');
  if (activeModalClass && modalEl) modalEl.classList.remove(activeModalClass);
  activeModalClass = modalClass || null;
  if (activeModalClass && modalEl) modalEl.classList.add(activeModalClass);

  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML = bodyHTML;
  document.getElementById('modal-footer').innerHTML = footerHTML || '';
  document.getElementById('modal-overlay').classList.remove('hidden');
  document.getElementById('modal-overlay').setAttribute('aria-hidden', 'false');
  onClose = onCloseCallback || null;
}

export function closeModal() {
  const modalEl = document.querySelector('#modal-overlay .modal');
  if (activeModalClass && modalEl) modalEl.classList.remove(activeModalClass);
  activeModalClass = null;

  document.getElementById('modal-overlay').classList.add('hidden');
  document.getElementById('modal-overlay').setAttribute('aria-hidden', 'true');
  if (onClose) onClose();
  onClose = null;
}

document.querySelector('.modal-close')?.addEventListener('click', closeModal);
document.getElementById('modal-overlay')?.addEventListener('click', (e) => {
  if (e.target.id === 'modal-overlay') closeModal();
});
