/* ui_kits/yeoum-app/weave.js — 로컬 수렴(엮기) 엔진.
 *
 * 백엔드/LLM 없이 조각(fragments)을 '완성된 결과물'로 엮는 목업.
 * 사람=발산(강점) / AI=수렴 보완 / 결과물=글·기획.
 * 실제 제품에선 이 함수 하나를 LLM 호출로 교체한다.
 */
(function (global) {
  "use strict";

  // '기획'류 신호 — 실행 3단계 허용(경계선 §8). 이 외엔 '글'.
  var PLAN_HINTS = [
    "계획", "기획", "하자", "만들", "출시", "론칭", "런칭", "준비",
    "런치", "실행", "프로젝트", "일정", "로드맵", "전략", "제안",
  ];

  var STOP = /[.!?。…\n]+/;

  function firstClause(text) {
    var t = text.trim().split(STOP)[0].trim();
    if (t.length > 26) t = t.slice(0, 24).trim() + "…";
    return t;
  }

  function condense(text) {
    var t = text.trim().replace(/\s+/g, " ");
    if (t.length > 60) t = t.slice(0, 58).trim() + "…";
    return t;
  }

  function looksLikePlan(fragments) {
    var joined = fragments.join(" ");
    return PLAN_HINTS.some(function (h) {
      return joined.indexOf(h) !== -1;
    });
  }

  function pickTitle(fragments) {
    // 가장 긴 조각의 첫 구절을 제목 씨앗으로.
    var longest = fragments
      .slice()
      .sort(function (a, b) {
        return b.length - a.length;
      })[0];
    var seed = firstClause(longest || "생각 조각");
    return seed.replace(/[,·\-\s]+$/, "");
  }

  /**
   * @param {string[]} fragments  쏟아낸 조각들
   * @param {string[]} [answers]  되물음에 대한 답(있으면 반영)
   * @returns {object} draft
   */
  function weave(fragments, answers) {
    fragments = (fragments || [])
      .map(function (f) {
        return (f || "").trim();
      })
      .filter(Boolean);
    answers = (answers || []).filter(Boolean);

    var isPlan = looksLikePlan(fragments.concat(answers));
    var title = pickTitle(fragments);

    // 씨앗 — 각 조각을 한 줄로 압축(핵심 추출의 목업).
    var seeds = fragments.map(condense);

    // 인트로 — 조각 수를 증폭 카피로.
    var intro =
      "흩어져 있던 조각 " +
      fragments.length +
      "개를 모아 하나의 " +
      (isPlan ? "기획으로" : "글로") +
      " 엮었어요. 아래는 그 초안이에요.";

    // 본문 문단 — 조각들을 흐름 있게 이어 붙임(목업).
    var body = fragments
      .map(function (f) {
        return f.trim();
      })
      .join(" ");

    var draft = {
      kind: isPlan ? "기획 초안" : "글 초안",
      title: title,
      intro: intro,
      seeds: seeds,
      body: body,
      steps: null,
      fragmentCount: fragments.length,
      createdAt: Date.now(),
    };

    if (isPlan) {
      // 실행 3단계 — 산출물의 내용일 뿐, 사용자의 하루를 추적하지 않는다.
      draft.steps = [
        "가장 마음이 가는 조각 하나를 골라 오늘 30분만 써봐요.",
        "그 결과를 다음날 다시 열어 한 번 더 엮어요.",
        "충분하다 싶으면 복사해서 원하는 곳에 붙여넣어요.",
      ];
    }

    if (answers.length) {
      draft.body +=
        " " + answers.join(" ").trim();
    }

    return draft;
  }

  /** 되물음 — 부드러운 후속 질문 하나. 비난·독촉 없이. */
  function nextQuestion(draft) {
    var pool = draft && draft.kind === "기획 초안"
      ? [
          "이걸 누구한테 보여주고 싶어요? 한 사람만 떠올려봐요.",
          "가장 먼저 손대고 싶은 부분은 어디예요?",
          "여기서 딱 하나만 더 붙인다면 뭘까요?",
        ]
      : [
          "이 글에서 제일 하고 싶었던 말은 뭐였어요?",
          "빠진 조각이 하나 있다면, 그게 뭘까요?",
          "누가 이걸 읽었으면 좋겠어요?",
        ];
    // createdAt 기반 결정적 선택(랜덤 미사용).
    var idx = draft && draft.createdAt ? draft.createdAt % pool.length : 0;
    return pool[idx];
  }

  global.YeoumWeave = { weave: weave, nextQuestion: nextQuestion };
})(typeof window !== "undefined" ? window : this);
