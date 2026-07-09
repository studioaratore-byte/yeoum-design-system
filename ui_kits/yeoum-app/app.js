/* ui_kits/yeoum-app/app.js — 엮음 앱 컨트롤러.
 *
 * 흐름: 쏟기 → 엮기 → 결과물 → 되물음.
 * 탭: 홈 · 보관함 · 설정 (지도 없음 — 경계선 §8).
 * 설계 헌법 R1~R10을 코드에서 지킨다:
 *   R1 홈이 곧 입력 · R3 입력 중 강제 0(자동저장) · R5 언제든 중단(확인 모달 없음)
 *   R7 독촉 없음(배지·스트릭·연체 없음) · R8 화면당 primary 1개.
 */
(function () {
  "use strict";

  var DS = window.YeoumDesignSystem;
  var WEAVE = window.YeoumWeave;
  var icon = DS.icon;
  var STORE_KEY = "yeoum:v1";

  /* ── 상태 ─────────────────────────────────────── */
  var state = {
    fragments: [], // 현재 세션 조각(문자열)
    answers: [], // 되물음 답
    draft: null, // 현재 결과물
    archive: [], // 보관된 결과물
    settings: { reducedMotion: false },
  };

  function load() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        var saved = JSON.parse(raw);
        state.archive = saved.archive || [];
        state.settings = saved.settings || state.settings;
      }
    } catch (e) {
      /* 저장 실패는 조용히 무시 — 앱은 계속 동작(R5 정신) */
    }
  }
  function persist() {
    try {
      localStorage.setItem(
        STORE_KEY,
        JSON.stringify({ archive: state.archive, settings: state.settings })
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
    // reflow → transition
    void t.offsetWidth;
    t.classList.add("is-show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      t.classList.remove("is-show");
    }, 2000);
  }

  /* ── 라우터 ───────────────────────────────────── */
  var TABS = { home: true, archive: true, settings: true };
  var current = "home";

  function go(view, opts) {
    current = view;
    render(view, opts || {});
  }

  function render(view, opts) {
    app.innerHTML = "";
    var node = VIEWS[view](opts);
    var wrap = h('<div class="view is-entering"></div>');
    wrap.appendChild(node);

    // 하단 탭바 — 최상위 탭에서만 노출
    if (TABS[view]) wrap.appendChild(tabbar(view));

    app.appendChild(wrap);
    // 진입 애니메이션 클래스 정리
    requestAnimationFrame(function () {
      setTimeout(function () {
        wrap.classList.remove("is-entering");
      }, 260);
    });
  }

  function tabbar(active) {
    var items = [
      { id: "home", label: "홈", ic: "home" },
      { id: "archive", label: "보관함", ic: "archive" },
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

  /* ── 조각 조작 ────────────────────────────────── */
  function addFragment(text) {
    text = (text || "").trim();
    if (!text) return;
    state.fragments.push(text);
    updateWeaveBar();
    renderFragList();
  }
  function removeFragment(i) {
    state.fragments.splice(i, 1);
    updateWeaveBar();
    renderFragList();
  }

  /* ── 뷰들 ─────────────────────────────────────── */
  var VIEWS = {};

  /* 홈 — 0탭 캡처. 큰 마이크가 지배 요소(R1·R2). */
  VIEWS.home = function () {
    var v = h('<section class="view"></section>');

    var top = h('<header class="topbar"></header>');
    top.appendChild(
      h('<div class="wordmark">엮<span>음</span></div>')
    );
    v.appendChild(top);

    var home = h('<div class="home"></div>');
    home.innerHTML =
      '<button class="ys-mic" id="homeMic" type="button" aria-label="쏟기 — 음성으로 시작">' +
      icon("mic", 40) +
      "</button>" +
      '<p class="ys-prompt-hint home__hint" id="homeHint"></p>';

    // 텍스트는 보조(R2)
    var textToggle = h(
      '<button class="ys-btn ys-btn--ghost home__text-toggle" type="button">글로 쏟기</button>'
    );
    home.appendChild(textToggle);
    v.appendChild(home);

    // 회전 힌트(R6)
    setTimeout(function () {
      var hintEl = v.querySelector("#homeHint");
      if (hintEl) DS.rotateHints(hintEl);
    }, 0);

    v.querySelector("#homeMic").addEventListener("click", function () {
      go("capture", { autostart: true });
    });
    textToggle.addEventListener("click", function () {
      go("capture", { autostart: false, focusText: true });
    });

    // 이어가던 조각이 있으면 살짝 알림(독촉 아님 — 정보만)
    if (state.fragments.length) {
      var cont = h(
        '<button class="ys-btn ys-btn--secondary" type="button">이어서 엮기 · 조각 ' +
          state.fragments.length +
          "개</button>"
      );
      cont.addEventListener("click", function () {
        go("capture", {});
      });
      home.appendChild(cont);
    }

    return v;
  };

  /* 캡처 — 쏟기. 조각 누적 + WeaveBar. */
  VIEWS.capture = function (opts) {
    var v = h('<section class="view"></section>');
    v.appendChild(
      topbar("쏟는 중", function () {
        go("home");
      })
    );

    var scroll = h('<div class="view__scroll view__scroll--flush"></div>');
    scroll.appendChild(h('<div class="fraglist" id="fraglist"></div>'));
    v.appendChild(scroll);

    // 입력 바 — 강제 라벨/저장 없음(R3)
    var input = h('<div class="capture-input"></div>');
    var row = h('<div class="capture-input__row"></div>');
    var field = h(
      '<textarea class="ys-field" id="pour" rows="1" ' +
        'placeholder="뭐든 쏟아. 정리는 나중에." aria-label="생각 쏟기"></textarea>'
    );
    var micBtn = h(
      '<button class="ys-icon-btn" id="voiceBtn" type="button" aria-label="음성으로 쏟기">' +
        icon("mic", 24) +
        "</button>"
    );
    var addBtn = h(
      '<button class="ys-icon-btn" id="addBtn" type="button" aria-label="조각 더하기">' +
        icon("check", 24) +
        "</button>"
    );
    row.appendChild(field);
    row.appendChild(micBtn);
    row.appendChild(addBtn);
    input.appendChild(row);
    v.appendChild(input);

    // WeaveBar(하단 고정)
    v.appendChild(weaveBar());

    // 자동 높이 + Enter로 조각 커밋(Shift+Enter 줄바꿈)
    field.addEventListener("input", function () {
      field.style.height = "auto";
      field.style.height = Math.min(field.scrollHeight, 160) + "px";
    });
    field.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        commitField();
      }
    });
    addBtn.addEventListener("click", commitField);
    function commitField() {
      addFragment(field.value);
      field.value = "";
      field.style.height = "auto";
      field.focus();
    }

    micBtn.addEventListener("click", function () {
      toggleVoice(micBtn, field);
    });

    setTimeout(function () {
      renderFragList();
      updateWeaveBar();
      if (opts.autostart) toggleVoice(micBtn, field);
      if (opts.focusText) field.focus();
    }, 0);

    return v;
  };

  function weaveBar() {
    var bar = h('<div class="ys-weavebar" id="weavebar"></div>');
    bar.innerHTML =
      '<div class="ys-weavebar__count"><span>조각</span><b id="wbCount">0</b><span>개</span></div>' +
      '<button class="ys-btn ys-btn--primary" id="weaveBtn" type="button" aria-disabled="true">엮기</button>';
    bar.querySelector("#weaveBtn").addEventListener("click", function () {
      if (!state.fragments.length) return;
      startWeaving();
    });
    return bar;
  }
  function updateWeaveBar() {
    var c = document.getElementById("wbCount");
    var b = document.getElementById("weaveBtn");
    if (c) c.textContent = state.fragments.length;
    if (b) {
      var on = state.fragments.length > 0;
      b.setAttribute("aria-disabled", on ? "false" : "true");
    }
  }
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
    state.fragments.forEach(function (f, i) {
      var card = h('<article class="ys-fragment"></article>');
      card.appendChild(
        h('<div class="ys-fragment__text">' + esc(f) + "</div>")
      );
      var rm = h(
        '<button class="ys-icon-btn ys-fragment__remove" type="button" aria-label="이 조각 빼기">' +
          icon("x", 20) +
          "</button>"
      );
      rm.addEventListener("click", function () {
        removeFragment(i);
      });
      card.appendChild(rm);
      list.appendChild(card);
    });
    list.lastElementChild.scrollIntoView({ block: "nearest" });
  }

  /* 엮는 중 — 수렴 로딩(전환). */
  function startWeaving() {
    go("weaving");
    var reduce = prefersReduced();
    setTimeout(
      function () {
        var draft = WEAVE.weave(state.fragments, state.answers);
        state.draft = draft;
        archiveDraft(draft);
        go("result", { fresh: true });
      },
      reduce ? 200 : 1400
    );
  }

  VIEWS.weaving = function () {
    var v = h('<section class="view"></section>');
    var w = h('<div class="weaving"></div>');
    w.innerHTML =
      '<div class="weaving__glyph">' +
      icon("git-merge", 56) +
      "</div>" +
      '<div class="ys-title">엮는 중이에요</div>' +
      '<div class="weaving__count ys-body-lg">조각 ' +
      state.fragments.length +
      "개를 모으고 있어요…</div>";
    v.appendChild(w);
    return v;
  };

  /* 결과물 — Before/After 증폭. */
  VIEWS.result = function (opts) {
    var d = opts.draft || state.draft;
    if (!d) {
      return VIEWS.home();
    }
    var v = h('<section class="view"></section>');
    v.appendChild(
      topbar("결과물", function () {
        go(opts.fromArchive ? "archive" : "home");
      })
    );

    var scroll = h('<div class="view__scroll view__scroll--flush"></div>');

    // 증폭 카운터 — "조각 N개 → 결과물"
    scroll.appendChild(
      h(
        '<div class="result__amplify"><div class="ys-amplify">' +
          "<span>조각</span> <b>" +
          d.fragmentCount +
          "개</b> " +
          icon("arrow-right", 18) +
          " <span>이 " +
          (d.kind === "기획 초안" ? "기획" : "글") +
          "이 됐어요</span></div></div>"
      )
    );

    // 문서
    var doc = h('<article class="result__doc"></article>');
    var html =
      '<span class="result__kind">' +
      esc(d.kind) +
      "</span>" +
      '<h2 class="result__title">' +
      esc(d.title) +
      "</h2>" +
      "<p>" +
      esc(d.intro) +
      "</p>";

    if (d.seeds && d.seeds.length) {
      html += "<h3>핵심 씨앗</h3><ul>";
      d.seeds.forEach(function (s) {
        html += "<li>" + esc(s) + "</li>";
      });
      html += "</ul>";
    }
    html += "<h3>초안</h3><p>" + esc(d.body) + "</p>";
    doc.innerHTML = html;

    if (d.steps && d.steps.length) {
      var steps = h('<div class="result__steps"></div>');
      var sh = "<h3>실행 3단계</h3><ol>";
      d.steps.forEach(function (s) {
        sh += "<li>" + esc(s) + "</li>";
      });
      sh += "</ol>";
      steps.innerHTML = sh;
      doc.appendChild(steps);
    }
    scroll.appendChild(doc);
    v.appendChild(scroll);

    // 액션 — primary 1개(R8): 복사. 나머지는 secondary/ghost.
    var actions = h('<div class="result__actions"></div>');
    var copyBtn = h(
      '<button class="ys-btn ys-btn--primary" type="button">복사</button>'
    );
    var shareBtn = h(
      '<button class="ys-btn ys-btn--secondary" type="button">공유</button>'
    );
    var reweaveBtn = h(
      '<button class="ys-btn ys-btn--ghost" type="button">다시 엮기</button>'
    );
    copyBtn.addEventListener("click", function () {
      copyDraft(d);
    });
    shareBtn.addEventListener("click", function () {
      shareDraft(d);
    });
    reweaveBtn.addEventListener("click", function () {
      state.draft = d;
      go("reask");
    });
    actions.appendChild(copyBtn);
    actions.appendChild(shareBtn);
    actions.appendChild(reweaveBtn);
    v.appendChild(actions);

    if (opts.fresh) setTimeout(function () {
      toast("조각 " + d.fragmentCount + "개 → 결과물이 됐어요");
    }, 400);

    return v;
  };

  /* 되물음 — 부드러운 후속 질문 하나. */
  VIEWS.reask = function () {
    var d = state.draft;
    var q = WEAVE.nextQuestion(d);
    var v = h('<section class="view"></section>');
    v.appendChild(
      topbar("되물음", function () {
        go("result");
      })
    );
    var box = h('<div class="reask"></div>');
    box.appendChild(
      h('<div class="ys-caption">한 가지만 더 물어볼게요</div>')
    );
    box.appendChild(h('<div class="reask__q">' + esc(q) + "</div>"));
    var field = h(
      '<textarea class="ys-field" id="answer" rows="3" placeholder="떠오른 대로, 안 써도 괜찮아요." aria-label="되물음 답"></textarea>'
    );
    box.appendChild(field);

    var primary = h(
      '<button class="ys-btn ys-btn--primary ys-btn--block" type="button">다시 엮기</button>'
    );
    var skip = h(
      '<button class="ys-btn ys-btn--ghost ys-btn--block" type="button">그냥 둘래요</button>'
    );
    primary.addEventListener("click", function () {
      if (field.value.trim()) state.answers.push(field.value.trim());
      startWeaving();
    });
    skip.addEventListener("click", function () {
      go("result");
    });
    box.appendChild(primary);
    box.appendChild(skip);
    v.appendChild(box);
    setTimeout(function () {
      field.focus();
    }, 0);
    return v;
  };

  /* 보관함 — 배지·독촉 없음(R7). 그냥 모아둔 결과물. */
  VIEWS.archive = function () {
    var v = h('<section class="view"></section>');
    var top = h('<header class="topbar"></header>');
    top.appendChild(h('<div class="topbar__title">보관함</div>'));
    v.appendChild(top);

    var scroll = h('<div class="view__scroll"></div>');
    if (!state.archive.length) {
      scroll.appendChild(
        h(
          '<div class="fraglist__empty ys-body-lg">아직 엮은 결과물이 없어요.<br>홈에서 뭐든 쏟아봐요.</div>'
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
      state.archive.forEach(function (d, i) {
        var item = h('<button class="archive-item" type="button"></button>');
        item.innerHTML =
          '<div class="archive-item__title">' +
          esc(d.title) +
          "</div>" +
          '<div class="archive-item__meta">' +
          esc(d.kind) +
          " · 조각 " +
          d.fragmentCount +
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

  /* 설정 — 감각 차분 · 접근성. */
  VIEWS.settings = function () {
    var v = h('<section class="view"></section>');
    var top = h('<header class="topbar"></header>');
    top.appendChild(h('<div class="topbar__title">설정</div>'));
    v.appendChild(top);

    var scroll = h('<div class="view__scroll"></div>');

    // 접근성
    var g1 = h('<div class="settings-group"><h2>감각</h2></div>');
    var row = h(
      '<div class="settings-row">' +
        '<div class="settings-row__label"><b>모션 줄이기</b>' +
        "<span>전환·움직임을 최소화해요.</span></div></div>"
    );
    var sw = h(
      '<button class="switch" type="button" role="switch" aria-label="모션 줄이기"></button>'
    );
    sw.setAttribute(
      "aria-checked",
      state.settings.reducedMotion ? "true" : "false"
    );
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

    // 엮음이 하지 않는 것 — 경계선 §8
    var g2 = h('<div class="settings-group"><h2>엮음이 하지 않는 것</h2></div>');
    g2.appendChild(
      h(
        '<div class="boundary-note">' +
          "엮음은 <b>일정·리마인드·투두·목표 추적</b>을 하지 않아요. " +
          "빨간 배지도, 스트릭도, 연체도 없어요.<br><br>" +
          "엮음은 당신의 <b>하루</b>가 아니라 <b>결과물</b>을 쪼개요. " +
          "깊이는 기능 수가 아니라 변환의 질로.</div>"
      )
    );
    scroll.appendChild(g2);

    // 데이터
    var g3 = h('<div class="settings-group"><h2>데이터</h2></div>');
    var clr = h(
      '<button class="ys-btn ys-btn--secondary ys-btn--block" type="button">보관함 비우기</button>'
    );
    clr.addEventListener("click", function () {
      // R5 정신 — 확인 모달 최소화하되, 파괴적 동작이라 한 번만 되묻음
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

  /* ── 결과물 저장/내보내기 ─────────────────────── */
  function archiveDraft(d) {
    // 같은 세션의 재엮기는 최신본으로 교체(맨 앞 항목이 현재 세션이면 갱신)
    if (state._sessionArchiveId != null) {
      var idx = state.archive.findIndex(function (x) {
        return x._id === state._sessionArchiveId;
      });
      if (idx !== -1) {
        d._id = state._sessionArchiveId;
        state.archive[idx] = d;
        persist();
        return;
      }
    }
    d._id = "d" + d.createdAt;
    state._sessionArchiveId = d._id;
    state.archive.unshift(d);
    persist();
  }

  function draftToText(d) {
    var lines = [d.title, "", d.intro, ""];
    if (d.seeds && d.seeds.length) {
      lines.push("[핵심 씨앗]");
      d.seeds.forEach(function (s) {
        lines.push("· " + s);
      });
      lines.push("");
    }
    lines.push(d.body);
    if (d.steps && d.steps.length) {
      lines.push("", "[실행 3단계]");
      d.steps.forEach(function (s, i) {
        lines.push(i + 1 + ". " + s);
      });
    }
    return lines.join("\n");
  }

  function copyDraft(d) {
    var text = draftToText(d);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        function () {
          toast("복사했어요");
        },
        function () {
          fallbackCopy(text);
        }
      );
    } else {
      fallbackCopy(text);
    }
  }
  function fallbackCopy(text) {
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
  function shareDraft(d) {
    var text = draftToText(d);
    if (navigator.share) {
      navigator.share({ title: d.title, text: text }).catch(function () {});
    } else {
      copyDraft(d);
    }
  }

  /* ── 음성(webkitSpeechRecognition) — 없으면 텍스트로. ── */
  var recog = null;
  var recActive = false;
  function toggleVoice(btn, field) {
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      // 음성 미지원 — 조용히 텍스트로 유도(음성 인식 오류 문구 금지)
      toast("이 브라우저는 음성을 못 들어요. 글로 쏟아봐요.");
      field.focus();
      return;
    }
    if (recActive) {
      stopVoice(btn);
      return;
    }
    recog = new SR();
    recog.lang = "ko-KR";
    recog.continuous = true;
    recog.interimResults = true;
    var interim = "";
    recog.onresult = function (e) {
      interim = "";
      for (var i = e.resultIndex; i < e.results.length; i++) {
        var r = e.results[i];
        if (r.isFinal) {
          addFragment(r[0].transcript);
        } else {
          interim += r[0].transcript;
        }
      }
      field.value = interim;
    };
    recog.onerror = function () {
      // 비난 없는 회복 문구
      toast("잘 안 들렸어요. 한 번 더?");
      stopVoice(btn);
    };
    recog.onend = function () {
      recActive = false;
      btn.classList.remove("is-active");
      var mic = document.getElementById("homeMic");
    };
    try {
      recog.start();
      recActive = true;
      btn.classList.add("is-active");
      btn.setAttribute("aria-label", "그만 듣기");
    } catch (e) {
      toast("잘 안 들렸어요. 글로 쏟아봐요.");
    }
  }
  function stopVoice(btn) {
    if (recog) {
      try {
        recog.stop();
      } catch (e) {}
    }
    recActive = false;
    if (btn) {
      btn.classList.remove("is-active");
      btn.setAttribute("aria-label", "음성으로 쏟기");
    }
  }

  /* ── 유틸 ─────────────────────────────────────── */
  function fmtDate(ts) {
    var d = new Date(ts);
    var mm = ("0" + (d.getMonth() + 1)).slice(-2);
    var dd = ("0" + d.getDate()).slice(-2);
    return d.getFullYear() + "." + mm + "." + dd;
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
  go("home");
})();
