# OpenPose BODY_25 — Mixamo Bone Mapping

## References

| 문서 | 설명 |
|------|------|
| [poseParametersRender.hpp](https://github.com/CMU-Perceptual-Computing-Lab/openpose/blob/master/include/openpose/pose/poseParametersRender.hpp) | `POSE_BODY_25_COLORS_RENDER` — 25 keypoint RGB 색상표 |
| [doc/02_output.md](https://github.com/CMU-Perceptual-Computing-Lab/openpose/blob/master/doc/02_output.md) | Keypoint 인덱스 다이어그램 + JSON 출력 포맷 |
| [ControlNet annotator/openpose/\_\_init\_\_.py](https://github.com/lllyasviel/ControlNet/blob/main/annotator/openpose/__init__.py) | COCO-18 limb 색상 리스트 (ControlNet 학습 기준) |

---

## BODY_25 Keypoint 인덱스 및 색상

| idx | 이름 | RGB | hex | Mixamo 소스 |
|-----|------|-----|-----|-------------|
| 0 | Nose | (255, 0, 85) | `#ff0055` | `mixamorigHead` HEAD 기준 추정 |
| 1 | Neck | (255, 0, 0) | `#ff0000` | `mixamorigNeck` HEAD |
| 2 | RShoulder | (255, 85, 0) | `#ff5500` | `mixamorigRightArm` HEAD (glenohumeral joint) |
| 3 | RElbow | (255, 170, 0) | `#ffaa00` | `mixamorigRightForeArm` HEAD |
| 4 | RWrist | (255, 255, 0) | `#ffff00` | `mixamorigRightHand` HEAD |
| 5 | LShoulder | (170, 255, 0) | `#aaff00` | `mixamorigLeftArm` HEAD |
| 6 | LElbow | (85, 255, 0) | `#55ff00` | `mixamorigLeftForeArm` HEAD |
| 7 | LWrist | (0, 255, 0) | `#00ff00` | `mixamorigLeftHand` HEAD |
| 8 | MidHip | (255, 0, 0) | `#ff0000` | `mixamorigHips` HEAD |
| 9 | RHip | (0, 255, 85) | `#00ff55` | `mixamorigRightUpLeg` HEAD |
| 10 | RKnee | (0, 255, 170) | `#00ffaa` | `mixamorigRightLeg` HEAD |
| 11 | RAnkle | (0, 255, 255) | `#00ffff` | `mixamorigRightFoot` HEAD |
| 12 | LHip | (0, 170, 255) | `#00aaff` | `mixamorigLeftUpLeg` HEAD |
| 13 | LKnee | (0, 85, 255) | `#0055ff` | `mixamorigLeftLeg` HEAD |
| 14 | LAnkle | (0, 0, 255) | `#0000ff` | `mixamorigLeftFoot` HEAD |
| 15 | REye | (255, 0, 170) | `#ff00aa` | `mixamorigHead` 기준 +X 추정 |
| 16 | LEye | (170, 0, 255) | `#aa00ff` | `mixamorigHead` 기준 -X 추정 |
| 17 | REar | (255, 0, 255) | `#ff00ff` | `mixamorigHead` 기준 +X 추정 |
| 18 | LEar | (85, 0, 255) | `#5500ff` | `mixamorigHead` 기준 -X 추정 |
| 19 | LBigToe | (0, 0, 255) | `#0000ff` | `mixamorigLeftToeBase` HEAD (MTP 관절 ≈ 엄지발가락 기저) |
| 20 | LSmallToe | (0, 0, 255) | `#0000ff` | `mixamorigLeftToeBase` -X 오프셋 추정 (발 길이 × 0.3) |
| 21 | LHeel | (0, 0, 255) | `#0000ff` | `mixamorigLeftFoot` HEAD (발목 ≈ 뒤꿈치 근사) |
| 22 | RBigToe | (0, 255, 255) | `#00ffff` | `mixamorigRightToeBase` HEAD |
| 23 | RSmallToe | (0, 255, 255) | `#00ffff` | `mixamorigRightToeBase` +X 오프셋 추정 |
| 24 | RHeel | (0, 255, 255) | `#00ffff` | `mixamorigRightFoot` HEAD |

> **Bone HEAD 규칙**: Three.js `bone.getWorldPosition()` 는 bone의 HEAD(관절 원점)를 반환한다.  
> 예) `mixamorigRightArm` = 상완골 → HEAD = glenohumeral(어깨) 관절 위치 → kp2 RShoulder 에 매핑.

---

## BODY_25 Limb 색상표

ControlNet COCO-18 색상 리스트 기준 (`colors[0..17]`):

| limb | 연결 | RGB | hex | COCO 색상 인덱스 |
|------|------|-----|-----|-----------------|
| Neck → MidHip | 1→8 | (255, 0, 85) | `#ff0055` | COCO 없음 (BODY_25 추가, warm pink) |
| Neck → RShoulder | 1→2 | (255, 0, 0) | `#ff0000` | `colors[0]` |
| Neck → LShoulder | 1→5 | (255, 85, 0) | `#ff5500` | `colors[1]` |
| RShoulder → RElbow | 2→3 | (255, 170, 0) | `#ffaa00` | `colors[2]` |
| RElbow → RWrist | 3→4 | (255, 255, 0) | `#ffff00` | `colors[3]` |
| LShoulder → LElbow | 5→6 | (170, 255, 0) | `#aaff00` | `colors[4]` |
| LElbow → LWrist | 6→7 | (85, 255, 0) | `#55ff00` | `colors[5]` |
| MidHip → RHip | 8→9 | (0, 255, 0) | `#00ff00` | ~`colors[6]` (COCO Neck→RHip) |
| RHip → RKnee | 9→10 | (0, 255, 85) | `#00ff55` | `colors[7]` |
| RKnee → RAnkle | 10→11 | (0, 255, 170) | `#00ffaa` | `colors[8]` |
| MidHip → LHip | 8→12 | (0, 255, 255) | `#00ffff` | ~`colors[9]` (COCO Neck→LHip) |
| LHip → LKnee | 12→13 | (0, 170, 255) | `#00aaff` | `colors[10]` |
| LKnee → LAnkle | 13→14 | (0, 85, 255) | `#0055ff` | `colors[11]` |
| Neck → Nose | 1→0 | (0, 0, 255) | `#0000ff` | `colors[12]` |
| Nose → REye | 0→15 | (85, 0, 255) | `#5500ff` | `colors[13]` |
| REye → REar | 15→17 | (170, 0, 255) | `#aa00ff` | `colors[14]` |
| Nose → LEye | 0→16 | (255, 0, 255) | `#ff00ff` | `colors[15]` |
| LEye → LEar | 16→18 | (255, 0, 170) | `#ff00aa` | `colors[16]` |
| LAnkle → LBigToe | 14→19 | (0, 255, 255) | `#00ffff` | BODY_25 추가 (L발 계열) |
| LBigToe → LSmallToe | 19→20 | (0, 255, 255) | `#00ffff` | BODY_25 추가 |
| LAnkle → LHeel | 14→21 | (0, 255, 255) | `#00ffff` | BODY_25 추가 |
| RAnkle → RBigToe | 11→22 | (0, 255, 0) | `#00ff00` | BODY_25 추가 (R발 계열) |
| RBigToe → RSmallToe | 22→23 | (255, 255, 0) | `#ffff00` | BODY_25 추가 |
| RAnkle → RHeel | 11→24 | (255, 255, 0) | `#ffff00` | BODY_25 추가 |

---

## 근사 처리된 키포인트

Mixamo 표준 리그에는 없거나 직접 매핑이 불가한 keypoint들은 주변 bone으로 추정:

| keypoint | 추정 방법 | 한계 |
|----------|-----------|------|
| 0 Nose | `mixamorigHead` HEAD에서 neck 길이 × 0.28 아래 | head bone 방향에 따라 오차 |
| 15 REye | `mixamorigHead` +X eyeSpan (neck 길이 × 0.18) | 대칭 근사, 실제 안구 위치 아님 |
| 16 LEye | `mixamorigHead` -X eyeSpan | 동일 |
| 17 REar | `mixamorigHead` +X earSpan (neck 길이 × 0.34) | 동일 |
| 18 LEar | `mixamorigHead` -X earSpan | 동일 |
| 20 LSmallToe | `mixamorigLeftToeBase` -X (발 길이 × 0.3) | 발 방향에 따라 오차 |
| 21 LHeel | `mixamorigLeftFoot` HEAD (발목을 뒤꿈치로 근사) | heel bone 없음 |
| 23 RSmallToe | `mixamorigRightToeBase` +X (발 길이 × 0.3) | 동일 |
| 24 RHeel | `mixamorigRightFoot` HEAD | 동일 |

---

## Mixamo 축 규약

| 축 | 방향 |
|----|------|
| +X | 캐릭터 오른쪽 |
| +Y | 위 |
| +Z | 캐릭터 등(뒤) |

Front view toScreen: `x = W/2 - (wp.x - cx) * scale` — +X(캐릭터 우) → 화면 왼쪽 (OpenPose 표준과 일치).
