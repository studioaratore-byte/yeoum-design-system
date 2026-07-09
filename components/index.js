/* components/index.js — window.YeoumDesignSystem 네임스페이스.
 *
 * 컴포넌트는 CSS(components/*.css)로 스타일링하고, 여기서는 마크업
 * 헬퍼와 아이콘 세트를 노출한다. 아이콘은 얇은 스트로크(1.5~2px)
 * 라인 아이콘이며 색은 currentColor를 상속한다. 채운(filled)
 * 아이콘·이모지·유니코드 대용은 쓰지 않는다.
 *
 * 대체 플래그: 소스에 아이콘 세트 없음 → Lucide 형태의 인라인
 * SVG path로 임시 대체. 실제 세트 확보 시 ICONS 맵만 교체한다.
 */
(function (global) {
  "use strict";

  // Lucide(ISC) 형태의 path 데이터. viewBox 0 0 24 24.
  var ICONS = {
    mic: '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><path d="M12 19v3"/>',
    type: '<path d="M4 7V4h16v3"/><path d="M9 20h6"/><path d="M12 4v16"/>',
    "git-merge":
      '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M6 9v6"/><path d="M18 12a9 9 0 0 0-9-9"/><circle cx="18" cy="12" r="3"/>',
    copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    share:
      '<path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7"/><path d="M16 6l-4-4-4 4"/><path d="M12 2v14"/>',
    x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    "arrow-right": '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
    home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9"/>',
    archive:
      '<rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8"/><path d="M10 12h4"/>',
    settings:
      '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
    "chevron-left": '<path d="m15 18-6-6 6-6"/>',
    sparkle:
      '<path d="M12 3v4M12 17v4M3 12h4M17 12h4"/><path d="M12 8a4 4 0 0 0 4 4 4 4 0 0 0-4 4 4 4 0 0 0-4-4 4 4 0 0 0 4-4Z"/>',
  };

  /** 인라인 SVG 문자열을 반환한다. currentColor 상속. */
  function icon(name, size) {
    var body = ICONS[name] || "";
    var s = size || 24;
    return (
      '<svg viewBox="0 0 24 24" width="' +
      s +
      '" height="' +
      s +
      '" fill="none" stroke="currentColor" stroke-width="1.75" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      body +
      "</svg>"
    );
  }

  var YeoumDesignSystem = {
    version: "0.1.0",
    icons: ICONS,
    icon: icon,

    /** 회전형 프롬프트 힌트(R6). 빈 화면 공포 방지, 독촉 아님(R7). */
    promptHints: [
      "뭐든 쏟아. 정리는 나중에.",
      "지금 머릿속에 뭐가 지나가?",
      "반쯤 생각난 것도 괜찮아.",
      "문장 안 돼도 돼. 조각이면 충분해.",
      "떠오른 대로, 순서 없이.",
      "쏟고 나면 내가 엮어줄게.",
    ],

    /** 회전 힌트를 element에 순환시킨다. 반환값으로 stop() 제공. */
    rotateHints: function (el, opts) {
      opts = opts || {};
      var hints = opts.hints || YeoumDesignSystem.promptHints;
      var interval = opts.interval || 4200;
      var i = 0;
      el.textContent = hints[0];
      var reduce =
        global.matchMedia &&
        global.matchMedia("(prefers-reduced-motion: reduce)").matches;
      var timer = setInterval(function () {
        i = (i + 1) % hints.length;
        if (reduce) {
          el.textContent = hints[i];
          return;
        }
        el.classList.add("is-swapping");
        setTimeout(function () {
          el.textContent = hints[i];
          el.classList.remove("is-swapping");
        }, 240);
      }, interval);
      return {
        stop: function () {
          clearInterval(timer);
        },
      };
    },
  };

  global.YeoumDesignSystem = YeoumDesignSystem;
})(typeof window !== "undefined" ? window : this);
