/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useSyncExternalStore } from 'react';
import { AlertTriangle, Check, Grid3x3, Move, RotateCw, Trash2, X } from 'lucide-react';
import { Button, DockPanel, DockStatus, IconTile, KeyCap } from './DesignKit';
import { getPlacementSession, subscribePlacementSession } from '../../lib/placementSession';
import { useIsTouchDevice } from '../../hooks/useIsTouchDevice';

/**
 * THE ONE PLACEMENT DOCK — the chrome for "you are holding something; put it down".
 *
 * ## Why it is shared
 *
 * The house and the island were running the same three beats (pick a subject → adjust → commit or
 * cancel, see DESIGN_SYSTEM.md "Catalog, shop, inventory, placement, selection") through two
 * unrelated pieces of chrome: indoors a bottom-centre `DockPanel` with captioned action keys,
 * outdoors a top-centre floating bar with small inline buttons. Same verbs, opposite ends of the
 * screen, different button shapes, and a live verdict that read one way in one place and another
 * way in the other. A player who learned to decorate their living room had to learn the whole
 * thing again to put a fountain on their lawn — which is the learning cost this consolidation is
 * about, and it was pure cost: nothing about a fountain makes 確認 belong somewhere else.
 *
 * ## The anatomy, and what each part is allowed to say
 *
 *   **subject** — what is being positioned right now. Never instructions.
 *   **note**    — the LIVE verdict, and only when there is something live to say: why 確認 has
 *                 gone dead, or that the piece has just snapped to a wall or a tabletop. How to
 *                 use the editor belongs to the 小天使 (AngelGuide.tsx), not to a bar the player
 *                 reads once and then has to look past forever. The `hint` tone is the one
 *                 exception, for a session that has no verdict of its own to report.
 *   **actions** — 旋轉 (with its key cap), whatever the subject adds, 收回, 確認, 取消.
 *                 Danger keeps coral to itself and 取消 sits on the far side of 確認, so the two
 *                 destructive taps are never neighbours.
 *
 * Everything optional is optional because a subject genuinely does not have it: a wall-mounted
 * picture takes its facing from the wall, so it gets no 旋轉; a copy being placed for the first
 * time is not yet standing anywhere, so it gets no 收回.
 */

export type PlacementNoteTone = 'blocked' | 'ok' | 'hint';

export interface PlacementNote {
  tone: PlacementNoteTone;
  /** Small caps line above the message. Only used by `blocked`, where naming the refusal helps. */
  label?: React.ReactNode;
  detail: React.ReactNode;
}

/**
 * Which step the drag is moving in, live.
 *
 * The grid used to be the only way to move a piece indoors — half a metre at a time, whether the
 * player wanted it or not — and it was invisible, so what the player saw was furniture that
 * refused to be nudged. It is a tool now rather than the mechanism: dragging is continuous, and
 * holding Shift snaps to a coarse grid for lining a row of things up. That is worth exactly one
 * chip: it says which of the two is happening right now, and which key changes it.
 *
 * Pointer devices only. There is no Shift on a touchscreen, so on a phone this would be a control
 * the player cannot reach describing a state they cannot leave.
 */
function PrecisionChip() {
  const session = useSyncExternalStore(subscribePlacementSession, getPlacementSession);
  const isTouch = useIsTouchDevice();
  if (isTouch) return null;

  return (
    <div
      className="hidden flex-shrink-0 items-center gap-2 rounded-[1.25rem] border border-island-line bg-island-cream-2 px-3 py-2 text-island-navy-soft sm:flex"
      title="拖曳可自由微調；按住 Shift 對齊格線"
    >
      {session.align
        ? <Grid3x3 size={15} strokeWidth={2.5} className="flex-shrink-0 text-island-teal-dark" />
        : <Move size={15} strokeWidth={2.5} className="flex-shrink-0" />}
      <span className="text-[11px] font-black leading-none">
        {session.align ? '對齊格線' : '自由微調'}
      </span>
      <KeyCap size="sm">Shift</KeyCap>
    </div>
  );
}

const NOTE_STYLE: Record<PlacementNoteTone, string> = {
  blocked: 'border-island-coral/25 bg-island-coral/10 text-island-coral',
  ok: 'border-island-teal/25 bg-island-teal/10 text-island-teal-dark',
  hint: 'border-island-line bg-island-cream-2 text-island-navy-soft',
};

export function PlacementDock({
  icon,
  badge,
  badgeIcon,
  title,
  meta,
  note,
  onRotate,
  rotateTitle = '旋轉 45°（鍵盤 R）',
  extraActions,
  onRetrieve,
  retrieveLabel = '收回',
  retrieveTitle,
  onConfirm,
  confirmLabel = '確認擺放',
  confirmDisabled = false,
  confirmTitle,
  onCancel,
  className = '',
  ...motionProps
}: {
  icon: React.ReactNode;
  badge: React.ReactNode;
  badgeIcon?: React.ReactNode;
  title: React.ReactNode;
  meta?: React.ReactNode;
  note?: PlacementNote | null;
  /** Omit to hide 旋轉 — for a subject whose facing is not the player's to choose. */
  onRotate?: () => void;
  rotateTitle?: string;
  /** Subject-specific extras, e.g. the Home's 更換外觀. Sits between 旋轉 and 收回. */
  extraActions?: React.ReactNode;
  /** Omit to hide 收回 — for a copy that is not standing anywhere yet. */
  onRetrieve?: () => void;
  retrieveLabel?: string;
  retrieveTitle?: string;
  onConfirm: () => void;
  confirmLabel?: string;
  confirmDisabled?: boolean;
  confirmTitle?: string;
  onCancel: () => void;
  className?: string;
} & Omit<React.ComponentProps<typeof DockPanel>, 'children' | 'className' | 'title'>) {
  return (
    <DockPanel
      initial={{ y: 40, scale: 0.94, opacity: 0 }}
      animate={{ y: 0, scale: 1, opacity: 1 }}
      exit={{ y: 40, scale: 0.94, opacity: 0 }}
      transition={{ type: 'spring', damping: 25, stiffness: 300 }}
      // `w-max`, not `w-auto`. DockPanel is absolutely positioned at `left-1/2`, and an absolute
      // box's shrink-to-fit width is capped at the space from its left edge to the containing
      // block's right edge — half the viewport. On a laptop window that clamp lands right in the
      // middle of this dock and squeezes the verdict until it wraps one character per line.
      // max-content ignores the clamp; the max-width below is what keeps it on screen instead.
      className={`flex w-[95%] flex-col gap-3 p-3 sm:w-max sm:max-w-[calc(100vw-2rem)] sm:flex-row sm:items-center sm:gap-4 sm:p-4 ${className}`}
      {...motionProps}
    >
      {/* `flex-shrink-0` and a min width, not just a max: without them the action row's confirm
          button wins the space and the subject block collapses until 擺放中 wraps one character
          per line. A dock names what it is holding or it is not a dock. */}
      <div className="flex flex-shrink-0 items-center gap-3 sm:min-w-[180px] sm:max-w-[240px] sm:border-r sm:border-island-line sm:pr-4">
        <IconTile size={52} active className="flex-shrink-0">
          {icon}
        </IconTile>
        <DockStatus badge={badge} badgeIcon={badgeIcon} title={title} meta={meta} className="flex-1" />

        {/* Phone-only dismiss. On sm+ it lives at the end of the action row, clear of 收回. */}
        <Button
          variant="ghost"
          onClick={onCancel}
          className="h-9 w-9 flex-shrink-0 p-0 sm:hidden"
          title="取消（Esc）"
        >
          <X size={18} strokeWidth={3} />
        </Button>
      </div>

      {note && (
        <div
          className={`flex items-center gap-2 rounded-[1.25rem] border px-3 py-2 sm:min-w-[150px] sm:max-w-[240px] ${NOTE_STYLE[note.tone]}`}
        >
          {note.tone === 'blocked' && <AlertTriangle size={16} strokeWidth={2.5} className="flex-shrink-0" />}
          {note.tone === 'ok' && <Check size={16} strokeWidth={3} className="flex-shrink-0" />}
          <span className="min-w-0 text-[11px] font-bold leading-snug">
            {note.label && (
              <span className="block text-[10px] font-black tracking-[0.14em] opacity-70">{note.label}</span>
            )}
            <span className="block font-black">{note.detail}</span>
          </span>
        </div>
      )}

      <PrecisionChip />

      <div className="flex items-center justify-end gap-2 sm:gap-3">
        {onRotate && (
          <Button
            variant="ghost"
            onClick={onRotate}
            className="h-14 w-14 flex-col p-0 hover:-translate-y-1 sm:h-16 sm:w-16"
            title={rotateTitle}
          >
            <RotateCw size={20} strokeWidth={2.5} />
            <span className="flex items-center gap-1 text-[10px] leading-none">
              旋轉
              <KeyCap size="sm">R</KeyCap>
            </span>
          </Button>
        )}

        {extraActions}

        {onRetrieve && (
          <Button
            variant="danger"
            onClick={onRetrieve}
            className="h-14 w-14 flex-col p-0 hover:-translate-y-1 sm:h-16 sm:w-16"
            title={retrieveTitle}
          >
            <Trash2 size={22} strokeWidth={2.5} />
            <span className="text-[10px] leading-none">{retrieveLabel}</span>
          </Button>
        )}

        <Button
          variant="primary"
          onClick={onConfirm}
          disabled={confirmDisabled}
          title={confirmTitle}
          className="h-14 flex-1 gap-2 px-5 text-sm hover:-translate-y-1 sm:h-16 sm:flex-initial sm:gap-3 sm:px-9 sm:text-base"
        >
          <Check size={22} strokeWidth={3} />
          <span className="whitespace-nowrap">{confirmLabel}</span>
        </Button>

        <Button
          variant="ghost"
          onClick={onCancel}
          className="hidden h-16 w-16 p-0 sm:flex"
          title="取消（Esc）"
        >
          <X size={24} strokeWidth={3} />
        </Button>
      </div>
    </DockPanel>
  );
}
