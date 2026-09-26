/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The four shapes every 管理員測試 category is built from.
 *
 * These exist so the console reads as ONE screen rather than as five panels that happened to be
 * moved into the same drawer. Each control that came in from the game UI kept its own body — the
 * offline simulator, the value editor and the workout panel are the same components they always
 * were — but the frame around them, the heading, the one-line explanation of what the control
 * WRITES, and the way an on/off state is shown are all from here.
 *
 * {@link AdminStatePill} deserves a note. 「Toggle 不應只有視覺差異極小的顏色變化」 — so a state in
 * this console is never carried by colour alone: every pill has a WORD (啟用中 / 已關閉 / 生效中),
 * a filled-or-hollow dot, and a border weight that differ together. That triple survives a
 * colour-blind reader, a washed-out projector, and a screenshot in a bug report.
 */

import type { ReactNode } from 'react';

export type AdminStateTone = 'on' | 'off' | 'info' | 'warn';

const pillToneClass: Record<AdminStateTone, string> = {
  on: 'bg-island-teal/12 border-island-teal/45 text-island-teal-dark',
  off: 'bg-white border-island-line text-island-navy-soft/80',
  info: 'bg-island-navy/8 border-island-navy/25 text-island-navy',
  warn: 'bg-island-gold/14 border-island-gold/50 text-island-navy',
};

const dotToneClass: Record<AdminStateTone, string> = {
  on: 'bg-island-teal',
  off: 'bg-island-navy-soft/35',
  info: 'bg-island-navy/60',
  warn: 'bg-island-gold',
};

/** A state, said in a word. The dot is the redundancy, never the message. */
export function AdminStatePill({ tone, children }: { tone: AdminStateTone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full border text-[10px] font-black leading-none whitespace-nowrap ${pillToneClass[tone]}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dotToneClass[tone]}`} />
      {children}
    </span>
  );
}

/**
 * One labelled block inside a category: what the control is, what it costs the save, then the
 * control.
 *
 * `note` is not decoration. Half of these controls write to the account and half do not, and which
 * is which is the single most useful thing to know before pressing one — so every group says it in
 * its own line rather than leaving it to be inferred from the button's colour.
 */
export function AdminGroup({
  icon,
  title,
  note,
  state,
  children,
}: {
  icon?: ReactNode;
  title: string;
  note?: string;
  state?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-[1.5rem] border border-island-line bg-white/70 overflow-hidden">
      <header className="flex items-start justify-between gap-2 px-3.5 pt-3 pb-2">
        <div className="flex items-start gap-2 min-w-0">
          {icon && <span className="text-island-teal-dark mt-[1px] flex-shrink-0">{icon}</span>}
          <div className="min-w-0">
            <h4 className="text-[12px] font-black text-island-navy leading-tight">{title}</h4>
            {note && (
              <p className="text-[10px] font-bold text-island-navy-soft/85 leading-snug mt-0.5">{note}</p>
            )}
          </div>
        </div>
        {state && <div className="flex-shrink-0">{state}</div>}
      </header>
      <div className="px-3 pb-3">{children}</div>
    </section>
  );
}

/**
 * A read-only fact about the current state — 「這個開關現在是開的」, 「這個覆寫正在生效」.
 *
 * Rows like these are why the console can answer 「是否正在生效」 without the tester having to go
 * and look at the game: several Admin behaviours (教學重播, the URL overrides) have no button at
 * all, and before this there was nowhere at all that said they were on.
 */
export function AdminStatusRow({
  label,
  detail,
  state,
}: {
  label: string;
  detail?: string;
  state: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-2 py-2 border-b border-dashed border-island-line last:border-b-0">
      <div className="min-w-0">
        <span className="block text-[11px] font-black text-island-navy leading-tight">{label}</span>
        {detail && (
          <span className="block text-[10px] font-bold text-island-navy-soft/80 leading-snug mt-0.5">
            {detail}
          </span>
        )}
      </div>
      <div className="flex-shrink-0 pt-0.5">{state}</div>
    </div>
  );
}

const actionToneClass = {
  neutral: 'bg-white hover:bg-island-cream-2 border-island-line text-island-navy',
  teal: 'bg-island-teal/10 hover:bg-island-teal/20 border-island-teal/30 text-island-navy',
  danger: 'bg-island-coral/10 hover:bg-island-coral/20 border-island-coral/30 text-island-coral',
} as const;

/**
 * The console's own button. Same size and shape everywhere so a destructive one and a harmless one
 * are told apart by their WORDS and their tone, never by being differently built.
 */
export function AdminActionButton({
  tone = 'neutral',
  icon,
  label,
  onClick,
  disabled,
  title,
  full = false,
}: {
  tone?: keyof typeof actionToneClass;
  icon?: ReactNode;
  label: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  /** Occupy the row on its own — for the one-of-a-kind actions (a wipe, a grant). */
  full?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`${full ? 'w-full' : ''} flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border text-[11px] font-black leading-none transition-all active:scale-95 disabled:opacity-45 disabled:pointer-events-none ${actionToneClass[tone]}`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}
