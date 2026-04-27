# selenoid-workspace TODO

> 마지막 업데이트: 2026-04-28

---

## packages/bridge

### 🔴 High

- [ ] **WebDriver 테스트 업데이트** (`tests/webdriver.test.ts`)
  새 액션(double-click, right-click, upload, press.keys) 단위 테스트 추가.
  기존 브라우저 capabilities 직렬화 관련 assertion 2건 실패 중 — 확인 후 수정.

- [ ] **CLAUDE.md 액션 문서 갱신**
  `double-click`, `right-click`, `upload`, `press.keys` 콤보 예시 추가.

### 🟡 Medium

- [ ] **WebDriver 재시도 로직**
  일시적 네트워크 오류·컨테이너 기동 지연 시 즉시 abort됨.
  핵심 요청(`createSession`, `navigate`, element 탐색)에 exponential backoff 적용.

- [ ] **stealth 실패 진단**
  `applyStealth()`가 `.catch(() => undefined)` 로 소리없이 실패함.
  CDP 명령 실패 시 warn 로그 추가.

### 🟢 Low

- [ ] **keyboard shortcut 확장**
  `mapKey`에 F1–F12 전체, NumLock, CapsLock, PrintScreen 추가.

- [ ] **assert 타입 확장**
  `assert count` (엘리먼트 개수), `assert attribute` (속성값) 추가 검토.

---

## packages/mixamo

### 🟡 Medium

- [ ] **split FBX (--char + --anim) 실테스트**
  Mixamo에서 캐릭터 FBX + 별도 애니메이션 FBX 다운로드 후 테스트.
  `--char character.fbx --anim walking.fbx` 워크플로우 검증.

- [ ] **ComfyUI generate 연동 테스트**
  ComfyUI 실행 환경에서 `generate --comfyui http://127.0.0.1:8188` 실제 제출 검증.
  워크플로우 JSON이 ComfyUI에서 정상 임포트되는지 확인.

- [ ] **다양한 모션 OpenPose 품질 검증**
  Walking, Running, Idle 등 다른 애니메이션으로 OpenPose 출력 품질 확인.
  측면 뷰(`--view side`) OpenPose 렌더 검증.

### 🟢 Low

- [ ] **얼굴 키포인트 정확도 개선**
  현재 Head bone 위치에서 neck-length 비율로 추정.
  head bone 방향 벡터를 활용한 개선 검토.

- [ ] **batch 렌더링 커맨드**
  디렉토리 내 여러 FBX 파일을 일괄 렌더링하는 `batch` 커맨드.

---

## packages/selenoid

### 🟡 Medium

- [ ] **browsers.json 자동 갱신 스크립트**
  `scripts/use-extensions.sh`를 CI/docker-compose 시작 훅으로 연결.
  `EXTENSIONS_DIR` 미설정 시 `browsers.json` 자동으로 기본값 사용.

### 🟢 Low

- [ ] **selenoid.go TODO 정리** (`line 59`)
  `localaddr()` 추출 로직 주석 개선 또는 리팩토링.

- [ ] **브라우저 버전 추가**
  Chrome 149+ 이미지 확인 및 `browsers.json` 업데이트.

---

## 파이프라인 전체

### 🟡 Medium

- [ ] **FBX → OpenPose → ComfyUI 엔드투엔드 테스트**
  실제 캐릭터로 전체 파이프라인 1회 검증:
  `render --openpose` → `generate --workflow-out` → ComfyUI 임포트 → `strip`

- [ ] **생성 이미지 후처리 자동화**
  ComfyUI 출력 → `remove-bg` → `strip` → `layers.json` 생성 자동화 스크립트.

### 🟢 Low

- [ ] **워크스페이스 README 작성**
  루트 `README.md` — 전체 패키지 구조, 빠른 시작, 각 패키지 링크.
