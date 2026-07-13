/* api/weave.js — Vercel 서버리스 함수. 키를 숨기고 Claude로 '보관·연결'을 수행.
 *
 * 방향(2026-07-10): 입력 → 보관(짧은 카드) → 연결 → 노출.
 * 프론트(ui_kits/yeoum-app)는 /api/weave 로 POST 한다.
 *   { mode: "distill", fragments: string[] }
 *        → { items: [{ keyword, topic }] }              // 각 조각을 짧은 카드로 보관
 *   { mode: "connect", cards: [{ id, raw, keyword, topic }] }
 *        → { clusters: [{ label, insight, cardIds }],    // 흩어진 생각 사이의 연결
 *            resurface: [{ cardId, message }] }           // 과거 생각 재노출(비압박)
 *
 * 키는 Vercel 환경변수 ANTHROPIC_API_KEY 에 둔다(코드/프론트에 노출 안 됨).
 */

const AnthropicMod = require("@anthropic-ai/sdk");
const Anthropic = AnthropicMod.default || AnthropicMod;

const MODEL = "claude-opus-4-8";

/* ── 공통 보이스 규칙 ─────────────────────────────── */
const VOICE = [
  "너는 'Piko'라는 앱의 AI다.",
  "발산형(ADHD 성향) 사용자가 떠오른 생각을 정리 없이 쏟으면, 그걸 짧게 보관하고 과거 생각과 연결해 다시 만나게 돕는다.",
  "사람은 발산(강점), 너는 정리와 연결을 보완한다. 결코 대신 생각해주지 않는다.",
  "톤: 짧고 다정하게. 비난·독촉·평가·압박 금지. 이모지 금지.",
  "금지 어휘: 마감, 연체, 놓침(을 나무라는 뜻), 벌점, 스트릭, 완료하세요, 미루지 마세요.",
  "항상 한국어로. 반드시 주어진 JSON 스키마에 맞춰 응답한다.",
].join(" ");

/* 보관: 각 조각 → { keyword, topic } */
const DISTILL_SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          keyword: { type: "string" }, // 핵심 단어 1~2개
          topic: { type: "string" }, // 10자 이내 짧은 주제
        },
        required: ["keyword", "topic"],
        additionalProperties: false,
      },
    },
  },
  required: ["items"],
  additionalProperties: false,
};

/* 연결: clusters(연결) + resurface(재노출) */
const CONNECT_SCHEMA = {
  type: "object",
  properties: {
    clusters: {
      type: "array",
      items: {
        type: "object",
        properties: {
          label: { type: "string" }, // 이 묶음을 한 줄로(짧게)
          insight: { type: "string" }, // 왜 이어지는지 한두 문장(대신 결론 X)
          cardIds: { type: "array", items: { type: "string" } },
        },
        required: ["label", "insight", "cardIds"],
        additionalProperties: false,
      },
    },
    resurface: {
      type: "array",
      items: {
        type: "object",
        properties: {
          cardId: { type: "string" },
          message: { type: "string" }, // 부드러운 재노출 문구(독촉 아님)
        },
        required: ["cardId", "message"],
        additionalProperties: false,
      },
    },
  },
  required: ["clusters", "resurface"],
  additionalProperties: false,
};

function firstText(message) {
  const block = (message.content || []).find((b) => b.type === "text");
  return block ? block.text : "";
}

async function runDistill(client, fragments) {
  const system =
    VOICE +
    " 임무: 사용자가 쏟은 각 생각 조각을 '짧은 카드'로 보관한다." +
    " 각 조각마다 keyword(핵심 단어 1~2개)와 topic(10자 이내의 아주 짧은 주제)을 만든다." +
    " topic은 긴 요약문이 아니라, 한눈에 인식되는 단어·짧은 구절이어야 한다(예: '게임엔 몰입', '완성이 안 됨')." +
    " 절대 규칙: 조각에 실제로 등장한 단어·사실만 사용한다. 없는 소재·상황·숫자를 지어내지 마라." +
    " 입력 조각의 개수와 순서를 그대로 유지해, items 배열을 같은 길이·같은 순서로 반환한다.";
  const user =
    "다음 조각들을 각각 짧은 카드로 보관해줘:\n" +
    fragments.map((f, i) => i + 1 + ". " + f).join("\n");

  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 1200,
    system,
    output_config: {
      effort: "low",
      format: { type: "json_schema", schema: DISTILL_SCHEMA },
    },
    messages: [{ role: "user", content: user }],
  });
  return JSON.parse(firstText(message));
}

async function runConnect(client, cards) {
  const system =
    VOICE +
    " 임무: 보관된 생각 카드들 사이에서 반복되는 주제와 의미적 연결을 발견한다." +
    " clusters: 서로 이어지는 카드들을 2~4개 묶음으로. 각 묶음은 label(묶음을 한 줄로, 짧게)," +
    " insight(왜 이어지는지 한두 문장 — 사용자 대신 결론을 내리지 말고, 관계만 비춰준다)," +
    " cardIds(묶음에 속한 카드들의 id 배열, 실제 존재하는 id만)로 구성한다." +
    " resurface: 지금 다시 꺼내볼 만한 과거 카드 1~2개. cardId와 message(부드러운 재노출 문구)." +
    " message는 독촉이 아니라 가능성만 비춘다. 예: '지난주에도 이 단어가 자주 나왔어요', '전에 남긴 생각이 지금과 닮아 있어요'." +
    " 절대 규칙: 주어진 카드에 없는 새로운 사실·소재를 지어내지 마라. cardIds/cardId는 반드시 입력에 존재하는 id만 사용한다.";

  const cardLines = (cards || [])
    .map(function (c) {
      return (
        "[" +
        c.id +
        "] keyword=" +
        (c.keyword || "") +
        " / topic=" +
        (c.topic || "") +
        " / 원문=" +
        (c.raw || "")
      );
    })
    .join("\n");

  const user =
    "보관된 생각 카드들:\n" +
    cardLines +
    "\n\n여기서 반복되는 주제와 이어지는 생각을 찾아 clusters와 resurface로 정리해줘.";

  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 2000,
    system,
    output_config: {
      effort: "medium",
      format: { type: "json_schema", schema: CONNECT_SCHEMA },
    },
    messages: [{ role: "user", content: user }],
  });
  return JSON.parse(firstText(message));
}

module.exports = async function handler(req, res) {
  // 같은 오리진이 아니어도 호출할 수 있게 CORS 허용
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST")
    return res.status(405).json({ error: "method_not_allowed" });
  if (!process.env.ANTHROPIC_API_KEY)
    return res.status(503).json({ error: "missing_api_key" });

  try {
    const body =
      typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};

    const client = new Anthropic(); // ANTHROPIC_API_KEY 자동 사용

    if (body.mode === "distill") {
      const fragments = (body.fragments || [])
        .map(function (f) {
          return (f || "").toString().trim();
        })
        .filter(Boolean);
      if (!fragments.length) return res.status(200).json({ items: [] });
      const out = await runDistill(client, fragments);
      return res.status(200).json(out);
    }

    if (body.mode === "connect") {
      const cards = (body.cards || []).filter(function (c) {
        return c && c.id;
      });
      if (cards.length < 2)
        return res.status(200).json({ clusters: [], resurface: [] });
      const out = await runConnect(client, cards);
      return res.status(200).json(out);
    }

    return res.status(400).json({ error: "unknown_mode" });
  } catch (err) {
    // 프론트는 실패 시 로컬 목업으로 폴백하므로, 에러만 조용히 반환
    return res
      .status(502)
      .json({ error: "weave_failed", detail: String(err && err.message) });
  }
};
