/* ui_kits/yeoum-app/app.js — Piko 앱 컨트롤러.
 *
 * 흐름: 담기(입력) → 보관(짧은 카드) → 연결(반복 주제·성좌) → 노출(재부상).
 * 설계 헌법 R1~R10: 홈=입력 · 마이크 지배 · 입력 중 강제 0(자동저장) ·
 *   확인 모달 없음(대신 되돌리기) · 독촉/배지/스트릭 없음 · 화면당 primary 1개 · 감각 차분.
 *
 * 고도화(2026-07-13): AI 배치·id매핑·타임아웃 폴백, '이어서 쏟기' 앵커 루프,
 *   접근성(포커스 이동·라이브리전·드로어 포커스트랩·헤딩·대비), 견고성(음성 재시작·
 *   경쟁조건 가드·id 충돌·되돌리기), 보관 검색·타임라인, 성좌 시각화, 다크모드 토글.
 */
(function () {
  "use strict";

  var DS = window.YeoumDesignSystem;
  var WEAVE = window.YeoumWeave;
  var icon = DS.icon;
  var STORE_KEY = "yeoum:v3";
  var DAY = 86400000;

  /* ── 상태 ─────────────────────────────────────── */
  var state = {
    cards: [], // [{ id, raw, keyword, topic, ts, by }]
    connections: { clusters: [], resurface: [], source: "ai" },
    connDirty: true,
    dismissed: {}, // resurface cardId -> true (영속)
    settings: { reducedMotion: false, theme: "system" }, // theme: system|light|dark
  };

  // 세션 전용(비영속)
  var seq = 0; // 카드 id 단조 증가
  var current = "capture";
  var hintCtl = null; // rotateHints stop 핸들
  var voiceSession = [];
  var voiceStopped = false;
  var voicePermBlocked = false;
  var voiceAnchor = null; // { topic, keyword }
  var storeFilter = ""; // 보관 검색어
  var undoData = null; // { snapshot, timer }
  var lastActive = null; // 드로어 열기 전 포커스 복원용
  var connSeq = 0; // 카드 변경 시퀀스(연결 무효화)
  var connInFlight = false;
  var connTrailing = false;
  var connApply = null; // 연결 뷰가 열려 있으면 AI 결과 도착 시 재렌더하는 훅
  var resurfaceRot = 0;

  function load() {
    try {
      var s = JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
      state.cards = s.cards || [];
      state.connections = s.connections || {
        clusters: [],
        resurface: [],
        source: "ai",
      };
      state.dismissed = s.dismissed || {};
      state.settings = Object.assign(
        { reducedMotion: false, theme: "system" },
        s.settings || {}
      );
      if (typeof s.connDirty === "boolean") state.connDirty = s.connDirty;
    } catch (e) {}
  }
  function persist() {
    try {
      localStorage.setItem(
        STORE_KEY,
        JSON.stringify({
          cards: state.cards,
          connections: state.connections,
          dismissed: state.dismissed,
          settings: state.settings,
          connDirty: state.connDirty,
        })
      );
    } catch (e) {
      if (e && e.name === "QuotaExceededError")
        toast("저장 공간이 가득 찼어요. 설정에서 오래된 생각을 정리해봐요.");
    }
  }

  /* ── DOM 헬퍼 ─────────────────────────────────── */
  var app = document.getElementById("app");
  var viewhost, liveRegion;
  function h(html) {
    var t = document.createElement("template");
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }
  function esc(s) {
    return (s || "").replace(/[&<>"']/g, function (c) {
      return {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      }[c];
    });
  }
  function announce(msg) {
    if (liveRegion) liveRegion.textContent = msg;
  }

  var toastTimer;
  /** toast(msg) 또는 toast(msg, { actionLabel, onAction, duration }). */
  function toast(msg, opts) {
    opts = opts || {};
    var t = document.querySelector(".toast");
    if (t) t.remove();
    t = h('<div class="toast" role="status"></div>');
    var span = h('<span class="toast__msg"></span>');
    span.textContent = msg;
    t.appendChild(span);
    if (opts.actionLabel && opts.onAction) {
      var btn = h(
        '<button class="toast__action" type="button">' +
          esc(opts.actionLabel) +
          "</button>"
      );
      btn.addEventListener("click", function () {
        clearTimeout(toastTimer);
        t.classList.remove("is-show");
        opts.onAction();
      });
      t.appendChild(btn);
    }
    app.appendChild(t);
    void t.offsetWidth;
    t.classList.add("is-show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      t.classList.remove("is-show");
      setTimeout(function () {
        if (t.parentNode) t.remove();
      }, 260);
    }, opts.duration || 2200);
    announce(msg);
  }

  /* ── 라우터 ───────────────────────────────────── */
  var TABS = { capture: true, store: true, connect: true, settings: true };
  var TITLES = {
    capture: "담기",
    store: "보관",
    connect: "연결",
    settings: "설정",
  };
  function go(view, opts) {
    stopVoice();
    if (hintCtl) {
      hintCtl.stop();
      hintCtl = null;
    }
    current = view;
    render(view, opts || {});
  }
  function render(view, opts) {
    viewhost.innerHTML = "";
    var node = VIEWS[view](opts);
    var wrap = h('<div class="view is-entering"></div>');
    wrap.appendChild(node);
    if (TABS[view]) wrap.appendChild(tabbar(view));
    viewhost.appendChild(wrap);
    // 라우팅 안내 + 포커스 이동(스크린리더·키보드)
    announce((TITLES[view] || "화면") + " 화면");
    requestAnimationFrame(function () {
      var vt = wrap.querySelector("[data-vtitle]");
      if (vt) {
        try {
          vt.focus({ preventScroll: true });
        } catch (e) {
          vt.focus();
        }
      }
      setTimeout(function () {
        wrap.classList.remove("is-entering");
      }, 300);
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
        '<button class="tabbar__item" type="button" aria-label="' +
          it.label +
          '">' +
          icon(it.ic, 24) +
          '<span class="lab">' +
          it.label +
          "</span></button>"
      );
      if (it.id === active) b.setAttribute("aria-current", "page");
      b.addEventListener("click", function () {
        if (it.id !== current) go(it.id);
      });
      bar.appendChild(b);
    });
    return bar;
  }

  /* 뷰 제목(h1) — 포커스 대상 겸 헤딩. */
  function viewTitle(text) {
    return (
      '<h1 class="topbar__title topbar__title--lead" data-vtitle tabindex="-1">' +
      esc(text) +
      "</h1>"
    );
  }

  /* ── 카드 조작 ────────────────────────────────── */
  function newId() {
    return "c" + Date.now() + "-" + seq++;
  }
  function addCard(text, opts) {
    opts = opts || {};
    text = (text || "").trim();
    if (!text) return null;
    var card = {
      id: newId(),
      raw: text,
      keyword: "",
      topic: "",
      ts: Date.now(),
      by: "",
    };
    state.cards.push(card);
    connDirtyBump();
    persist();
    if (!opts.defer) distillCards([card]);
    return card;
  }
  function removeCard(id) {
    state.cards = state.cards.filter(function (c) {
      return c.id !== id;
    });
    connDirtyBump();
    persist();
  }
  function cardById(id) {
    return state.cards.filter(function (c) {
      return c.id === id;
    })[0];
  }
  function connDirtyBump() {
    state.connDirty = true;
    connSeq++;
  }

  /** 주어진 카드들을 실제 AI(배치)로 보관해 keyword/topic 채움. 완료 노드만 갱신. */
  function distillCards(cards) {
    var pending = cards.filter(function (c) {
      return c && !c.keyword;
    });
    if (!pending.length) return Promise.resolve();
    return WEAVE.distill(
      pending.map(function (c) {
        return c.raw;
      })
    ).then(function (items) {
      pending.forEach(function (c, i) {
        if (items && items[i]) {
          c.keyword = items[i].keyword;
          c.topic = items[i].topic;
          c.by = items[i].by || "ai";
          updateCardNode(c);
        }
      });
      persist();
    });
  }
  /** 미보관(또는 로컬로만 채워진) 카드를 배경에서 AI로 재보관. */
  function distillPending(cb) {
    var pending = state.cards.filter(function (c) {
      return !c.keyword || c.by === "local";
    });
    if (!pending.length) {
      if (cb) cb();
      return;
    }
    // keyword 없는 것 우선, 로컬 보정은 함께
    distillCards(
      state.cards.filter(function (c) {
        return !c.keyword;
      })
    ).then(function () {
      // 로컬로만 채워진 카드 재보관(있으면)
      var locals = state.cards.filter(function (c) {
        return c.by === "local" && c.keyword;
      });
      if (!locals.length) {
        if (cb) cb();
        return;
      }
      WEAVE.distill(
        locals.map(function (c) {
          return c.raw;
        })
      ).then(function (items) {
        locals.forEach(function (c, i) {
          if (items && items[i] && items[i].by === "ai") {
            c.keyword = items[i].keyword;
            c.topic = items[i].topic;
            c.by = "ai";
            updateCardNode(c);
          }
        });
        persist();
        if (cb) cb();
      });
    });
  }
  /** 현재 화면에 있는 해당 카드 노드만 부분 갱신(전체 재렌더 회피). */
  function updateCardNode(c) {
    var nodes = viewhost.querySelectorAll('[data-card-id="' + cssEsc(c.id) + '"]');
    nodes.forEach(function (n) {
      var fresh = miniCard(c);
      n.replaceWith(fresh);
    });
  }
  function cssEsc(s) {
    return (s || "").replace(/["\\]/g, "\\$&");
  }

  /* ── 연결 계산(경쟁조건 가드) ─────────────────── */
  function refreshConnections(cb) {
    if (state.cards.length < 2) {
      state.connections = { clusters: [], resurface: [], source: "ai" };
      state.connDirty = false;
      if (cb) cb();
      if (connApply) connApply();
      return;
    }
    if (connInFlight) {
      connTrailing = true;
      if (cb) cb();
      return;
    }
    connInFlight = true;
    var seqAtStart = connSeq;
    WEAVE.connect(state.cards).then(function (res) {
      connInFlight = false;
      // 진행 중 카드가 바뀌었으면 이 결과는 stale → 폐기, dirty 유지
      if (connSeq === seqAtStart) {
        state.connections = res || {
          clusters: [],
          resurface: [],
          source: "ai",
        };
        state.connDirty = false;
        persist();
        // 권위 있는 결과가 도착했으니 연결 뷰가 열려 있으면 반드시 재렌더
        if (connApply) connApply();
      }
      if (cb) cb();
      if (connTrailing) {
        connTrailing = false;
        if (state.connDirty) refreshConnections();
      }
    });
  }

  /* ── 뷰 ───────────────────────────────────────── */
  var VIEWS = {};

  /* 담기(홈) = 쏟기 + 노출. */
  VIEWS.capture = function () {
    var v = h('<section class="view view--capture"></section>');

    var top = h('<header class="topbar"></header>');
    var menuBtn = h(
      '<button class="ys-icon-btn" type="button" aria-label="메뉴 열기">' +
        icon("menu", 24) +
        "</button>"
    );
    menuBtn.addEventListener("click", openDrawer);
    top.appendChild(menuBtn);
    top.appendChild(h(viewTitle("담기")));
    v.appendChild(top);

    var hero = h('<div class="capture-hero"></div>');
    hero.innerHTML =
      '<button class="ys-mic" id="homeMic" type="button" aria-label="음성으로 쏟기 시작">' +
      icon("mic", 40) +
      "</button>" +
      '<p class="ys-prompt-hint" id="homeHint"></p>';
    var typeField = h(
      '<input class="capture-typefield" id="pour" type="text" ' +
        'placeholder="또는 여기에 입력…" aria-label="글로 쏟기" autocomplete="off" enterkeyhint="done" />'
    );
    hero.appendChild(typeField);
    v.appendChild(hero);

    var scroll = h('<div class="fraglist-scroll" id="fragscroll"></div>');
    scroll.appendChild(h('<div id="resurfaceSlot"></div>'));
    scroll.appendChild(h('<div class="fraglist" id="recentlist"></div>'));
    v.appendChild(scroll);

    setTimeout(function () {
      var hintEl = v.querySelector("#homeHint");
      if (hintEl) hintCtl = DS.rotateHints(hintEl);
      renderResurface();
      renderRecent();
      // 방금 쏟은 흐름이 재노출에 반영되도록(카드 2개↑ & dirty) 한 번 갱신
      if (state.cards.length >= 2 && state.connDirty)
        refreshConnections(function () {
          if (current === "capture") renderResurface();
        });
    }, 0);

    v.querySelector("#homeMic").addEventListener("click", function () {
      startVoiceFlow(null);
    });
    typeField.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        if (!typeField.value.trim()) return;
        var c = addCard(typeField.value);
        typeField.value = "";
        toast("담아뒀어요");
        renderRecent();
        var fs = document.getElementById("fragscroll");
        if (fs) fs.scrollTop = 0;
      }
    });

    return v;
  };

  /** 음성 지원 시 몰입 모드로, 미지원 시 텍스트 입력으로 안내. anchor 선택적. */
  function startVoiceFlow(anchor) {
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      go("capture");
      setTimeout(function () {
        var f = document.getElementById("pour");
        if (f) {
          f.focus();
          if (anchor && anchor.topic) f.placeholder = "‘" + anchor.topic + "’에 이어서…";
        }
        toast("이 브라우저는 음성을 못 들어요. 글로 쏟아봐요.");
      }, 30);
      return;
    }
    voiceAnchor = anchor || null;
    go("voice");
  }

  function renderResurface() {
    var slot = document.getElementById("resurfaceSlot");
    if (!slot) return;
    slot.innerHTML = "";
    var list = (state.connections.resurface || []).filter(function (r) {
      return !state.dismissed[r.cardId] && cardById(r.cardId);
    });
    if (!list.length) return;
    var r = list[resurfaceRot % list.length];
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
      "</b><span>" +
      esc(card.topic || card.raw) +
      "</span></div>";
    var open = h(
      '<button class="ys-btn ys-btn--secondary ys-btn--block" type="button">이 생각에 이어서 쏟기</button>'
    );
    open.addEventListener("click", function () {
      startVoiceFlow({ topic: card.topic || card.raw, keyword: card.keyword });
    });
    var dismiss = h(
      '<button class="ys-icon-btn resurface__x" type="button" aria-label="이 재노출 닫기">' +
        icon("x", 18) +
        "</button>"
    );
    dismiss.addEventListener("click", function () {
      state.dismissed[r.cardId] = true;
      resurfaceRot++;
      persist();
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
        emptyState(
          "쏟은 생각이 여기 모여요",
          "정리하지 않아도 괜찮아요. 마이크를 누르거나 입력해서 뭐든 쏟아봐요.",
          { demo: true }
        )
      );
      return;
    }
    list.appendChild(
      h('<h2 class="recent-lead">최근 담은 생각</h2>')
    );
    var recent = state.cards.slice().reverse().slice(0, 6);
    recent.forEach(function (c, i) {
      list.appendChild(miniCard(c, i));
    });
  }

  function miniCard(c, i) {
    var card = h(
      '<button class="mini-card" type="button" data-card-id="' +
        esc(c.id) +
        '"></button>'
    );
    if (typeof i === "number") card.style.setProperty("--i", i);
    var kw = c.keyword
      ? '<span class="mini-card__kw">' + esc(c.keyword) + "</span>"
      : '<span class="mini-card__kw mini-card__kw--pending">담는 중…</span>';
    card.innerHTML =
      kw +
      '<span class="mini-card__topic">' +
      esc(c.topic || c.raw) +
      "</span>" +
      '<span class="mini-card__time">' +
      fmtTime(c.ts) +
      "</span>";
    card.setAttribute(
      "aria-label",
      (c.keyword ? c.keyword + ", " : "") + (c.topic || c.raw)
    );
    card.addEventListener("click", function (e) {
      // 키워드 pill 탭 → 보관에서 같은 키워드 필터
      if (
        c.keyword &&
        e.target.closest &&
        e.target.closest(".mini-card__kw:not(.mini-card__kw--pending)")
      ) {
        e.stopPropagation();
        storeFilter = c.keyword;
        go("store");
        return;
      }
      go("card", { id: c.id });
    });
    return card;
  }

  /* 몰입 음성 모드. */
  VIEWS.voice = function () {
    voiceSession = [];
    voiceStopped = false;
    var v = h('<section class="view view--voice"></section>');
    var wrap = h('<div class="voice"></div>');
    if (voiceAnchor && voiceAnchor.topic) {
      wrap.appendChild(
        h(
          '<div class="voice__anchor">' +
            icon("corner-down-right", 16) +
            "<span>이어가는 중 · ‘" +
            esc(voiceAnchor.topic) +
            "’</span></div>"
        )
      );
    }
    wrap.appendChild(
      h(
        '<div class="voice__lines" id="voiceLines" aria-live="polite" aria-atomic="false"></div>'
      )
    );
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

    function finish() {
      voiceStopped = true;
      stopVoice();
      // 음성으로 담은 카드 배치 보관 후 연결 갱신
      distillPending(function () {
        if (state.cards.length >= 2 && state.connDirty) refreshConnections();
      });
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

  /* 보관 — 검색 + 타임라인 그룹. */
  VIEWS.store = function () {
    var v = h('<section class="view"></section>');
    var top = h('<header class="topbar"></header>');
    top.appendChild(h(viewTitle("보관")));
    v.appendChild(top);

    var scroll = h('<div class="view__scroll"></div>');

    if (!state.cards.length) {
      scroll.appendChild(
        emptyState(
          "담은 생각이 여기 쌓여요",
          "쏟은 생각이 짧은 카드로 모여요. 담기 탭에서 뭐든 쏟아봐요.",
          { demo: false }
        )
      );
      v.appendChild(scroll);
      return v;
    }

    // 검색 바
    var searchWrap = h('<div class="store-search"></div>');
    searchWrap.innerHTML = icon("search", 18);
    var input = h(
      '<input class="store-search__input" type="search" placeholder="생각 찾기 (단어·주제)" aria-label="보관 검색" />'
    );
    input.value = storeFilter;
    searchWrap.appendChild(input);
    if (storeFilter) {
      var clear = h(
        '<button class="ys-icon-btn store-search__clear" type="button" aria-label="검색 지우기">' +
          icon("x", 18) +
          "</button>"
      );
      clear.addEventListener("click", function () {
        storeFilter = "";
        go("store");
      });
      searchWrap.appendChild(clear);
    }
    scroll.appendChild(searchWrap);

    var listHost = h('<div id="storeList"></div>');
    scroll.appendChild(listHost);
    v.appendChild(scroll);

    input.addEventListener("input", function () {
      storeFilter = input.value;
      renderStoreList(listHost);
    });
    setTimeout(function () {
      renderStoreList(listHost);
    }, 0);
    return v;
  };

  function matchCard(c, q) {
    q = (q || "").trim().toLowerCase();
    if (!q) return true;
    return (
      (c.raw || "").toLowerCase().indexOf(q) !== -1 ||
      (c.keyword || "").toLowerCase().indexOf(q) !== -1 ||
      (c.topic || "").toLowerCase().indexOf(q) !== -1
    );
  }
  function dayBucket(ts) {
    var d = new Date(ts),
      now = new Date();
    var diff = now - d;
    if (d.toDateString() === now.toDateString()) return "오늘";
    var y = new Date(now - DAY);
    if (d.toDateString() === y.toDateString()) return "어제";
    var days = Math.floor(diff / DAY);
    if (days < 7) return days + "일 전";
    if (
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth()
    )
      return "이번 달";
    return d.getFullYear() + "년 " + (d.getMonth() + 1) + "월";
  }
  function renderStoreList(host) {
    host.innerHTML = "";
    var cards = state.cards
      .slice()
      .reverse()
      .filter(function (c) {
        return matchCard(c, storeFilter);
      });
    if (!cards.length) {
      host.appendChild(
        h(
          '<div class="fraglist__empty ys-body-lg">그 실마리는 아직 없어요.<br>다른 단어로 찾아볼까요.</div>'
        )
      );
      return;
    }
    if (!storeFilter) {
      host.appendChild(
        h(
          '<p class="section-lead ys-body">가볍게 담아둔 생각 ' +
            state.cards.length +
            "개. 정리하지 않아도 돼요.</p>"
        )
      );
    }
    var lastBucket = null;
    var gi = 0;
    cards.forEach(function (c) {
      var b = dayBucket(c.ts);
      if (b !== lastBucket) {
        lastBucket = b;
        host.appendChild(h('<div class="timeline-head">' + esc(b) + "</div>"));
      }
      var grid = host.lastElementChild;
      if (!grid || !grid.classList || !grid.classList.contains("card-grid")) {
        grid = h('<div class="card-grid"></div>');
        host.appendChild(grid);
      }
      grid.appendChild(miniCard(c, gi++));
    });
  }

  /* 연결 — 성좌 시각화 + 반복 주제 클러스터. */
  VIEWS.connect = function () {
    var v = h('<section class="view"></section>');
    var top = h('<header class="topbar"></header>');
    top.appendChild(h(viewTitle("연결")));
    top.appendChild(h('<div class="topbar__spacer"></div>'));
    var refresh = h(
      '<button class="ys-icon-btn topbar__round" type="button" aria-label="연결 다시 찾기">' +
        icon("rotate-cw", 20) +
        "</button>"
    );
    refresh.addEventListener("click", function () {
      connDirtyBump();
      go("connect");
    });
    top.appendChild(refresh);
    v.appendChild(top);

    var scroll = h('<div class="view__scroll" id="connscroll"></div>');
    v.appendChild(scroll);

    setTimeout(function () {
      if (state.cards.length < 2) {
        scroll.appendChild(
          emptyState(
            "생각이 이어지는 곳",
            "카드가 몇 개 쌓이면, 흩어진 생각들이 어떻게 이어지는지 여기서 보여줄게요.",
            { demo: false }
          )
        );
        return;
      }
      // 로컬 결과를 즉시(낙관적) 보여주고, AI가 오면 교체
      var local = WEAVE.localConnect(state.cards);
      renderClusters(scroll, local, state.connDirty);
      // 권위 있는(AI) 결과가 도착하면 refreshConnections가 이 훅을 부른다.
      // 살아있는 #connscroll을 다시 조회해, 진행 중 새로고침 창에서 열려도 최종값이 반영된다.
      connApply = function () {
        if (current !== "connect") return;
        var sc = document.getElementById("connscroll");
        if (sc) renderClusters(sc, state.connections, false);
      };
      if (state.connDirty) refreshConnections();
      else connApply();
    }, 0);
    return v;
  };

  function renderClusters(scroll, data, loading) {
    scroll.innerHTML = "";
    var clusters = (data && data.clusters) || [];
    if (!clusters.length) {
      if (loading) {
        scroll.appendChild(loadingBlock("흩어진 생각을 이어보는 중이에요"));
        return;
      }
      scroll.appendChild(
        emptyState(
          "아직 뚜렷한 연결은 안 보여요",
          "더 쏟을수록 이어질 실이 많아져요. 억지로 잇지 않을게요 — 결론은 늘 당신이 내려요.",
          { demo: false }
        )
      );
      return;
    }
    if (loading)
      scroll.appendChild(
        h('<div class="conn-status ys-caption">방금 본 연결이에요 · 더 또렷하게 잇는 중…</div>')
      );

    // 성좌(constellation) 개요
    var svg = buildConstellation(clusters);
    if (svg) {
      var cwrap = h('<div class="constellation"></div>');
      cwrap.innerHTML = svg;
      scroll.appendChild(cwrap);
      // 노드 클릭 위임
      cwrap.querySelectorAll("[data-node-card]").forEach(function (n) {
        n.addEventListener("click", function () {
          go("card", { id: n.getAttribute("data-node-card") });
        });
      });
    }

    scroll.appendChild(
      h(
        '<p class="section-lead ys-body">서로 떨어져 있던 생각이 이렇게 이어져요.</p>'
      )
    );
    clusters.forEach(function (cl, ci) {
      var group = h('<div class="cluster"></div>');
      group.style.setProperty("--i", ci);
      group.setAttribute("data-cluster", ci);
      group.appendChild(
        h('<h2 class="cluster__label">' + esc(cl.label) + "</h2>")
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
          "<b>" + esc(c.keyword || "") + "</b>" + esc(c.topic || c.raw);
        chip.addEventListener("click", function () {
          go("card", { id: c.id });
        });
        chips.appendChild(chip);
      });
      group.appendChild(chips);
      var cont = h(
        '<button class="ys-btn ys-btn--secondary cluster__more" type="button">이 흐름 이어서 쏟기</button>'
      );
      cont.addEventListener("click", function () {
        startVoiceFlow({ topic: cl.label, keyword: "" });
      });
      group.appendChild(cont);
      scroll.appendChild(group);
    });
  }

  /** 클러스터 → 콤팩트 성좌 SVG. 허브(라벨) + 카드 점, 얇은 곡선 연결. */
  function buildConstellation(clusters) {
    var cs = clusters.slice(0, 3);
    if (!cs.length) return "";
    var W = 340,
      pad = 26;
    var n = cs.length;
    var colW = (W - pad * 2) / n;
    var rows = cs.map(function (cl) {
      return Math.min((cl.cardIds || []).length, 5);
    });
    var maxRow = Math.max.apply(null, rows.concat([1]));
    var H = 70 + maxRow * 26;
    var hubY = 40;
    var parts = [];
    cs.forEach(function (cl, i) {
      var hx = pad + colW * i + colW / 2;
      var ids = (cl.cardIds || []).slice(0, 5);
      // 링크 + 카드 점
      ids.forEach(function (id, j) {
        var c = cardById(id);
        var cy = hubY + 34 + j * 26;
        var cx = hx + (j % 2 === 0 ? -1 : 1) * (10 + (j % 3) * 6);
        parts.push(
          '<path class="cst-link" d="M' +
            hx +
            "," +
            hubY +
            " C" +
            hx +
            "," +
            (hubY + 18) +
            " " +
            cx +
            "," +
            (cy - 14) +
            " " +
            cx +
            "," +
            cy +
            '" />'
        );
        parts.push(
          '<circle class="cst-dot" data-node-card="' +
            esc(id) +
            '" cx="' +
            cx +
            '" cy="' +
            cy +
            '" r="5"><title>' +
            esc((c && (c.keyword || c.topic || c.raw)) || "생각") +
            "</title></circle>"
        );
      });
      // 허브
      parts.push('<circle class="cst-hub" cx="' + hx + '" cy="' + hubY + '" r="9"/>');
      var lbl = (cl.label || "").replace(/[‘’']/g, "").slice(0, 8);
      parts.push(
        '<text class="cst-label" x="' +
          hx +
          '" y="' +
          (hubY - 15) +
          '" text-anchor="middle">' +
          esc(lbl) +
          "</text>"
      );
    });
    return (
      '<svg viewBox="0 0 ' +
      W +
      " " +
      H +
      '" width="100%" role="img" aria-label="생각 연결 성좌 개요">' +
      parts.join("") +
      "</svg>"
    );
  }

  function loadingBlock(msg) {
    var w = h('<div class="conn-loading" role="status" aria-live="polite"></div>');
    w.innerHTML =
      '<div class="weaving__glyph">' +
      icon("git-merge", 44) +
      "</div><div class='ys-body'>" +
      esc(msg) +
      "</div>";
    return w;
  }

  /* 카드 상세 — 원문(편집) + 연결 + 이어서 쏟기. */
  VIEWS.card = function (opts) {
    var c = cardById(opts.id);
    if (!c) return VIEWS.store();
    var v = h('<section class="view"></section>');
    v.appendChild(
      topbar("담긴 생각", function () {
        go(opts.from === "connect" ? "connect" : "store");
      })
    );
    var scroll = h('<div class="view__scroll"></div>');

    var head = h('<div class="card-detail__head"></div>');
    head.innerHTML =
      (c.keyword
        ? '<span class="card-detail__kw">' + esc(c.keyword) + "</span>"
        : "") +
      '<span class="card-detail__time">' +
      fmtTime(c.ts) +
      "</span>";
    scroll.appendChild(head);

    if (c.topic)
      scroll.appendChild(
        h('<h1 class="card-detail__topic" data-vtitle tabindex="-1">' + esc(c.topic) + "</h1>")
      );
    else scroll.appendChild(h('<span data-vtitle tabindex="-1" class="sr-only">담긴 생각</span>'));

    // 원문 인라인 편집(자동 반영, 저장버튼 없음)
    var raw = h(
      '<div class="card-detail__raw" contenteditable="true" role="textbox" aria-label="원문 편집" spellcheck="false"></div>'
    );
    raw.textContent = c.raw;
    raw.addEventListener("blur", function () {
      var nt = raw.textContent.trim();
      if (nt && nt !== c.raw) {
        c.raw = nt;
        c.keyword = "";
        c.topic = "";
        c.by = "";
        connDirtyBump();
        persist();
        distillCards([c]);
        toast("고쳐서 다시 담았어요");
      } else if (!nt) {
        raw.textContent = c.raw; // 빈 편집은 되돌림
      }
    });
    scroll.appendChild(raw);

    var related = (state.connections.clusters || []).filter(function (cl) {
      return (cl.cardIds || []).indexOf(c.id) !== -1;
    });
    if (related.length) {
      scroll.appendChild(
        h('<h2 class="card-detail__rel-label">이 생각과 이어진 흐름</h2>')
      );
      related.forEach(function (cl) {
        var r = h(
          '<button class="cluster-chip cluster-chip--wide" type="button"></button>'
        );
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
      startVoiceFlow({ topic: c.topic || c.raw, keyword: c.keyword });
    });
    var del = h(
      '<button class="ys-btn ys-btn--ghost" type="button">지우기</button>'
    );
    del.addEventListener("click", function () {
      var removed = c;
      var idx = state.cards.indexOf(c);
      removeCard(c.id);
      go("store");
      toast("지웠어요", {
        actionLabel: "되돌리기",
        duration: 5000,
        onAction: function () {
          if (idx < 0) idx = state.cards.length;
          state.cards.splice(Math.min(idx, state.cards.length), 0, removed);
          connDirtyBump();
          persist();
          go("store");
        },
      });
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
    top.appendChild(h(viewTitle("설정")));
    v.appendChild(top);
    var scroll = h('<div class="view__scroll"></div>');

    // 감각
    var g1 = h('<div class="settings-group"><h2>감각</h2></div>');
    g1.appendChild(
      switchRow("모션 줄이기", "전환·움직임을 최소화해요.", state.settings.reducedMotion, function (on) {
        state.settings.reducedMotion = on;
        applyMotionSetting();
        persist();
      })
    );
    // 테마 세그먼트
    var themeRow = h(
      '<div class="settings-row"><div class="settings-row__label"><b>테마</b><span>밝게·어둡게·시스템 따라.</span></div></div>'
    );
    var seg = h('<div class="seg" role="group" aria-label="테마"></div>');
    [
      { k: "system", t: "시스템" },
      { k: "light", t: "밝게" },
      { k: "dark", t: "어둡게" },
    ].forEach(function (o) {
      var b = h(
        '<button class="seg__btn" type="button">' + o.t + "</button>"
      );
      if (state.settings.theme === o.k) b.setAttribute("aria-pressed", "true");
      b.addEventListener("click", function () {
        state.settings.theme = o.k;
        applyTheme();
        persist();
        go("settings");
      });
      seg.appendChild(b);
    });
    themeRow.appendChild(seg);
    g1.appendChild(themeRow);
    scroll.appendChild(g1);

    // 경계
    var g2 = h('<div class="settings-group"><h2>Piko가 하지 않는 것</h2></div>');
    g2.appendChild(
      h(
        '<div class="boundary-note">Piko는 <b>일정·리마인드·투두·목표 추적</b>을 하지 않아요. ' +
          "빨간 배지도, 스트릭도, 독촉도 없어요.<br><br>과거 생각을 다시 보여주는 건 " +
          "<b>독촉이 아니라</b>, 흩어진 생각을 다시 만나게 하려는 거예요. 결론은 늘 당신이 내려요.</div>"
      )
    );
    scroll.appendChild(g2);

    // 데이터
    var g3 = h('<div class="settings-group"><h2>데이터</h2></div>');
    var exp = h(
      '<button class="ys-btn ys-btn--secondary ys-btn--block" type="button">' +
        icon("download", 18) +
        "생각 내보내기 (.md)</button>"
    );
    exp.addEventListener("click", exportMarkdown);
    g3.appendChild(exp);
    var clr = h(
      '<button class="ys-btn ys-btn--ghost ys-btn--block" type="button" style="margin-top:8px">모든 생각 비우기</button>'
    );
    clr.addEventListener("click", function () {
      var snap = snapshot();
      state.cards = [];
      state.connections = { clusters: [], resurface: [], source: "ai" };
      state.dismissed = {};
      connDirtyBump();
      persist();
      go("settings");
      toast("비웠어요", {
        actionLabel: "되돌리기",
        duration: 5000,
        onAction: function () {
          restore(snap);
          go("store");
        },
      });
    });
    g3.appendChild(clr);
    var reseed = h(
      '<button class="ys-btn ys-btn--ghost ys-btn--block" type="button" style="margin-top:8px">예시 생각 불러오기 (데모용)</button>'
    );
    reseed.addEventListener("click", function () {
      state.cards = [];
      state.dismissed = {};
      seedExamples();
      toast("예시를 넣었어요");
      go("store");
      distillPending(function () {
        refreshConnections();
      });
    });
    g3.appendChild(reseed);
    scroll.appendChild(g3);

    scroll.appendChild(
      h(
        '<p class="ys-caption" style="text-align:center;margin-top:24px">Piko · v' +
          DS.version +
          "</p>"
      )
    );
    v.appendChild(scroll);
    return v;
  };

  function switchRow(title, sub, on, onToggle) {
    var row = h(
      '<div class="settings-row"><div class="settings-row__label"><b>' +
        esc(title) +
        "</b><span>" +
        esc(sub) +
        "</span></div></div>"
    );
    var sw = h(
      '<button class="switch" type="button" role="switch" aria-label="' +
        esc(title) +
        '"></button>'
    );
    sw.setAttribute("aria-checked", on ? "true" : "false");
    sw.addEventListener("click", function () {
      on = !on;
      sw.setAttribute("aria-checked", on ? "true" : "false");
      onToggle(on);
    });
    row.appendChild(sw);
    return row;
  }

  /* ── 공통 빈 상태(밀도 있는) ─────────────────── */
  function emptyState(title, body, opts) {
    opts = opts || {};
    var w = h('<div class="empty-state"></div>');
    w.innerHTML =
      '<div class="empty-state__mascot">' +
      DS.mascot +
      "</div>" +
      '<div class="empty-state__title">' +
      esc(title) +
      "</div>" +
      '<p class="empty-state__body">' +
      esc(body) +
      "</p>";
    if (opts.demo) {
      var demo = h(
        '<button class="ys-btn ys-btn--ghost empty-state__demo" type="button">예시로 둘러보기</button>'
      );
      demo.addEventListener("click", function () {
        seedExamples();
        toast("예시를 넣었어요");
        go("store");
        distillPending(function () {
          refreshConnections();
        });
      });
      w.appendChild(demo);
    }
    return w;
  }

  /* ── 좌측 드로어(포커스 트랩) ─────────────────── */
  function openDrawer() {
    lastActive = document.activeElement;
    var overlay = h('<div class="drawer-overlay"></div>');
    var panel = h(
      '<aside class="drawer" role="dialog" aria-modal="true" aria-label="메뉴"></aside>'
    );

    var head = h('<div class="drawer__head"></div>');
    head.appendChild(h('<div class="wordmark">Pik<span>o</span></div>'));
    var close = h(
      '<button class="ys-icon-btn" type="button" aria-label="메뉴 닫기">' +
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

    var menu = h('<nav class="drawer__menu" aria-label="빠른 이동"></nav>');
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
        ic: "download",
        label: "생각 내보내기",
        sub: null,
        act: function () {
          exportMarkdown();
        },
      },
      {
        ic: "help-circle",
        label: "도움말",
        sub: null,
        act: function () {
          toast("쏟기만 해요. 보관·연결·다시 만나기는 Piko가 맡아요.");
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
      h('<div class="drawer__foot">Piko · v' + DS.version + "</div>")
    );

    overlay.appendChild(panel);
    overlay.addEventListener("mousedown", function (e) {
      if (e.target === overlay) shut();
    });
    app.appendChild(overlay);
    setInert(true);
    requestAnimationFrame(function () {
      overlay.classList.add("is-open");
      close.focus();
    });

    function onKey(e) {
      if (e.key === "Escape") {
        e.preventDefault();
        shut();
        return;
      }
      if (e.key === "Tab") {
        var f = panel.querySelectorAll(
          'button, [href], input, [tabindex]:not([tabindex="-1"])'
        );
        if (!f.length) return;
        var first = f[0],
          last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener("keydown", onKey);

    function shut() {
      document.removeEventListener("keydown", onKey);
      overlay.classList.remove("is-open");
      setInert(false);
      setTimeout(function () {
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        if (lastActive && lastActive.focus) lastActive.focus();
      }, 240);
    }
  }
  function setInert(on) {
    if (!viewhost) return;
    if (on) {
      viewhost.setAttribute("inert", "");
      viewhost.setAttribute("aria-hidden", "true");
    } else {
      viewhost.removeAttribute("inert");
      viewhost.removeAttribute("aria-hidden");
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
    bar.appendChild(
      h('<div class="topbar__title">' + esc(title) + "</div>")
    );
    bar.appendChild(h('<div class="topbar__spacer"></div>'));
    return bar;
  }

  /* ── 내보내기 ─────────────────────────────────── */
  function exportMarkdown() {
    if (!state.cards.length) {
      toast("내보낼 생각이 아직 없어요");
      return;
    }
    var lines = ["# Piko — 담은 생각\n"];
    state.cards
      .slice()
      .reverse()
      .forEach(function (c) {
        lines.push(
          "- " +
            fmtDate(c.ts) +
            (c.keyword ? " · **" + c.keyword + "**" : "") +
            (c.topic ? " · " + c.topic : "") +
            "\n  " +
            c.raw
        );
      });
    var cl = state.connections.clusters || [];
    if (cl.length) {
      lines.push("\n## 발견된 연결\n");
      cl.forEach(function (x) {
        lines.push("- **" + x.label + "** — " + (x.insight || ""));
      });
    }
    var md = lines.join("\n");
    try {
      var blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = "piko-생각.md";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () {
        URL.revokeObjectURL(url);
      }, 1000);
      toast("파일로 내보냈어요");
    } catch (e) {
      if (navigator.clipboard)
        navigator.clipboard.writeText(md).then(function () {
          toast("클립보드에 복사했어요");
        });
    }
  }

  /* ── 예시 데이터(데모용) ──────────────────────── */
  function seedExamples() {
    var now = Date.now();
    var seeds = [
      ["게임할 땐 몇 시간이고 집중하는데 공부는 10분도 못 앉아있어", 6],
      ["ADHD는 관심 있는 거엔 과몰입한대. 나도 딱 그런 듯", 6],
      ["아이디어는 계속 나오는데 하나도 끝을 못 봐", 5],
      ["할 일을 게임 퀘스트처럼 만들면 실행이 될까", 4],
      ["타이머 25분 켜고 하기, 이건 좀 먹혔음", 3],
      ["친구가 옆에 있으면 이상하게 집중이 잘돼", 3],
      ["ADHD 앱들은 죄다 할 일 관리라 죄책감만 들고 재미없어", 2],
      ["게임처럼 레벨업 되는 실행 도구 있으면 진짜 쓸 텐데", 1],
      ["요즘 계속 실행력 생각이 맴돌아", 0],
    ];
    state.cards = seeds.map(function (s, i) {
      return {
        id: "seed" + i,
        raw: s[0],
        keyword: "",
        topic: "",
        ts: now - s[1] * DAY - (seeds.length - i) * 1200000,
        by: "",
      };
    });
    connDirtyBump();
    persist();
  }

  /* ── 되돌리기 스냅샷 ──────────────────────────── */
  function snapshot() {
    return JSON.stringify({
      cards: state.cards,
      connections: state.connections,
      dismissed: state.dismissed,
    });
  }
  function restore(snap) {
    try {
      var s = JSON.parse(snap);
      state.cards = s.cards || [];
      state.connections = s.connections || {
        clusters: [],
        resurface: [],
        source: "ai",
      };
      state.dismissed = s.dismissed || {};
      connDirtyBump();
      persist();
    } catch (e) {}
  }

  /* ── 음성(webkitSpeechRecognition) ────────────── */
  var recog = null;
  var onInterim = null;
  function startVoice(interimCb) {
    onInterim = interimCb;
    voicePermBlocked = false;
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      // 미지원: 가짜 녹음 화면에 가두지 않는다
      go("capture");
      setTimeout(function () {
        var f = document.getElementById("pour");
        if (f) f.focus();
      }, 30);
      toast("이 브라우저는 음성을 못 들어요. 글로 쏟아봐요.");
      return;
    }
    launchRecog(SR);
  }
  function launchRecog(SR) {
    recog = new SR();
    recog.lang = "ko-KR";
    recog.continuous = true;
    recog.interimResults = true;
    recog.onresult = function (e) {
      // '그만' 이후 stop()이 비동기로 흘려보내는 최종 결과는 무시 — 멈춤 의도 존중, 유령 카드 방지
      if (voiceStopped) return;
      var interim = "";
      for (var i = e.resultIndex; i < e.results.length; i++) {
        var r = e.results[i];
        if (r.isFinal) {
          var text = (r[0].transcript || "").trim();
          if (text) {
            addCard(text, { defer: true }); // 배치 보관(그만 누를 때 flush)
            voiceSession.push(text);
          }
          if (onInterim) onInterim("");
        } else {
          interim += r[0].transcript;
        }
      }
      if (interim && onInterim) onInterim(interim);
    };
    recog.onerror = function (e) {
      var err = e && e.error;
      if (err === "not-allowed" || err === "service-not-allowed") {
        voicePermBlocked = true;
        voiceStopped = true;
        stopVoice();
        go("capture");
        setTimeout(function () {
          var f = document.getElementById("pour");
          if (f) f.focus();
        }, 30);
        toast("마이크 권한이 필요해요. 글로 쏟아봐요.");
      } else if (err !== "no-speech" && err !== "aborted") {
        toast("잘 안 들렸어요. 계속 말해도 돼요.");
      }
    };
    recog.onend = function () {
      // 무음으로 브라우저가 세션을 끊어도, 음성 화면에 머물면 자동 재시작
      if (current === "voice" && !voiceStopped && !voicePermBlocked) {
        try {
          recog.start();
        } catch (e) {
          setTimeout(function () {
            if (current === "voice" && !voiceStopped && !voicePermBlocked) {
              try {
                recog.start();
              } catch (e2) {}
            }
          }, 300);
        }
      }
    };
    try {
      recog.start();
    } catch (e) {}
  }
  function stopVoice() {
    if (recog) {
      try {
        recog.onend = null;
        recog.onresult = null; // stop() 이후 비동기 최종 결과가 유령 카드를 만들지 않도록 핸들러도 뗀다
        recog.stop();
      } catch (e) {}
    }
    recog = null;
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
  function fmtDate(ts) {
    var d = new Date(ts);
    return d.getFullYear() + "." + pad(d.getMonth() + 1) + "." + pad(d.getDate());
  }
  function applyMotionSetting() {
    document.documentElement.classList.toggle(
      "reduce-motion",
      state.settings.reducedMotion
    );
  }
  function applyTheme() {
    var t = state.settings.theme;
    if (t === "light" || t === "dark")
      document.documentElement.setAttribute("data-theme", t);
    else document.documentElement.removeAttribute("data-theme");
  }

  /* ── 부트 ─────────────────────────────────────── */
  load();
  applyMotionSetting();
  applyTheme();
  // 지속 셸: viewhost(교체됨) + 라이브리전(유지)
  app.innerHTML = "";
  viewhost = h('<div id="viewhost"></div>');
  liveRegion = h(
    '<div class="sr-only" role="status" aria-live="polite" aria-atomic="true"></div>'
  );
  app.appendChild(viewhost);
  app.appendChild(liveRegion);
  go("capture");
  // 부팅 후: 미보관 채우고 → 연결 계산 → 재노출 갱신
  setTimeout(function () {
    distillPending(function () {
      if (state.cards.length >= 2 && state.connDirty)
        refreshConnections(function () {
          if (current === "capture") renderResurface();
        });
    });
  }, 400);
})();
