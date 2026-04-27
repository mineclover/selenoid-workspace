# 스프라이트 이미지 제작 가이드

`render-sprites` 파이프라인에 공급할 스프라이트 이미지 파일을 만드는 방법을 설명합니다.  
레이어 JSON 설정과 xExpr 표현식은 [`sprite-authoring-guide.md`](./sprite-authoring-guide.md) 를 참고하세요.

---

## 스프라이트 시트 구조

**가로 스트립** (rows=1, 기본값): 프레임을 왼→오른으로 이어 붙인 단일 이미지

```
┌────────┬────────┬────────┬────────┐
│ frame0 │ frame1 │ frame2 │ frame3 │
└────────┴────────┴────────┴────────┘
  전체 가로 = frameWidth × 4
  전체 세로 = frameHeight
```

**그리드** (rows > 1): 가로 먼저, 위→아래 순서

```
┌────────┬────────┐
│ frame0 │ frame1 │   rows=2, cols=2
├────────┼────────┤   전체 가로 = frameWidth × cols
│ frame2 │ frame3 │   전체 세로 = frameHeight × rows
└────────┴────────┘
```

렌더러는 `frameWidth × frameHeight` 단위로 잘라 각 출력 프레임에 합성합니다.

---

## 파일 규칙

| 항목 | 규칙 |
|---|---|
| 포맷 | **PNG RGBA** 권장, JPEG(알파 없음), WebP |
| 프레임 배치 | 가로 스트립: 왼→오른 / 그리드: 행 우선 |
| 파일 크기 | 파일당 최대 20 MB |
| 시트 가로 | 최대 8192 px (canvas 렌더 모드 시 SwiftShader 한도) |
| 파일명 | 레이어 JSON의 `name` 필드와 일치 (확장자 포함) |

---

## 알파(투명도) 설계

합성 엔진은 Porter-Duff **over** 블렌딩을 사용합니다.

| 영역 | alpha 값 | 결과 |
|---|---|---|
| 도형 내부 | `alpha = 255` | 이 레이어 색상만 보임 |
| 완전 투명 | `alpha = 0` | 아래 레이어가 그대로 비침 |
| 반투명 | `alpha = 1~254` | 이 레이어와 아래 레이어 혼합 |
| 테두리 페이드 | `alpha` 그라데이션 | 계단 현상 제거 (안티앨리어싱) |

### 안티앨리어싱 구현 원칙

테두리에서 1.5 px 범위로 `alpha`를 `0 → max` 로 선형 보간하면 부드러운 경계가 생깁니다.

```typescript
const aa = 1.5; // 소프트니스 픽셀 수
const edgeFade = Math.min(1, (distToEdge + aa) / (aa * 2));
alpha = Math.round(maxAlpha * edgeFade);
```

---

## 코드로 스프라이트 생성 (Node.js)

`packages/bridge/src/index.ts`에 내장된 생성기 함수들을 참고하거나 직접 활용합니다.

### 속이 빈 사각형 테두리 (회전 애니메이션)

```typescript
makeHollowRectStrip(
  frameWidth:  120,          // 한 프레임 가로(px)
  frameHeight: 120,          // 한 프레임 세로(px)
  rgb:         [0, 220, 230],// 테두리 RGB
  borderW:     10,           // 테두리 두께(px)
  nFrames:     16,           // 회전 단계 수 (프레임 수)
  alpha:       180,          // 최대 알파 0-255
)
// 출력: frameWidth*nFrames × frameHeight 가로 스트립 PNG (RGBA)
// 각 프레임은 fi/nFrames * 2π 만큼 회전
```

### 속이 빈 링 (정적 단일 프레임)

```typescript
makeHollowRingSprite(
  frameWidth:  150,
  frameHeight: 150,
  rgb:         [250, 210, 40],
  innerFrac:   0.5,           // 내부 반지름 / 외부 반지름 (0.0~1.0)
  alpha:       180,
)
// 출력: frameWidth × frameHeight 단일 프레임 PNG (RGBA)
// 링은 회전 대칭이므로 단일 프레임으로도 공전 표현 가능
```

### 속이 빈 다이아몬드 (회전 애니메이션)

```typescript
makeHollowDiamondStrip(
  frameWidth:  100,
  frameHeight: 100,
  rgb:         [230, 50, 220],
  borderW:     8,
  nFrames:     16,
  alpha:       180,
)
// 출력: frameWidth*nFrames × frameHeight 가로 스트립 PNG (RGBA)
// 맨해튼 거리 기반 다이아몬드 SDF, 각 프레임 회전
```

### 직접 RGBA PNG 생성

```typescript
function makeRGBAPNG(
  w: number,
  h: number,
  px: (x: number, y: number) => [r: number, g: number, b: number, a: number]
): Buffer
```

픽셀 함수를 넘기면 순수 Node.js(zlib만 사용)로 PNG를 생성합니다. 의존성이 없어 빌드 환경을 타지 않습니다.

---

## 외부 툴로 스프라이트 시트 만들기

| 툴 | 용도 |
|---|---|
| **TexturePacker** | GUI 패킹, strip/sheet 내보내기, 알파 트리밍 |
| **Aseprite** | 픽셀 아트 애니메이션 → sprite sheet 내보내기 |
| **ImageMagick** | CLI 이어붙이기 |
| **FFmpeg** | 동영상 → 프레임 추출 → strip 변환 |
| **Sharp (Node.js)** | 프로그래밍 방식 합성/리사이즈 |

### ImageMagick — 프레임 → 가로 스트립

```bash
# RGBA PNG 프레임들을 가로로 이어 붙이기
magick frame_000.png frame_001.png frame_002.png +append strip.png

# 알파 채널 유지 여부 확인
magick identify -verbose strip.png | grep -i "alpha\|type\|channel"

# 배경을 투명으로 유지하면서 리사이즈
magick strip.png -background none -resize 50% strip_half.png
```

### FFmpeg — 동영상 → 프레임 → 스트립

```bash
# 동영상에서 RGBA 프레임 추출 (fps=16, 120×120으로 리사이즈)
ffmpeg -i source.mp4 -vf "fps=16,scale=120:120" -pix_fmt rgba frame_%04d.png

# 프레임 → 가로 스트립
magick frame_*.png +append strip.png
```

### TexturePacker 내보내기 설정

- Data Format: `JSON Array` 또는 `JSON Hash`
- Algorithm: `Strip`
- Max size: `8192×8192`
- Allow rotation: **OFF** (렌더러가 회전을 지원하지 않음)
- Premultiply alpha: **OFF** (Porter-Duff 합성과 충돌)

---

## Mixamo → AI 생성 워크플로우

3D 애니메이션 포즈를 AI 2D 스프라이트 생성의 레퍼런스로 활용하는 권장 워크플로우입니다.

```
Mixamo (3D 포즈 레퍼런스)
    ↓  프레임별 스크린샷 or 렌더 이미지
AI 이미지 생성  (포즈 ref → 2D 애니 스타일)
    ↓  n × 1024 또는 n × 2048 가로 스트립
배경 제거 → RGBA PNG
    ↓
render-sprites (레이어 합성 → animated WebP)
```

### Step 1 — Mixamo에서 포즈 레퍼런스 추출

1. [mixamo.com](https://www.mixamo.com/) 에서 캐릭터 + 애니메이션 선택
2. 원하는 키프레임(보행 사이클 기준 8~16프레임)에서 **스크린샷** 촬영
   - 배경을 단색(흰/검정)으로 설정하고 캐릭터만 보이게 클린업
   - 카메라 각도 고정 (정면 또는 측면) — 모든 프레임에서 동일한 앵글 유지
3. 각 프레임을 `pose_00.png`, `pose_01.png` ... 로 저장

**권장 프레임 수**

| 애니메이션 유형 | 권장 프레임 수 |
|---|---|
| 걷기 사이클 | 8~12 |
| 달리기 | 6~8 |
| 공격/스킬 | 8~16 |
| 아이들 | 4~6 |

### Step 2 — AI 이미지 생성 (포즈 레퍼런스 기반)

포즈 레퍼런스 이미지를 AI 생성기에 첨부(ControlNet, Image-to-Image, 또는 Reference 모드)하거나, 프롬프트에 포즈 설명을 직접 기재합니다.

**출력 해상도 목표**

| 프레임 수 | 프레임 크기 | 스트립 전체 크기 |
|---|---|---|
| 4 | 512×1024 | 2048×1024 |
| 8 | 512×1024 | 4096×1024 |
| 8 | 512×2048 | 4096×2048 |
| 16 | 512×1024 | 8192×1024 (최대) |

**배경색 권장: `#00FF00` (크로마키 그린)**

흰색 배경은 캐릭터의 흰 의상과 겹쳐 제거가 어렵습니다. 순수 그린(`#00FF00`)을 배경으로 사용하면 `fuzz 10~15%`로 깔끔하게 분리됩니다.

```json
{
  "prompt": "<캐릭터 설명>, 2D anime sprite sheet, horizontal strip layout, 8 walking animation frames, side view, flat coloring, clean black outlines, solid bright green background (#00FF00), frames perfectly aligned side-by-side",
  "negative_prompt": "3d, realistic, vertical layout, multiple rows, text, watermark, gradient background",
  "aspect_ratio": "4:1"
}
```

### Step 3 — 개별 프레임 추출 + 배경 제거

AI가 그리드(n×m) 형태로 생성한 경우 프레임을 한 컷씩 추출합니다.

```bash
# 2048×2048 이미지, 4×2 그리드 → 8프레임 개별 추출
COLS=4; ROWS=2; FW=512; FH=1024
for r in $(seq 0 $((ROWS-1))); do
  for c in $(seq 0 $((COLS-1))); do
    fi=$((r*COLS + c))
    magick input.png \
      -crop ${FW}x${FH}+$((c*FW))+$((r*FH)) +repage \
      -fuzz 12% -transparent "#00FF00" \
      frame_$(printf '%02d' $fi).png
  done
done
```

### Step 4 — 가로 스트립으로 조합

```bash
# 개별 프레임 → 가로 스트립 (파이프라인 입력 포맷)
magick frame_00.png frame_01.png frame_02.png frame_03.png \
       frame_04.png frame_05.png frame_06.png frame_07.png \
       +append sprite_strip.png

# 확인: 4096×1024, TrueColorAlpha
magick identify sprite_strip.png
```

### Step 5 — layers.json 구성

```json
{
  "name": "char.png",
  "file": "./sprite_strip.png",
  "frameWidth": 512,
  "frameHeight": 1024,
  "rows": 1,
  "xExpr": "main_w + overlay_w - t*(main_w + 2*overlay_w) / 4.0",
  "yExpr": "main_h - overlay_h",
  "loop": true
}
```

### 그리드 확인 (sprite-grid)

생성한 스프라이트의 프레임 경계가 맞는지 시각적으로 확인합니다.

```bash
node dist/index.js sprite-grid sprite_strip.png --cols 8 --rows 1 --export-png
# 또는 인터랙티브 HTML 뷰어
node dist/index.js sprite-grid sprite_strip.png --cols 8 --rows 1
```

---

## AI 이미지 생성으로 스프라이트 만들기

Midjourney, Stable Diffusion, DALL-E 등 AI 이미지 생성기로 스프라이트 시트를 만들 수 있습니다.  
생성된 이미지는 후처리(배경 제거, RGBA 변환)가 필요합니다.

### 프롬프트 구조

```json
{
  "prompt": "<캐릭터/오브젝트 설명>, horizontal strip layout, <프레임 수> animation frames, flat <스타일> coloring, clean outlines, solid white background, multiple frames perfectly aligned horizontally side-by-side in a single row",
  "negative_prompt": "3d, realistic, vertical layout, messy background, text, watermarks",
  "aspect_ratio": "16:9"
}
```

핵심 키워드:
- `horizontal strip layout` — 가로 스트립 구조 명시
- `solid white background` — 배경 제거를 쉽게 하기 위한 단색 배경
- `perfectly aligned horizontally side-by-side` — 프레임 정렬 강제
- `flat coloring, clean outlines` — 애니메이션 스타일 유지

### 예시 프롬프트

```json
{
  "prompt": "A 2D sprite sheet of an anime girl, horizontal strip layout, showing a walking animation sequence from left to right. The girl has silver hair, green eyes, a white long-sleeve shirt, green plaid skirt, a green bow tie with a yellow flower, and a red backpack. Flat anime coloring, clean outlines, solid white background, multiple animation frames perfectly aligned horizontally side-by-side in a single row.",
  "negative_prompt": "3d, realistic, vertical layout, messy background, text, watermarks",
  "aspect_ratio": "16:9"
}
```

`aspect_ratio: "16:9"` → 가로가 세로보다 훨씬 긴 비율 → 여러 프레임이 가로로 배치될 가능성 증가

### AI 생성 후 필수 후처리

AI 생성 이미지는 대부분 RGB(알파 없음)이므로 배경 제거가 필요합니다.

**1. 배경 제거 (흰색 배경 → 투명)**

```bash
# ImageMagick: 흰색을 투명으로 변환 (fuzz로 유사 흰색도 포함)
magick strip.png -fuzz 10% -transparent white strip_rgba.png

# 결과 확인
magick identify -verbose strip_rgba.png | grep -i "alpha\|type"
```

**2. 프레임 크기 균등화 확인**

AI가 생성한 스프라이트는 프레임 경계가 불균일할 수 있습니다.

```bash
# 전체 시트 크기 확인
magick identify strip_rgba.png

# 예: 총 1280×720, 프레임 8개 → frameWidth=160, frameHeight=720
```

**3. 프레임 분리 테스트 (ffmpeg로 확인)**

```bash
ffmpeg -i strip_rgba.png -vf "crop=160:720:0:0" frame_test.png
```

프레임 하나가 올바르게 잘리는지 확인한 뒤 `frameWidth`/`frameHeight`를 레이어 JSON에 기록합니다.

### AI 생성 주의 사항

| 문제 | 원인 | 해결 |
|---|---|---|
| 프레임 수가 의도와 다름 | 생성기가 레이아웃을 임의로 결정 | 생성 후 실제 프레임 수 계산 후 `frameWidth` 조정 |
| 프레임 간격이 불균일 | AI의 구조 이해 한계 | 수동으로 리사이즈·크롭 후 이어 붙이기 |
| 배경이 완전 흰색이 아님 | 그라데이션/쉐이딩 | `fuzz` 값을 높이거나 AI 배경 제거 서비스 사용 |
| 캐릭터 일관성 깨짐 | 프레임 간 스타일 차이 | ControlNet(Stable Diffusion) 또는 후처리 통일 |

---

## 체크리스트

스프라이트를 렌더러에 보내기 전 확인 사항:

- [ ] PNG 파일이 **RGBA** (alpha 채널 포함) 인가?
- [ ] 모든 프레임이 정확히 `frameWidth × frameHeight` 크기인가?
- [ ] 프레임 순서가 왼→오른 (가로 스트립), 행 우선 (그리드) 인가?
- [ ] 투명해야 할 영역의 alpha가 0인가?
- [ ] 파일 크기가 20 MB 이하인가?
- [ ] 시트 가로가 8192 px 이하인가?
