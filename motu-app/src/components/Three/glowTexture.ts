/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as THREE from 'three';

/**
 * 一張徑向漸層的光暈貼圖 —— 中心白、往外淡到全透明。
 *
 * 加法混合的球體看起來還是像球體：邊緣是硬的，因為它就是一顆球。「光」的樣子是中心亮、邊緣
 * 沒有邊緣，而那只能由一張中間到外面連續變透明的貼圖來給。房間裡每一個會發光的東西 —— 燭火、
 * 開關上那顆找得到位置的小指示燈 —— 用的都是這同一張。
 *
 * 一張、全域共用、只做一次。它跟顏色無關（材質的 `color` 會乘上去），所以不需要每種顏色一張。
 */
let cached: THREE.CanvasTexture | null = null;

export function getGlowTexture(): THREE.CanvasTexture {
  if (cached) return cached;

  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  const c = size / 2;
  const g = ctx.createRadialGradient(c, c, 0, c, c, c);
  // 四個停點而不是兩個：一條直線的漸層看起來像一個有邊界的圓盤，因為亮度在中間就已經掉了一半。
  // 前段掉得慢、後段拖長的尾巴，才是光真正的衰減形狀。
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.18, 'rgba(255,255,255,0.82)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.26)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  cached = tex;
  return tex;
}
