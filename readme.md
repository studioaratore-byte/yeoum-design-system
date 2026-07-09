# 엮음 (Yeoum) — Design System & App

> 폭주하는 생각을 마구 쏟으면, AI가 유의미한 걸 뽑아 '완성된 결과물'로 엮어주는
> 발산형(ADHD) 인재의 결과물 엔진.
> **사람 = 발산(강점) / AI = 수렴 보완 / 결과물 = 글·기획.**

이 저장소는 `handoff/Design-Handoff.html`의 디자인 명세를 그대로 구현한
디자인 시스템(토큰·컴포넌트)과, 그 위에서 도는 인터랙티브 앱 목업이다.

## 실행

정적 파일만으로 동작한다. 프로젝트 루트에서 아무 정적 서버나 띄우면 된다.

```bash
python -m http.server 4173
# → http://localhost:4173/ui_kits/yeoum-app/
```

브라우저에서 `ui_kits/yeoum-app/index.html` 을 직접 열어도 되지만, Pretendard
CDN·클립보드·음성 API 때문에 로컬 서버 경유를 권장한다.

## 구조

```
styles.css              전역 진입점 — 소비 프로젝트는 이 파일 하나만 링크
tokens/
  fonts.css             Pretendard 단일 패밀리 (jsDelivr CDN, v1.3.9)
  colors.css            쿨 뉴트럴 + 라프텔 바이올렛(thread) 단일 액센트
  typography.css        타입 스케일 (display 26 → caption 13)
  spacing.css           4px 베이스 · 라운딩 · 그림자 · 모션 · 터치타깃
components/
  core.css              Button · IconButton · TextField · Chip · Card
  capture.css           MicButton(96px 히어로) · PromptHint(회전 힌트)
  fragments.css         FragmentCard · SeedCard · WeaveBar
  index.js              window.YeoumDesignSystem — 아이콘 세트 · 회전 힌트
ui_kits/yeoum-app/
  index.html            앱 셸
  app.css               앱 셸 레이아웃(폰 프레임·뷰·탭바)
  app.js                라우터 · 캡처 · 저장 · 음성
  weave.js              로컬 수렴(엮기) 엔진 — 실제 제품에선 LLM 호출로 교체
handoff/                원본 디자인 핸드오프 문서
```

## 앱 흐름

**쏟기 → 엮기 → 결과물 → 되물음**, 그리고 탭 **홈 · 보관함 · 설정**.
지도/사고 그래프는 의도적으로 없다(핸드오프 §8 경계선).

- **홈** — 화면이 곧 입력창. 96px 히어로 마이크가 지배 요소, 텍스트는 보조.
- **쏟기** — 조각을 누적. 제목·태그·저장 버튼 없이 자동저장. 조각은 언제든 뺄 수 있다.
- **엮기** — 하단 WeaveBar의 "조각 N개 → 엮기". AI 수렴 목업이 초안을 만든다.
- **결과물** — "조각 N개 → 이 글" Before/After 증폭. 복사·공유·다시 엮기.
- **되물음** — 부드러운 후속 질문 하나로 초안을 다듬어 재-엮기.

'기획'류 신호(계획·출시·론칭 등)가 잡히면 결과물 끝에 **실행 3단계**가 붙는다 —
이는 산출물의 내용일 뿐 사용자의 하루를 추적하지 않는다(§8).

## 설계 헌법 R1~R10 (구현 반영)

| # | 규칙 | 구현 |
|---|------|------|
| R1 | 0탭 캡처 | 홈이 곧 입력창, "새로 만들기" 없음 |
| R2 | 음성 우선 | 96px 마이크가 히어로, 텍스트는 ghost 버튼 |
| R3 | 입력 중 강제 0 | 제목·태그·저장 버튼 없음, 자동저장 |
| R4 | 미완성 허용 | 문법·완결 강요 UI 없음 |
| R5 | 언제든 중단 | "정말 나갈래?" 모달 없음 |
| R6 | 빈 화면 공포 방지 | 회전형 은은한 프롬프트 힌트 |
| R7 | 독촉 금지 | 빨간 배지·스트릭·연체 없음 |
| R8 | 한 화면 = 한 액션 | 화면당 primary 버튼 1개 |
| R9 | 작은 보상 | 부드러운 토스트, 게이미피케이션 없음 |
| R10 | 감각 차분 | 넉넉한 여백·저채도, `prefers-reduced-motion` 존중 |

## 대체 플래그 (실제 에셋 확보 시 교체)

- **폰트** — Pretendard 로컬 woff2 미제공 → CDN 참조. 확보 시 `tokens/fonts.css`.
- **아이콘** — 소스에 세트 없음 → Lucide 형태 인라인 SVG로 임시 대체(`components/index.js`의 `ICONS`).
- **로고** — 로고 없음. Pretendard 600 워드마크 "엮음"으로 조판. 로고를 그리거나 지어내지 않는다.
- **엮기 엔진** — 백엔드/LLM 없음 → `weave.js`의 로컬 목업. 함수 하나를 LLM 호출로 교체.

## 카피 · 보이스

짧고 다정하게, 비난·독촉 없이, 이모지 미사용.
금지 어휘: 마감 · 연체 · 놓침 · 벌점 · 스트릭 · "정말 나가시겠습니까".
