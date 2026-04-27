# renderer

헤드리스 렌더러 서버. `chrome-headless-shell` + BeginFrame CDP로 HTML 페이지를 프레임 단위로 캡처하고, Sharp(libvips)로 스프라이트 레이어를 합성해 animated WebP를 출력합니다.

## 요구 사항

- **linux/amd64** 전용 (BeginFrame CDP는 headless-shell x86_64 바이너리에서만 동작)
- Apple Silicon에서는 Rosetta 2를 통해 실행됩니다

## 빌드 및 실행

```bash
# 이미지 빌드 (workspace 루트에서)
docker build -f packages/renderer/Dockerfile \
  --build-arg CACHE_BUST=$(date +%s) \
  -t renderer:local .

# 실행
docker run -p 9847:9847 -v "$(pwd)/renders:/renders" renderer:local
```

기본 포트: `9847`. 렌더 결과는 `/renders` 볼륨에 저장됩니다.

## API

### POST /render/html

Hyperframes 페이지를 프레임 단위로 캡처해 animated WebP를 반환합니다.

```json
{
  "url": "http://host/page.html",
  "fps": 30,
  "duration": 3,
  "width": 1280,
  "height": 720,
  "format": "webp"
}
```

응답: `Content-Type: video/webp` — animated WebP 바이너리

**동작**

1. Puppeteer로 `chrome-headless-shell` 실행
2. `HeadlessExperimental.beginFrame` CDP 커맨드로 결정론적 프레임 캡처
3. `window.__hf.seek(t)` 호출로 각 프레임 시각 지정
4. PNG 프레임을 ffmpeg stdin 파이프로 스트리밍 → animated WebP

### POST /render/sprites

스프라이트 레이어를 투명 animated WebP로 합성합니다.

```json
{
  "layers": [
    {
      "url": "http://host/sprite.webp",
      "xExpr": "(main_w - overlay_w) * 0.5 + (main_w - overlay_w) * 0.38 * cos(t * 1.2)",
      "yExpr": "(main_h - overlay_h) * 0.5 + (main_h - overlay_h) * 0.38 * sin(t * 1.2)",
      "transparent": true
    }
  ],
  "fps": 30,
  "duration": 3,
  "width": 800,
  "height": 600,
  "format": "webp",
  "transparent": true,
  "quality": 80
}
```

응답: `Content-Type: video/webp` — animated WebP 바이너리 (알파 보존)

**레이어 xExpr / yExpr**

FFmpeg 스타일 산술 표현식. 보안을 위해 `safeExpr()`로 `[^0-9a-zA-Z_+\-*/().,': ]` 이외 문자를 제거한 뒤 `compileOrbit()`으로 렌더 시작 시 한 번만 컴파일합니다 (per-frame `new Function()` 호출 없음).

| 변수 | 설명 |
|---|---|
| `main_w` | 출력 가로 픽셀 |
| `main_h` | 출력 세로 픽셀 |
| `overlay_w` | 스프라이트 가로 픽셀 |
| `overlay_h` | 스프라이트 세로 픽셀 |
| `t` | 현재 시각(초) |
| `cos`, `sin`, `PI` | 수학 함수/상수 |

### GET /outputs/:token

렌더 완료 응답에 포함된 `outputToken`으로 결과 파일을 다운로드합니다. 토큰은 발급 후 15분간 유효합니다.

- 파일 전체를 메모리에 올리지 않고 `createReadStream`으로 스트리밍합니다
- 다운로드가 완료되면 토큰과 파일을 즉시 삭제합니다
- 만료된 토큰은 60초 주기 cleanup에서 파일과 함께 삭제됩니다

## 합성 파이프라인

```
레이어 입력 (URL)
      │
      ▼
레이어별 프레임 디코딩 (Sharp)
      │
      ▼  ← xExpr/yExpr 위치 계산 (evalOrbit, 초당 t값)
Sharp Porter-Duff "over" 합성 (BATCH=8 프레임 병렬)
      │  알파 채널 보존 (channels:4, background:{alpha:0})
      ▼
ffmpeg stdin 파이프 (image2pipe, -vcodec png)
      │
      ▼
libwebp_anim 인코더 → animated WebP
```

**왜 ffmpeg overlay 필터 대신 Sharp를 쓰나?**

ffmpeg 5.1에서 `overlay` 필터는 알파 채널을 출력 포맷으로 전달하지 못합니다. VP9 WebM의 경우 알파가 별도 스트림으로 인코딩되어 overlay가 읽지 못합니다. Sharp의 Porter-Duff `over` 합성은 프레임별로 RGBA를 완전히 보존합니다.

**ffmpeg stdin 파이프 최적화**

중간 PNG를 디스크에 쓰지 않고 Sharp 결과를 직접 ffmpeg stdin으로 스트리밍합니다. 고해상도·장시간 애니메이션에서 ~600MB 이상의 임시 I/O를 제거합니다.

**orbit 표현식 사전 컴파일**

`xExpr`/`yExpr`는 렌더 시작 시 `compileOrbit()`으로 한 번만 `Function` 객체로 컴파일합니다. 30fps 3s 4레이어 기준 720회였던 `new Function()` 호출이 8회로 줄어듭니다.

**base64 단일 디코드**

각 레이어의 base64 이미지는 Pass 1(크기 계산)에서 한 번 디코드 후 Pass 2a(디스크 쓰기)에서 재사용합니다.

## 환경 변수

| 변수 | 기본값 | 설명 |
|---|---|---|
| `PORT` | `9847` | 서버 수신 포트 |
| `RENDERS_DIR` | `/renders` | 렌더 파일 저장 디렉토리 |

## 보안

- **경로 순회 방어**: 파일 쓰기와 정적 서빙 모두 `target.startsWith(workDir + "/")` 검사
- **표현식 인젝션 방어**: `safeExpr()` 화이트리스트로 `xExpr/yExpr` 정제 후 `compileOrbit()` 평가
- **작업 디렉토리 정리**: `renderHtml` / `renderSprites` 모두 `try/finally`로 임시 파일 보장 삭제
- **출력 파일 자동 삭제**: 다운로드 완료 즉시 또는 15분 만료 시 `RENDERS_DIR`에서 삭제
