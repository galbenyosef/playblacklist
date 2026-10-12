// Landing page: show whether a game build is deployed (and how big the first download is).
(async () => {
  const dot = document.getElementById('build-dot');
  const status = document.getElementById('build-status');
  const play = document.querySelectorAll('[data-play]');
  const mb = (n) => (n / 1048576 >= 100 ? Math.round(n / 1048576) : (n / 1048576).toFixed(1)) + ' MB';
  try {
    const res = await fetch('/api/build', { cache: 'no-store' });
    const b = await res.json();
    if (!b.available) {
      dot.className = 'dot off';
      status.textContent = 'Game build offline - check back soon';
      play.forEach((a) => a.setAttribute('aria-disabled', 'true'));
      return;
    }
    const version = b.productVersion ? 'v' + b.productVersion.replace(/^v/i, '') : 'Latest build';
    const built = new Date(b.builtAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
    dot.className = 'dot ok';
    // before the launch (html.prelaunch, js/launch.js) the build is there but not open yet
    const ready = document.documentElement.classList.contains('prelaunch') ? 'Launch build ready' : 'Ready to play';
    status.textContent = `${ready} · ${version} · updated ${built} · ${mb(b.downloadBytes)} first download`;
    document.getElementById('req-size').textContent =
      `The first load downloads about ${mb(b.downloadBytes)}; after that the game starts from your browser cache.`;
    document.getElementById('footer-version').textContent = `${b.productName || 'Blacklist'} ${version}`;
  } catch {
    dot.className = 'dot off';
    status.textContent = 'Could not reach the game server';
  }
})();

// Landing page: top 10 players and top 5 clans (the leaderboard API); rows open the full leaderboard.
(async () => {
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (n) => Number(n || 0).toLocaleString('en-US');
  const kd = (k, d) => (Number(k || 0) / Math.max(1, Number(d || 0))).toFixed(2);
  const badge = (level) => {
    const lv = Math.min(200, Math.max(1, Number(level) || 1));
    return `<span class="lvl" title="Level ${lv}"><img src="/img/ranks/rank_${String(lv).padStart(2, '0')}.svg" alt="" loading="lazy"><b>${lv}</b></span>`;
  };
  const get = async (path) => {
    const r = await fetch('/api/v1' + path, { cache: 'no-store' });
    const j = await r.json().catch(() => ({ ok: false }));
    if (!j.ok) throw new Error(j.error || 'The leaderboard is unavailable right now.');
    return j;
  };
  const msg = (tbody, cols, text) => { tbody.innerHTML = `<tr class="msg"><td colspan="${cols}">${esc(text)}</td></tr>`; };
  const link = (tbody, href) => tbody.addEventListener('click', (e) => { if (e.target.closest('tr.row')) location.href = href; });

  const players = document.getElementById('top-players');
  const clans = document.getElementById('top-clans');
  if (!players || !clans) return;
  link(players, '/leaderboard');
  link(clans, '/leaderboard?tab=clans');
  get('/leaderboard?sort=xp&limit=10').then((j) => {
    if (!j.players.length) return msg(players, 5, 'No players on the board yet. Be the first.');
    players.innerHTML = j.players.map((p) => `
      <tr class="row">
        <td class="n pos p${p.position}">${p.position}</td>
        <td><div class="who">${badge(p.level)}<span class="nm">${p.clan ? `<span class="tag">[${esc(p.clan)}]</span> ` : ''}<b>${esc(p.nickname)}</b></span></div></td>
        <td class="hide-s muted">${esc(p.rank)}</td>
        <td class="r hl">${num(p.xp)}</td>
        <td class="r hide-xs">${kd(p.kills, p.deaths)}</td>
      </tr>`).join('');
  }).catch((e) => msg(players, 5, e.message));
  get('/clans?limit=5').then((j) => {
    if (!j.clans.length) return msg(clans, 4, 'No clans yet.');
    clans.innerHTML = j.clans.map((c) => `
      <tr class="row">
        <td class="n pos p${c.position}">${c.position}</td>
        <td><span class="tag big">[${esc(c.name)}]</span></td>
        <td class="r">${num(c.members)}</td>
        <td class="r hl">${num(c.xp)}</td>
      </tr>`).join('');
  }).catch((e) => msg(clans, 4, e.message));
})();
