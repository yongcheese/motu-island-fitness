/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { ReactNode } from 'react';
import { useAdminMode } from '../../hooks/useAdminMode';

/**
 * Central render gate for Admin/QA-only UI — see constants/adminFeatures.ts
 * for the registry of what belongs behind it.
 *
 * Wrap a feature in this ONCE at its mount point:
 *
 *   <AdminOnly><DebugPanel /></AdminOnly>
 *
 * instead of adding a local `if (settings?.adminTestMode)` at each call site.
 * When a feature is promoted from "candidate" to "active" in the registry,
 * this is the only wrapper it needs.
 */
export function AdminOnly({ children }: { children: ReactNode }) {
  const isAdminMode = useAdminMode();
  if (!isAdminMode) return null;
  return <>{children}</>;
}
