/* api/weave.js — Vercel 서버리스 함수. 키를 숨기고 Claude로 '보관·연결'을 수행.
 *
 * 방향: 입력 → 보관(짧은 카드) → 연결 → 노출.
 *   { mode: "distill", items: [{ id, text }] }
 *        → { items: [{ id, keyword, topic }] }   // id 에코로 1:1 매핑(개수/순서 견고)
 *   { mode: "connect", cards: [{ id, raw, keyword, topic }] }
 *        → { clusters: [{ label, insight, cardIds }], resurface: [{ cardId, message }] }
 *
 * 모델: distill = Haiku 4.5(저난도 추출·저지연·저비용), connect = Opus 4.8 + adaptive thinking(근거 판단).
 * refusal·빈 응답·비JSON은 5xx로 던지지 않고 200 + 빈 결과로 응답 → 프론트가 로컬 폴백으로 매끄럽게 이어감.
 * 키는 Vercel 환경변수 ANTHROPIC_API_KEY.
 */

const AnthropicMod = require("@anthropic-ai/sdk");
const Anthropic = AnthropicMod.default || AnthropicMod;

const DISTILL_MODEL = "claude-haiku-4-5";
const CONNECT_MODEL = "claude-opus-4-8";

const VOICE = [
  "너는 'Piko'라는 앱의 AI다.",
  "발산형(ADHD) 사용자가 정리 없이 쏟아낸 생각을, 짧게 보관하고 과거 생각과 이어 다시 만나게 돕는다.",
  "사람은 발산(강점), 너는 정리·연결을 보완한다. 결코 대신 결론 내리지 않는다.",
  "톤: 짧고 다정하게. 비난·독촉·평가·압박 금지. 이모지 금지.",
  "금지 어휘: 마감, 연체, 놓침, 벌점, 스트릭.",
  "항상 한국어로. 반드시 주어진 JSON 스키마에 맞춰 응답한다.",
].join(" ");

const DISTILL_SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          keyword: { type: "string" },
          topic: { type: "string" },
        },
        required: ["id", "keyword", "topic"],
        additionalProperties: false,
      },
    },
  },
  required: ["items"],
  additionalProperties: false,
};

const CONNECT_SCHEMA = {
  type: "object",
  properties: {
    clusters: {
      type: "array",
      items: {
        type: "object",
        properties: {
          label: { type: "string" },
          insight: { type: "string" },
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
          message: { type: "string" },
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
  if (!message || message.stop_reason === "refusal") return "";
  var block = (message.content || []).find(function (b) {
    return b.type === "text";
  });
  return block ? block.text : "";
}

/** 안전 파싱: 빈/비JSON이면 null(→ 상위에서 빈 결과 처리). */
function safeParse(text) {
  if (!text || !text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch (e) {
    return null;
  }
}

async function runDistill(client, items) {
  var system =
    VOICE +
    " 임무: 각 생각 조각을 '짧은 카드'로 보관한다." +
    " 조각마다 keyword(핵심 단어 1~2개)와 topic(10자 이내의 아주 짧은 주제 — 문장 아님, 한눈에 읽히는 단어·짧은 구절)을 만든다(예: '게임엔 몰입', '완성이 안 됨')." +
    " 각 입력에는 [id]가 붙어 있다. 반환 items의 각 원소에 그 id를 그대로 담아라." +
    " 입력 조각 하나당 정확히 하나의 결과를 낸다. 조각을 쪼개거나 합치지 마라." +
    " 절대 규칙: 조각에 실제로 등장한 단어·사실만 사용한다. 없는 소재·상황·숫자를 지어내지 마라.";
  var user =
    "다음 조각들을 각각 짧은 카드로 보관해줘:\n" +
    items
      .map(function (it) {
        return "[" + it.id + "] " + it.text;
      })
      .join("\n");

  var message = await client.messages.create({
    model: DISTILL_MODEL,
    max_tokens: Math.min(4000, 300 + items.length * 90),
    system: system,
    output_config: {
      format: { type: "json_schema", schema: DISTILL_SCHEMA },
    },
    messages: [{ role: "user", content: user }],
  });
  var parsed = safeParse(firstText(message));
  return parsed && Array.isArray(parsed.items) ? { items: parsed.items } : { items: [] };
}

async function runConnect(client, cards) {
  var system =
    VOICE +
    " 임무: 보관된 생각 카드들 사이에서 반복 주제와 의미적 연결을 발견한다." +
    " clusters: 서로 이어지는 카드들을 최대 4개 묶음으로. 각 묶음은 label(한 줄로, 짧게)," +
    " insight(왜 이어지는지 한두 문장 — 사용자 대신 결론 내리지 말고 관계만 비춰준다)," +
    " cardIds(묶음에 속한 카드 id 배열, 실제 존재하는 id만, 묶음당 2개 이상)로 구성한다." +
    " resurface: 지금 다시 꺼내볼 만한 과거 카드 1~2개. cardId와 message(부드러운 재노출 문구, 독촉 아님)." +
    " 절대 규칙: 카드에 없는 사실·소재를 지어내지 마라. 뚜렷한 연결이 없으면 억지로 묶지 말고 clusters를 빈 배열로 둬라.";

  var cardLines = cards
    .map(function (c) {
      return (
        "[" +
        c.id +
        "] " +
        (c.keyword ? "(" + c.keyword + ") " : "") +
        (c.raw || c.topic || "")
      );
    })
    .join("\n");
  var user =
    "보관된 생각 카드들:\n" +
    cardLines +
    "\n\n여기서 반복되는 주제와 이어지는 생각을 찾아 clusters와 resurface로 정리해줘. 억지 연결은 만들지 마.";

  var message = await client.messages.create({
    model: CONNECT_MODEL,
    max_tokens: 3000,
    system: system,
    thinking: { type: "adaptive" },
    output_config: {
      effort: "medium",
      format: { type: "json_schema", schema: CONNECT_SCHEMA },
    },
    messages: [{ role: "user", content: user }],
  });
  var parsed = safeParse(firstText(message));
  if (!parsed || !Array.isArray(parsed.clusters))
    return { clusters: [], resurface: [] };
  return {
    clusters: parsed.clusters,
    resurface: Array.isArray(parsed.resurface) ? parsed.resurface : [],
  };
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST")
    return res.status(405).json({ error: "method_not_allowed" });
  if (!process.env.ANTHROPIC_API_KEY)
    return res.status(503).json({ error: "missing_api_key" });

  try {
    var body =
      typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    var client = new Anthropic();

    if (body.mode === "distill") {
      var items = (body.items || [])
        .filter(function (it) {
          return it && it.id != null && (it.text || "").toString().trim();
        })
        .map(function (it) {
          return { id: String(it.id), text: String(it.text).trim() };
        });
      if (!items.length) return res.status(200).json({ items: [] });
      var out = await runDistill(client, items);
      return res.status(200).json(out);
    }

    if (body.mode === "connect") {
      var cards = (body.cards || []).filter(function (c) {
        return c && c.id;
      });
      if (cards.length < 2)
        return res.status(200).json({ clusters: [], resurface: [] });
      var cout = await runConnect(client, cards);
      return res.status(200).json(cout);
    }

    return res.status(400).json({ error: "unknown_mode" });
  } catch (err) {
    // 프론트는 실패 시 로컬 목업으로 폴백하므로 에러만 반환
    return res
      .status(502)
      .json({ error: "weave_failed", detail: String(err && err.message) });
  }
};
