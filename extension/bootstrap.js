// Run before Canvas paints. A timeout always restores Canvas if the app cannot mount.
(() => {
  if (location.pathname.startsWith('/login') || document.documentElement.classList.contains('canvasdoc-booting')) return;
  const mainView = location.pathname === '/' || /^\/courses\/\d+\/assignments\/\d+/.test(location.pathname);
  document.documentElement.toggleAttribute('data-canvasdoc-boot-sidebar', mainView && innerWidth > 1100);
  document.documentElement.classList.add('canvasdoc-booting');
  performance.mark('canvasdoc:boot');
  const clear = () => { document.documentElement.classList.remove('canvasdoc-booting'); document.documentElement.removeAttribute('data-canvasdoc-boot-sidebar'); };
  setTimeout(clear, 4000);
  window.addEventListener('canvasdoc:ready', clear, { once: true });
})();
