/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { VISIBLE_SETTINGS_CATEGORIES, type SettingsCategoryId } from './settingsCategories';

/**
 * Two renderings of the same `activeId`/`onSelect` pair, switched purely by
 * Tailwind breakpoint (this project's sanctioned way to branch mobile vs.
 * desktop layout — see useViewportWidth.ts, which explicitly reserves JS
 * width checks for scaling an already-desktop layout, not for this kind of
 * branch). Below `lg` there usually isn't room for a sidebar, so the same
 * categories become wrapping chips instead.
 *
 * It renders `VISIBLE_SETTINGS_CATEGORIES`, not the whole table: 畫面 / 操作 /
 * 關於 have no settings in them yet, and a nav where half the entries lead to
 * 「敬請期待」 is a nav that has stopped telling the player where anything is.
 * The categories themselves are untouched — see settingsCategories.ts.
 *
 * `DesignKit.tsx`'s `Toolbar` was tried here first (it's the existing
 * array-driven tab switcher) but doesn't fit: its tab pill is one
 * non-wrapping flex row sized for 2-4 mode tabs, so six categories on a
 * phone-width viewport overflowed the card and cut off 帳號/關於 entirely
 * instead of wrapping — confirmed by screenshot, not a hunch. Plain
 * `flex-wrap` chips (same active/inactive token pairing as the weather
 * picker in GeneralCategory) wrap to a second row instead of clipping.
 */
export function SettingsNav({
  activeId,
  onSelect,
}: {
  activeId: SettingsCategoryId;
  onSelect: (id: SettingsCategoryId) => void;
}) {
  return (
    <>
      {/* Desktop / laptop / landscape tablet — vertical rail. */}
      <nav className="hidden lg:flex flex-col gap-1.5 w-56 flex-shrink-0">
        {VISIBLE_SETTINGS_CATEGORIES.map((cat) => {
          const Icon = cat.icon;
          const isActive = cat.id === activeId;
          return (
            <button
              key={cat.id}
              onClick={() => onSelect(cat.id)}
              className={`flex items-center gap-3 px-4 py-3 rounded-2xl border transition-all text-left active:scale-[0.98] ${
                isActive
                  ? 'bg-island-teal/8 border-island-teal text-island-navy'
                  : 'bg-transparent border-transparent text-island-navy-soft hover:bg-island-cream-2 hover:text-island-navy'
              }`}
            >
              <Icon size={18} className={isActive ? 'text-island-teal' : ''} />
              <span className="font-bold text-sm">{cat.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Tablet portrait / mobile — wrapping chip row. */}
      <div className="lg:hidden w-full flex flex-wrap gap-2">
        {VISIBLE_SETTINGS_CATEGORIES.map((cat) => {
          const Icon = cat.icon;
          const isActive = cat.id === activeId;
          return (
            <button
              key={cat.id}
              onClick={() => onSelect(cat.id)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-full border transition-all active:scale-95 ${
                isActive
                  ? 'bg-island-teal text-white border-island-teal shadow-[0_4px_12px_rgba(42,157,143,0.3)]'
                  : 'bg-white text-island-navy-soft border-island-line hover:border-island-teal/40 hover:text-island-navy'
              }`}
            >
              <Icon size={14} />
              <span className="text-xs font-black">{cat.label}</span>
            </button>
          );
        })}
      </div>
    </>
  );
}
