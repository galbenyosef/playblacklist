// js__launch 01 — the
// Lines 1-63 of readable/js__launch.pretty.js (statement-aligned).
// Before the launch (/api/launch, env LAUNCH_AT): the site's Play links lead to the countdown instead of the game, and
// the rankings ([data-lock]: top players / clans, the leaderboard tables) are blurred under a lock (html.prelaunch -
// set for the first paint by the pages' head script, corrected here from the server's answer).
// /play itself stays open, so playtesters with the link can keep stress-testing. After the launch nothing changes.
(async () => {
  let j;
  try {
    j = await (await fetch("/api/launch", { cache: "no-store" })).json();
  } catch {
    return;
  }
  if (!j) return;
  document.documentElement.classList.toggle("prelaunch", !j.live);
  if (j.live) return;
  // the landing page's countdown ([data-countdown]): against the server clock; at zero the page reloads (live)
  const box = document.querySelector("[data-countdown]");
  if (box) {
    const at = Date.parse(j.launchAt),
      skew = Date.parse(j.now) - Date.now();
    const pad = (n) => String(n).padStart(2, "0");
    const cell = (k) => box.querySelector('[data-cd="' + k + '"]');
    const when = box.querySelector("[data-cd-when]");
    if (when)
      when.textContent =
        new Date(at)
          .toLocaleString("en-GB", {
            timeZone: "UTC",
            weekday: "long",
            day: "numeric",
            month: "long",
            hour: "2-digit",
            minute: "2-digit",
          })
          .replace(" at ", ", ") + " UTC (GMT)";
    const tick = () => {
      const left = at - (Date.now() + skew);
      if (left <= 0) {
        clearInterval(timer);
        location.reload();
        return;
      }
      const s = Math.floor(left / 1000);
      cell("d").textContent = pad(Math.floor(s / 86400));
      cell("h").textContent = pad(Math.floor(s / 3600) % 24);
      cell("m").textContent = pad(Math.floor(s / 60) % 60);
      cell("s").textContent = pad(s % 60);
    };
    const timer = setInterval(tick, 250);
    tick();
  }
  document.querySelectorAll('a[href="/play"]').forEach((a) => {
    a.setAttribute("href", "/countdown");
    if (a.classList.contains("nav-play")) {
      a.textContent = "Launch";
      return;
    }
    const t = [...a.childNodes]
      .reverse()
      .find((n) => n.nodeType === 3 && n.textContent.trim());
    if (t && /^\s*play( now)?\s*$/i.test(t.textContent))
      t.textContent = " Launch countdown "; // "Sign in and play" keeps its words
  });
})();
