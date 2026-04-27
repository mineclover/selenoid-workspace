# 스프라이트 레이어 설계 가이드

`render-sprites` 파이프라인의 레이어 JSON 구성, xExpr/yExpr 표현식, 합성 설계 원칙을 설명합니다.  
스프라이트 이미지 파일 자체를 만드는 방법은 [`sprite-image-guide.md`](./sprite-image-guide.md) 를 참고하세요.

---

## 레이어 JSON 포맷

`--layers <file.json>` 로 전달하는 배열의 각 항목:

```json
{
  "name": "rect.png",
  "file": "./rect.png",
  "frameWidth": 120,
  "frameHeight": 120,
  "rows": 1,
  "xExpr": "main_w/2 - overlay_w/2 + (main_w - overlay_w)*0.38*cos(t*1.0)",
  "yExpr": "main_h/2 - overlay_h/2 + (main_h - overlay_h)*0.38*sin(t*1.0)",
  "x": 0,
  "y": 0,
  "loop": true
}
```

| 필드 | 필수 | 설명 |
|---|---|---|
| `name` | ✓ | 레이어 식별자 (파일명 형식) |
| `file` | ✓ | 파일 경로, base64 문자열, 또는 `data:image/...` URI |
| `frameWidth` | ✓ | 한 프레임 가로(px) |
| `frameHeight` | ✓ | 한 프레임 세로(px) |
| `rows` | | 그리드 행 수 (기본 1 = 가로 스트립) |
| `xExpr` | | x 좌표 표현식 (설정 시 `x` 무시) |
| `yExpr` | | y 좌표 표현식 (설정 시 `y` 무시) |
| `x` | | 정적 x 위치 px (기본 0) |
| `y` | | 정적 y 위치 px (기본 0) |
| `loop` | | 프레임 수 < 총 출력 프레임일 때 반복 (기본 true) |

### `file` 필드 인식 순서

1. `data:image/...;base64,...` → `,` 이후 base64 부분만 사용
2. 길이 > 200이고 첫 50자가 base64 문자 → base64 그대로 사용
3. 그 외 → 파일 경로로 읽어 base64 인코딩

---

## xExpr / yExpr 표현식

레이어 좌상단 좌표(px)를 시각 `t`(초)의 함수로 정의합니다. 렌더 시작 시 한 번 컴파일되어 프레임마다 재사용됩니다.

### 사용 가능한 변수

| 변수 | 의미 |
|---|---|
| `main_w` | 출력 캔버스 가로(px) |
| `main_h` | 출력 캔버스 세로(px) |
| `overlay_w` | 이 레이어 `frameWidth` |
| `overlay_h` | 이 레이어 `frameHeight` |
| `t` | 현재 시각(초, 0부터 시작) |
| `cos`, `sin`, `tan`, `sqrt`, `abs` | 수학 함수 |
| `PI` | 3.14159... |

허용 문자: `0-9 a-z A-Z _ + - * / ( ) . , ' 공백`  
그 외 문자는 실행 전 제거됩니다 (인젝션 방어).

### 표현식 레시피

**중앙 고정**
```
xExpr: "main_w/2 - overlay_w/2"
yExpr: "main_h/2 - overlay_h/2"
```

**원형 공전**
```
xExpr: "main_w/2 - overlay_w/2 + (main_w - overlay_w)*0.38*cos(t*1.5)"
yExpr: "main_h/2 - overlay_h/2 + (main_h - overlay_h)*0.38*sin(t*1.5)"
```

**교차 공전** — 레이어끼리 경로를 교차시키려면 **궤도 반경이 같아야** 합니다

```javascript
// 공통 변수 (JavaScript로 표현식 조립 시)
const rx = "(main_w - overlay_w) * 0.38";
const ry = "(main_h - overlay_h) * 0.38";
const cx = "main_w/2 - overlay_w/2";
const cy = "main_h/2 - overlay_h/2";

// 레이어 A: 시계 방향, 위상 0
xExpr: `${cx} + ${rx}*cos(t*1.0)`
yExpr: `${cy} + ${ry}*sin(t*1.0)`

// 레이어 B: 반시계 방향, 위상 π/3 (60°)
xExpr: `${cx} + ${rx}*cos(-t*1.4 + 1.0472)`
yExpr: `${cy} + ${ry}*sin(-t*1.4 + 1.0472)`

// 레이어 C: 시계 방향, 위상 2π/3 (120°), 빠른 속도
xExpr: `${cx} + ${rx}*cos(t*1.9 + 2.0944)`
yExpr: `${cy} + ${ry}*sin(t*1.9 + 2.0944)`
```

위상 참고값: `1.0472 = π/3`, `2.0944 = 2π/3`, `3.1416 = π`

**수평 왕복**
```
xExpr: "main_w/2 - overlay_w/2 + (main_w - overlay_w)*0.4*cos(t*2.0)"
yExpr: "main_h/2 - overlay_h/2"
```

**나선형 확산**
```
xExpr: "main_w/2 - overlay_w/2 + (0.1 + t*0.05)*main_w*cos(t*3.0)"
yExpr: "main_h/2 - overlay_h/2 + (0.1 + t*0.05)*main_h*sin(t*3.0)"
```

---

## 레이어 합성 설계 원칙

### 레이어 순서 (아래→위)

```
Layer 0 — 배경 (불투명 또는 투명 채우기)
Layer 1 — 가장 아래 도형
Layer 2 — 그 위 도형
...
Layer N — 가장 위 도형
```

렌더러는 이 순서대로 Porter-Duff `over` 합성합니다. 배경 레이어에 알파가 없으면 아래 레이어가 완전히 가려집니다.

### 프레임 수 계산

```
총 출력 프레임 = ceil(duration × fps)
레이어 프레임 수 = 시트 전체 가로 / frameWidth  (×  rows)

loop: true  → 레이어 프레임을 순환 (fi % totalFrames)
loop: false → 마지막 프레임을 정지 유지
```

**루프 경계 끊김 방지**: 애니메이션 주기가 `duration`과 딱 맞아 떨어져야 마지막 프레임에서 점프가 없습니다.

```
권장: nFrames = round(duration × fps / n)   // n = 반복 횟수
예시: 30fps × 3s = 90프레임, n=3 → nFrames = 30
```

### duration 자동 추정

`--duration` 생략 시 `max(레이어별 totalFrames / fps)` 로 결정됩니다.  
`loop: true` 레이어가 있으면 duration이 가장 긴 비-loop 레이어에 맞춰집니다. 원하는 길이가 있으면 항상 명시하세요.

---

## 완성 예시 — layers.json

```json
[
  {
    "name": "bg.png",
    "file": "./bg.png",
    "frameWidth": 1280,
    "frameHeight": 720
  },
  {
    "name": "particle.png",
    "file": "./particle.png",
    "frameWidth": 64,
    "frameHeight": 64,
    "rows": 4,
    "xExpr": "main_w/2 - overlay_w/2 + (main_w - overlay_w)*0.38*cos(t*2.0)",
    "yExpr": "main_h/2 - overlay_h/2 + (main_h - overlay_h)*0.38*sin(t*2.0)",
    "loop": true
  },
  {
    "name": "overlay.png",
    "file": "./overlay.png",
    "frameWidth": 200,
    "frameHeight": 200,
    "x": 40,
    "y": 40
  }
]
```

```bash
node dist/index.js render-sprites \
  --layers layers.json \
  --format webp \
  --transparent \
  --fps 30 \
  --duration 3 \
  --width 1280 \
  --height 720 \
  --quality standard \
  --output result.webp
```
