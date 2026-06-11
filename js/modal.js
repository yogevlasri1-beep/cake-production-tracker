let onClose = null;

export function openModal({ title, bodyHTML, footerHTML, onCloseCallback }) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML = bodyHTML;
  document.getElementById('modal-footer').innerHTML = footerHTML || '';
  document.getElementById('modal-overlay').classList.remove('hidden');
  document.getElementById('modal-overlay').setAttribute('aria-hidden', 'false');
  onClose = onCloseCallback || null;
}

export function closeModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
  document.getElementById('modal-overlay').setAttribute('aria-hidden', 'true');
  if (onClose) onClose();
  onClose = null;
}

document.querySelector('.modal-close')?.addEventListener('click', closeModal);
document.getElementById('modal-overlay')?.addEventListener('click', (e) => {
  if (e.target.id === 'modal-overlay') closeModal();
});
