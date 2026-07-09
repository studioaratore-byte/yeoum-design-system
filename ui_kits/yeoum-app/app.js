/* ui_kits/yeoum-app/app.js — 엮음 앱 컨트롤러.
 *
 * 흐름: 쏟기(홈=음성) → 엮어줘 → 줍기·엮기(씨앗 선택) → 결과물 → 되물음.
 * 탭: 음성 · 보관함 · 설정.  좌측 드로어: 프로필·요약·기록·도움말·피드백.
 *
 * 설계 헌법 R1~R10:
 *   R1 홈이 곧 입력(조각이 홈에 바로 쌓임) · R2 마이크가 지배 요소
 *   R3 입력 중 강제 0(자동저장, 제목·태그·저장 없음) · R5 확인 모달 없음
 *   R7 독촉 없음(배지·스트릭·연체 없음) · R8 화면당 primary 1개 · R10 감각 차분
 */
(function () {
  "use strict";

  var DS = window.YeoumDesignSystem;
  var WEAVE = window.YeoumWeave;
  var icon = DS.icon;
  var STORE_KEY = "yeoum:v2";

  /* ── 상태 ─────────────────────────────────────── */
  var state = {
    fragments: [], // 현재 세션: [{ text, ts }]
    answers: [],
    seeds: [],
    discarded: {}, // seedId -> true (폐기)
    selected: {}, // seedId -> true (이걸로 엮기)
    draft: null,
    archive: [], // 결과물 보관
    stats: { frag: 0, seed: 0 }, // 이번 주 발산 요약(누적)
    settings: { reducedMotion: false },
  };

  function load() {
    try {
      var s = JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
      state.archive = s.archive || [];
      state.stats = s.stats || state.stats;
      state.settings = s.settings || state.settings;
      state.fragments = s.fragments || [];
    } catch (e) {}
  }
  function persist() {
    try {
      localStorage.setItem(
        STORE_KEY,
        JSON.stringify({
          archive: state.archive,
          stats: state.stats,
          settings: state.settings,
          fragments: state.fragments,
        })
      );
    } catch (e) {}
  }

  /* ── DOM 헬퍼 ─────────────────────────────────── */
  var app = document.getElementById("app");
  function h(html) {
    var t = document.createElement("template");
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }
  function esc(s) {
    return (s || "").replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  var toastTimer;
  function toast(msg) {
    var t = document.querySelector(".toast");
    if (!t) {
      t = h('<div class="toast" role="status" aria-live="polite"></div>');
      app.appendChild(t);
    }
    t.textContent = msg;
    void t.offsetWidth;
    t.classList.add("is-show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      t.classList.remove("is-show");
    }, 2000);
  }

  /* ── 라우터 ───────────────────────────────────── */
  var TABS = { capture: true, archive: true, settings: true };
  var current = "capture";
  function go(view, opts) {
    stopVoice();
    current = view;
    render(view, opts || {});
  }
  function render(view, opts) {
    app.innerHTML = "";
    var node = VIEWS[view](opts);
    var wrap = h('<div class="view is-entering"></div>');
    wrap.appendChild(node);
    if (TABS[view]) wrap.appendChild(tabbar(view));
    app.appendChild(wrap);
    requestAnimationFrame(function () {
      setTimeout(function () {
        wrap.classList.remove("is-entering");
      }, 260);
    });
  }

  function tabbar(active) {
    var items = [
      { id: "capture", label: "음성", ic: "mic" },
      { id: "archive", label: "보관함", ic: "inbox" },
      { id: "settings", label: "설정", ic: "settings" },
    ];
    var bar = h('<nav class="tabbar" aria-label="주요 이동"></nav>');
    items.forEach(function (it) {
      var b = h(
        '<button class="tabbar__item" type="button">' +
          icon(it.ic, 24) +
          '<span class="lab">' +
          it.label +
          "</span></button>"
      );
      if (it.id === active) b.setAttribute("aria-current", "true");
      b.addEventListener("click", function () {
        go(it.id);
      });
      bar.appendChild(b);
    });
    return bar;
  }

  /* ── 조각 조작 ────────────────────────────────── */
  function addFragment(text) {
    text = (text || "").trim();
    if (!text) return;
    state.fragments.push({ text: text, ts: Date.now() });
    state.stats.frag += 1;
    persist();
  }
  function removeFragment(i) {
    state.fragments.splice(i, 1);
    persist();
  }
  function fragTexts() {
    return state.fragments.map(function (f) {
      return f.text;
    });
  }

  /* ── 뷰 ───────────────────────────────────────── */
  var VIEWS = {};

  /* 홈 = 쏟기(음성 탭). 조각이 여기에 바로 쌓인다(R1). */
  VIEWS.capture = function () {
    var v = h('<section class="view view--capture"></section>');

    // 상단바 — 햄버거 + "쏟기"
    var top = h('<header class="topbar"></header>');
    var menuBtn = h(
      '<button class="ys-icon-btn" type="button" aria-label="메뉴">' +
        icon("menu", 24) +
        "</button>"
    );
    menuBtn.addEventListener("click", openDrawer);
    top.appendChild(menuBtn);
    top.appendChild(h('<div class="topbar__title topbar__title--lead">쏟기</div>'));
    v.appendChild(top);

    // 히어로 — 마이크 + 힌트 + 입력 필드
    var hero = h('<div class="capture-hero"></div>');
    hero.innerHTML =
      '<button class="ys-mic" id="homeMic" type="button" aria-label="쏟기 — 음성으로 시작">' +
      icon("mic", 40) +
      "</button>" +
      '<p class="ys-prompt-hint" id="homeHint"></p>';
    var typeField = h(
      '<input class="capture-typefield" id="pour" type="text" ' +
        'placeholder="또는 입력…" aria-label="글로 쏟기" autocomplete="off" />'
    );
    hero.appendChild(typeField);
    v.appendChild(hero);

    // 조각 리스트(스크롤)
    var scroll = h('<div class="fraglist-scroll" id="fragscroll"></div>');
    scroll.appendChild(h('<div class="fraglist" id="fraglist"></div>'));
    v.appendChild(scroll);

    // 엮어줘 CTA
    var cta = h('<div class="weave-cta" id="weavecta"></div>');
    v.appendChild(cta);

    // 힌트 회전(R6)
    setTimeout(function () {
      var hintEl = v.querySelector("#homeHint");
      if (hintEl) DS.rotateHints(hintEl);
      renderFragList();
      renderWeaveCta();
    }, 0);

    v.querySelector("#homeMic").addEventListener("click", function () {
      go("voice");
    });
    typeField.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        addFragment(typeField.value);
        typeField.value = "";
        renderFragList();
        renderWeaveCta();
        var fs = document.getElementById("fragscroll");
        if (fs) fs.scrollTop = 0;
      }
    });

    return v;
  };

  function renderFragList() {
    var list = document.getElementById("fraglist");
    if (!list) return;
    list.innerHTML = "";
    if (!state.fragments.length) {
      list.appendChild(
        h(
          '<div class="fraglist__empty ys-body-lg">아직 조각이 없어요.<br>떠오른 대로 쏟아봐요.</div>'
        )
      );
      return;
    }
    // 최신 조각이 위로
    var frs = state.fragments.slice().reverse();
    frs.forEach(function (f, ri) {
      var i = state.fragments.length - 1 - ri;
      var card = h('<article class="frag-card"></article>');
      card.innerHTML =
        '<div class="frag-card__text">' +
        esc(f.text) +
        "</div>" +
        '<div class="frag-card__time">' +
        fmtTime(f.ts) +
        "</div>";
      var rm = h(
        '<button class="ys-icon-btn frag-card__remove" type="button" aria-label="이 조각 빼기">' +
          icon("x", 18) +
          "</button>"
      );
      rm.addEventListener("click", function () {
        removeFragment(i);
        renderFragList();
        renderWeaveCta();
      });
      card.appendChild(rm);
      list.appendChild(card);
    });
  }

  function renderWeaveCta() {
    var cta = document.getElementById("weavecta");
    if (!cta) return;
    var n = state.fragments.length;
    cta.innerHTML = "";
    var btn = h(
      '<button class="ys-btn ys-btn--primary ys-btn--block ys-btn--lg" type="button">' +
        icon("git-merge", 20) +
        "엮어줘 · 조각 " +
        n +
        "개</button>"
    );
    if (!n) btn.setAttribute("aria-disabled", "true");
    btn.addEventListener("click", function () {
      if (!n) {
        toast("먼저 뭐든 쏟아봐요");
        return;
      }
      startPicking();
    });
    cta.appendChild(btn);
  }

  /* 몰입 음성 모드 — 흐려지는 라인 + 마이크 + 그만. */
  VIEWS.voice = function (opts) {
    var v = h('<section class="view view--voice"></section>');
    var wrap = h('<div class="voice"></div>');
    wrap.appendChild(h('<div class="voice__lines" id="voiceLines"></div>'));
    var mic = h(
      '<button class="ys-mic ys-mic--sm is-recording" id="voiceMic" type="button" aria-label="그만 듣기">' +
        icon("mic", 32) +
        "</button>"
    );
    var stop = h(
      '<button class="ys-btn ys-btn--ghost voice__stop" type="button">그만</button>'
    );
    wrap.appendChild(mic);
    wrap.appendChild(stop);
    v.appendChild(wrap);

    var returnTo = opts.returnTo || "capture";
    function finish() {
      stopVoice();
      if (returnTo === "result-recompose") {
        recomposeFromCurrent();
      } else {
        go("capture");
      }
    }
    mic.addEventListener("click", finish);
    stop.addEventListener("click", finish);

    setTimeout(function () {
      renderVoiceLines("");
      startVoice(function (interim) {
        renderVoiceLines(interim);
      });
    }, 0);
    return v;
  };

  function renderVoiceLines(interim) {
    var box = document.getElementById("voiceLines");
    if (!box) return;
    box.innerHTML = "";
    var recent = state.fragments.slice(-4);
    recent.forEach(function (f, i) {
      var line = h('<p class="voice__line"></p>');
      line.textContent = f.text;
      // 오래된 라인일수록 흐리게
      var depth = recent.length - i; // 1(최신) .. n
      line.style.opacity = String(Math.max(0.28, 1 - (depth - 1) * 0.28));
      if (i === recent.length - 1 && !interim) line.classList.add("is-current");
      box.appendChild(line);
    });
    if (interim) {
      var live = h('<p class="voice__line is-current is-interim"></p>');
      live.textContent = interim;
      box.appendChild(live);
    }
    if (!recent.length && !interim) {
      box.appendChild(
        h('<p class="voice__hint ys-body-lg">듣고 있어요. 편하게 쏟아요.</p>')
      );
    }
  }

  /* 씨앗 추출 → 줍기·엮기 (AI 호출, 로딩 표시) */
  function startPicking() {
    state._weaveMsg = "핵심을 줍는 중이에요";
    go("weaving");
    WEAVE.extractSeeds(fragTexts()).then(function (seeds) {
      state.seeds = seeds;
      state.discarded = {};
      state.selected = {};
      // 기본: 모두 선택된 채로 시작(원하는 것만 폐기/해제)
      state.seeds.forEach(function (s) {
        state.selected[s.id] = true;
      });
      state.stats.seed += state.seeds.length;
      persist();
      go("seeds");
    });
  }

  VIEWS.seeds = function () {
    var v = h('<section class="view"></section>');
    v.appendChild(
      topbar("줍기 · 엮기", function () {
        go("capture");
      })
    );
    var scroll = h('<div class="view__scroll view__scroll--flush"></div>');
    scroll.appendChild(
      h(
        '<p class="section-lead ys-body">폭주한 덤프에서 핵심을 줍었어요 — 고르기만 하면 돼.</p>'
      )
    );
    var groups = h('<div class="seed-groups" id="seedgroups"></div>');
    scroll.appendChild(groups);
    v.appendChild(scroll);

    var cta = h('<div class="weave-cta"></div>');
    var make = h(
      '<button class="ys-btn ys-btn--primary ys-btn--block ys-btn--lg" type="button">결과물 만들기</button>'
    );
    make.addEventListener("click", function () {
      var chosen = state.seeds.filter(function (s) {
        return !state.discarded[s.id] && state.selected[s.id];
      });
      if (!chosen.length) {
        chosen = state.seeds.filter(function (s) {
          return !state.discarded[s.id];
        });
      }
      if (!chosen.length) {
        toast("엮을 씨앗이 하나는 있어야 해요");
        return;
      }
      makeResult(chosen);
    });
    cta.appendChild(make);
    v.appendChild(cta);

    setTimeout(renderSeeds, 0);
    return v;
  };

  function renderSeeds() {
    var box = document.getElementById("seedgroups");
    if (!box) return;
    box.innerHTML = "";
    state.seeds.forEach(function (s) {
      if (state.discarded[s.id]) return;
      var group = h('<div class="seed-group"></div>');
      group.appendChild(
        h('<div class="seed-label">' + esc(s.label) + "</div>")
      );
      var card = h('<article class="seed-card"></article>');
      if (state.selected[s.id]) card.classList.add("is-selected");
      card.innerHTML =
        '<h3 class="seed-card__title">' +
        esc(s.title) +
        "</h3>" +
        '<p class="seed-card__body">' +
        esc(s.body) +
        "</p>";
      var actions = h('<div class="seed-card__actions"></div>');
      var pick = h(
        '<button class="ys-btn seed-pick" type="button">이걸로 엮기</button>'
      );
      pick.classList.add(
        state.selected[s.id] ? "seed-pick--on" : "ys-btn--secondary"
      );
      pick.addEventListener("click", function () {
        state.selected[s.id] = !state.selected[s.id];
        renderSeeds();
      });
      var drop = h(
        '<button class="ys-btn ys-btn--ghost seed-drop" type="button">폐기</button>'
      );
      drop.addEventListener("click", function () {
        state.discarded[s.id] = true;
        state.selected[s.id] = false;
        renderSeeds();
      });
      actions.appendChild(pick);
      actions.appendChild(drop);
      card.appendChild(actions);
      group.appendChild(card);
      box.appendChild(group);
    });
    if (!box.children.length) {
      box.appendChild(
        h(
          '<div class="fraglist__empty ys-body-lg">씨앗을 다 폐기했어요.<br>뒤로 가 더 쏟아봐요.</div>'
        )
      );
    }
  }

  /* 결과물 생성 (AI 호출) */
  function makeResult(chosenSeeds) {
    state._weaveMsg = "엮는 중이에요";
    go("weaving");
    WEAVE.composeDoc(chosenSeeds, fragTexts(), state.answers).then(function (
      draft
    ) {
      draft.fragmentCount = fragTexts().length;
      draft.seedCount = chosenSeeds.length;
      draft.createdAt = Date.now();
      state.draft = draft;
      archiveDraft(draft);
      go("result", { fresh: true });
    });
  }
  function recomposeFromCurrent() {
    var chosen = state.seeds.filter(function (s) {
      return !state.discarded[s.id] && state.selected[s.id];
    });
    if (!chosen.length) chosen = state.seeds;
    makeResult(chosen);
  }

  VIEWS.weaving = function () {
    var v = h('<section class="view"></section>');
    var w = h('<div class="weaving"></div>');
    var msg = state._weaveMsg || "엮는 중이에요";
    var sub =
      msg.indexOf("줍") !== -1
        ? "쏟아낸 조각에서 핵심을 고르고 있어요…"
        : "조각을 하나의 글로 모으고 있어요…";
    w.innerHTML =
      '<div class="weaving__glyph">' +
      icon("git-merge", 56) +
      "</div>" +
      '<div class="ys-title">' +
      esc(msg) +
      "</div>" +
      '<div class="weaving__count ys-body-lg">' +
      sub +
      "</div>";
    v.appendChild(w);
    return v;
  };

  /* 결과물 — 내 생각 / AI 보강 마커 + 되물음. */
  VIEWS.result = function (opts) {
    var d = opts.draft || state.draft;
    if (!d) return VIEWS.capture();
    var fromArchive = !!opts.fromArchive;

    var v = h('<section class="view"></section>');

    // 상단바 — 뒤로 + 공유
    var top = h('<header class="topbar"></header>');
    var back = h(
      '<button class="ys-icon-btn" type="button" aria-label="뒤로">' +
        icon("chevron-left", 24) +
        "</button>"
    );
    back.addEventListener("click", function () {
      go(fromArchive ? "archive" : "capture");
    });
    top.appendChild(back);
    top.appendChild(h('<div class="topbar__spacer"></div>'));
    var share = h(
      '<button class="ys-icon-btn topbar__round" type="button" aria-label="내보내기">' +
        icon("share", 22) +
        "</button>"
    );
    share.addEventListener("click", function () {
      shareDraft(d);
    });
    top.appendChild(share);
    v.appendChild(top);

    var scroll = h('<div class="view__scroll view__scroll--flush"></div>');

    // 헤더 — 마스코트 + 증폭 pill
    var head = h('<div class="result-head"></div>');
    head.innerHTML =
      '<div class="result-head__mascot">' +
      DS.mascot +
      "</div>" +
      '<div class="result-pill">당신의 조각 <b>' +
      d.fragmentCount +
      "개</b> " +
      icon("arrow-right", 16) +
      " 이 글이 됐어요</div>";
    scroll.appendChild(head);

    scroll.appendChild(
      h('<h1 class="result-title">' + esc(d.title) + "</h1>")
    );
    scroll.appendChild(
      h('<div class="result-meta">초안 · 자동저장됨</div>')
    );

    // 범례
    scroll.appendChild(
      h(
        '<div class="result-legend">' +
          '<span class="legend-item legend-item--me">내 생각</span>' +
          '<span class="legend-item legend-item--ai">AI 보강</span>' +
          "</div>"
      )
    );

    // 문단 — 좌측 바 마커
    var body = h('<div class="result-body"></div>');
    d.paras.forEach(function (p) {
      body.appendChild(
        h(
          '<p class="result-para result-para--' +
            p.who +
            '">' +
            esc(p.text) +
            "</p>"
        )
      );
    });
    scroll.appendChild(body);

    // 실행 3단계(기획류)
    if (d.steps && d.steps.length) {
      var steps = h('<div class="result-steps"></div>');
      var sh = "<h3>실행 3단계</h3><ol>";
      d.steps.forEach(function (s) {
        sh += "<li>" + esc(s) + "</li>";
      });
      sh += "</ol>";
      steps.innerHTML = sh;
      scroll.appendChild(steps);
    }

    // 되물음
    if (d.reask) {
      var reask = h('<div class="reask-card"></div>');
      reask.innerHTML =
        '<div class="reask-card__label">엮음이 되물어요</div>' +
        '<p class="reask-card__q">' +
        esc(d.reask.text) +
        "</p>";
      var pourMore = h(
        '<button class="ys-btn ys-btn--primary ys-btn--block" type="button">30초 더 쏟기</button>'
      );
      pourMore.addEventListener("click", function () {
        go("voice", { returnTo: "result-recompose" });
      });
      reask.appendChild(pourMore);
      scroll.appendChild(reask);
    }

    v.appendChild(scroll);

    // 하단 액션 — 다듬기 / 다시 엮기
    var actions = h('<div class="result-actions"></div>');
    var refine = h(
      '<button class="ys-btn ys-btn--secondary" type="button">다듬기</button>'
    );
    refine.addEventListener("click", function () {
      go("voice", { returnTo: "result-recompose" });
    });
    var reweave = h(
      '<button class="ys-btn ys-btn--ghost" type="button">다시 엮기</button>'
    );
    reweave.addEventListener("click", function () {
      go("seeds");
    });
    actions.appendChild(refine);
    actions.appendChild(reweave);
    v.appendChild(actions);

    if (opts.fresh)
      setTimeout(function () {
        toast("조각 " + d.fragmentCount + "개 → 결과물이 됐어요");
      }, 400);

    return v;
  };

  /* 보관함 */
  VIEWS.archive = function () {
    var v = h('<section class="view"></section>');
    var top = h('<header class="topbar"></header>');
    top.appendChild(h('<div class="topbar__title">보관함</div>'));
    v.appendChild(top);
    var scroll = h('<div class="view__scroll"></div>');
    if (!state.archive.length) {
      scroll.appendChild(
        h(
          '<div class="fraglist__empty ys-body-lg">아직 엮은 결과물이 없어요.<br>음성 탭에서 뭐든 쏟아봐요.</div>'
        )
      );
    } else {
      scroll.appendChild(
        h(
          '<p class="section-lead ys-body">지금까지 엮은 결과물 ' +
            state.archive.length +
            "개.</p>"
        )
      );
      var list = h('<div class="archive-list"></div>');
      state.archive.forEach(function (d) {
        var item = h('<button class="archive-item" type="button"></button>');
        item.innerHTML =
          '<div class="archive-item__title">' +
          esc(d.title) +
          "</div>" +
          '<div class="archive-item__meta">조각 ' +
          d.fragmentCount +
          "개 · 씨앗 " +
          (d.seedCount || 0) +
          "개 · " +
          fmtDate(d.createdAt) +
          "</div>";
        item.addEventListener("click", function () {
          go("result", { draft: d, fromArchive: true });
        });
        list.appendChild(item);
      });
      scroll.appendChild(list);
    }
    v.appendChild(scroll);
    return v;
  };

  /* 설정 */
  VIEWS.settings = function () {
    var v = h('<section class="view"></section>');
    var top = h('<header class="topbar"></header>');
    top.appendChild(h('<div class="topbar__title">설정</div>'));
    v.appendChild(top);
    var scroll = h('<div class="view__scroll"></div>');

    var g1 = h('<div class="settings-group"><h2>감각</h2></div>');
    var row = h(
      '<div class="settings-row"><div class="settings-row__label">' +
        "<b>모션 줄이기</b><span>전환·움직임을 최소화해요.</span></div></div>"
    );
    var sw = h(
      '<button class="switch" type="button" role="switch" aria-label="모션 줄이기"></button>'
    );
    sw.setAttribute("aria-checked", state.settings.reducedMotion ? "true" : "false");
    sw.addEventListener("click", function () {
      state.settings.reducedMotion = !state.settings.reducedMotion;
      sw.setAttribute(
        "aria-checked",
        state.settings.reducedMotion ? "true" : "false"
      );
      applyMotionSetting();
      persist();
    });
    row.appendChild(sw);
    g1.appendChild(row);
    scroll.appendChild(g1);

    var g2 = h('<div class="settings-group"><h2>엮음이 하지 않는 것</h2></div>');
    g2.appendChild(
      h(
        '<div class="boundary-note">엮음은 <b>일정·리마인드·투두·목표 추적</b>을 하지 않아요. ' +
          "빨간 배지도, 스트릭도, 연체도 없어요.<br><br>엮음은 당신의 <b>하루</b>가 아니라 " +
          "<b>결과물</b>을 쪼개요. 깊이는 기능 수가 아니라 변환의 질로.</div>"
      )
    );
    scroll.appendChild(g2);

    var g3 = h('<div class="settings-group"><h2>데이터</h2></div>');
    var clr = h(
      '<button class="ys-btn ys-btn--secondary ys-btn--block" type="button">보관함 비우기</button>'
    );
    clr.addEventListener("click", function () {
      state.archive = [];
      persist();
      toast("보관함을 비웠어요");
      go("settings");
    });
    g3.appendChild(clr);
    scroll.appendChild(g3);

    scroll.appendChild(
      h(
        '<p class="ys-caption" style="text-align:center;margin-top:24px">엮음 · v' +
          DS.version +
          "</p>"
      )
    );
    v.appendChild(scroll);
    return v;
  };

  /* ── 좌측 드로어 ──────────────────────────────── */
  function openDrawer() {
    var overlay = h('<div class="drawer-overlay"></div>');
    var panel = h('<aside class="drawer" role="dialog" aria-label="메뉴"></aside>');

    var head = h('<div class="drawer__head"></div>');
    head.appendChild(h('<div class="wordmark">엮<span>음</span></div>'));
    var close = h(
      '<button class="ys-icon-btn" type="button" aria-label="닫기">' +
        icon("x", 24) +
        "</button>"
    );
    close.addEventListener("click", shut);
    head.appendChild(close);
    panel.appendChild(head);

    var profile = h('<div class="drawer__profile"></div>');
    profile.innerHTML =
      '<div class="drawer__avatar">발</div>' +
      '<div class="drawer__who"><b>발산하는 사람</b><span>모두 자동저장 중</span></div>';
    panel.appendChild(profile);

    panel.appendChild(h('<div class="drawer__divider"></div>'));

    var menu = h('<nav class="drawer__menu"></nav>');
    var items = [
      {
        ic: "folder",
        label: "이번 주 발산 요약",
        sub:
          "조각 " +
          state.stats.frag +
          " · 씨앗 " +
          state.stats.seed +
          " · 결과물 " +
          state.archive.length,
        act: function () {
          shut();
          go("archive");
        },
      },
      {
        ic: "file-text",
        label: "내보낸 기록",
        sub: null,
        act: function () {
          shut();
          go("archive");
        },
      },
      {
        ic: "help-circle",
        label: "도움말",
        sub: null,
        act: function () {
          toast("쏟고 → 엮어줘 → 골라서 → 결과물. 그게 다예요.");
        },
      },
      {
        ic: "send",
        label: "피드백 보내기",
        sub: null,
        act: function () {
          toast("고마워요. 뭐든 편하게 보내줘요.");
        },
      },
    ];
    items.forEach(function (it) {
      var row = h('<button class="drawer__item" type="button"></button>');
      row.innerHTML =
        '<span class="drawer__item-ic">' +
        icon(it.ic, 22) +
        "</span>" +
        '<span class="drawer__item-txt"><b>' +
        esc(it.label) +
        "</b>" +
        (it.sub ? "<span>" + esc(it.sub) + "</span>" : "") +
        "</span>";
      row.addEventListener("click", it.act);
      menu.appendChild(row);
    });
    panel.appendChild(menu);

    panel.appendChild(
      h('<div class="drawer__foot">엮음 · v' + DS.version + "</div>")
    );

    overlay.appendChild(panel);
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) shut();
    });
    app.appendChild(overlay);
    requestAnimationFrame(function () {
      overlay.classList.add("is-open");
    });

    function shut() {
      overlay.classList.remove("is-open");
      setTimeout(function () {
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      }, 240);
    }
  }

  /* ── 공통 상단바(뒤로+제목) ───────────────────── */
  function topbar(title, onBack) {
    var bar = h('<header class="topbar"></header>');
    if (onBack) {
      var back = h(
        '<button class="ys-icon-btn" type="button" aria-label="뒤로">' +
          icon("chevron-left", 24) +
          "</button>"
      );
      back.addEventListener("click", onBack);
      bar.appendChild(back);
    }
    bar.appendChild(h('<div class="topbar__title">' + esc(title) + "</div>"));
    bar.appendChild(h('<div class="topbar__spacer"></div>'));
    return bar;
  }

  /* ── 저장/내보내기 ────────────────────────────── */
  function archiveDraft(d) {
    if (state._sid != null) {
      var idx = state.archive.findIndex(function (x) {
        return x._id === state._sid;
      });
      if (idx !== -1) {
        d._id = state._sid;
        state.archive[idx] = d;
        persist();
        return;
      }
    }
    d._id = "d" + d.createdAt;
    state._sid = d._id;
    state.archive.unshift(d);
    persist();
  }
  function draftToText(d) {
    var lines = [d.title, ""];
    d.paras.forEach(function (p) {
      lines.push(p.text, "");
    });
    if (d.steps && d.steps.length) {
      lines.push("[실행 3단계]");
      d.steps.forEach(function (s, i) {
        lines.push(i + 1 + ". " + s);
      });
    }
    return lines.join("\n").trim();
  }
  function shareDraft(d) {
    var text = draftToText(d);
    if (navigator.share) {
      navigator.share({ title: d.title, text: text }).catch(function () {});
    } else {
      copyText(text);
    }
  }
  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        function () {
          toast("복사했어요");
        },
        function () {
          legacyCopy(text);
        }
      );
    } else legacyCopy(text);
  }
  function legacyCopy(text) {
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
      toast("복사했어요");
    } catch (e) {
      toast("복사를 못 했어요. 한 번 더?");
    }
    document.body.removeChild(ta);
  }

  /* ── 음성(webkitSpeechRecognition) ────────────── */
  var recog = null;
  var recActive = false;
  var onInterim = null;
  function startVoice(interimCb) {
    onInterim = interimCb;
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      toast("이 브라우저는 음성을 못 들어요. ‘또는 입력’으로 쏟아봐요.");
      return;
    }
    recog = new SR();
    recog.lang = "ko-KR";
    recog.continuous = true;
    recog.interimResults = true;
    recog.onresult = function (e) {
      var interim = "";
      for (var i = e.resultIndex; i < e.results.length; i++) {
        var r = e.results[i];
        if (r.isFinal) {
          addFragment(r[0].transcript);
          if (onInterim) onInterim("");
        } else {
          interim += r[0].transcript;
        }
      }
      if (interim && onInterim) onInterim(interim);
    };
    recog.onerror = function () {
      toast("잘 안 들렸어요. 한 번 더?");
    };
    recog.onend = function () {
      recActive = false;
    };
    try {
      recog.start();
      recActive = true;
    } catch (e) {}
  }
  function stopVoice() {
    if (recog) {
      try {
        recog.stop();
      } catch (e) {}
    }
    recog = null;
    recActive = false;
    onInterim = null;
  }

  /* ── 유틸 ─────────────────────────────────────── */
  function pad(n) {
    return ("0" + n).slice(-2);
  }
  function fmtTime(ts) {
    var d = new Date(ts),
      now = new Date();
    var same = d.toDateString() === now.toDateString();
    var t = pad(d.getHours()) + ":" + pad(d.getMinutes());
    return (same ? "오늘 " : d.getMonth() + 1 + "월 " + d.getDate() + "일 ") + t;
  }
  function fmtDate(ts) {
    var d = new Date(ts);
    return d.getFullYear() + "." + pad(d.getMonth() + 1) + "." + pad(d.getDate());
  }
  function prefersReduced() {
    if (state.settings.reducedMotion) return true;
    return (
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    );
  }
  function applyMotionSetting() {
    document.documentElement.classList.toggle(
      "reduce-motion",
      state.settings.reducedMotion
    );
  }

  /* ── 부트 ─────────────────────────────────────── */
  load();
  applyMotionSetting();
  go("capture");
})();
