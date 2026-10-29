// /leaderboard: players (sortable) and clans from the stats API; click a row for the player's profile or the clan roster.
(() => {
  const API = '/api/v1';
  const PAGE = 50;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (n) => Number(n || 0).toLocaleString('en-US');
  const kd = (k, d) => (Number(k || 0) / Math.max(1, Number(d || 0))).toFixed(2);
  const ago = (iso) => {
    if (!iso) return '';
    const s = (Date.now() - new Date(iso).getTime()) / 1000;
    if (s < 3600) return Math.max(1, Math.round(s / 60)) + ' min ago';
    if (s < 86400) return Math.round(s / 3600) + ' h ago';
    return Math.round(s / 86400) + ' d ago';
  };
  // match rows store the game's scene name; show the map's display name (the game's MapCatalog)
  const MAPS = { GS_Zook: 'Zook', GS_UrbanWarfare: 'Urban Warfare', GS_DeSnowoot: 'Greywoot', GS_Orbital: 'Orbital', GS_Ancient: 'Ancient', GS_Forge: 'Forge', GS_Enlightment: 'Zonnieville', GS_Backyard: 'Backyard', GS_Korea: 'Korea', GS_Shipment: 'Shipment', GS_Hangar: 'Hangar', GS_Paris: 'Paris' };
  const mapName = (m) => MAPS[m] || String(m || '').replace(/^GS_|^RT2_/, '');
  // the API stores Deathmatch as "ffa": players see DM
  const modeName = (m) => ({ ffa: 'DM', tdm: 'TDM', bomb: 'BOMB', elim: 'ELIM' }[m] || String(m || '').toUpperCase());
  const hours = (sec) => (sec >= 3600 ? (sec / 3600).toFixed(1) + ' h' : Math.round(sec / 60) + ' min');
  // round 327: a player's equipped title and held achievement cards in the profile, coloured by tier (as on /account)
  const TIER_CLASS = ['t-common', 't-uncommon', 't-rare', 't-epic', 't-legendary', 't-staff'];
  const cardBadges = (list) => {
    const held = (list || []).filter((a) => a.tier >= 0).sort((a, b) => b.tier - a.tier);
    return held.length ? held.map((a) => `<li class="${TIER_CLASS[a.tier] || ''}" title="${esc(a.tierName)} - ${esc(a.label || '')}">${esc(a.title)}</li>`).join('')
      : '<li class="none muted">No cards yet</li>';
  };

  const params = new URLSearchParams(location.search);
  const state = { tab: params.get('tab') === 'clans' ? 'clans' : 'players', sort: params.get('sort') || 'xp', offset: 0 };
  const NOTES = { kd: 'Players with 20+ confirmed kills', xp: '', kills: '', headshots: '', wins: '' };
  if (!(state.sort in NOTES)) state.sort = 'xp';

  async function api(path) {
    const r = await fetch(API + path, { cache: 'no-store' });
    const j = await r.json().catch(() => ({ ok: false, error: 'Unexpected response from the server.' }));
    if (!j.ok) throw new Error(j.error || 'Request failed.');
    return j;
  }

  function message(tbody, cols, text) {
    tbody.innerHTML = `<tr class="msg"><td colspan="${cols}">${esc(text)}</td></tr>`;
  }

  // rank badge (public/img/ranks, the same art as the game's Resources/RankIcons) + level number
  const badge = (level) => {
    const lv = Math.min(200, Math.max(1, Number(level) || 1));
    return `<span class="lvl" title="Level ${lv}"><img src="/img/ranks/rank_${String(lv).padStart(2, '0')}.svg" alt="" loading="lazy"><b>${lv}</b></span>`;
  };
  const clanTag = (c) => (c ? `<span class="tag">[${esc(c)}]</span> ` : '');

  // ------------------------------------------------------------------ players
  async function loadPlayers(append) {
    const tbody = $('players');
    if (!append) { state.offset = 0; message(tbody, 9, 'Loading...'); }
    try {
      const j = await api(`/leaderboard?sort=${state.sort}&limit=${PAGE}&offset=${state.offset}`);
      const rows = j.players.map((p) => `
        <tr class="row" data-player="${esc(p.nickname)}">
          <td class="n pos p${p.position}">${p.position}</td>
          <td><div class="who">${badge(p.level)}<span class="nm">${clanTag(p.clan)}<b>${esc(p.nickname)}</b></span></div></td>
          <td class="hide-s muted">${esc(p.rank)}</td>
          <td class="r${state.sort === 'xp' ? ' hl' : ''}">${num(p.xp)}</td>
          <td class="r hide-xs${state.sort === 'kills' ? ' hl' : ''}">${num(p.kills)}</td>
          <td class="r hide-s">${num(p.deaths)}</td>
          <td class="r${state.sort === 'kd' ? ' hl' : ''}">${kd(p.kills, p.deaths)}</td>
          <td class="r hide-s${state.sort === 'headshots' ? ' hl' : ''}">${num(p.headshots)}</td>
          <td class="r hide-s${state.sort === 'wins' ? ' hl' : ''}">${num(p.wins)}</td>
        </tr>`).join('');
      if (append) tbody.insertAdjacentHTML('beforeend', rows);
      else if (!rows) message(tbody, 9, state.sort === 'kd' ? 'Nobody has 20 confirmed kills yet.' : 'No players on the board yet. Be the first.');
      else tbody.innerHTML = rows;
      state.offset += j.players.length;
      $('more-players').hidden = j.players.length < PAGE;
    } catch (e) {
      if (!append) message(tbody, 9, e.message);
    }
  }

  async function togglePlayer(tr) {
    const next = tr.nextElementSibling;
    if (next && next.classList.contains('detail')) { next.remove(); tr.classList.remove('open'); return; }
    tr.classList.add('open');
    tr.insertAdjacentHTML('afterend', '<tr class="detail"><td colspan="9"><div class="det">Loading...</div></td></tr>');
    const cell = tr.nextElementSibling.querySelector('.det');
    try {
      const { player: p, recent } = await api('/players/' + encodeURIComponent(tr.dataset.player));
      const span = Math.max(1, (p.nextLevelXp || p.xp) - p.levelXp);
      const pct = p.nextLevelXp ? Math.min(100, Math.round(((p.xp - p.levelXp) / span) * 100)) : 100;
      const games = recent.length ? recent.map((m) => `
          <li><span class="map">${esc(mapName(m.map))}</span><span class="muted">${esc(modeName(m.mode))}</span>
          <span>${m.kills} / ${m.deaths}${m.headshots ? ` <span class="muted">(${m.headshots} HS)</span>` : ''}</span>
          <span class="xp">+${num(m.xp)} XP</span><span class="muted">${ago(m.ended_at)}</span></li>`).join('')
        : '<li class="muted">No finished matches yet.</li>';
      cell.innerHTML = `
        <div class="det-grid">
          <div>
            <div class="det-rank">${badge(p.level)}<div><b>${esc(p.rank)}</b><span class="muted">${p.nextLevelXp ? `${num(p.xp)} / ${num(p.nextLevelXp)} XP` : `${num(p.xp)} XP - max level`}</span></div></div>
            ${p.title ? `<div class="det-title ${TIER_CLASS[p.title.tier] || ''}">${esc(p.title.title)}</div>` : ''}
            <div class="bar"><i style="width:${pct}%"></i></div>
            <dl class="facts">
              <div><dt>Matches</dt><dd>${num(p.matches)}</dd></div>
              <div><dt>Wins</dt><dd>${num(p.wins)}</dd></div>
              <div><dt>Headshot %</dt><dd>${p.kills ? Math.round((p.headshots / p.kills) * 100) : 0}%</dd></div>
              <div><dt>Played</dt><dd>${hours(p.playtimeSec || 0)}</dd></div>
              ${p.clan ? `<div><dt>Clan</dt><dd><a href="?tab=clans" data-clan-link="${esc(p.clan)}">[${esc(p.clan)}]</a>${p.clanRole === 'leader' ? ' <span class="muted">leader</span>' : ''}</dd></div>` : ''}
            </dl>
          </div>
          <div><h4>Recent matches</h4><ul class="games">${games}</ul></div>
        </div>
        <h4 class="det-cards-h">Achievements</h4><ul class="badges">${cardBadges(p.achievements)}</ul>`;
    } catch (e) {
      cell.textContent = e.message;
    }
  }

  // ------------------------------------------------------------------ clans
  async function loadClans() {
    const tbody = $('clans');
    message(tbody, 7, 'Loading...');
    try {
      const j = await api('/clans?limit=100');
      if (!j.clans.length) return message(tbody, 7, 'No clans yet.');
      tbody.innerHTML = j.clans.map((c) => `
        <tr class="row" data-clan="${esc(c.name)}">
          <td class="n pos p${c.position}">${c.position}</td>
          <td><span class="tag big">[${esc(c.name)}]</span></td>
          <td class="r">${num(c.members)}</td>
          <td class="r hl">${num(c.xp)}</td>
          <td class="r">${num(c.kills)}</td>
          <td class="r hide-s">${num(c.deaths)}</td>
          <td class="r">${kd(c.kills, c.deaths)}</td>
        </tr>`).join('');
    } catch (e) {
      message(tbody, 7, e.message);
    }
  }

  async function toggleClan(tr) {
    const next = tr.nextElementSibling;
    if (next && next.classList.contains('detail')) { next.remove(); tr.classList.remove('open'); return; }
    tr.classList.add('open');
    tr.insertAdjacentHTML('afterend', '<tr class="detail"><td colspan="7"><div class="det">Loading...</div></td></tr>');
    const cell = tr.nextElementSibling.querySelector('.det');
    try {
      const { clan } = await api('/clans/' + encodeURIComponent(tr.dataset.clan));
      cell.innerHTML = `<ul class="roster">${clan.members.map((m) => `
          <li>${badge(m.level)}<b>${esc(m.nickname)}</b><span class="role">${m.role === 'leader' ? 'Leader' : ''}</span>
          <span class="muted">${esc(m.rank)}</span><span>${num(m.kills)} kills</span><span class="muted">K/D ${kd(m.kills, m.deaths)}</span></li>`).join('')}</ul>
        <p class="muted small">Founded ${new Date(clan.created).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}</p>`;
    } catch (e) {
      cell.textContent = e.message;
    }
  }

  // ------------------------------------------------------------------ wiring
  function setTab(tab, push) {
    state.tab = tab;
    document.querySelectorAll('[data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
    $('players-panel').hidden = tab !== 'players';
    $('clans-panel').hidden = tab !== 'clans';
    if (push !== false) syncUrl();
    return tab === 'clans' ? loadClans() : loadPlayers(false);
  }

  function syncUrl() {
    const q = new URLSearchParams();
    if (state.tab === 'clans') q.set('tab', 'clans');
    else if (state.sort !== 'xp') q.set('sort', state.sort);
    history.replaceState(null, '', location.pathname + (q.toString() ? '?' + q : ''));
  }

  document.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));
  $('sorts').addEventListener('click', (e) => {
    const b = e.target.closest('[data-sort]');
    if (!b || b.dataset.sort === state.sort) return;
    state.sort = b.dataset.sort;
    document.querySelectorAll('[data-sort]').forEach((x) => x.classList.toggle('on', x === b));
    $('sort-note').textContent = NOTES[state.sort];
    syncUrl();
    loadPlayers(false);
  });
  $('more-players').addEventListener('click', () => loadPlayers(true));
  $('players').addEventListener('click', (e) => {
    const link = e.target.closest('[data-clan-link]');
    if (link) {
      e.preventDefault();
      setTab('clans').then(() => {
        const row = [...document.querySelectorAll('#clans tr.row')].find((r) => r.dataset.clan.toLowerCase() === link.dataset.clanLink.toLowerCase());
        if (row) { toggleClan(row); row.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
      });
      return;
    }
    const tr = e.target.closest('tr.row');
    if (tr) togglePlayer(tr);
  });
  $('clans').addEventListener('click', (e) => { const tr = e.target.closest('tr.row'); if (tr) toggleClan(tr); });

  document.querySelectorAll('[data-sort]').forEach((x) => x.classList.toggle('on', x.dataset.sort === state.sort));
  $('sort-note').textContent = NOTES[state.sort];
  setTab(state.tab, false);
})();
