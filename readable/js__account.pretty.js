// /account: log in with the game account (api/web.js - the session is an HttpOnly cookie this script never sees),
// then the player's rank, stats, cards and recent matches, and the account settings (email, password, sign out).
(() => {
  const API = "/api/v1/web";
  const $ = (id) => document.getElementById(id);
  const esc = (s) =>
    String(s == null ? "" : s).replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  const num = (n) => Number(n || 0).toLocaleString("en-US");
  const kd = (k, d) =>
    (Number(k || 0) / Math.max(1, Number(d || 0))).toFixed(2);
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0) + "%";
  const hours = (sec) =>
    sec >= 3600
      ? (sec / 3600).toFixed(1) + " h"
      : Math.round(sec / 60) + " min";
  const date = (iso) =>
    iso
      ? new Date(iso).toLocaleDateString(undefined, {
          day: "numeric",
          month: "short",
          year: "numeric",
        })
      : "";
  const ago = (iso) => {
    if (!iso) return "";
    const s = (Date.now() - new Date(iso).getTime()) / 1000;
    if (s < 3600) return Math.max(1, Math.round(s / 60)) + " min ago";
    if (s < 86400) return Math.round(s / 3600) + " h ago";
    return Math.round(s / 86400) + " d ago";
  };
  // match rows store the game's scene name (the game's MapCatalog names, as on the leaderboard)
  const MAPS = {
    GS_Zook: "Zook",
    GS_UrbanWarfare: "Urban Warfare",
    GS_DeSnowoot: "Greywoot",
    GS_Orbital: "Orbital",
    GS_Ancient: "Ancient",
    GS_Forge: "Forge",
    GS_Enlightment: "Zonnieville",
    GS_Backyard: "Backyard",
    GS_Korea: "Korea",
    GS_Shipment: "Shipment",
    GS_Hangar: "Hangar",
  };
  const mapName = (m) => MAPS[m] || String(m || "").replace(/^GS_|^RT2_/, "");
  const MODES = { tdm: "TDM", ffa: "DM", bomb: "BOMB" };
  const TIER_CLASS = [
    "t-common",
    "t-uncommon",
    "t-rare",
    "t-epic",
    "t-legendary",
    "t-staff",
  ];
  const badge = (level) => {
    const lv = Math.min(200, Math.max(1, Number(level) || 1));
    return `<span class="lvl" title="Level ${lv}"><img src="/img/ranks/rank_${String(lv).padStart(2, "0")}.svg" alt=""><b>${lv}</b></span>`;
  };

  async function call(path, body) {
    const opt = { cache: "no-store", credentials: "same-origin" };
    if (body !== undefined)
      Object.assign(opt, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    const r = await fetch(API + path, opt);
    const j = await r.json().catch(() => ({
      ok: false,
      error: "Unexpected response from the server.",
    }));
    if (!j.ok) {
      const e = new Error(j.error || "Request failed.");
      e.status = r.status;
      throw e;
    }
    return j;
  }

  // ?next=/play: the pre-launch playtest gate (server.js) sent the player here - after logging in, on to the game
  const NEXT = ["/play"].includes(
    new URLSearchParams(location.search).get("next"),
  )
    ? new URLSearchParams(location.search).get("next")
    : "";
  if (NEXT) {
    $("gate-note").hidden = false;
    $("reg-note").hidden = true;
  }

  const views = {
    loading: $("acc-loading"),
    signin: $("signin"),
    profile: $("profile"),
  };
  function show(name) {
    for (const k in views) views[k].hidden = k !== name;
  }

  function say(form, text, good) {
    const m = form.querySelector(".form-msg");
    m.textContent = text || "";
    m.hidden = !text;
    m.classList.toggle("good", !!good);
  }
  function busy(form, on) {
    form.querySelectorAll("button, input").forEach((el) => {
      el.disabled = on;
    });
  }

  // ------------------------------------------------------------------ signed out
  $("login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.currentTarget;
    const username = f.username.value.trim(),
      password = f.password.value;
    if (!username || !password)
      return say(f, "Enter your username and password.");
    say(f, "");
    busy(f, true);
    try {
      await call("/login", { username, password });
      if (NEXT) {
        location.href = NEXT;
        return;
      }
      f.reset();
      await load();
      document.dispatchEvent(new Event("bl-account")); // nav.js: the header button
    } catch (err) {
      say(f, err.message);
    } finally {
      busy(f, false);
    }
  });

  // ------------------------------------------------------------------ signed in
  let cards = [],
    allCards = false;

  function renderCards() {
    const held = cards.filter((a) => a.tier >= 0);
    const list = allCards
      ? cards
          .slice()
          .sort((a, b) => (b.tier >= 0) - (a.tier >= 0) || b.tier - a.tier)
      : held.sort((a, b) => b.tier - a.tier);
    $("p-cards-count").textContent = `${held.length} of ${cards.length}`;
    $("p-cards").innerHTML = list.length
      ? list
          .map((a) => {
            const got = a.tier >= 0;
            const goal =
              (a.thresholds || [])[
                Math.min((a.thresholds || []).length - 1, a.tier + 1)
              ] || 0;
            const next = got && a.tier + 1 < (a.thresholds || []).length;
            const prog =
              !got || next
                ? `<span class="c-prog muted small">${num(Math.min(a.value, goal))} / ${num(goal)}</span>`
                : "";
            return `<li class="${got ? TIER_CLASS[a.tier] || "" : "locked"}"><b class="c-name">${esc(got ? a.title : (a.titles && a.titles[0]) || a.title)}</b>
        <span class="c-tier">${got ? esc(a.tierName) : "Locked"}</span>
        <span class="c-label muted small">${esc(a.label || "")}</span>${prog}</li>`;
          })
          .join("")
      : '<li class="locked"><span class="muted">No cards yet - play a few matches.</span></li>';
    $("p-cards-all").hidden = cards.length === held.length;
    $("p-cards-all").textContent = allCards ? "Only mine" : "Show all";
  }
  $("p-cards-all").addEventListener("click", () => {
    allCards = !allCards;
    renderCards();
  });

  function render({ me: p, account, recent }) {
    $("p-name").innerHTML =
      (p.clan ? `<span class="tag">[${esc(p.clan)}]</span> ` : "") +
      esc(p.nickname);
    const t = $("p-title");
    t.hidden = !p.title;
    if (p.title) {
      t.className = "p-title " + (TIER_CLASS[p.title.tier] || "");
      t.textContent = p.title.title;
    }

    const span = Math.max(1, (p.nextLevelXp || p.xp) - p.levelXp);
    const progress = p.nextLevelXp
      ? Math.min(100, Math.round(((p.xp - p.levelXp) / span) * 100))
      : 100;
    $("p-rank").innerHTML =
      `${badge(p.level)}<div><b>${esc(p.rank)}</b><span class="muted">Level ${p.level} · ${p.nextLevelXp ? `${num(p.xp)} / ${num(p.nextLevelXp)} XP` : `${num(p.xp)} XP - max level`}</span></div>`;
    $("p-bar").style.width = progress + "%";
    $("p-wallet").innerHTML = `
      <div><dt>Points</dt><dd>${num(p.points)}</dd></div>
      <div><dt>Gold</dt><dd class="gold">${num(p.gold)}</dd></div>
      <div><dt>Joined</dt><dd>${esc(date(p.joined))}</dd></div>
      ${p.clan ? `<div><dt>Clan</dt><dd>[${esc(p.clan)}]${p.clanRole && p.clanRole !== "member" ? ` <span class="muted small">${esc(p.clanRole)}</span>` : ""}</dd></div>` : ""}`;
    $("p-stats").innerHTML = [
      ["Kills", num(p.kills)],
      ["Deaths", num(p.deaths)],
      ["K/D", kd(p.kills, p.deaths)],
      ["Assists", num(p.assists)],
      ["Headshots", num(p.headshots)],
      ["Headshot %", pct(p.headshots, p.kills)],
      ["Matches", num(p.matches)],
      ["Wins", num(p.wins)],
      ["Win %", pct(p.wins, p.matches)],
      ["Best streak", num(p.bestStreak)],
      ["Knife kills", num(p.meleeKills)],
      ["Explosive kills", num(p.explosiveKills)],
      ["Played", hours(p.playtimeSec || 0)],
    ]
      .map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`)
      .join("");

    $("p-games").innerHTML = recent.length
      ? recent
          .map(
            (m) => `
      <li><span class="map">${esc(mapName(m.map))}</span><span class="muted">${esc(MODES[m.mode] || String(m.mode).toUpperCase())}${m.won_team ? ' <span class="won">WIN</span>' : ""}</span>
      <span>${m.kills} / ${m.deaths}${m.headshots ? ` <span class="muted">(${m.headshots} HS)</span>` : ""}</span>
      <span class="xp">+${num(m.xp)} XP</span><span class="muted">${ago(m.ended_at)}</span></li>`,
          )
          .join("")
      : '<li class="muted">No finished matches yet.</li>';

    cards = p.achievements || [];
    renderCards();

    $("a-user").textContent = account.username;
    $("password-form").username.value = account.username; // for password managers
    $("email-form").email.value = account.email;
    $("a-sessions").textContent =
      account.sessions === 1
        ? "Only here."
        : `On ${account.sessions} devices or browsers (the game counts too). Lost a device or shared your password? Sign out everywhere.`;
    show("profile");
  }

  async function load() {
    try {
      const who = await call("/whoami");
      if (!who.signedIn) {
        show("signin");
        return;
      }
      if (NEXT) {
        location.replace(NEXT);
        return;
      }
      render(await call("/me"));
    } catch (e) {
      if (e.status === 401) {
        show("signin");
        return;
      }
      show("signin");
      say(
        $("login-form"),
        e.status === 403
          ? e.message
          : e.message || "The account server is unavailable right now.",
      );
    }
  }

  $("logout").addEventListener("click", async () => {
    try {
      await call("/logout", {});
    } catch {
      /* signed out either way */
    }
    document.dispatchEvent(new Event("bl-account"));
    show("signin");
  });

  $("logout-all").addEventListener("click", async (e) => {
    if (!confirm("Sign out on every device, the game included?")) return;
    e.currentTarget.disabled = true;
    try {
      await call("/logout-all", {});
    } catch {
      /* the cookie is cleared */
    }
    e.currentTarget.disabled = false;
    document.dispatchEvent(new Event("bl-account"));
    show("signin");
  });

  $("email-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.currentTarget;
    if (!f.password.value) return say(f, "Enter your current password.");
    say(f, "");
    busy(f, true);
    try {
      const j = await call("/email", {
        email: f.email.value.trim(),
        password: f.password.value,
      });
      f.password.value = "";
      say(f, j.email ? "Email saved." : "Email removed.", true);
    } catch (err) {
      if (err.status === 401 && /session/i.test(err.message))
        return show("signin");
      say(f, err.message);
    } finally {
      busy(f, false);
    }
  });

  $("password-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.currentTarget;
    if (!f.current.value) return say(f, "Enter your current password.");
    if (f.password.value.length < 8)
      return say(f, "New password: at least 8 characters.");
    if (f.password.value !== f.again.value)
      return say(f, "The new passwords are not the same.");
    say(f, "");
    busy(f, true);
    try {
      const j = await call("/password", {
        current: f.current.value,
        password: f.password.value,
      });
      f.current.value = f.password.value = f.again.value = "";
      say(
        f,
        "Password changed." +
          (j.signedOut
            ? ` Signed out on ${j.signedOut} other device${j.signedOut === 1 ? "" : "s"}.`
            : ""),
        true,
      );
      $("a-sessions").textContent = "Only here.";
    } catch (err) {
      if (err.status === 401 && /session/i.test(err.message))
        return show("signin");
      say(f, err.message);
    } finally {
      busy(f, false);
    }
  });

  show("loading");
  load();
})();
