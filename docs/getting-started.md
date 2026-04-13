# Getting Started

## 사전 요구사항

- Docker Desktop
- Go 1.25+
- Node.js 20+
- (선택) Tailscale — 원격 접근 시

## 설치

```bash
git clone --recurse-submodules https://github.com/mineclover/selenoid-workspace.git
cd selenoid-workspace
```

## 환경 설정

### 1. Selenoid 빌드

```bash
cd packages/selenoid
go build -o /tmp/selenoid-test .
```

### 2. 브라우저 이미지 Pull

```bash
docker pull selenoid/chrome:128.0
# 추가 브라우저:
# docker pull selenoid/firefox:130.0
```

### 3. browsers.json 작성

```bash
cat > /tmp/browsers-test.json << 'EOF'
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
```

### 4. Selenoid 시작

```bash
/tmp/selenoid-test -listen :4444 -conf /tmp/browsers-test.json -limit 5 -timeout 60s -disable-privileged &
curl -s http://localhost:4444/ping
```

`-limit` 은 동시에 열 수 있는 브라우저 세션 수입니다. `bridge run --concurrency` 도 같은 값 이하로 맞추면 Selenoid 큐가 불필요하게 길어지는 것을 피할 수 있습니다.

### 5. Bridge 설치

```bash
cd packages/bridge
npm install && npm run build
```

## 사용법

### 시나리오 생성

```bash
cd packages/bridge
node dist/index.js create "login-test" --url https://myapp.com
```

### 시나리오 실행

```bash
node dist/index.js run login-test.json --selenoid http://localhost:4444 --browsers chrome:128.0
```

### 크로스 브라우저 실행

```bash
node dist/index.js run login-test.json \
  --selenoid http://localhost:4444 \
  --browsers chrome:128.0,firefox:130.0 \
  --concurrency 5 \
  --request-timeout 30000 \
  --capture failure
```

`--selenoid` 는 원격 브라우저 엔진 주소이므로, 스크린샷 캡처는 실행하는 쪽에서 `--capture` 로 제어합니다. 새 템플릿은 기본적으로 실패 단계만 캡처하지만, 이전처럼 모든 단계를 캡처하려면 `--capture all` 을 사용합니다. 캡처를 끄려면 `--capture off` 를 사용합니다.

`--browsers` 는 `browser[:version]` 목록입니다. `chrome` 처럼 버전을 생략하면 Selenoid `browsers.json` 의 기본 버전을 사용합니다. `chrome:128` 처럼 prefix를 넘기면 `128.0` 같은 등록 버전과 매칭됩니다. 이 워크스페이스 기본 Chrome 풀은 `116.0`, `122.0`, `128.0` 이고 직접 빌드한 최신 체크포인트 이미지는 `147.0` 입니다. 다양한 버전을 선택하려면 `browsers.json` 의 `versions` 에 각 버전을 추가하고, 해당 이미지를 미리 pull한 뒤 Selenoid를 reload하세요.

## Claude Code 스킬 사용

이 워크스페이스에서 Claude Code를 실행하면 `/e2e-test` 스킬이 자동 로드됩니다.

```
/e2e-test setup                              # 환경 구성
/e2e-test create "my-test" --url https://...  # 시나리오 생성
/e2e-test run test.json                       # 실행
/e2e-test status                              # 상태 확인
/e2e-test stop                                # 중지
```

## Tailscale 원격 접근

상세 설정은 [tailscale-setup.md](./tailscale-setup.md) 참고.

```bash
# 방식 1: 호스트 Tailscale IP (추가 설정 없음)
curl http://<tailscale-ip>:4444/ping

# 방식 2: Docker + Tailscale 사이드카
TS_AUTHKEY=tskey-xxx docker compose -f packages/selenoid/docker-compose.tailscale.yml up -d

# 방식 3: Tailscale Serve (HTTPS)
tailscale serve --bg 4444
```
