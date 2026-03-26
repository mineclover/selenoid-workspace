# Architecture

## Overview

```
selenoid-workspace/
├── packages/
│   ├── selenoid/    (Go)     브라우저 컨테이너 관리 서버
│   ├── images/      (Go)     브라우저 Docker 이미지 빌더
│   └── bridge/      (TS)     테스트 시나리오 생성 + 실행 브릿지
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
