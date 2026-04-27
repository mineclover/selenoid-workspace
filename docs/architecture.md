# Architecture

## Overview

```
selenoid-workspace/
├── packages/
│   ├── selenoid/    (Go)     브라우저 컨테이너 관리 서버
│   ├── images/      (Go)     브라우저 Docker 이미지 빌더
│   ├── bridge/      (TS)     테스트 시나리오 생성 + 실행 브릿지
│   └── renderer/    (TS)     헤드리스 렌더러 — 프레임 단위 캡처 + 스프라이트 합성
├── docs/                      통합 문서
└── skills/                    Claude Code 스킬
```

## 컴포넌트 역할

### selenoid (packages/selenoid)
- WebDriver Hub — 세션 생성/프록시/관리
- Docker API로 브라우저 컨테이너 라이프사이클 관리
- CDP/VNC/비디오/로그 프록시
- Tailscale 네트워킹 지원 (사이드카, Serve/Funnel)

### images (packages/images)
- 브라우저 Docker 이미지 빌드 CLI
- Chrome/Firefox/Edge/Opera/Chromium/Yandex 지원
- ChromeDriver/GeckoDriver 자동 매칭 다운로드
- Go embed으로 Dockerfile 템플릿 관리

### bridge (packages/bridge)
- agent-browser ↔ Selenoid 브릿지
- 셀렉터 추출: CDP → data-testid/id/aria-label/role/text
- 시나리오 JSON 포맷: goto/click/fill/assert 등
- WebDriver 클라이언트로 Selenoid에서 실행
- 크로스 브라우저 병렬 실행
- `render-sprites` 커맨드: 렌더러 API를 호출해 스프라이트 레이어를 합성

### renderer (packages/renderer)
- HTTP API 서버 (port 9847) — Docker 컨테이너로 배포
- `POST /render/html` — Hyperframes 페이지를 프레임별로 캡처 → 애니메이션 WebP
- `POST /render/sprites` — 스프라이트 레이어를 투명 애니메이션 WebP로 합성
- BeginFrame CDP로 결정론적(flicker-free) 프레임 캡처 (linux/amd64 + chrome-headless-shell 전용)
- Sharp(libvips) Porter-Duff over 합성으로 알파 투명도 보존
- ffmpeg stdin 파이프라인 — 중간 PNG 디스크 I/O 없이 Sharp → ffmpeg 스트리밍

## 데이터 흐름

```
[탐색]  agent-browser → 스냅샷 → @ref → CDP → 안정적 셀렉터
                                                    ↓
[저장]                                    시나리오 JSON 파일
                                                    ↓
[실행]  bridge CLI → WebDriver → Selenoid → Docker → Chrome/Firefox/Edge
                                                    ↓
[결과]                            pass/fail per browser + timing report
```

### HTML 렌더 파이프라인

```
bridge render-html          renderer (Docker)
─────────────────           ─────────────────────────────────────────────────
POST /render/html   ──────▶ chrome-headless-shell (BeginFrame CDP)
                            프레임별 PNG 캡처
                            ffmpeg stdin 파이프 → animated WebP
                   ◀─────── /renders/<id>.webp
```

### 스프라이트 합성 파이프라인

```
bridge render-sprites       renderer (Docker)
─────────────────           ─────────────────────────────────────────────────
POST /render/sprites ─────▶ 레이어별 xExpr/yExpr 평가 (safeExpr → evalOrbit)
                            Sharp(libvips) per-frame Porter-Duff over 합성
                            ffmpeg stdin 파이프 → animated WebP (알파 보존)
                   ◀─────── /renders/<id>.webp
                            또는 --split: 레이어별 개별 WebP + HTML 컴포지터
```

## 관련 문서

- `docs/sprite-image-guide.md` — 스프라이트 이미지 제작 (RGBA 설계, 알파 원칙, 외부 툴, 체크리스트)
- `docs/sprite-authoring-guide.md` — 레이어 JSON 설정·xExpr 표현식·합성 설계 원칙
- `packages/renderer/README.md` — 렌더러 API 및 파이프라인 상세
- `packages/bridge/README.md` — render / render-sprites CLI 사용법

## 네트워크 토폴로지

### 로컬 실행
```
브릿지 → http://localhost:4444 → Selenoid → Docker bridge → 브라우저 컨테이너
```

### Tailscale 사이드카 (Docker)
```
원격 기기 → http://selenoid:4444 (MagicDNS) → Tailscale 사이드카 → Selenoid → Docker → 브라우저
```

### Tailscale Serve (HTTPS)
```
원격 기기 → https://<host>.ts.net → Tailscale Serve → localhost:4444 → Selenoid → Docker → 브라우저
```
