/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';

// The single-row setting pattern hand-rolled for the AI-voice-guide and
// admin-test-mode toggles: icon + label + description on the left, one
// control on the right. `onClick` on the row itself (with the control
// wrapped so its own click doesn't double-fire) mirrors the old behaviour
// where clicking anywhere on the row — not just the switch — toggled it.
export function SettingRow({
  icon,
  label,
  description,
  control,
  onClick,
  className = '',
}: {
  icon?: React.ReactNode;
  label: React.ReactNode;
  description?: React.ReactNode;
  control: React.ReactNode;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <div
      onClick={onClick}
      className={`flex items-center justify-between gap-4 p-5 bg-island-cream-2 rounded-2xl border border-island-line transition-colors text-left ${
        onClick ? 'hover:bg-island-line/30 cursor-pointer' : ''
      } ${className}`}
    >
      <div className="flex items-center gap-3 min-w-0">
        {icon}
        <div className="min-w-0">
          <span className="font-bold text-sm block">{label}</span>
          {description && <span className="text-[10px] text-island-navy-soft">{description}</span>}
        </div>
      </div>
      <div onClick={onClick ? (e) => e.stopPropagation() : undefined} className="flex-shrink-0">
        {control}
      </div>
    </div>
  );
}
