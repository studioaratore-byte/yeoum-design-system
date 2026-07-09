/* ui_kits/yeoum-app/weave.js — 로컬 수렴(엮기) 엔진. 2단계.
 *
 *   1) extractSeeds(fragments)  — 폭주한 덤프에서 '씨앗'(핵심)을 줍는다.
 *   2) composeDoc(seeds, ...)   — 고른 씨앗을 '내 생각/AI 보강'이 섞인 글로 엮는다.
 *
 * 백엔드/LLM 없이 도는 목업. 사람=발산 / AI=수렴 보완 / 결과물=글·기획.
 * 실제 제품에선 이 두 함수를 LLM 호출로 교체한다.
 */
(function (global) {
  "use strict";

  var PLAN_HINTS = [
    "계획", "기획", "하자", "만들", "출시", "론칭", "런칭", "준비",
    "런치", "실행", "프로젝트", "일정", "로드맵", "전략", "제안", "도구",
  ];
  var STOP = /[.!?。…\n]+/;

  function firstClause(text, max) {
    var t = (text || "").trim().split(STOP)[0].trim();
    t = t.replace(/^(그리고|근데|그래서|그냥|아마|음|아|어)\s+/, "");
    max = max || 18;
    if (t.length > max) {
      var cut = t.slice(0, max);
      var sp = cut.lastIndexOf(" ");
      if (sp > 7) cut = cut.slice(0, sp);
      t = cut.trim() + "…";
    }
    return t.replace(/[,·\-\s]+$/, "");
  }

  function condense(text, max) {
    var t = (text || "").trim().replace(/\s+/g, " ");
    max = max || 64;
    if (t.length > max) t = t.slice(0, max - 1).trim() + "…";
    return t;
  }

  function looksLikePlan(list) {
    var joined = list.join(" ");
    return PLAN_HINTS.some(function (h) {
      return joined.indexOf(h) !== -1;
    });
  }

  /** 연속 조각을 parts개의 그룹으로 최대한 고르게 나눈다. */
  function chunk(arr, parts) {
    parts = Math.max(1, Math.min(parts, arr.length));
    var out = [];
    var size = Math.ceil(arr.length / parts);
    for (var i = 0; i < arr.length; i += size) {
      out.push(arr.slice(i, i + size));
    }
    return out;
  }

  // 씨앗 맥락 라벨 — 발산을 '증폭 가시화'하는 카피 장치.
  var LABELERS = [
    function (g, i) {
      return "이번 주 " + (g.length + 2) + "번 반복된 주제";
    },
    function (g, i) {
      return g.length + "개 조각이 하나로 모임";
    },
    function (g, i) {
      return 2 + i + "일 전 조각과 이어짐";
    },
  ];

  /**
   * @param {string[]} fragments
   * @returns {{id,label,title,body,sources}[]}
   */
  function extractSeeds(fragments) {
    fragments = (fragments || [])
      .map(function (f) {
        return (f || "").trim();
      })
      .filter(Boolean);
    if (!fragments.length) return [];

    var n = fragments.length;
    var seedCount = n <= 1 ? 1 : n <= 3 ? 2 : 3;
    var groups = chunk(fragments, seedCount);

    return groups.map(function (g, i) {
      // 대표(가장 긴) 조각을 제목 씨앗으로.
      var rep = g.slice().sort(function (a, b) {
        return b.length - a.length;
      })[0];
      return {
        id: "s" + i,
        label: LABELERS[i % LABELERS.length](g, i),
        title: firstClause(rep, 16),
        body: condense(g.join(" · "), 70),
        sources: g.slice(),
      };
    });
  }

  // AI 보강 문단 — 씨앗을 잇는 수렴 브릿지(결정적 템플릿, 자기완결형).
  var BRIDGES = [
    "정리하려는 순간 생각은 도망간다. 그래서 분류와 폴더 대신, 쏟아진 조각을 그대로 받아 자동으로 엮는 흐름이 필요하다.",
    "흩어져 있던 조각들은 결함이 아니라 방향이다. 조각이 많을수록 엮을 실이 많아진다.",
    "혼자선 0개였던 완성이, 쏟기만 하면 1개가 된다. 발산은 그대로 두고 수렴만 도구에 맡기면 된다.",
  ];

  /**
   * @param {object[]} seeds       고른 씨앗들
   * @param {string[]} fragments   전체 조각(카운트·본문용)
   * @param {string[]} [answers]   되물음 답
   * @returns {object} draft
   */
  function composeDoc(seeds, fragments, answers) {
    seeds = seeds || [];
    fragments = (fragments || []).filter(Boolean);
    answers = (answers || []).filter(Boolean);

    var isPlan = looksLikePlan(
      fragments.concat(answers).concat(
        seeds.map(function (s) {
          return s.title;
        })
      )
    );

    var paras = [];
    seeds.forEach(function (s, i) {
      // 내 생각 — 사용자의 실제 조각을 이어 붙인 문단.
      paras.push({ who: "me", text: cleanJoin(s.sources) });
      // AI 보강 — 수렴 브릿지 한 문단.
      paras.push({ who: "ai", text: BRIDGES[i % BRIDGES.length] });
    });
    if (answers.length) {
      paras.push({ who: "me", text: cleanJoin(answers) });
    }

    var title = seeds.length ? seeds[0].title.replace(/…$/, "") : "생각 조각";

    var draft = {
      kind: "초안",
      title: title,
      paras: paras,
      fragmentCount: fragments.length,
      seedCount: seeds.length,
      createdAt: Date.now(),
      steps: null,
      reask: pickReask(paras, isPlan),
    };

    if (isPlan) {
      draft.steps = [
        "가장 마음이 가는 씨앗 하나를 골라 오늘 30분만 써봐요.",
        "그 결과를 다음날 다시 열어 한 번 더 엮어요.",
        "충분하다 싶으면 내보내서 원하는 곳에 붙여넣어요.",
      ];
    }
    return draft;
  }

  function cleanJoin(list) {
    return list
      .map(function (t) {
        return t.trim().replace(/[·\s]+$/, "");
      })
      .join(". ")
      .replace(/\.\.+/g, ".");
  }

  // 되물음 — AI 보강 문단 중 하나를 '근거 약한 곳'으로 지목.
  function pickReask(paras, isPlan) {
    var ai = paras.filter(function (p) {
      return p.who === "ai";
    });
    if (!ai.length) {
      return {
        weak: "",
        text: "이 글에서 제일 하고 싶었던 말은 뭐였어요? 한 줄만 더 쏟아줄래요?",
      };
    }
    var target = ai[0];
    var phrase = firstClause(target.text, 20);
    return {
      weak: phrase,
      text:
        "‘" +
        phrase +
        "’ 이 부분, 왜 기존 방식으론 안 됐는지 근거가 좀 약해요. 30초만 더 쏟아줄래요?",
    };
  }

  global.YeoumWeave = {
    extractSeeds: extractSeeds,
    composeDoc: composeDoc,
  };
})(typeof window !== "undefined" ? window : this);
