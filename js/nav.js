// Site header: the account button ("Log in", or the signed-in player's rank badge + nickname), every page.
(() => {
  const links = document.querySelectorAll('[data-account-link]');
  if (!links.length) return;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const icon = links[0].querySelector('svg') ? links[0].querySelector('svg').outerHTML : '';
  async function update() {
    let me = { signedIn: false };
    try {
      const r = await fetch('/api/v1/web/whoami', { cache: 'no-store', credentials: 'same-origin' });
      const j = await r.json();
      if (j.ok) me = j;
    } catch { /* offline: stays "Log in" */ }
    links.forEach((a) => {
      if (me.signedIn) {
        const lv = Math.min(200, Math.max(1, Number(me.level) || 1));
        a.innerHTML = `<img class="acc-badge" src="/img/ranks/rank_${String(lv).padStart(2, '0')}.svg" alt=""><span class="acc-label">${esc(me.nickname)}</span>`;
        a.title = 'Your account';
        a.classList.add('signed-in');
      } else {
        a.innerHTML = `${icon}<span class="acc-label">Log in</span>`;
        a.title = 'Log in with your game account';
        a.classList.remove('signed-in');
      }
    });
  }
  document.addEventListener('bl-account', update);
  update();
})();
