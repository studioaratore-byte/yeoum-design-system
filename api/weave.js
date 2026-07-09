/* api/weave.js — Vercel 서버리스 함수. 키를 숨기고 Claude로 '엮기'를 수행.
 *
 * 프론트(ui_kits/yeoum-app)는 /api/weave 로 POST 한다.
 *   { mode: "seeds",   fragments: string[] }                 → { seeds:[{label,title,body}] }
 *   { mode: "compose", seeds:[...], fragments, answers }     → { title,kind,paras,steps?,reask }
 *
 * 키는 Vercel 환경변수 ANTHROPIC_API_KEY 에 둔다(코드/프론트에 노출 안 됨).
 */

const AnthropicMod = require("@anthropic-ai/sdk");
const Anthropic = AnthropicMod.default || AnthropicMod;

const MODEL = "claude-opus-4-8";

/* ── 공통 보이스 규칙 ─────────────────────────────── */
const VOICE = [
  "너는 '엮음(Yeoum)'이라는 앱의 AI다.",
  "폭주형(ADHD) 사용자가 마구 쏟아낸 생각을 받아, 유의미한 것을 뽑아 '완성된 결과물'로 엮어준다.",
  "사람은 발산(강점), 너는 수렴을 보완한다.",
  "톤: 짧고 다정하게. 비난·독촉·평가 금지. 이모지 금지.",
  "금지 어휘: 마감, 연체, 놓침, 벌점, 스트릭.",
  "항상 한국어로. 반드시 주어진 JSON 스키마에 맞춰 응답한다.",
].join(" ");

const SEEDS_SCHEMA = {
  type: "object",
  properties: {
    seeds: {
      type: "array",
      items: {
        type: "object",
        properties: {
          label: { type: "string" },
          title: { type: "string" },
          body: { type: "string" },
        },
        required: ["label", "title", "body"],
        additionalProperties: false,
      },
    },
  },
  required: ["seeds"],
  additionalProperties: false,
};

const COMPOSE_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    kind: { type: "string", enum: ["글 초안", "기획 초안"] },
    paras: {
      type: "array",
      items: {
        type: "object",
        properties: {
          who: { type: "string", enum: ["me", "ai"] },
          text: { type: "string" },
        },
        required: ["who", "text"],
        additionalProperties: false,
      },
    },
    steps: { type: "array", items: { type: "string" } },
    reask: {
      type: "object",
      properties: { text: { type: "string" } },
      required: ["text"],
      additionalProperties: false,
    },
  },
  required: ["title", "kind", "paras", "reask"],
  additionalProperties: false,
};

function firstText(message) {
  const block = (message.content || []).find((b) => b.type === "text");
  return block ? block.text : "";
}

async function runSeeds(client, fragments) {
  const system =
    VOICE +
    " 임무: 쏟아진 조각들에서 핵심 주제(씨앗)를 2~3개 뽑는다." +
    " 각 씨앗은 label(맥락 한 줄, 예: '이번 주 반복된 주제', 'N개 조각이 하나로 모임')," +
    " title(핵심을 짚는 짧은 제목, 16자 이내 권장)," +
    " body(왜 이게 씨앗인지 한두 문장)로 구성한다." +
    " 절대 규칙: title·body는 조각에 실제로 등장한 단어와 사실만 사용한다." +
    " 조각에 없는 소재·상황·숫자를 새로 지어내지 마라(예: 조각에 '앱 출시'가 있으면 '발표'로 바꾸지 말고, '유저 20명'을 '슬라이드 20장'으로 왜곡하지 마라)." +
    " 확실하지 않으면 조각의 표현을 그대로 옮겨라.";
  const user =
    "다음은 사용자가 쏟아낸 조각들이야:\n" +
    fragments.map((f) => "- " + f).join("\n") +
    "\n\n여기서 핵심 씨앗을 뽑아줘.";

  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 1500,
    system,
    output_config: {
      effort: "medium",
      format: { type: "json_schema", schema: SEEDS_SCHEMA },
    },
    messages: [{ role: "user", content: user }],
  });
  return JSON.parse(firstText(message));
}

async function runCompose(client, seeds, fragments, answers) {
  const system =
    VOICE +
    " 임무: 사용자가 고른 씨앗과 원래 조각들을 모아 하나의 완성된 결과물로 엮는다." +
    " title: 결과물 제목." +
    " kind: 계획·실행·기획 성격이면 '기획 초안', 그 외에는 '글 초안'." +
    " paras: 문단 배열. 각 문단은 who('me'=사용자의 생각을 다듬은 것, 'ai'=AI가 보강한 연결·맥락)와 text." +
    " 사용자의 목소리를 살리되 흐르게 엮고, me와 ai를 자연스럽게 섞는다(보통 3~6문단)." +
    " steps: '기획 초안'일 때만 실행 3단계(선택). 사용자의 하루를 추적하지 말고, 산출물 내용으로서의 다음 행동만 담는다." +
    " reask: 되물음 하나. 근거가 약하거나 더 듣고 싶은 지점을 짚어 '30초만 더 쏟아줄래요?' 식으로 부드럽게 묻는다." +
    " 절대 규칙: 조각과 씨앗에 없는 새로운 사실·소재·숫자를 지어내지 마라. AI 보강 문단도 사용자의 조각 맥락 안에서만 확장한다.";

  const seedLines = (seeds || [])
    .map(function (s) {
      return "· [" + (s.label || "") + "] " + (s.title || "") + " — " + (s.body || "");
    })
    .join("\n");
  const fragLines = (fragments || []).map((f) => "- " + f).join("\n");
  const answerLines = (answers || []).length
    ? "\n\n되물음에 대한 사용자의 추가 답:\n" +
      answers.map((a) => "- " + a).join("\n")
    : "";

  const user =
    "고른 씨앗:\n" +
    seedLines +
    "\n\n원래 조각들:\n" +
    fragLines +
    answerLines +
    "\n\n이 재료로 하나의 결과물을 엮어줘.";

  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 2500,
    system,
    output_config: {
      effort: "medium",
      format: { type: "json_schema", schema: COMPOSE_SCHEMA },
    },
    messages: [{ role: "user", content: user }],
  });
  return JSON.parse(firstText(message));
}

module.exports = async function handler(req, res) {
  // 같은 오리진이 아니어도(예: GitHub Pages 프론트) 호출할 수 있게 CORS 허용
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
    const fragments = (body.fragments || [])
      .map(function (f) {
        return (f || "").toString().trim();
      })
      .filter(Boolean);

    const client = new Anthropic(); // ANTHROPIC_API_KEY 자동 사용

    if (body.mode === "seeds") {
      if (!fragments.length) return res.status(200).json({ seeds: [] });
      const out = await runSeeds(client, fragments);
      return res.status(200).json(out);
    }

    if (body.mode === "compose") {
      const out = await runCompose(
        client,
        body.seeds || [],
        fragments,
        body.answers || []
      );
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
