/* ui_kits/yeoum-app/weave.js — 보관·연결 엔진. 비동기.
 *
 *   1) distill(fragments)  → [{ keyword, topic, by }]   각 조각을 짧은 카드로(입력과 1:1·동일 순서)
 *   2) connect(cards)      → { clusters, resurface, source }  흩어진 생각의 연결·재노출
 *
 * 우선 백엔드(/api/weave)의 실제 Claude를 호출하고, 실패(키 없음·네트워크·타임아웃·비JSON)면
 * 로컬 목업으로 조용히 폴백한다. distill은 id 에코로 개수/순서를 견고하게 매핑하고, 누락된
 * 조각만 부분 폴백한다. connect는 Claude가 낸 '연결 없음'(빈 배열)을 존중하고, 실패일 때만 로컬.
 * 백엔드 주소는 window.YEOUM_API_BASE 로 바꿀 수 있다(기본: 같은 오리진).
 */
(function (global) {
  "use strict";

  var TIMEOUT_MS = 8000;

  function apiCall(payload) {
    var base = (typeof global !== "undefined" && global.YEOUM_API_BASE) || "";
    var ctrl =
      typeof AbortController !== "undefined" ? new AbortController() : null;
    var to = ctrl
      ? setTimeout(function () {
          ctrl.abort();
        }, TIMEOUT_MS)
      : null;
    return fetch(base + "/api/weave", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: ctrl ? ctrl.signal : undefined,
    })
      .then(function (res) {
        if (to) clearTimeout(to);
        if (!res.ok) throw new Error("api " + res.status);
        return res.json();
      })
      .catch(function (e) {
        if (to) clearTimeout(to);
        throw e;
      });
  }

  /* ── 로컬 목업(폴백) ───────────────────────────── */
  var STOP = /[.!?。…\n]+/;
  var STOPWORDS =
    "그리고 근데 그래서 그냥 아마 음 아 어 나 내 것 거 게 걸 좀 더 또 이 그 저 왜 뭐 는 은 이런 저런 요즘 계속 진짜 약간".split(
      " "
    );

  function firstClause(text, max) {
    var t = (text || "").trim().split(STOP)[0].trim();
    t = t.replace(/^(그리고|근데|그래서|그냥|아마|음|아|어)\s+/, "");
    max = max || 10;
    if (t.length > max) t = t.slice(0, max).trim();
    return t.replace(/[,·\-\s]+$/, "");
  }

  /** topic 안전 트림(스키마가 maxLength 미지원 → 사후 방어). 어절 경계 존중. */
  function trimTopic(t) {
    t = (t || "").trim().replace(/\s+/g, " ");
    var MAX = 14;
    if (t.length <= MAX) return t;
    var cut = t.slice(0, MAX);
    var sp = cut.lastIndexOf(" ");
    if (sp > 5) cut = cut.slice(0, sp);
    return cut.trim();
  }

  function localKeyword(text) {
    var words = (text || "")
      .replace(/[^0-9A-Za-z가-힣\s]/g, " ")
      .split(/\s+/)
      .filter(Boolean)
      .filter(function (w) {
        return w.length >= 2 && STOPWORDS.indexOf(w) === -1;
      });
    if (!words.length) return firstClause(text, 6) || "생각";
    words.sort(function (a, b) {
      return b.length - a.length;
    });
    return words[0].replace(/(은|는|이|가|을|를|에|의|도|만|과|와|랑)$/, "");
  }

  function localDistillOne(text) {
    return {
      keyword: localKeyword(text),
      topic: firstClause(text, 10) || "생각 조각",
      by: "local",
    };
  }

  function localConnect(cards) {
    cards = cards || [];
    if (cards.length < 2) return { clusters: [], resurface: [], source: "local" };
    var byKw = {};
    cards.forEach(function (c) {
      var k = (c.keyword || localKeyword(c.raw || "")).trim();
      if (!k) return;
      (byKw[k] = byKw[k] || []).push(c);
    });
    var clusters = Object.keys(byKw)
      .filter(function (k) {
        return byKw[k].length >= 2;
      })
      .sort(function (a, b) {
        return byKw[b].length - byKw[a].length;
      })
      .slice(0, 4)
      .map(function (k) {
        var group = byKw[k];
        return {
          label: "‘" + k + "’ 이 자꾸 돌아와요",
          insight:
            k +
            " 이야기가 " +
            group.length +
            "번 나왔어요. 흩어진 조각이지만 한 방향을 가리키고 있을지도 몰라요.",
          cardIds: group.map(function (c) {
            return c.id;
          }),
        };
      });
    var resurface = [];
    if (clusters.length) {
      var topKw = clusters[0].cardIds;
      var oldest = cards
        .filter(function (c) {
          return topKw.indexOf(c.id) !== -1;
        })
        .sort(function (a, b) {
          return (a.ts || 0) - (b.ts || 0);
        })[0];
      if (oldest)
        resurface.push({
          cardId: oldest.id,
          message: "전에 남긴 이 생각, 지금 기록과 닮아 있어요.",
        });
    }
    return { clusters: clusters, resurface: resurface, source: "local" };
  }

  /* ── 공개 API (비동기) ─────────────────────────── */
  /** 입력과 항상 같은 길이·순서의 [{keyword, topic, by}] 반환. */
  function distill(fragments) {
    fragments = (fragments || []).map(function (f) {
      return (f || "").trim();
    });
    var idxs = [];
    fragments.forEach(function (f, i) {
      if (f) idxs.push(i);
    });
    if (!idxs.length) return Promise.resolve(fragments.map(localDistillOne));

    var payloadItems = idxs.map(function (i) {
      return { id: "f" + i, text: fragments[i] };
    });

    function assemble(byId) {
      return fragments.map(function (f, i) {
        if (!f) return localDistillOne("");
        var it = byId["f" + i];
        if (it && (it.keyword || it.topic)) {
          return {
            keyword: (it.keyword || localKeyword(f)).trim(),
            topic: trimTopic(it.topic || firstClause(f, 10)),
            by: "ai",
          };
        }
        return localDistillOne(f); // 누락된 조각만 부분 폴백
      });
    }

    return apiCall({ mode: "distill", items: payloadItems })
      .then(function (data) {
        var byId = {};
        if (data && Array.isArray(data.items)) {
          data.items.forEach(function (it) {
            if (it && it.id) byId[it.id] = it;
          });
        }
        return assemble(byId);
      })
      .catch(function () {
        return fragments.map(function (f) {
          return f ? localDistillOne(f) : localDistillOne("");
        });
      });
  }

  /** { clusters, resurface, source:'ai'|'local' }. AI가 낸 빈 결과는 존중, 실패만 로컬. */
  function connect(cards) {
    cards = (cards || []).filter(function (c) {
      return c && c.id;
    });
    if (cards.length < 2)
      return Promise.resolve({ clusters: [], resurface: [], source: "ai" });

    return apiCall({
      mode: "connect",
      cards: cards.map(function (c) {
        return { id: c.id, raw: c.raw, keyword: c.keyword, topic: c.topic };
      }),
    })
      .then(function (data) {
        if (!data || !Array.isArray(data.clusters)) return localConnect(cards);
        var ids = {};
        cards.forEach(function (c) {
          ids[c.id] = true;
        });
        var clusters = data.clusters
          .map(function (cl) {
            return {
              label: cl.label || "이어지는 생각",
              insight: cl.insight || "",
              cardIds: (cl.cardIds || []).filter(function (id) {
                return ids[id];
              }),
            };
          })
          .filter(function (cl) {
            return cl.cardIds.length >= 2;
          });
        var resurface = (data.resurface || [])
          .filter(function (r) {
            return r && ids[r.cardId];
          })
          .map(function (r) {
            return {
              cardId: r.cardId,
              message: r.message || "다시 꺼내볼 만해요.",
            };
          });
        // AI가 유효 응답을 냈으면 (빈 결과라도) 그대로 존중
        return { clusters: clusters, resurface: resurface, source: "ai" };
      })
      .catch(function () {
        return localConnect(cards);
      });
  }

  global.YeoumWeave = {
    distill: distill,
    connect: connect,
    localConnect: localConnect,
  };
})(typeof window !== "undefined" ? window : this);
