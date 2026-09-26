/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';

// The card shell hand-rolled three times in the old SettingsView.tsx
// (Music, YouTube Music, Weather blocks): icon tile + title + description
// header, then a bg-island-cream-2 + dock-notch card holding the actual
// controls. Centralized so a new setting group is one call site, not
// another copy of the same Tailwind string.
export function SettingsSection({
  icon,
  title,
  description,
  children,
  className = '',
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`w-full space-y-3 ${className}`}>
      {(icon || title) && (
        <div className="flex items-center gap-3 px-1">
          {icon && (
            <div className="w-10 h-10 bg-island-teal/12 text-island-teal-dark border border-island-teal/25 rounded-2xl flex items-center justify-center flex-shrink-0">
              {icon}
            </div>
          )}
          <div>
            <h3 className="text-sm font-black text-island-navy">{title}</h3>
            {description && <p className="text-[10px] text-island-navy-soft">{description}</p>}
          </div>
        </div>
      )}
      <div className="bg-island-cream-2 border border-island-line dock-notch rounded-[1.75rem] p-5 space-y-4">
        {children}
      </div>
    </div>
  );
}
