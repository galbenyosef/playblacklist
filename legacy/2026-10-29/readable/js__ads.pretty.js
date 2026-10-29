// Round 275: rewarded ads for the game shop ("watch an ad: +50 points"), Google H5 Games Ads (Ad Placement API).
// The game (Unity, Plugins/WebGL/BLAds.jslib) drives window.BLAds:
//   request()  ask Google for a rewarded ad; when one is ready the state turns READY
//   show()     play it (called from the browser's own pointerup of the click on WATCH AD: a user gesture)
//   state()    0 OFF (no ads on this page), 1 IDLE, 2 LOADING, 3 READY, 4 SHOWING, 5 VIEWED (pay the points),
//              6 DISMISSED (closed early: nothing), 7 NONE (no ad to show right now: try again later)
//   ack()      the game has handled VIEWED / DISMISSED / NONE: back to IDLE
// The mode comes from the server (data-ads-mode on this script tag, see server.js): off / test / live.
(function () {
  var OFF = 0,
    IDLE = 1,
    LOADING = 2,
    READY = 3,
    SHOWING = 4,
    VIEWED = 5,
    DISMISSED = 6,
    NONE = 7;
  var me = document.currentScript;
  var mode = (me && me.getAttribute("data-ads-mode")) || "off";
  if (mode !== "test" && mode !== "live") {
    window.BLAds = {
      state: function () {
        return OFF;
      },
      request: function () {},
      show: function () {},
      ack: function () {},
      mode: "off",
    };
    return;
  }

  var tag = document.createElement("script");
  tag.async = true;
  tag.crossOrigin = "anonymous";
  if (mode === "test") tag.setAttribute("data-adbreak-test", "on"); // Google's test ads: no revenue, no policy risk
  tag.src =
    "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-5455017629067849";
  document.head.appendChild(tag);
  window.adsbygoogle = window.adsbygoogle || [];
  window.adBreak = window.adConfig = function (o) {
    window.adsbygoogle.push(o);
  };
  window.adConfig({ preloadAdBreaks: "on", sound: "on" });

  var state = IDLE,
    showFn = null,
    gen = 0,
    lastStatus = "";
  function set(s) {
    state = s;
  }

  window.BLAds = {
    mode: mode,
    state: function () {
      return state;
    },
    status: function () {
      return lastStatus;
    },
    request: function () {
      if (state === LOADING || state === READY || state === SHOWING) return;
      var my = ++gen;
      showFn = null;
      set(LOADING);
      window.adBreak({
        type: "reward",
        name: "shop_points",
        beforeAd: function () {
          if (my === gen) set(SHOWING);
        },
        afterAd: function () {},
        beforeReward: function (fn) {
          if (my === gen) {
            showFn = fn;
            set(READY);
          }
        },
        adDismissed: function () {
          if (my === gen) {
            showFn = null;
            set(DISMISSED);
          }
        },
        adViewed: function () {
          if (my === gen) {
            showFn = null;
            set(VIEWED);
          }
        },
        adBreakDone: function (info) {
          lastStatus = (info && info.breakStatus) || "";
          if (my !== gen) return;
          // no ad came (not ready, frequency capped, error...): the game asks again later
          if (state === LOADING || state === SHOWING) {
            showFn = null;
            set(NONE);
          }
        },
      });
    },
    show: function () {
      if (state !== READY || !showFn) return;
      var fn = showFn;
      showFn = null;
      set(SHOWING);
      try {
        fn();
      } catch (e) {
        console.warn("BLAds:", e);
        set(NONE);
      }
    },
    ack: function () {
      if (state === VIEWED || state === DISMISSED || state === NONE) set(IDLE);
    },
  };
})();
