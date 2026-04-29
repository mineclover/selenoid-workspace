# selenoid-workspace TODO

> 마지막 업데이트: 2026-04-28

---

## packages/bridge

### 🔴 High

- [x] **WebDriver 테스트 업데이트** (`tests/webdriver.test.ts`)
  doubleClick/rightClick/pressKeys/uploadFile 테스트 추가 + 기존 2건 실패 수정. 52/52 통과.

- [x] **CLAUDE.md 액션 문서 갱신**
  16개 전체 액션 표 + 키 이름 목록 + 콤보 예시 추가.

### 🟡 Medium

- [x] **WebDriver 재시도 로직**
  `request()`에 exponential backoff 3회 (300ms/900ms/2700ms) — 네트워크 오류·502/503/504 재시도.

- [x] **stealth 실패 진단**
  `applyStealth()` catch → `console.warn` 로 실패 메시지 출력.

### 🟢 Low

- [x] **keyboard shortcut 확장**
  F1–F12 전체, Space, Insert 추가. NumLock/CapsLock/PrintScreen은 W3C WebDriver 미지원.

- [x] **assert 타입 확장**
  `assert count` (엘리먼트 개수), `assert attribute` (속성값) 추가. getAttribute/getElementCount 메서드 추가.

---

## packages/mixamo

### 🟡 Medium

- [x] **split FBX (--char + --anim) 실테스트**
  Sword and Shield Pack으로 검증. walk/slash/run/jump/idle/block 6종 전부 정상.
  X Bot.fbx(v6100) 에러 → 즉시 실패(pageerror race) + README 워크어라운드 문서화.

- [ ] **ComfyUI generate 연동 테스트**
  ComfyUI 실행 환경에서 `generate --comfyui http://127.0.0.1:8188` 실제 제출 검증.
  워크플로우 JSON이 ComfyUI에서 정상 임포트되는지 확인.

- [x] **다양한 모션 OpenPose 품질 검증**
  6종 모션 검증 완료. 색상·본 매핑·글로벌 노멀라이제이션 전부 정상.

### 🟢 Low

- [x] **얼굴 키포인트 정확도 개선**
  head bone tail world-space 위치 + bone direction vector 사용. cm/m 단위 버그 수정.

- [x] **batch 렌더링 커맨드**
  `batch <dir>` — *.fbx 일괄 렌더링, `rendered/<stem>/frames/` 출력.

---

## packages/selenoid

### 🟡 Medium

- [x] **browsers.json 자동 갱신**
  docker-compose `browsers-init` 서비스 추가 — `EXTENSIONS_DIR` 설정 시
  envsubst로 browsers.template.json → browsers.json 자동 생성 후 selenoid 시작.

### 🟢 Low

- [x] **selenoid.go TODO 정리** (`line 59`)
  `localaddr()` 주석을 설명적으로 교체.

- [x] **브라우저 버전 추가**
  selenoid/chrome 최신 이미지가 128.0 — 이미 default로 설정됨. 추가할 버전 없음.

---

## 파이프라인 전체

### 🟡 Medium

- [ ] **FBX → OpenPose → ComfyUI 엔드투엔드 테스트**
  실제 캐릭터로 전체 파이프라인 1회 검증:
  `render --openpose` → `generate --workflow-out` → ComfyUI 임포트 → `strip`

- [x] **생성 이미지 후처리 자동화**
  `process <frames-dir>` 커맨드 추가 — remove-bg → strip → layers.json 자동화.

### 🟢 Low

- [ ] **워크스페이스 README 작성**
  루트 `README.md` — 전체 패키지 구조, 빠른 시작, 각 패키지 링크.
