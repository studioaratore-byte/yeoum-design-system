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
    menu: '<path d="M4 6h16"/><path d="M4 12h16"/><path d="M4 18h16"/>',
    inbox:
      '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11Z"/>',
    "file-text":
      '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/><path d="M9 13h6"/><path d="M9 17h6"/>',
    "help-circle":
      '<circle cx="12" cy="12" r="9"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
    send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
    folder:
      '<path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/>',
    search:
      '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
    "rotate-cw":
      '<path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v5h-5"/>',
    pencil:
      '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
    download:
      '<path d="M12 3v12"/><path d="m7 11 5 4 5-4"/><path d="M5 21h14"/>',
    moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8Z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4 12H2M22 12h-2M5.6 5.6 4.2 4.2M19.8 19.8l-1.4-1.4M18.4 5.6l1.4-1.4M4.2 19.8l1.4-1.4"/>',
    "corner-down-right":
      '<path d="M4 4v7a2 2 0 0 0 2 2h13"/><path d="m15 9 4 4-4 4"/>',
  };

  // 마스코트 — 브랜드 장식(고양이). UI 아이콘이 아니라 일러스트라 별도.
  var MASCOT =
    '<svg viewBox="0 0 48 48" width="40" height="40" aria-hidden="true">' +
    '<circle cx="24" cy="24" r="24" fill="var(--thread-1)"/>' +
    '<g fill="none" stroke="var(--thread-6)" stroke-width="1.6" ' +
    'stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M16 16l3 5M32 16l-3 5"/>' +
    '<path d="M15 27a9 9 0 0 0 18 0c0-4-2-7-4-8.5-1.5-1-3.2-1.5-5-1.5s-3.5.5-5 1.5C17 20 15 23 15 27Z"/>' +
    '<path d="M20.5 26h.01M27.5 26h.01"/>' +
    '<path d="M24 29v1.5M24 30.5l-1.5 1M24 30.5l1.5 1"/>' +
    '<path d="M12 25h4M32 25h4"/>' +
    "</g></svg>";

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

  /** 앱 전역이 모션 감소 상태인가 (OS 설정 또는 인앱 토글). */
  function motionReduced() {
    var mq =
      global.matchMedia &&
      global.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var cls =
      global.document &&
      global.document.documentElement.classList.contains("reduce-motion");
    return !!(mq || cls);
  }

  var YeoumDesignSystem = {
    version: "0.2.0",
    icons: ICONS,
    icon: icon,
    mascot: MASCOT,
    motionReduced: motionReduced,

    /** 회전형 프롬프트 힌트(R6). 빈 화면 공포 방지, 독촉 아님(R7). */
    promptHints: [
      "뭐든 쏟아. 정리는 나중에.",
      "지금 머릿속에 뭐가 지나가?",
      "반쯤 생각난 것도 괜찮아.",
      "문장 안 돼도 돼. 조각이면 충분해.",
      "떠오른 대로, 순서 없이.",
      "쏟고 나면 내가 엮어줄게.",
    ],

    /** 회전 힌트를 element에 순환시킨다. 반환값의 stop()으로 반드시 정리.
     *  모션 감소(OS 또는 인앱)면 자동 교체를 멈추고 첫 힌트만 고정한다
     *  (WCAG 2.2.2 — 5초 이상 자동 갱신엔 정지 수단 필요). */
    rotateHints: function (el, opts) {
      opts = opts || {};
      var hints = opts.hints || YeoumDesignSystem.promptHints;
      var interval = opts.interval || 4200;
      var i = 0;
      el.textContent = hints[0];
      if (motionReduced()) {
        return { stop: function () {} };
      }
      var swapT = null;
      var timer = setInterval(function () {
        i = (i + 1) % hints.length;
        el.classList.add("is-swapping");
        swapT = setTimeout(function () {
          el.textContent = hints[i];
          el.classList.remove("is-swapping");
        }, 240);
      }, interval);
      return {
        stop: function () {
          clearInterval(timer);
          if (swapT) clearTimeout(swapT);
        },
      };
    },
  };

  global.YeoumDesignSystem = YeoumDesignSystem;
})(typeof window !== "undefined" ? window : this);
