// MediaPipe Pose 33 關鍵節點索引（附錄 A）
// landmark = { x, y, z, visibility }，x/y 為影像正規化座標 [0,1]，y 向下為正。
export const LM = {
  NOSE: 0,
  LEFT_EYE_INNER: 1, LEFT_EYE: 2, LEFT_EYE_OUTER: 3,
  RIGHT_EYE_INNER: 4, RIGHT_EYE: 5, RIGHT_EYE_OUTER: 6,
  LEFT_EAR: 7, RIGHT_EAR: 8,
  MOUTH_LEFT: 9, MOUTH_RIGHT: 10,
  LEFT_SHOULDER: 11, RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13, RIGHT_ELBOW: 14,
  LEFT_WRIST: 15, RIGHT_WRIST: 16,
  LEFT_PINKY: 17, RIGHT_PINKY: 18,
  LEFT_INDEX: 19, RIGHT_INDEX: 20,
  LEFT_THUMB: 21, RIGHT_THUMB: 22,
  LEFT_HIP: 23, RIGHT_HIP: 24,
  LEFT_KNEE: 25, RIGHT_KNEE: 26,
  LEFT_ANKLE: 27, RIGHT_ANKLE: 28,
  LEFT_HEEL: 29, RIGHT_HEEL: 30,
  LEFT_FOOT_INDEX: 31, RIGHT_FOOT_INDEX: 32,
};

// 骨架連線（用於繪製）
export const POSE_CONNECTIONS = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [27, 29], [29, 31], [27, 31],
  [24, 26], [26, 28], [28, 30], [30, 32], [28, 32],
  [11, 12],
  // 臉部簡化
  [0, 11], [0, 12],
];

// 身體分段（給三色骨架「哪段違規哪段變色」用）
export const SEGMENTS = {
  torso: [[11, 23], [12, 24], [11, 12], [23, 24]],
  leftArm: [[11, 13], [13, 15]],
  rightArm: [[12, 14], [14, 16]],
  leftLeg: [[23, 25], [25, 27]],
  rightLeg: [[24, 26], [26, 28]],
};

export const LM_NAMES = Object.fromEntries(Object.entries(LM).map(([k, v]) => [v, k]));
