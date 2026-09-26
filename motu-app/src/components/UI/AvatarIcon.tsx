/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ReactElement } from 'react';

/**
 * Hand-drawn avatar badges, replacing the raw emoji characters that used to
 * be stored directly as `profile.avatar`. Emoji render inconsistently across
 * OS/browser emoji fonts (a different "🏝️" on Windows vs. macOS vs. Android),
 * so avatar choice looked different per player. These are plain inline SVGs —
 * same pixels everywhere — kept simple/bold so they still read at the ~14px
 * size TopBar uses, not just the larger AccountPanel/SettingsView picker size.
 */

export const AVATAR_IDS = ['island', 'runner', 'coconut', 'pineapple', 'wave', 'surfer', 'volcano', 'tent'] as const;
export type AvatarId = typeof AVATAR_IDS[number];

// Old profiles may still have a raw emoji string saved from before this
// change; map it to the equivalent new id instead of requiring a data migration.
const LEGACY_EMOJI_TO_ID: Record<string, AvatarId> = {
  '🏝️': 'island',
  '🏃': 'runner',
  '🥥': 'coconut',
  '🍍': 'pineapple',
  '🌊': 'wave',
  '🏄': 'surfer',
  '🌋': 'volcano',
  '⛺': 'tent',
};

export function resolveAvatarId(stored: string | null | undefined): AvatarId {
  if (stored && (AVATAR_IDS as readonly string[]).includes(stored)) return stored as AvatarId;
  if (stored && LEGACY_EMOJI_TO_ID[stored]) return LEGACY_EMOJI_TO_ID[stored];
  return 'island';
}

function IslandGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 20c1.8-.6 2-4 2-7.5" stroke="white" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M12.5 12.5c-2.5-2-6-1.3-8-.3 1.7 2.6 5 2.6 8 .3z" fill="white" />
      <path d="M12.5 12.5c2.5-2 6-1.3 8-.3-1.7 2.6-5 2.6-8 .3z" fill="white" />
      <path d="M12.5 12.5c-1-3.2 0-5.8 1.8-7.5-2.6 0-4.3 2.4-4.3 4.8 0 .9.9 1.8 2.5 2.7z" fill="white" />
      <ellipse cx="12" cy="20" rx="7" ry="1.4" fill="white" opacity="0.55" />
    </svg>
  );
}

function RunnerGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="white" xmlns="http://www.w3.org/2000/svg">
      <circle cx="14.5" cy="5" r="2.1" />
      <path d="M8.5 9.2l3.8 1.4 1.4 3.6-2.7 6.4-2-.9 2.1-5-1.3-3.3-3.3 1.6-.9-1.9z" />
      <path d="M13.2 10.8l3.6.9 2.6 4.7-1.9 1-2.1-3.9-3-1z" />
    </svg>
  );
}

function CoconutGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="12" cy="13" r="7" fill="white" />
      <circle cx="9.5" cy="10.5" r="1" fill="#8B5E3C" />
      <circle cx="13" cy="9.5" r="1" fill="#8B5E3C" />
      <circle cx="12" cy="12.5" r="1" fill="#8B5E3C" />
      <path d="M9 6.5c1-1.6 4-1.6 5 0" stroke="white" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function PineappleGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="white" xmlns="http://www.w3.org/2000/svg">
      <path d="M9.5 6L12 3l2.5 3-1.2 1.6h-2.6z" />
      <path d="M7.5 6.6L10 4.4l.3 2.4-1 1.4z" />
      <path d="M16.5 6.6L14 4.4l-.3 2.4 1 1.4z" />
      <ellipse cx="12" cy="14.5" rx="5.5" ry="7" />
    </svg>
  );
}

function WaveGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M3 10c1.5-2 3.5-2 5 0s3.5 2 5 0 3.5-2 5 0 3.5-2 5 0" stroke="white" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M3 15c1.5-2 3.5-2 5 0s3.5 2 5 0 3.5-2 5 0 3.5-2 5 0" stroke="white" strokeWidth="1.8" strokeLinecap="round" opacity="0.6" />
    </svg>
  );
}

function SurferGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <ellipse cx="12" cy="12" rx="3" ry="9" transform="rotate(35 12 12)" fill="white" />
      <circle cx="16.2" cy="6.4" r="1.9" fill="white" />
      <path d="M14 9l1.4 1.6-2 3.4" stroke="white" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}

function VolcanoGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 5l6.5 13h-13z" fill="white" />
      <path d="M9.5 10.5h5l1.5 4h-8z" fill="#D96C4A" />
      <circle cx="12" cy="4" r="1.6" fill="#D96C4A" />
    </svg>
  );
}

function TentGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 5l7.5 14h-15z" fill="white" />
      <path d="M12 5v14" stroke="#B5A26B" strokeWidth="1.6" />
      <path d="M9 19l3-6.5 3 6.5" stroke="#B5A26B" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}

const AVATAR_DEFS: Record<AvatarId, { bg: string; Glyph: () => ReactElement }> = {
  island: { bg: '#2A9D8F', Glyph: IslandGlyph },
  runner: { bg: '#264653', Glyph: RunnerGlyph },
  coconut: { bg: '#8B5E3C', Glyph: CoconutGlyph },
  pineapple: { bg: '#E9B44C', Glyph: PineappleGlyph },
  wave: { bg: '#5FBDAF', Glyph: WaveGlyph },
  surfer: { bg: '#1F7A70', Glyph: SurferGlyph },
  volcano: { bg: '#D96C4A', Glyph: VolcanoGlyph },
  tent: { bg: '#B5A26B', Glyph: TentGlyph },
};

interface AvatarIconProps {
  id?: string | null;
  /** px number, or any CSS length (a token included) — see below. */
  size?: number | string;
  className?: string;
}

export function AvatarIcon({ id, size = 24, className = '' }: AvatarIconProps) {
  const resolved = resolveAvatarId(id);
  const { bg, Glyph } = AVATAR_DEFS[resolved];
  // `size` may be a CSS length as well as a px number (e.g.
  // `size="var(--hud-avatar)"`, so TopBar's badge is sized by the responsive
  // HUD token scale rather than by a per-breakpoint number in JS). The glyph
  // keeps the same 0.62 proportion either way.
  const glyph = typeof size === 'number' ? Math.round(size * 0.62) : `calc(${size} * 0.62)`;

  return (
    <div
      className={`rounded-full flex items-center justify-center shrink-0 ${className}`}
      style={{ width: size, height: size, backgroundColor: bg }}
    >
      <div style={{ width: glyph, height: glyph }}>
        <Glyph />
      </div>
    </div>
  );
}
