// Run before Canvas paints. A timeout always restores Canvas if the app cannot mount.
(() => {
  if (location.pathname.startsWith('/login') || document.documentElement.classList.contains('canvasdoc-booting')) return;
  document.documentElement.classList.add('canvasdoc-booting');
  performance.mark('canvasdoc:boot');
  const clear = () => document.documentElement.classList.remove('canvasdoc-booting');
  setTimeout(clear, 4000);
  window.addEventListener('canvasdoc:ready', clear, { once: true });
})();
