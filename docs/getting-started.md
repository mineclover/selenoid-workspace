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
  --browsers chrome:128.0,firefox:130.0
```

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
