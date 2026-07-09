/* ui_kits/yeoum-app/weave.js — 수렴(엮기) 엔진. 2단계, 비동기.
 *
 *   1) extractSeeds(fragments)          → 씨앗 추출
 *   2) composeDoc(seeds, fragments, ...) → '내 생각/AI 보강' 문서
 *
 * 우선 Vercel 백엔드(/api/weave)의 실제 Claude를 호출하고,
 * 실패하면(키 없음·네트워크·오프라인) 로컬 목업으로 조용히 폴백한다.
 * 백엔드 주소는 window.YEOUM_API_BASE 로 바꿀 수 있다(기본: 같은 오리진).
 */
(function (global) {
  "use strict";

  var API_BASE =
    (typeof global !== "undefined" && global.YEOUM_API_BASE) || "";

  function apiCall(payload) {
    return fetch(API_BASE + "/api/weave", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).then(function (res) {
      if (!res.ok) throw new Error("api " + res.status);
      return res.json();
    });
  }

  /* ── 로컬 목업(폴백) ───────────────────────────── */
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
  function chunk(arr, parts) {
    parts = Math.max(1, Math.min(parts, arr.length));
    var out = [];
    var size = Math.ceil(arr.length / parts);
    for (var i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
  }
  var LABELERS = [
    function (g) {
      return "이번 주 " + (g.length + 2) + "번 반복된 주제";
    },
    function (g) {
      return g.length + "개 조각이 하나로 모임";
    },
    function (g, i) {
      return 2 + i + "일 전 조각과 이어짐";
    },
  ];
  var BRIDGES = [
    "정리하려는 순간 생각은 도망간다. 그래서 분류와 폴더 대신, 쏟아진 조각을 그대로 받아 자동으로 엮는 흐름이 필요하다.",
    "흩어져 있던 조각들은 결함이 아니라 방향이다. 조각이 많을수록 엮을 실이 많아진다.",
    "혼자선 0개였던 완성이, 쏟기만 하면 1개가 된다. 발산은 그대로 두고 수렴만 도구에 맡기면 된다.",
  ];

  function localExtractSeeds(fragments) {
    if (!fragments.length) return [];
    var n = fragments.length;
    var seedCount = n <= 1 ? 1 : n <= 3 ? 2 : 3;
    var groups = chunk(fragments, seedCount);
    return groups.map(function (g, i) {
      var rep = g.slice().sort(function (a, b) {
        return b.length - a.length;
      })[0];
      return {
        id: "s" + i,
        label: LABELERS[i % LABELERS.length](g, i),
        title: firstClause(rep, 16),
        body: condense(rep, 72),
        sources: g.slice(),
      };
    });
  }
  function cleanJoin(list) {
    return list
      .map(function (t) {
        // 조각 끝의 이음표·공백 정리 후, 문장으로 끝맺음
        t = (t || "").trim().replace(/[·,\-\s]+$/, "");
        if (t && !/[.!?…]$/.test(t)) t += ".";
        return t;
      })
      .filter(Boolean)
      .join(" ") // 각 조각이 이미 마침표로 끝나므로 공백으로만 이음(뚝뚝 끊김 방지)
      .replace(/\s{2,}/g, " ");
  }
  function localPickReask(paras) {
    var ai = paras.filter(function (p) {
      return p.who === "ai";
    });
    if (!ai.length)
      return { text: "이 글에서 제일 하고 싶었던 말은 뭐였어요? 한 줄만 더 쏟아줄래요?" };
    var phrase = firstClause(ai[0].text, 20);
    return {
      text:
        "‘" +
        phrase +
        "’ 이 부분, 왜 기존 방식으론 안 됐는지 근거가 좀 약해요. 30초만 더 쏟아줄래요?",
    };
  }
  function localComposeDoc(seeds, fragments, answers) {
    seeds = seeds || [];
    fragments = (fragments || []).filter(Boolean);
    answers = (answers || []).filter(Boolean);
    var isPlan = looksLikePlan(
      fragments.concat(answers).concat(
        seeds.map(function (s) {
          return s.title || "";
        })
      )
    );
    var paras = [];
    seeds.forEach(function (s, i) {
      var mine =
        s.sources && s.sources.length ? cleanJoin(s.sources) : s.body || s.title;
      paras.push({ who: "me", text: mine });
      paras.push({ who: "ai", text: BRIDGES[i % BRIDGES.length] });
    });
    if (answers.length) paras.push({ who: "me", text: cleanJoin(answers) });
    var draft = {
      kind: isPlan ? "기획 초안" : "글 초안",
      title: seeds.length ? (seeds[0].title || "생각 조각").replace(/…$/, "") : "생각 조각",
      paras: paras,
      reask: localPickReask(paras),
      steps: isPlan
        ? [
            "가장 마음이 가는 씨앗 하나를 골라 오늘 30분만 써봐요.",
            "그 결과를 다음날 다시 열어 한 번 더 엮어요.",
            "충분하다 싶으면 내보내서 원하는 곳에 붙여넣어요.",
          ]
        : null,
    };
    return draft;
  }

  /* ── 공개 API (비동기) ─────────────────────────── */
  function extractSeeds(fragments) {
    fragments = (fragments || [])
      .map(function (f) {
        return (f || "").trim();
      })
      .filter(Boolean);
    if (!fragments.length) return Promise.resolve([]);

    return apiCall({ mode: "seeds", fragments: fragments })
      .then(function (data) {
        if (data && Array.isArray(data.seeds) && data.seeds.length) {
          return data.seeds.map(function (s, i) {
            return {
              id: "s" + i,
              label: s.label,
              title: s.title,
              body: s.body,
              sources: [],
            };
          });
        }
        return localExtractSeeds(fragments);
      })
      .catch(function () {
        return localExtractSeeds(fragments);
      });
  }

  function composeDoc(seeds, fragments, answers) {
    fragments = (fragments || []).filter(Boolean);
    return apiCall({
      mode: "compose",
      seeds: seeds || [],
      fragments: fragments,
      answers: answers || [],
    })
      .then(function (data) {
        if (data && Array.isArray(data.paras) && data.paras.length) {
          return {
            kind: data.kind || "글 초안",
            title: data.title || "생각 조각",
            paras: data.paras,
            steps: data.steps && data.steps.length ? data.steps : null,
            reask: data.reask || null,
          };
        }
        return localComposeDoc(seeds, fragments, answers);
      })
      .catch(function () {
        return localComposeDoc(seeds, fragments, answers);
      });
  }

  global.YeoumWeave = { extractSeeds: extractSeeds, composeDoc: composeDoc };
})(typeof window !== "undefined" ? window : this);
