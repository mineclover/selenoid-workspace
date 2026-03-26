# Selenoid + Tailscale 네트워크 설정

Selenoid를 Tailscale 네트워크를 통해 원격 접근 가능하게 만드는 3가지 방식.

---

## 방식 1: 호스트 포트 매핑 (가장 단순)

호스트에 Tailscale이 설치되어 있으면 추가 설정 없이 동작한다.

```
Tailscale 네트워크의 다른 기기
    ↓ http://<tailscale-ip>:4444
호스트 (Tailscale 연결됨)
    ↓ -p 4444:4444
Selenoid 컨테이너 (또는 네이티브 바이너리)
    ↓ Docker socket
브라우저 컨테이너들
```

### Docker 실행

```bash
docker run -d --name selenoid \
  -p 4444:4444 \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v $(pwd)/browsers.json:/etc/selenoid/browsers.json:ro \
  selenoid/selenoid:latest
```

### 네이티브 실행

```bash
./selenoid -listen :4444 -conf browsers.json
```

### 접근

```bash
# 호스트의 Tailscale IP 확인
tailscale ip -4

# 다른 기기에서
curl http://<tailscale-ip>:4444/ping
```

**장점**: 설정 제로, 즉시 동작
**단점**: 호스트에 Tailscale 필수, 포트가 호스트에 직접 바인딩됨

---

## 방식 2: Tailscale 사이드카 (독립 Tailscale ID)

Selenoid가 자체 Tailscale 노드로 등록되어 호스트와 독립적으로 접근 가능하다.

```
Tailscale 네트워크
    ↓ http://selenoid:4444 (Tailscale MagicDNS)
Tailscale 사이드카 ←→ Selenoid (network namespace 공유)
                           ↓ Docker socket
                      브라우저 컨테이너들
```

### docker-compose.yml

```yaml
services:
  tailscale:
    image: tailscale/tailscale:latest
    container_name: selenoid-ts
    hostname: selenoid
    cap_add:
      - NET_ADMIN
      - SYS_MODULE
    volumes:
      - tailscale-state:/var/lib/tailscale
      - /dev/net/tun:/dev/net/tun
    environment:
      - TS_AUTHKEY=${TS_AUTHKEY}
      - TS_STATE_DIR=/var/lib/tailscale
      - TS_HOSTNAME=selenoid
    restart: unless-stopped

  selenoid:
    image: aerokube/selenoid:latest
    # 또는 로컬 빌드: build: .
    network_mode: service:tailscale
    depends_on:
      - tailscale
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - ./browsers.json:/etc/selenoid/browsers.json:ro
      - ./video:/opt/selenoid/video
    restart: unless-stopped

volumes:
  tailscale-state:
```

### 사용법

```bash
# 1. Tailscale auth key 생성 (https://login.tailscale.com/admin/settings/keys)
#    - Reusable: 선택
#    - Ephemeral: 선택 (컨테이너 종료 시 자동 제거)

# 2. 실행
TS_AUTHKEY=tskey-auth-xxx docker compose up -d

# 3. 다른 기기에서 접근 (MagicDNS 사용)
curl http://selenoid:4444/ping
# 또는 Tailscale IP로
curl http://100.x.y.z:4444/ping
```

**장점**: Selenoid 전용 Tailscale 주소, 호스트 Tailscale 불필요, ACL로 접근 제어 가능
**단점**: Auth key 필요, docker-compose 설정

---

## 방식 3: Tailscale Serve/Funnel (HTTPS + 인증)

Tailscale의 내장 리버스 프록시로 HTTPS 자동 인증서 + ACL 기반 접근 제어.

```
[Serve]  Tailscale 네트워크 내부만 접근 가능
         https://selenoid.<tailnet>.ts.net → localhost:4444

[Funnel] 인터넷에서도 접근 가능 (공개)
         https://selenoid.<tailnet>.ts.net → localhost:4444
```

### Serve (Tailscale 네트워크 내부 전용)

```bash
# Selenoid 실행 (네이티브 또는 Docker -p 4444:4444)
./selenoid -listen :4444 -conf browsers.json &

# Tailscale Serve 설정
tailscale serve --bg 4444

# 확인
tailscale serve status
```

접근: `https://<hostname>.<tailnet>.ts.net/ping`

### Funnel (인터넷 공개)

```bash
# Selenoid 실행
./selenoid -listen :4444 -conf browsers.json &

# Funnel 설정 (인터넷에서 접근 가능)
tailscale funnel --bg 4444

# 확인
tailscale funnel status
```

접근: `https://<hostname>.<tailnet>.ts.net/ping` (인터넷 어디서든)

### 중지

```bash
tailscale serve reset   # Serve 중지
tailscale funnel reset  # Funnel 중지
```

**장점**: HTTPS 자동, Tailscale ACL로 인증, Funnel은 인터넷 공개 가능
**단점**: Serve는 Tailscale 네트워크 내부만, Funnel은 보안 주의 필요

---

## 방식 비교

| | 방식 1: 포트 매핑 | 방식 2: 사이드카 | 방식 3: Serve/Funnel |
|---|---|---|---|
| 난이도 | 매우 쉬움 | 중간 | 쉬움 |
| HTTPS | ✗ | ✗ | ✅ 자동 |
| 독립 Tailscale ID | ✗ | ✅ | ✗ (호스트 공유) |
| 호스트 Tailscale 필요 | ✅ | ✗ | ✅ |
| ACL 제어 | 호스트 단위 | 컨테이너 단위 | 호스트 단위 |
| 인터넷 공개 | ✗ | ✗ | ✅ (Funnel) |
| Docker-only 환경 | ✗ | ✅ | ✗ |
