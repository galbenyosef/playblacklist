// js__play 01 — fail
// Lines 1-102 of readable/js__play.pretty.js (statement-aligned).
// /play: find the deployed Unity WebGL build (/api/build) and start it full-window.
(function () {
  const $ = (id) => document.getElementById(id);
  const canvas = $("unity-canvas");

  function fail(title, text, allowForce) {
    $("loader").hidden = true;
    $("error-title").textContent = title;
    $("error-text").textContent = text;
    if (allowForce) {
      const a = document.createElement("a");
      a.className = "btn btn-ghost";
      a.href = "/play?force=1";
      a.textContent = "Play anyway";
      document.querySelector(".error-actions").prepend(a);
    }
    $("error").hidden = false;
  }

  // Unity's warnings / errors (config.showBanner)
  function banner(msg, type) {
    if (type === "error") return fail("Couldn't start the game", String(msg));
    const div = document.createElement("div");
    div.textContent = msg;
    $("banner").appendChild(div);
    setTimeout(() => div.remove(), 6000);
  }

  function setProgress(p) {
    const pct = Math.round(p * 100);
    $("fill").style.width = pct + "%";
    $("pct").textContent = pct + "%";
    $("phase").textContent = p < 0.9 ? "Downloading" : "Starting";
  }

  const force = new URLSearchParams(location.search).has("force");
  if (!force && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)) {
    return fail(
      "Desktop only (for now)",
      "Blacklist needs a keyboard and mouse. Open this page on a computer to play.",
      true,
    );
  }
  if (!document.createElement("canvas").getContext("webgl2")) {
    return fail(
      "WebGL 2 not available",
      "Your browser or graphics driver has WebGL 2 turned off. Update your browser (Chrome, Edge or Firefox) and enable hardware acceleration.",
    );
  }

  fetch("/api/build", { cache: "no-store" })
    .then((r) => r.json())
    .then((b) => {
      if (!b.available) throw new Error("offline");
      document.title = "Play " + (b.productName || "Blacklist");
      const config = {
        arguments: [],
        dataUrl: b.dataUrl,
        frameworkUrl: b.frameworkUrl,
        codeUrl: b.codeUrl,
        streamingAssetsUrl: b.streamingAssetsUrl,
        companyName: b.companyName,
        productName: b.productName,
        productVersion: b.productVersion,
        showBanner: banner,
      };
      $("phase").textContent = "Downloading";
      const script = document.createElement("script");
      script.src = b.loaderUrl;
      script.onerror = () =>
        fail(
          "Couldn't start the game",
          "The game loader failed to download. Check your connection and try again.",
        );
      script.onload = () => {
        createUnityInstance(canvas, config, setProgress)
          .then((unity) => {
            $("loader").hidden = true;
            $("hud").hidden = false;
            $("fullscreen").onclick = () => unity.SetFullscreen(1);
            canvas.focus();
          })
          .catch((msg) => fail("Couldn't start the game", String(msg)));
      };
      document.body.appendChild(script);
    })
    .catch((e) => {
      if (e && e.message === "offline")
        fail(
          "Game offline",
          "No game build is deployed right now. Check back soon.",
        );
      else
        fail(
          "Couldn't reach the server",
          "Check your connection and try again.",
        );
    });

  // keep keyboard input on the game after clicking it (pointer lock is requested by the game itself)
  canvas.addEventListener("mousedown", () => canvas.focus());
})();
