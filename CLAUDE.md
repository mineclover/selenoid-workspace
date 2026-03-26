# selenoid-workspace

E2E 크로스 브라우저 테스트 워크스페이스. 세 패키지를 submodule로 관리.

## 구조

```
packages/
├── selenoid/   Go — 브라우저 컨테이너 관리 서버 (WebDriver Hub)
├── images/     Go — 브라우저 Docker 이미지 빌더 CLI
└── bridge/     TS — 테스트 시나리오 생성/실행 브릿지
```

## 스킬

- `skills/e2e-test/` — `/e2e-test` 커맨드로 setup/create/run/status/stop

## 문서

- `docs/architecture.md` — 아키텍처 개요
- `docs/getting-started.md` — 설치 및 사용법
- `docs/tailscale-setup.md` — Tailscale 원격 접근 설정
