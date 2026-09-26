/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';

import { installZFightAudit } from '../../utils/zFightAudit';

/**
 * Registers the <Canvas> it is mounted in with `window.__auditZFighting()`, so the depth-conflict
 * check can be run against the real scene graph — with every group transform, territory scale and
 * runtime placement resolved — rather than guessed at from source. `npm run audit:zfighting` is
 * the static counterpart that runs in CI.
 *
 * Mounted in BOTH canvases: the island's (Scene.tsx) and the house interior's
 * (BuildingInteriorView.tsx). They are separate renderers with separate scene graphs, and while
 * this lived as a private component inside Scene.tsx the audit could only ever see the island —
 * so "clean" meant "clean outdoors", and every wall, floor, doorway and piece of furniture in the
 * house had never been looked at. `label` is what the report calls each one.
 *
 * Also exposes the scene as `window.__scene<Label>`, which is the companion to a finding: the
 * audit names a pair, and that handle is how you go find those two meshes in the live graph.
 *
 * Renders nothing — this is a logic-only Canvas child, like CameraController. Stripped from
 * production by the `import.meta.env.DEV` guard.
 */
export function ZFightAuditBridge({ label }: { label: string }) {
  const scene = useThree((state) => state.scene);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const handle = `__scene${label.charAt(0).toUpperCase()}${label.slice(1)}`;
    (window as unknown as Record<string, unknown>)[handle] = scene;
    return installZFightAudit(label, () => scene);
  }, [scene, label]);

  return null;
}
