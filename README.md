# selenoid-workspace

Selenoid 기반 크로스 브라우저 E2E 테스트를 한 워크스페이스에서 관리하기 위한 저장소입니다. 브라우저 세션 서버, 브라우저 이미지 빌더, 시나리오 실행 CLI를 각각 서브모듈로 묶어 둡니다.

## Workspace Layout

```text
packages/
├── selenoid/   Go - 브라우저 컨테이너 관리 서버
├── images/     Go - 브라우저 Docker 이미지 빌더
└── bridge/     TS - 시나리오 생성/검증/실행 CLI
```

각 패키지는 독립 저장소이지만, 이 워크스페이스에서는 함께 버전 관리하며 통합 실행 흐름을 맞춥니다.

## Included Packages

| Package | Role | Upstream |
| --- | --- | --- |
| `packages/selenoid` | WebDriver Hub, 세션 생성/프록시, 브라우저 컨테이너 라이프사이클 관리 | `mineclover/selenoid` |
| `packages/images` | Chrome/Firefox 등 브라우저 Docker 이미지 빌드 | `mineclover/images` |
| `packages/bridge` | 시나리오 JSON 생성, 검증, 병렬 실행, HTML/JSON 리포트 생성 | `mineclover/selenoid-bridge` |

## Quick Start

### 1. Clone

```bash
git clone --recurse-submodules https://github.com/mineclover/selenoid-workspace.git
cd selenoid-workspace
```

### 2. Prepare tools

필수 도구:

- Docker Desktop
- Go 1.25+
- Node.js 20+
- 선택: Tailscale

### 3. Bring up the test environment

Claude/Codex 계열 에이전트에서 스킬을 쓸 경우:

```text
/e2e-test setup
```

수동으로 실행할 경우:

```bash
cd packages/selenoid
go build -o /tmp/selenoid-test .

docker pull selenoid/chrome:128.0

cat > /tmp/browsers-test.json <<'EOF'
{
  "chrome": {
    "default": "128.0",
    "versions": {
      "128.0": {
        "image": "selenoid/chrome:128.0",
        "port": "4444",
        "path": "/"
      }
    }
  }
}
EOF

/tmp/selenoid-test -listen :4444 -conf /tmp/browsers-test.json -limit 5 -timeout 60s -disable-privileged &
curl -s http://localhost:4444/ping
```

운영 기본값은 Selenoid `-limit` 과 bridge `--concurrency` 를 같은 값으로 맞추는 것입니다. 긴 시나리오에서는 스크린샷 IO 비용을 줄이기 위해 기본 캡처 정책인 `failure` 를 유지하고, 디버깅할 때만 `--capture all` 을 사용합니다.

### 4. Build the bridge CLI

```bash
cd packages/bridge
npm install
npm run build
```

### 5. Create a scenario

빈 템플릿:

```bash
node dist/index.js create "smoke" --url https://example.com
```

커머스 체크아웃 템플릿:

```bash
node dist/index.js create "checkout-flow" \
  --url https://shop.example.com \
  --template commerce-checkout
```

`commerce-checkout` 템플릿은 다음 흐름을 바로 담고 있습니다.

- `selectors` 사전
- `journey.phases` 사용자 여정 단계
- `steps[].phase`, `steps[].name`
- `steps[].capture` 캡처 정책

기준 예시는 `packages/bridge/examples/commerce-checkout.json` 에 있습니다.

### 6. Run the scenario

```bash
node dist/index.js run checkout-flow.json \
  --selenoid http://localhost:4444 \
  --browsers chrome:128.0,firefox:130.0 \
  --concurrency 5 \
  --request-timeout 30000 \
  --capture failure
```

`--selenoid` 는 원격 브라우저 엔진 주소이므로 캡처 정책은 실행하는 쪽에서 제어합니다. 새 템플릿은 `"capture": "failure"` 로 생성되지만, 이전처럼 모든 단계 캡처가 필요하면 실행 시 `--capture all` 을 넘기면 됩니다. 완전히 끄려면 `--capture off` 를 사용하세요.

`--browsers` 는 `browser[:version]` 목록입니다. `--browsers chrome` 은 Selenoid 설정의 `chrome.default` 를 사용하고, `--browsers chrome:128` 은 `browsers.json` 의 `versions` 중 `128` 로 시작하는 버전을 선택합니다. 이 워크스페이스 기본 Chrome 풀은 Selenoid prebuilt 태그 기준으로 `116.0`, `122.0`, `128.0` 이고, 직접 빌드한 최신 체크포인트 이미지는 `147.0` 입니다. 여러 버전을 돌리려면 `--browsers chrome:116.0,chrome:122.0,chrome:128.0,chrome:147.0` 처럼 넘기고, Selenoid 쪽 설정과 Docker image pull을 먼저 맞춰야 합니다.

실행 결과는 기본적으로 `packages/bridge/artifacts/<scenario>-<timestamp>/` 아래에 생성됩니다.

- `report.json`
- `report.html`
- `<browser>/NN-step-name-passed.png`

## Recommended Workflow

1. `packages/bridge` 에서 템플릿으로 시나리오를 생성합니다.
2. 서비스별 실제 selector만 `selectors` 사전에 맞춥니다.
3. `validate` 로 포맷을 확인합니다.
4. `run` 으로 다중 브라우저 실행 후 HTML 리포트를 검토합니다.

예시:

```bash
cd packages/bridge
node dist/index.js validate checkout-flow.json
node dist/index.js run checkout-flow.json --selenoid http://localhost:4444 --browsers chrome:128.0
```

## Skill Entry Point

이 워크스페이스에는 `skills/e2e-test/` 스킬이 포함되어 있습니다. 지원하는 기본 명령은 다음과 같습니다.

```text
/e2e-test setup
/e2e-test create "my-test" --url https://example.com
/e2e-test run my-test.json --browsers chrome:128.0
/e2e-test status
/e2e-test stop
```

## Docs

- `docs/getting-started.md` - 설치와 기본 실행 흐름
- `docs/architecture.md` - 컴포넌트 구조와 데이터 흐름
- `docs/browser-image-checkpoints.md` - 브라우저 이미지 풀과 최신 Chrome 체크포인트 운영 방식
- `docs/tailscale-setup.md` - Tailscale 원격 접근 방식
- `packages/bridge/README.md` - 시나리오 포맷과 리포트 상세
- `packages/selenoid/README.md` - Selenoid 자체 문서
- `packages/images/README.md` - 이미지 빌더 문서
