/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Hand, Music, Trophy, RefreshCw, Activity, Smile, X, SmilePlus, Sparkles, Wand2, MonitorPlay } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { View } from '../../types';
import { playSound, SoundEffect } from '../../lib/soundUtils';
import { useIsTouchDevice } from '../../hooks/useIsTouchDevice';
import { PanelHeader, accentClass } from './DesignKit';

export interface EmoteItem {
  id: string;
  name: string;
  /** Compact 2-char label for cramped spots (SideButtons' inline tray). */
  shortName: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  description: string;
  colorClass: string;
  badgeColor: string;
}

// Small rotation of island-safe accent tones (teal/gold/coral/navy — the same
// four StatTile accents used elsewhere, via DesignKit's shared `accentClass`
// map instead of a second locally-maintained copy) instead of a per-item
// rainbow hue. Purely a visual "which tile is which" cue, not a
// category-color-coding system — items are still differentiated primarily
// by icon.
const ACCENT_TILE_HOVER = {
  teal: 'hover:bg-island-teal/16 hover:border-island-teal',
  gold: 'hover:bg-island-gold/18 hover:border-island-gold',
  coral: 'hover:bg-island-coral/18 hover:border-island-coral',
  navy: 'hover:bg-island-navy/14 hover:border-island-navy',
} as const;

const ACCENT_TILE = {
  teal: `${accentClass.teal} ${ACCENT_TILE_HOVER.teal}`,
  gold: `${accentClass.gold} ${ACCENT_TILE_HOVER.gold}`,
  coral: `${accentClass.coral} ${ACCENT_TILE_HOVER.coral}`,
  navy: `${accentClass.navy} ${ACCENT_TILE_HOVER.navy}`,
} as const;

const ACCENT_BADGE = accentClass;

export const EMOTE_ITEMS: EmoteItem[] = [
  {
    id: 'WAVE',
    name: '親切揮手',
    shortName: '揮手',
    icon: Hand,
    description: '伸出右手，高興地與大家打招呼！',
    colorClass: ACCENT_TILE.teal,
    badgeColor: ACCENT_BADGE.teal,
  },
  {
    id: 'DANCE',
    name: '歡樂熱舞',
    shortName: '跳舞',
    icon: Music,
    description: '隨著動感的節奏，擺動身體與頭部！',
    colorClass: ACCENT_TILE.gold,
    badgeColor: ACCENT_BADGE.gold,
  },
  {
    id: 'CELEBRATE',
    name: '狂歡慶祝',
    shortName: '慶祝',
    icon: Trophy,
    description: '雙手高舉，開心地上下蹦跳歡慶！',
    colorClass: ACCENT_TILE.coral,
    badgeColor: ACCENT_BADGE.coral,
  },
  {
    id: 'FLIP',
    name: '極限空翻',
    shortName: '空翻',
    icon: RefreshCw,
    description: '展現高超技巧，來一個帥氣的後空翻！',
    colorClass: ACCENT_TILE.navy,
    badgeColor: ACCENT_BADGE.navy,
  },
  {
    id: 'CRAWL',
    name: '戰術爬行',
    shortName: '爬行',
    icon: Activity,
    description: '匍匐前進，身手矯健地在地上爬行！',
    colorClass: ACCENT_TILE.teal,
    badgeColor: ACCENT_BADGE.teal,
  },
  {
    id: 'NONE',
    name: '平靜恢復',
    shortName: '恢復',
    icon: Smile,
    description: '停止一切動作與表情，恢復自信的站姿。',
    colorClass: ACCENT_TILE.navy,
    badgeColor: ACCENT_BADGE.navy,
  }
];

// Stylized skeletal 2D canvas animation preview component
function EmotePreviewAnimation({ emoteId }: { emoteId: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;
    let startTime = Date.now();

    const draw = () => {
      const now = Date.now();
      const t = (now - startTime) / 1000; // time in seconds

      const width = canvas.width;
      const height = canvas.height;

      // Clear with light island-cream backdrop and a faint navy blueprint grid
      ctx.fillStyle = '#F8F6F1'; // island-cream-2
      ctx.fillRect(0, 0, width, height);

      // Draw subtle grid lines
      ctx.strokeStyle = 'rgba(38, 70, 83, 0.06)'; // island-navy, low opacity
      ctx.lineWidth = 1;
      const gridSize = 12;
      for (let x = 0; x < width; x += gridSize) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }
      for (let y = 0; y < height; y += gridSize) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }

      // Main drawing setup
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.shadowBlur = 6;

      let neonColor = '#2A9D8F'; // island-teal default

      // Determine glow palette by emote ID (island-safe tones only)
      if (emoteId === 'WAVE') neonColor = '#E8AA3E';       // island-gold
      else if (emoteId === 'DANCE') neonColor = '#E8836A';  // island-coral
      else if (emoteId === 'CELEBRATE') neonColor = '#E8AA3E'; // island-gold
      else if (emoteId === 'FLIP') neonColor = '#2A9D8F';   // island-teal
      else if (emoteId === 'CRAWL') neonColor = '#264653';  // island-navy
      else if (emoteId === 'NONE') neonColor = '#4A6169';   // island-navy-soft

      ctx.strokeStyle = neonColor;
      ctx.shadowColor = neonColor;

      // Draw Ground
      ctx.beginPath();
      ctx.strokeStyle = 'rgba(38, 70, 83, 0.15)';
      ctx.shadowColor = 'transparent';
      ctx.lineWidth = 2;
      ctx.moveTo(10, height - 15);
      ctx.lineTo(width - 10, height - 15);
      ctx.stroke();

      // Reset to main stroke style
      ctx.strokeStyle = neonColor;
      ctx.shadowColor = neonColor;
      ctx.lineWidth = 4.5;

      // Helper for drawing cute circles/joints
      const drawJoint = (x: number, y: number, r: number) => {
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = neonColor;
        ctx.fill();
      };

      if (emoteId === 'WAVE') {
        // High frequency right hand waving, left hand resting idle
        const bodyY = height / 2 - 5 + Math.sin(t * 3.5) * 1.5;
        const headY = bodyY - 22;
        const headX = width / 2;

        // Head joint
        drawJoint(headX, headY, 6.5);

        // Spine
        ctx.beginPath();
        ctx.moveTo(headX, headY + 6.5);
        ctx.lineTo(width / 2, bodyY + 15);
        ctx.stroke();

        // Left arm (idle rest)
        ctx.beginPath();
        ctx.moveTo(width / 2, bodyY - 4);
        ctx.lineTo(width / 2 - 12, bodyY + 6);
        ctx.lineTo(width / 2 - 14, bodyY + 16);
        ctx.stroke();

        // Right arm (high speed wave)
        const waveAngle = Math.sin(t * 14) * 0.45;
        ctx.beginPath();
        ctx.moveTo(width / 2, bodyY - 4);
        ctx.lineTo(width / 2 + 10, bodyY - 14);
        ctx.lineTo(width / 2 + 14 + Math.sin(t * 14) * 10, bodyY - 24 + waveAngle * 4);
        ctx.stroke();

        // Legs
        ctx.beginPath();
        ctx.moveTo(width / 2, bodyY + 15);
        ctx.lineTo(width / 2 - 8, height - 16);
        ctx.moveTo(width / 2, bodyY + 15);
        ctx.lineTo(width / 2 + 8, height - 16);
        ctx.stroke();

      } else if (emoteId === 'DANCE') {
        // Rhythmic hip sway, torso bobs, arms alternate
        const cycle = t * 6.5;
        const sway = Math.sin(cycle) * 7.5;
        const bob = Math.abs(Math.sin(cycle)) * 4;

        const headX = width / 2 + sway;
        const headY = height / 2 - 24 + bob;
        const neckY = headY + 6.5;
        const waistX = width / 2 - sway * 0.4;
        const waistY = height / 2 + 12;

        drawJoint(headX, headY, 6.5);

        // Spine
        ctx.beginPath();
        ctx.moveTo(headX, neckY);
        ctx.lineTo(waistX, waistY);
        ctx.stroke();

        // Left Arm (Dancing loop)
        ctx.beginPath();
        ctx.moveTo((headX + waistX) / 2, (neckY + waistY) / 2);
        ctx.lineTo(width / 2 - 16 + sway * 0.5, height / 2 - 8 - Math.cos(cycle) * 10);
        ctx.lineTo(width / 2 - 22 + sway, height / 2 + 4 + Math.sin(cycle) * 8);
        ctx.stroke();

        // Right Arm (Dancing loop)
        ctx.beginPath();
        ctx.moveTo((headX + waistX) / 2, (neckY + waistY) / 2);
        ctx.lineTo(width / 2 + 16 + sway * 0.5, height / 2 - 8 + Math.cos(cycle) * 10);
        ctx.lineTo(width / 2 + 22 + sway, height / 2 + 4 - Math.sin(cycle) * 8);
        ctx.stroke();

        // Legs
        ctx.beginPath();
        ctx.moveTo(waistX, waistY);
        ctx.lineTo(width / 2 - 10, height - 16);
        ctx.moveTo(waistX, waistY);
        ctx.lineTo(width / 2 + 10, height - 16);
        ctx.stroke();

      } else if (emoteId === 'CELEBRATE') {
        // High vertical jump bounce loop, arms thrusting into the air
        const jumpY = Math.max(0, Math.sin(t * 8.5)) * 16;
        const headX = width / 2;
        const headY = height / 2 - 20 - jumpY;

        drawJoint(headX, headY, 6.5);

        // Spine
        ctx.beginPath();
        ctx.moveTo(headX, headY + 6.5);
        ctx.lineTo(width / 2, height / 2 + 10 - jumpY);
        ctx.stroke();

        // Left Raised Arm
        ctx.beginPath();
        ctx.moveTo(width / 2, height / 2 - 6 - jumpY);
        ctx.lineTo(width / 2 - 14, height / 2 - 24 - jumpY + Math.sin(t * 12) * 4);
        ctx.lineTo(width / 2 - 18, height / 2 - 36 - jumpY);
        ctx.stroke();

        // Right Raised Arm
        ctx.beginPath();
        ctx.moveTo(width / 2, height / 2 - 6 - jumpY);
        ctx.lineTo(width / 2 + 14, height / 2 - 24 - jumpY - Math.sin(t * 12) * 4);
        ctx.lineTo(width / 2 + 18, height / 2 - 36 - jumpY);
        ctx.stroke();

        // Legs bend when jumping, straight in the air
        ctx.beginPath();
        if (jumpY > 2) {
          // Bent knees in mid air
          ctx.moveTo(width / 2, height / 2 + 10 - jumpY);
          ctx.lineTo(width / 2 - 7, height / 2 + 22 - jumpY);
          ctx.lineTo(width / 2 - 5, height / 2 + 30 - jumpY);

          ctx.moveTo(width / 2, height / 2 + 10 - jumpY);
          ctx.lineTo(width / 2 + 7, height / 2 + 22 - jumpY);
          ctx.lineTo(width / 2 + 5, height / 2 + 30 - jumpY);
        } else {
          // Soft preparation squats
          ctx.moveTo(width / 2, height / 2 + 10);
          ctx.lineTo(width / 2 - 8, height - 20);
          ctx.lineTo(width / 2 - 9, height - 16);

          ctx.moveTo(width / 2, height / 2 + 10);
          ctx.lineTo(width / 2 + 8, height - 20);
          ctx.lineTo(width / 2 + 9, height - 16);
        }
        ctx.stroke();

      } else if (emoteId === 'FLIP') {
        // High dynamic somersault rotation
        const flipAngle = (t * 4.5) % (Math.PI * 2);
        const flipJump = Math.sin(flipAngle) * 18;

        ctx.save();
        ctx.translate(width / 2, height / 2 - 4 - flipJump);
        ctx.rotate(flipAngle);

        // Core schematic figure rotating on local space
        drawJoint(0, -18, 6.5);

        // Spine
        ctx.beginPath();
        ctx.moveTo(0, -11.5);
        ctx.lineTo(0, 10);
        ctx.stroke();

        // Arms tucked in aerodynamically
        ctx.beginPath();
        ctx.moveTo(0, -6);
        ctx.lineTo(-12, -2);
        ctx.lineTo(-6, 8);
        ctx.moveTo(0, -6);
        ctx.lineTo(12, -2);
        ctx.lineTo(6, 8);
        ctx.stroke();

        // Legs tucked
        ctx.beginPath();
        ctx.moveTo(0, 10);
        ctx.lineTo(-6, 20);
        ctx.lineTo(-10, 15);
        ctx.moveTo(0, 10);
        ctx.lineTo(6, 20);
        ctx.lineTo(10, 15);
        ctx.stroke();

        ctx.restore();

      } else if (emoteId === 'CRAWL') {
        // Horizontal forward/backward creeping motion close to floor
        const slide = Math.sin(t * 6) * 12;
        const bob = Math.abs(Math.sin(t * 12)) * 2.5;

        const coreX = width / 2 - 5 + slide;
        const coreY = height - 22 + bob;

        // Draw Head in front
        drawJoint(coreX + 18, coreY - 6, 6);

        // Torso horizontally
        ctx.beginPath();
        ctx.moveTo(coreX + 12, coreY - 6);
        ctx.lineTo(coreX - 16, coreY - 3);
        ctx.stroke();

        // Fore limb / crawl arm
        ctx.beginPath();
        ctx.moveTo(coreX + 4, coreY - 5);
        ctx.lineTo(coreX + 12 + Math.cos(t * 6) * 10, height - 16);
        ctx.stroke();

        // Rear limb / leg propelling
        ctx.beginPath();
        ctx.moveTo(coreX - 16, coreY - 3);
        ctx.lineTo(coreX - 22 - Math.sin(t * 6) * 8, height - 16);
        ctx.stroke();

      } else {
        // Idle - NONE: Calm subtle biological breathing loop
        const breath = Math.sin(t * 2.5) * 1.25;
        const headX = width / 2;
        const headY = height / 2 - 20 + breath * 0.4;

        drawJoint(headX, headY, 6.5);

        // Spine
        ctx.beginPath();
        ctx.moveTo(headX, headY + 6.5);
        ctx.lineTo(width / 2, height / 2 + 12 + breath * 0.1);
        ctx.stroke();

        // Slanted rested arms
        ctx.beginPath();
        ctx.moveTo(width / 2, height / 2 - 6 + breath * 0.35);
        ctx.lineTo(width / 2 - 14 + breath * 0.1, height / 2 + 6);
        ctx.moveTo(width / 2, height / 2 - 6 + breath * 0.35);
        ctx.lineTo(width / 2 + 14 - breath * 0.1, height / 2 + 6);
        ctx.stroke();

        // Symmetrical standing legs
        ctx.beginPath();
        ctx.moveTo(width / 2, height / 2 + 12 + breath * 0.1);
        ctx.lineTo(width / 2 - 8, height - 16);
        ctx.moveTo(width / 2, height / 2 + 12 + breath * 0.1);
        ctx.lineTo(width / 2 + 8, height - 16);
        ctx.stroke();
      }

      ctx.restore();
      animId = requestAnimationFrame(draw);
    };

    draw();

    return () => {
      cancelAnimationFrame(animId);
    };
  }, [emoteId]);

  return (
    <div className="relative w-full aspect-video md:h-28 md:w-28 rounded-2xl overflow-hidden border border-island-line shadow-inner">
      <canvas
        ref={canvasRef}
        width={160}
        height={130}
        className="w-full h-full object-cover block"
      />
      {/* Preview status strip */}
      <div className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-transparent via-island-teal to-transparent opacity-60 animate-pulse pointer-events-none" />
      <div className="absolute bottom-2 left-2 bg-white/85 px-2 py-0.5 rounded-md border border-island-line font-mono text-[8px] text-island-teal-dark tracking-widest uppercase pointer-events-none flex items-center gap-1">
        <MonitorPlay size={8} className="animate-pulse" />
        <span>PREVIEW</span>
      </div>
    </div>
  );
}

export function EmoteGrid() {
  const { currentView } = useApp();
  const [isOpen, setIsOpen] = useState(false);
  const [activeEmote, setActiveEmote] = useState<string>('NONE');
  const [hoveredEmote, setHoveredEmote] = useState<EmoteItem | null>(null);
  const isMobile = useIsTouchDevice();

  // Cooldown mapping: emoteId -> timestamp when cooldown finishes
  const [cooldownTimeouts, setCooldownTimeouts] = useState<Record<string, number>>({});
  // Ticker value to force-render smooth cooldown progress
  const [ticker, setTicker] = useState<number>(0);

  /**
   * The cooldown is a re-trigger guard, not a game rule: it exists so a button
   * can't be fired again while the動作 it starts is still playing. It should
   * therefore last as long as that action and no longer.
   *
   * A flat 3s for everything is what made 空翻 feel broken. The somersault runs
   * for FLIP_DURATION (Three/Avatar.tsx), so the button sat dead for over two
   * further seconds after the character had already landed — press it again and
   * nothing happened, with no way to tell the tile was disabled rather than the
   * emote being ignored.
   *
   * The pose emotes are toggles that hold until cancelled, so they need nothing
   * beyond swallowing an accidental double-click.
   */
  const COOLDOWN_BY_EMOTE: Record<string, number> = {
    FLIP: 1000, // FLIP_DURATION (0.85s) plus a beat to land on
  };
  const DEFAULT_COOLDOWN = 400;
  const cooldownFor = (emoteId: string) => COOLDOWN_BY_EMOTE[emoteId] ?? DEFAULT_COOLDOWN;

  // Smooth periodic state updates for active cooldown sweeps
  useEffect(() => {
    const activeCooldownsExist = Object.values(cooldownTimeouts).some(t => t > Date.now());
    if (!activeCooldownsExist) return;

    const interval = setInterval(() => {
      setTicker(t => t + 1);
    }, 33); // ~30 FPS smooth rendering of countdown progress

    return () => clearInterval(interval);
  }, [cooldownTimeouts]);

  // Listen to remote changes to reflect state
  useEffect(() => {
    const handleRemoteEmote = (e: Event) => {
      const customEvent = e as CustomEvent;
      const emoteId = customEvent.detail?.emote;
      if (emoteId) {
        setActiveEmote(emoteId);
      }
    };
    window.addEventListener('trigger-avatar-emote', handleRemoteEmote);
    return () => window.removeEventListener('trigger-avatar-emote', handleRemoteEmote);
  }, []);

  // Close hover preview if menu closes
  useEffect(() => {
    if (!isOpen) {
      setHoveredEmote(null);
    }
  }, [isOpen]);

  // Disable grid if not in main view
  if (currentView !== View.HOME) {
    return null;
  }

  const handleTriggerEmote = (emoteId: string) => {
    const now = Date.now();
    const cooldownEnd = cooldownTimeouts[emoteId] || 0;

    // Check if under active cooldown
    if (cooldownEnd > now) {
      // Opt-out or play minor error feedback if possible
      return;
    }

    playSound(SoundEffect.CLICK);
    setActiveEmote(emoteId);

    setCooldownTimeouts(prev => ({
      ...prev,
      [emoteId]: Date.now() + cooldownFor(emoteId)
    }));

    window.dispatchEvent(new CustomEvent('trigger-avatar-emote', { detail: { emote: emoteId } }));
  };

  const handleToggle = () => {
    playSound(SoundEffect.CLICK);
    setIsOpen(!isOpen);
  };

  const displayItem = hoveredEmote || EMOTE_ITEMS.find(i => i.id === activeEmote) || EMOTE_ITEMS[5];

  return (
    <>
      {/* Floating Trigger Button */}
      <div
        id="emote-floating-trigger"
        className="fixed z-hud-navbar bottom-24 md:bottom-36 right-4 md:right-10 pointer-events-auto"
      >
        <motion.button
          onClick={handleToggle}
          whileHover={{ scale: 1.08, rotate: 8 }}
          whileTap={{ scale: 0.92 }}
          className={`flex items-center justify-center w-14 h-14 md:w-16 md:h-16 rounded-[1.5rem] md:rounded-[2rem] border-2 shadow-[0_10px_28px_rgba(38,70,83,0.22)] transition-all ${
            isOpen
              ? 'bg-island-teal text-white border-island-teal-dark'
              : 'bg-white text-island-teal border-island-line hover:border-island-teal hover:bg-island-teal/8'
          }`}
          title="表情與動作"
        >
          {isOpen ? <X size={26} /> : <SmilePlus size={26} />}
        </motion.button>
      </div>

      {/* Grid & Preview Layout Container */}
      <AnimatePresence>
        {isOpen && (
          <div className="fixed z-floating-panel bottom-[6.5rem] md:bottom-[9.9rem] right-4 md:right-10 flex flex-col md:flex-row gap-4 items-end pointer-events-none">

            {/* Preview side-window (on wide screens: left-aligned popout; on mobile: nested above grid) */}
            <motion.div
              initial={{ opacity: 0, scale: 0.9, x: isMobile ? 0 : 30, y: isMobile ? 20 : 0 }}
              animate={{ opacity: 1, scale: 1, x: 0, y: 0 }}
              exit={{ opacity: 0, scale: 0.93, x: isMobile ? 0 : 20, y: isMobile ? 15 : 0 }}
              transition={{ type: 'spring', damping: 24, stiffness: 200 }}
              className="w-[92vw] max-w-[340px] md:w-[320px] bg-island-cream border border-island-line rounded-[1.75rem] shadow-[0_20px_50px_rgba(38,70,83,0.18)] pointer-events-auto flex flex-col overflow-hidden"
            >
              <PanelHeader
                icon={<Sparkles size={18} />}
                title={hoveredEmote ? '預覽動作' : '目前動作'}
                subtitle={displayItem.id}
              />

              <div className="flex flex-col gap-3.5 p-4">
                {/* Styled tiny side animation rendering preview */}
                <div className="flex flex-col md:flex-row items-center gap-3 bg-island-cream-2 p-2.5 rounded-2xl border border-island-line">
                  <EmotePreviewAnimation emoteId={displayItem.id} />

                  <div className="flex flex-col gap-1 w-full md:w-[130px]">
                    <span className={`text-xs font-black tracking-wide ${
                      hoveredEmote ? 'text-island-gold' : 'text-island-teal'
                    }`}>
                      {hoveredEmote ? '📋 預覽動作' : '✨ 正在運行'}
                    </span>
                    <p className="text-[14px] text-island-navy font-black leading-tight truncate">
                      {displayItem.name}
                    </p>
                    <span className="text-[9px] text-island-navy-soft/70 leading-none mt-1 break-words font-bold">
                      滑鼠懸停其他動作以取得即時 2D 骨骼預覽。
                    </span>
                  </div>
                </div>

                {/* Action Description */}
                <div className="flex flex-col gap-1.5 bg-island-teal/6 hover:bg-island-teal/10 transition-colors p-3 rounded-2xl border border-island-teal/15">
                  <span className="text-[10px] text-island-teal-dark font-extrabold tracking-wide uppercase font-mono">
                    動作詳情 / Overview
                  </span>
                  <p className="text-[11px] text-island-navy-soft leading-relaxed font-bold">
                    {displayItem.description}
                  </p>
                </div>
              </div>
            </motion.div>

            {/* Main Emotes Grid Card */}
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 30 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              transition={{ type: 'spring', damping: 25, stiffness: 220 }}
              className="w-[92vw] max-w-[380px] bg-island-cream border border-island-line rounded-[2.2rem] shadow-[0_24px_60px_rgba(38,70,83,0.2)] pointer-events-auto flex flex-col overflow-hidden"
            >
              <PanelHeader
                icon={<Wand2 size={18} />}
                title="角色動作"
                subtitle="Emote Grid"
                onClose={handleToggle}
              />

              <div className="flex flex-col gap-4 p-5 md:p-6">
                {/* Emotes Grid */}
                <div className="grid grid-cols-3 gap-2 md:gap-3">
                  {EMOTE_ITEMS.map((item) => {
                    const IconComponent = item.icon;
                    const isActive = activeEmote === item.id;

                    const now = Date.now();
                    const cooldownExpiration = cooldownTimeouts[item.id] || 0;
                    const isOnCooldown = cooldownExpiration > now;
                    const remainingSec = isOnCooldown ? (cooldownExpiration - now) / 1000 : 0;
                    const progress = isOnCooldown ? (cooldownExpiration - now) / cooldownFor(item.id) : 0; // 1 -> 0

                    return (
                      <motion.button
                        key={item.id}
                        onClick={() => handleTriggerEmote(item.id)}
                        onMouseEnter={() => setHoveredEmote(item)}
                        onMouseLeave={() => setHoveredEmote(null)}
                        whileHover={isOnCooldown ? {} : { scale: 1.05, y: -2 }}
                        whileTap={isOnCooldown ? {} : { scale: 0.95 }}
                        disabled={isOnCooldown}
                        className={`relative flex flex-col items-center justify-center gap-2 p-3 rounded-2xl border transition-all group overflow-hidden ${
                          isActive
                            ? 'bg-island-teal text-white border-island-teal-dark shadow-[0_6px_16px_rgba(42,157,143,0.35)]'
                            : item.colorClass
                        } ${isOnCooldown ? 'cursor-not-allowed opacity-70' : ''}`}
                      >
                        {/* Background glow for current active item */}
                        {isActive && (
                          <span className="absolute inset-0 bg-gradient-to-tr from-white/15 to-transparent opacity-50 animate-pulse pointer-events-none" />
                        )}

                        {/* Icon Container */}
                        <div className={`p-2 rounded-xl transition-all ${
                          isActive
                            ? 'bg-white/20 text-white'
                            : 'bg-white text-current group-hover:bg-island-sand'
                        }`}>
                          <IconComponent size={22} className={isActive ? "animate-bounce" : "group-hover:scale-110 transition-transform"} />
                        </div>

                        <span className="text-[10px] md:text-xs font-black tracking-wider leading-none">{item.name}</span>

                        {/* Radial / Circular Cooldown overlay visual */}
                        {isOnCooldown && (
                          <div className="absolute inset-0 bg-island-cream/90 backdrop-blur-[1.5px] flex flex-col items-center justify-center gap-1 z-10 pointer-events-none">
                            <svg className="w-8 h-8 -rotate-90" viewBox="0 0 36 36">
                              <circle
                                cx="18"
                                cy="18"
                                r="14"
                                fill="none"
                                stroke="rgba(38, 70, 83, 0.12)"
                                strokeWidth="2.5"
                              />
                              <circle
                                cx="18"
                                cy="18"
                                r="14"
                                fill="none"
                                stroke="#2A9D8F"
                                strokeWidth="2.5"
                                strokeDasharray="88"
                                strokeDashoffset={88 * (1 - progress)}
                                strokeLinecap="round"
                              />
                            </svg>
                            <span className="absolute text-[9px] font-black font-mono text-island-teal-dark">
                              {remainingSec.toFixed(1)}s
                            </span>
                          </div>
                        )}

                        {/* Small dot active indicator */}
                        {isActive && !isOnCooldown && (
                          <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-white ring-2 ring-island-teal animate-ping" />
                        )}
                      </motion.button>
                    );
                  })}
                </div>

                {/* Quick status line */}
                <div className="flex items-center justify-between text-[9px] text-island-navy-soft/60 font-bold px-1 font-mono tracking-wide">
                  <span>目前動作: {activeEmote}</span>
                  <span>移動即取消動作</span>
                </div>
              </div>
            </motion.div>

          </div>
        )}
      </AnimatePresence>
    </>
  );
}
