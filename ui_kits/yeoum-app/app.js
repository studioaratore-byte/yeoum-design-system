/* ui_kits/yeoum-app/app.js — 엮음 앱 컨트롤러.
 *
 * 방향(2026-07-10): 입력 → 보관 → 연결 → 노출.
 *   담기(홈)  : 음성/텍스트로 즉시 쏟기 + 과거 생각 재노출(노출)
 *   보관      : 짧은 카드(키워드·10자 주제)로 가볍게 남김
 *   연결      : 흩어진 카드 사이의 반복 주제·의미 연결을 발견
 *   노출      : 과거 카드를 부드럽게 다시 보여줌(독촉 아님) → 이어서 쏟게
 *
 * 설계 헌법 R1~R10: 홈이 곧 입력 · 마이크 지배 · 입력 중 강제 0(자동저장) ·
 *   확인 모달 없음 · 독촉/배지/스트릭 없음 · 화면당 primary 1개 · 감각 차분.
 */
(function () {
  "use strict";

  var DS = window.YeoumDesignSystem;
  var WEAVE = window.YeoumWeave;
  var icon = DS.icon;
  var STORE_KEY = "yeoum:v3";

  /* ── 상태 ─────────────────────────────────────── */
  var state = {
    cards: [], // [{ id, raw, keyword, topic, ts }]
    connections: { clusters: [], resurface: [] },
    connDirty: true, // 카드가 바뀌어 연결을 다시 계산해야 하는가
    dismissed: {}, // resurface cardId -> true (이번 세션 노출 닫음)
    settings: { reducedMotion: false },
  };

  function load() {
    try {
      var s = JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
      state.cards = s.cards || [];
      state.connections = s.connections || { clusters: [], resurface: [] };
      state.settings = s.settings || state.settings;
    } catch (e) {}
  }
  function persist() {
    try {
      localStorage.setItem(
        STORE_KEY,
        JSON.stringify({
          cards: state.cards,
          connections: state.connections,
          settings: state.settings,
        })
      );
    } catch (e) {}
  }

  /* ── 시드 데이터(시연용) ──────────────────────────
   * 연결·노출은 조각이 쌓여야 살아난다. 첫 실행 시 예시 카드를 심어
   * '흩어진 생각이 하나로 이어지는' 순간을 바로 보여준다. */
  var DAY = 86400000;
  function seedIfEmpty() {
    if (state.cards.length) return;
    var now = Date.now();
    var seeds = [
      ["게임할 땐 몇 시간이고 집중하는데 공부는 10분도 못 앉아있어", "게임", "게임엔 몰입", 6],
      ["ADHD는 관심 있는 거엔 과몰입한대. 나도 딱 그런 듯", "ADHD", "과몰입 특성", 6],
      ["아이디어는 계속 나오는데 하나도 끝을 못 봐", "실행력", "완성이 안 됨", 5],
      ["할 일을 게임 퀘스트처럼 만들면 실행이 될까", "실행력", "퀘스트로 실행", 4],
      ["타이머 25분 켜고 하기, 이건 좀 먹혔음", "집중", "짧은 타이머", 3],
      ["친구가 옆에 있으면 이상하게 집중이 잘돼", "집중", "같이 하면 집중", 3],
      ["ADHD 앱들은 죄다 할 일 관리라 죄책감만 들고 재미없어", "ADHD", "기존 앱 불만", 2],
      ["게임처럼 레벨업 되는 실행 도구 있으면 진짜 쓸 텐데", "게임", "게임형 도구", 1],
      ["요즘 계속 실행력 생각이 맴돌아", "실행력", "반복되는 관심", 0],
    ];
    state.cards = seeds.map(function (s, i) {
      return {
        id: "seed" + i,
        raw: s[0],
        keyword: s[1],
        topic: s[2],
        ts: now - s[3] * DAY - (seeds.length - i) * 1200000,
      };
    });
    state.connDirty = true;
    persist();
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
  var TABS = { capture: true, store: true, connect: true, settings: true };
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
      { id: "capture", label: "담기", ic: "mic" },
      { id: "store", label: "보관", ic: "archive" },
      { id: "connect", label: "연결", ic: "git-merge" },
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

  /* ── 카드 조작 ────────────────────────────────── */
  function addCard(text) {
    text = (text || "").trim();
    if (!text) return null;
    var card = {
      id: "c" + Date.now() + Math.floor(Math.random() * 1000),
      raw: text,
      keyword: "",
      topic: "", // 보관(distill) 전까지는 비어 있음
      ts: Date.now(),
    };
    state.cards.push(card);
    state.connDirty = true;
    persist();
    // 배경에서 짧은 카드로 보관(키워드·주제) 채우기 — 입력은 기다리지 않는다.
    WEAVE.distill([text]).then(function (items) {
      if (items && items[0]) {
        card.keyword = items[0].keyword;
        card.topic = items[0].topic;
        persist();
        if (current === "capture") renderRecent();
        if (current === "store") go("store");
      }
    });
    return card;
  }
  function removeCard(id) {
    state.cards = state.cards.filter(function (c) {
      return c.id !== id;
    });
    state.connDirty = true;
    persist();
  }
  function cardById(id) {
    return state.cards.filter(function (c) {
      return c.id === id;
    })[0];
  }

  /* ── 연결 계산(배경) ──────────────────────────── */
  function refreshConnections(cb) {
    if (state.cards.length < 2) {
      state.connections = { clusters: [], resurface: [] };
      state.connDirty = false;
      if (cb) cb();
      return;
    }
    WEAVE.connect(state.cards).then(function (res) {
      state.connections = res || { clusters: [], resurface: [] };
      state.connDirty = false;
      persist();
      if (cb) cb();
    });
  }

  /* ── 뷰 ───────────────────────────────────────── */
  var VIEWS = {};

  /* 담기(홈) = 쏟기 + 노출(과거 재부상). */
  VIEWS.capture = function () {
    var v = h('<section class="view view--capture"></section>');

    var top = h('<header class="topbar"></header>');
    var menuBtn = h(
      '<button class="ys-icon-btn" type="button" aria-label="메뉴">' +
        icon("menu", 24) +
        "</button>"
    );
    menuBtn.addEventListener("click", openDrawer);
    top.appendChild(menuBtn);
    top.appendChild(h('<div class="topbar__title topbar__title--lead">담기</div>'));
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

    // 노출(재부상) 자리 + 최근 카드
    var scroll = h('<div class="fraglist-scroll" id="fragscroll"></div>');
    scroll.appendChild(h('<div id="resurfaceSlot"></div>'));
    scroll.appendChild(h('<div class="fraglist" id="recentlist"></div>'));
    v.appendChild(scroll);

    setTimeout(function () {
      var hintEl = v.querySelector("#homeHint");
      if (hintEl) DS.rotateHints(hintEl);
      renderResurface();
      renderRecent();
    }, 0);

    v.querySelector("#homeMic").addEventListener("click", function () {
      go("voice");
    });
    typeField.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        if (!typeField.value.trim()) return;
        addCard(typeField.value);
        typeField.value = "";
        toast("담아뒀어요");
        renderRecent();
        var fs = document.getElementById("fragscroll");
        if (fs) fs.scrollTop = 0;
      }
    });

    return v;
  };

  function renderResurface() {
    var slot = document.getElementById("resurfaceSlot");
    if (!slot) return;
    slot.innerHTML = "";
    var list = (state.connections.resurface || []).filter(function (r) {
      return !state.dismissed[r.cardId] && cardById(r.cardId);
    });
    if (!list.length) return;
    var r = list[0];
    var card = cardById(r.cardId);
    var wrap = h('<div class="resurface"></div>');
    wrap.innerHTML =
      '<div class="resurface__label">' +
      icon("sparkle", 16) +
      "<span>다시 만난 생각</span></div>" +
      '<p class="resurface__msg">' +
      esc(r.message) +
      "</p>" +
      '<div class="resurface__card"><b>' +
      esc(card.keyword || "") +
      "</b>" +
      esc(card.topic || card.raw) +
      "</div>";
    var open = h(
      '<button class="ys-btn ys-btn--secondary ys-btn--block resurface__open" type="button">이어서 쏟기</button>'
    );
    open.addEventListener("click", function () {
      go("card", { id: card.id });
    });
    var dismiss = h(
      '<button class="ys-icon-btn resurface__x" type="button" aria-label="닫기">' +
        icon("x", 18) +
        "</button>"
    );
    dismiss.addEventListener("click", function () {
      state.dismissed[r.cardId] = true;
      renderResurface();
    });
    wrap.appendChild(open);
    wrap.appendChild(dismiss);
    slot.appendChild(wrap);
  }

  function renderRecent() {
    var list = document.getElementById("recentlist");
    if (!list) return;
    list.innerHTML = "";
    if (!state.cards.length) {
      list.appendChild(
        h(
          '<div class="fraglist__empty ys-body-lg">아직 담긴 생각이 없어요.<br>떠오른 대로 쏟아봐요.</div>'
        )
      );
      return;
    }
    list.appendChild(
      h('<div class="recent-lead">최근 담은 생각</div>')
    );
    var recent = state.cards.slice().reverse().slice(0, 6);
    recent.forEach(function (c) {
      list.appendChild(miniCard(c));
    });
  }

  function miniCard(c) {
    var card = h('<button class="mini-card" type="button"></button>');
    card.innerHTML =
      (c.keyword
        ? '<span class="mini-card__kw">' + esc(c.keyword) + "</span>"
        : '<span class="mini-card__kw mini-card__kw--pending">담는 중…</span>') +
      '<span class="mini-card__topic">' +
      esc(c.topic || c.raw) +
      "</span>" +
      '<span class="mini-card__time">' +
      fmtTime(c.ts) +
      "</span>";
    card.addEventListener("click", function () {
      go("card", { id: c.id });
    });
    return card;
  }

  /* 몰입 음성 모드 — 흐려지는 라인 + 마이크 + 그만. */
  VIEWS.voice = function () {
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

    // 이번 음성 세션에서 담은 카드(최근에 흐려지며 쌓임)
    voiceSession = [];
    function finish() {
      stopVoice();
      go("capture");
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

  var voiceSession = [];
  function renderVoiceLines(interim) {
    var box = document.getElementById("voiceLines");
    if (!box) return;
    box.innerHTML = "";
    var recent = voiceSession.slice(-4);
    recent.forEach(function (text, i) {
      var line = h('<p class="voice__line"></p>');
      line.textContent = text;
      var depth = recent.length - i;
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

  /* 보관 — 짧은 카드 목록. */
  VIEWS.store = function () {
    var v = h('<section class="view"></section>');
    var top = h('<header class="topbar"></header>');
    top.appendChild(h('<div class="topbar__title topbar__title--lead">보관</div>'));
    v.appendChild(top);

    var scroll = h('<div class="view__scroll"></div>');
    if (!state.cards.length) {
      scroll.appendChild(
        h(
          '<div class="fraglist__empty ys-body-lg">아직 담긴 생각이 없어요.<br>담기 탭에서 뭐든 쏟아봐요.</div>'
        )
      );
    } else {
      scroll.appendChild(
        h(
          '<p class="section-lead ys-body">가볍게 담아둔 생각 ' +
            state.cards.length +
            "개. 정리하지 않아도 돼요.</p>"
        )
      );
      var grid = h('<div class="card-grid"></div>');
      state.cards
        .slice()
        .reverse()
        .forEach(function (c) {
          grid.appendChild(miniCard(c));
        });
      scroll.appendChild(grid);
    }
    v.appendChild(scroll);
    return v;
  };

  /* 연결 — 반복 주제 · 의미 연결 발견. */
  VIEWS.connect = function () {
    var v = h('<section class="view"></section>');
    var top = h('<header class="topbar"></header>');
    top.appendChild(h('<div class="topbar__title topbar__title--lead">연결</div>'));
    top.appendChild(h('<div class="topbar__spacer"></div>'));
    var refresh = h(
      '<button class="ys-icon-btn topbar__round" type="button" aria-label="다시 연결">' +
        icon("git-merge", 20) +
        "</button>"
    );
    refresh.addEventListener("click", function () {
      state.connDirty = true;
      go("connect");
    });
    top.appendChild(refresh);
    v.appendChild(top);

    var scroll = h('<div class="view__scroll" id="connscroll"></div>');
    v.appendChild(scroll);

    setTimeout(function () {
      if (state.cards.length < 2) {
        scroll.appendChild(
          h(
            '<div class="fraglist__empty ys-body-lg">생각이 조금 더 쌓이면<br>흩어진 조각들이 어떻게 이어지는지 보여줄게요.</div>'
          )
        );
        return;
      }
      scroll.appendChild(loadingBlock("흩어진 생각을 이어보는 중이에요"));
      var run = function () {
        renderClusters(scroll);
      };
      if (state.connDirty) refreshConnections(run);
      else run();
    }, 0);
    return v;
  };

  function loadingBlock(msg) {
    var w = h('<div class="conn-loading"></div>');
    w.innerHTML =
      '<div class="weaving__glyph">' +
      icon("git-merge", 44) +
      "</div><div class='ys-body'>" +
      esc(msg) +
      "</div>";
    return w;
  }

  function renderClusters(scroll) {
    scroll.innerHTML = "";
    var clusters = state.connections.clusters || [];
    if (!clusters.length) {
      scroll.appendChild(
        h(
          '<div class="fraglist__empty ys-body-lg">아직 뚜렷한 연결은 안 보여요.<br>더 쏟을수록 이어질 실이 많아져요.</div>'
        )
      );
      return;
    }
    scroll.appendChild(
      h(
        '<p class="section-lead ys-body">서로 떨어져 있던 생각이 이렇게 이어져요. 결론은 당신이 내려요.</p>'
      )
    );
    clusters.forEach(function (cl) {
      var group = h('<div class="cluster"></div>');
      group.appendChild(
        h('<div class="cluster__label">' + esc(cl.label) + "</div>")
      );
      if (cl.insight)
        group.appendChild(
          h('<p class="cluster__insight">' + esc(cl.insight) + "</p>")
        );
      var chips = h('<div class="cluster__cards"></div>');
      (cl.cardIds || []).forEach(function (id) {
        var c = cardById(id);
        if (!c) return;
        var chip = h('<button class="cluster-chip" type="button"></button>');
        chip.innerHTML =
          "<b>" +
          esc(c.keyword || "") +
          "</b>" +
          esc(c.topic || c.raw);
        chip.addEventListener("click", function () {
          go("card", { id: c.id });
        });
        chips.appendChild(chip);
      });
      group.appendChild(chips);
      var cont = h(
        '<button class="ys-btn ys-btn--ghost cluster__more" type="button">이 흐름 이어서 쏟기</button>'
      );
      cont.addEventListener("click", function () {
        go("voice");
      });
      group.appendChild(cont);
      scroll.appendChild(group);
    });
  }

  /* 카드 상세 — 원문 + 이어서 쏟기. */
  VIEWS.card = function (opts) {
    var c = cardById(opts.id);
    if (!c) return VIEWS.store();
    var v = h('<section class="view"></section>');
    v.appendChild(
      topbar("담긴 생각", function () {
        go("store");
      })
    );
    var scroll = h('<div class="view__scroll"></div>');

    var head = h('<div class="card-detail__head"></div>');
    head.innerHTML =
      (c.keyword ? '<span class="card-detail__kw">' + esc(c.keyword) + "</span>" : "") +
      '<span class="card-detail__time">' + fmtTime(c.ts) + "</span>";
    scroll.appendChild(head);

    if (c.topic)
      scroll.appendChild(h('<h1 class="card-detail__topic">' + esc(c.topic) + "</h1>"));
    scroll.appendChild(h('<p class="card-detail__raw">' + esc(c.raw) + "</p>"));

    // 이 카드가 속한 연결
    var related = (state.connections.clusters || []).filter(function (cl) {
      return (cl.cardIds || []).indexOf(c.id) !== -1;
    });
    if (related.length) {
      scroll.appendChild(h('<div class="card-detail__rel-label">이 생각과 이어진 흐름</div>'));
      related.forEach(function (cl) {
        var r = h('<button class="cluster-chip cluster-chip--wide" type="button"></button>');
        r.innerHTML = "<b>" + esc(cl.label) + "</b>";
        r.addEventListener("click", function () {
          go("connect");
        });
        scroll.appendChild(r);
      });
    }
    v.appendChild(scroll);

    var actions = h('<div class="result-actions"></div>');
    var pour = h(
      '<button class="ys-btn ys-btn--primary" type="button">이어서 쏟기</button>'
    );
    pour.addEventListener("click", function () {
      go("voice");
    });
    var del = h(
      '<button class="ys-btn ys-btn--ghost" type="button">지우기</button>'
    );
    del.addEventListener("click", function () {
      removeCard(c.id);
      toast("지웠어요");
      go("store");
    });
    actions.appendChild(pour);
    actions.appendChild(del);
    v.appendChild(actions);
    return v;
  };

  /* 설정 */
  VIEWS.settings = function () {
    var v = h('<section class="view"></section>');
    var top = h('<header class="topbar"></header>');
    top.appendChild(h('<div class="topbar__title topbar__title--lead">설정</div>'));
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
      sw.setAttribute("aria-checked", state.settings.reducedMotion ? "true" : "false");
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
          "빨간 배지도, 스트릭도, 독촉도 없어요.<br><br>과거 생각을 다시 보여주는 건 " +
          "<b>독촉이 아니라</b>, 흩어진 생각을 다시 만나게 하려는 거예요. 결론은 늘 당신이 내려요.</div>"
      )
    );
    scroll.appendChild(g2);

    var g3 = h('<div class="settings-group"><h2>데이터</h2></div>');
    var clr = h(
      '<button class="ys-btn ys-btn--secondary ys-btn--block" type="button">모든 생각 비우기</button>'
    );
    clr.addEventListener("click", function () {
      state.cards = [];
      state.connections = { clusters: [], resurface: [] };
      state.dismissed = {};
      state.connDirty = true;
      persist();
      toast("비웠어요");
      go("settings");
    });
    g3.appendChild(clr);
    var reseed = h(
      '<button class="ys-btn ys-btn--ghost ys-btn--block" type="button" style="margin-top:8px">예시 생각 다시 넣기</button>'
    );
    reseed.addEventListener("click", function () {
      state.cards = [];
      state.dismissed = {};
      seedIfEmpty();
      refreshConnections();
      toast("예시를 넣었어요");
      go("store");
    });
    g3.appendChild(reseed);
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
        ic: "archive",
        label: "보관",
        sub: "담은 생각 " + state.cards.length + "개",
        act: function () {
          shut();
          go("store");
        },
      },
      {
        ic: "git-merge",
        label: "연결",
        sub: "발견된 흐름 " + (state.connections.clusters || []).length + "개",
        act: function () {
          shut();
          go("connect");
        },
      },
      {
        ic: "help-circle",
        label: "도움말",
        sub: null,
        act: function () {
          toast("쏟기만 해요. 보관·연결·다시 만나기는 엮음이 맡아요.");
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
          var text = (r[0].transcript || "").trim();
          if (text) {
            addCard(text);
            voiceSession.push(text);
          }
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
    var diff = now - d;
    if (diff < 60000) return "방금";
    var same = d.toDateString() === now.toDateString();
    if (same) return pad(d.getHours()) + ":" + pad(d.getMinutes());
    var days = Math.floor(diff / DAY);
    if (days < 7) return days + "일 전";
    return d.getMonth() + 1 + "월 " + d.getDate() + "일";
  }
  function applyMotionSetting() {
    document.documentElement.classList.toggle(
      "reduce-motion",
      state.settings.reducedMotion
    );
  }

  /* ── 부트 ─────────────────────────────────────── */
  load();
  seedIfEmpty();
  applyMotionSetting();
  go("capture");
  // 노출(재부상)을 위해 배경에서 연결을 미리 계산
  setTimeout(function () {
    if (state.connDirty)
      refreshConnections(function () {
        if (current === "capture") renderResurface();
      });
  }, 400);
})();
