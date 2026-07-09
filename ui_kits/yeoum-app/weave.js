/* ui_kits/yeoum-app/weave.js — 보관·연결 엔진. 비동기.
 *
 * 방향(2026-07-10): 입력 → 보관(짧은 카드) → 연결 → 노출.
 *   1) distill(fragments)  → [{ keyword, topic }]   각 조각을 짧은 카드로
 *   2) connect(cards)      → { clusters, resurface } 흩어진 생각의 연결·재노출
 *
 * 우선 Vercel 백엔드(/api/weave)의 실제 Claude를 호출하고,
 * 실패하면(키 없음·네트워크·오프라인) 로컬 목업으로 조용히 폴백한다.
 * 백엔드 주소는 window.YEOUM_API_BASE 로 바꿀 수 있다(기본: 같은 오리진).
 */
(function (global) {
  "use strict";

  var API_BASE = (typeof global !== "undefined" && global.YEOUM_API_BASE) || "";

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

  // 로컬 키워드: 가장 길고 흔하지 않은 명사스러운 토큰 하나
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
    return { keyword: localKeyword(text), topic: firstClause(text, 10) || "생각 조각" };
  }

  // 로컬 연결: 키워드 빈도로 묶음 + 가장 오래된 반복 카드 재노출
  function localConnect(cards) {
    cards = cards || [];
    if (cards.length < 2) return { clusters: [], resurface: [] };

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

    // 재노출: 가장 반복된 키워드의 가장 오래된 카드
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
    return { clusters: clusters, resurface: resurface };
  }

  /* ── 공개 API (비동기) ─────────────────────────── */
  function distill(fragments) {
    fragments = (fragments || [])
      .map(function (f) {
        return (f || "").trim();
      })
      .filter(Boolean);
    if (!fragments.length) return Promise.resolve([]);

    return apiCall({ mode: "distill", fragments: fragments })
      .then(function (data) {
        if (data && Array.isArray(data.items) && data.items.length === fragments.length) {
          return data.items.map(function (it, i) {
            return {
              keyword: (it.keyword || localKeyword(fragments[i])).trim(),
              topic: (it.topic || firstClause(fragments[i], 10)).trim(),
            };
          });
        }
        return fragments.map(localDistillOne);
      })
      .catch(function () {
        return fragments.map(localDistillOne);
      });
  }

  function connect(cards) {
    cards = (cards || []).filter(function (c) {
      return c && c.id;
    });
    if (cards.length < 2) return Promise.resolve({ clusters: [], resurface: [] });

    return apiCall({
      mode: "connect",
      cards: cards.map(function (c) {
        return { id: c.id, raw: c.raw, keyword: c.keyword, topic: c.topic };
      }),
    })
      .then(function (data) {
        var ids = {};
        cards.forEach(function (c) {
          ids[c.id] = true;
        });
        var valid = function (id) {
          return ids[id];
        };
        if (data && Array.isArray(data.clusters)) {
          var clusters = data.clusters
            .map(function (cl) {
              return {
                label: cl.label || "이어지는 생각",
                insight: cl.insight || "",
                cardIds: (cl.cardIds || []).filter(valid),
              };
            })
            .filter(function (cl) {
              return cl.cardIds.length >= 2;
            });
          var resurface = (data.resurface || [])
            .filter(function (r) {
              return r && valid(r.cardId);
            })
            .map(function (r) {
              return { cardId: r.cardId, message: r.message || "다시 꺼내볼 만해요." };
            });
          if (clusters.length || resurface.length)
            return { clusters: clusters, resurface: resurface };
        }
        return localConnect(cards);
      })
      .catch(function () {
        return localConnect(cards);
      });
  }

  global.YeoumWeave = { distill: distill, connect: connect, localConnect: localConnect };
})(typeof window !== "undefined" ? window : this);
