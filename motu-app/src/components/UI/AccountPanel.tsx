/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { getBalance } from '../../constants/currency';
import { useApp } from '../../context/AppContext';
import {
  User,
  LogOut,
  Settings,
  Key,
  ShieldAlert,
  Copy,
  Check,
  Calendar,
  Sparkles,
  ChevronRight,
  TrendingUp,
  Coins,
  X
, Gem } from 'lucide-react';
import { playSound, SoundEffect } from '../../lib/soundUtils';
import { View } from '../../types';
import { motion, AnimatePresence } from 'motion/react';
import { AvatarIcon } from './AvatarIcon';
import { PortholeFrame, ModalOverlay, PanelHeader, IconTile } from './DesignKit';
import { FloatingPanelPortal } from './FloatingPanelPortal';
import { ProviderButton } from './ProviderButton';
import type { SettingsCategoryId } from './settings/settingsCategories';
import { requestSettingsCategory } from './settings/settingsNavigation';
import { useAuth } from '../../auth/useAuth';
import { providerLabel } from '../../auth/errors';
import { useEscapeToClose } from '../../hooks/useEscapeToClose';
import { useIsTouchDevice } from '../../hooks/useIsTouchDevice';
import { profileLevel, xpIntoLevel } from '../../utils/level';

interface AccountPanelProps {
  onClose: () => void;
}

export function AccountPanel({ onClose }: AccountPanelProps) {
  const {
    user,
    profile,
    setCurrentView,
  } = useApp();

  // Account binding is driven entirely by the auth layer: which providers are
  // still bindable comes from the registry, not from a hardcoded Google button.
  const { linkableProviders, linkProvider, signOut, pendingProviderId, error, clearError } =
    useAuth();

  const [copied, setCopied] = useState(false);
  const [showManageStats, setShowManageStats] = useState(false);
  // Now a viewport-centred sheet at every size (see the container below), so
  // it no longer needs to know where TopBar is — this used to anchor to
  // TopBar's desktop card via `top-[128px] left-[104px]`, which broke once
  // TopBar moved into the shared HUD rail. `isMobile` (pointer-type) is kept
  // only to pick the panel *width* (full-bleed sheet on touch vs. fixed
  // desktop width).
  const isMobile = useIsTouchDevice();

  // Esc key closure
  useEscapeToClose(onClose);

  if (!profile) return null;

  const isGuest = !!user?.isGuest;
  // True only when the session never reached Firebase at all — the save is on
  // this device and nowhere else. Distinct from an ordinary anonymous guest,
  // whose progress *is* in the cloud and already syncs.
  const isLocalOnly = !!user?.isLocalOnly;
  const userEmail = user?.email || 'guest-session@island.local';
  const providerNames = (user?.linkedProviders ?? []).map(providerLabel).join('、');

  // Copy local user ID
  const handleCopyId = () => {
    playSound(SoundEffect.CLICK);
    navigator.clipboard.writeText(profile.userId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  /**
   * 開設定，而且**停在被承諾的那一頁**。
   *
   * 底下兩張快捷卡以前都呼叫同一個不帶參數的版本，所以「編輯個人資料 · 更變暱稱 & 挑選您的專屬
   * 頭像」會把玩家送到 設定 · 一般 —— 一個既沒有暱稱也沒有頭像的分頁。兩個看起來不同的入口通往
   * 同一個地方，而且是錯的那一個。現在每張卡自己說它要去哪（見 settings/settingsNavigation.ts）。
   */
  const handleNavigateToSettings = (category: SettingsCategoryId) => {
    playSound(SoundEffect.CLICK);
    requestSettingsCategory(category);
    setCurrentView(View.SETTINGS);
    onClose();
  };

  const handleSignOut = () => {
    playSound(SoundEffect.CLICK);
    onClose();
    void signOut();
  };

  const handleLink = (providerId: Parameters<typeof linkProvider>[0]) => {
    playSound(SoundEffect.CLICK);
    void linkProvider(providerId);
  };

  // 等級 and the bar both derive from cumulative XP (utils/level.ts); `profile.level` is stored
  // once and never incremented, so reading it here showed LV.1 for a player with thousands of XP.
  const level = profileLevel(profile);
  const xpPercent = Math.min(100, Math.max(0, xpIntoLevel(profile.currentXp)));

  return (
    // Portaled to #floating-panel-root, because this panel is rendered by
    // TopBar — i.e. from *inside* HudFrame, which is one stacking context on
    // the z-hud-frame tier (z-index 20). A `z-modal` written inside that
    // context only ranks against HudFrame's other children; it cannot beat an
    // App-level sibling of the frame itself. InteractionPrompt (z-hud-toolbar,
    // 24) is exactly that, so the world-tracked "摸摸小狗" badge painted straight
    // over this dialog. Portaling moves the panel out to App's root stacking
    // context, where its z-modal (1000) means what it says. Same reasoning,
    // and same fix, as BuildingInteriorView's floating dialogs — see
    // FloatingPanelPortal.tsx.
    <FloatingPanelPortal>
      {/* Background overlay for click outside dismissal — shared ModalOverlay
          scrim, same as every other blocking dialog in the app. */}
      <ModalOverlay
        className="!p-0 backdrop-blur-[2px] cursor-default"
        onClick={() => {
          playSound(SoundEffect.CLICK);
          onClose();
        }}
      />

      {/* Account panel container — viewport-centred at every size. */}
      <div
        className={`fixed z-modal pointer-events-auto top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 ${
          isMobile ? 'w-[92vw] max-w-sm' : 'w-[400px] xl:w-[440px]'
        }`}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.9, y: 15 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.92, y: 10 }}
          transition={{ type: 'spring', damping: 24, stiffness: 280 }}
          // `.notch-shadow-lg` (a filter on this element, wrapping the clipped
          // card below) instead of a `shadow-[...]` on the `dock-notch` element
          // — a clip-path clips the element's own box-shadow away. index.css.
          className="notch-shadow-lg max-h-[85vh] flex"
        >
        <div
          className="bg-white border border-island-line dock-notch rounded-[2rem] flex flex-col overflow-hidden w-full min-h-0 text-island-navy font-sans"
        >
          <PanelHeader
            icon={<Sparkles size={18} strokeWidth={2.5} />}
            title="帳號資訊安全"
            onClose={() => {
              playSound(SoundEffect.CLICK);
              onClose();
            }}
            className="!px-6 !py-4"
          />

          <div className="overflow-y-auto flex-1 min-h-0 scrollbar-thin scrollbar-thumb-island-line scrollbar-track-transparent">
          {/* User profile capsule */}
          <div className="flex flex-col items-center px-6 pt-5 pb-6 text-center">
            {/* Avatar — ticket photo in a porthole frame */}
            <div className="relative group">
              <PortholeFrame size={92} className="shadow-[0_10px_30px_rgba(42,157,143,0.2)]">
                <AvatarIcon id={profile.avatar} size={80} />
              </PortholeFrame>
              <div className="absolute -bottom-1.5 -right-1 bg-island-teal border-2 border-white text-white px-2 py-0.5 rounded-full text-[10px] font-black z-10 font-mono shadow">
                LV.{level}
              </div>
            </div>

            {/* Display Name */}
            <h3 className="mt-4 font-black text-xl tracking-tight text-island-navy mb-1">
              {profile.displayName}
            </h3>

            {/* Account identifier */}
            <p className="text-island-navy-soft text-xs font-mono break-all max-w-[280px]">
              {isGuest ? '訪客存檔' : userEmail}
            </p>

            {/* Sync badge. Three states, not two: an anonymous guest with a real
                Firebase account already syncs, and conflating that with a
                device-only session is what let players believe their progress
                was safe when it was sitting in one browser's localStorage. */}
            <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black tracking-wide uppercase mt-3 ${
              isLocalOnly
                ? 'bg-island-coral/10 text-island-coral border border-island-coral/30'
                : isGuest
                  ? 'bg-island-sand text-island-navy-soft border border-island-line'
                  : 'bg-island-teal/10 text-island-teal-dark border border-island-teal/30'
            }`}>
              <span className={`w-1.5 h-1.5 rounded-full ${
                isLocalOnly ? 'bg-island-coral' : isGuest ? 'bg-island-navy-soft' : 'bg-island-teal'
              } animate-pulse`} />
              {isLocalOnly ? '僅存於此裝置' : isGuest ? '訪客雲端存檔' : `${providerNames || '雲端'} 同步中`}
            </span>

            {isLocalOnly && (
              <p className="mt-3 text-[11px] leading-relaxed text-island-coral/90 bg-island-coral/8 border border-island-coral/20 rounded-2xl px-3 py-2.5 max-w-[300px]">
                你的島嶼目前只儲存在這台裝置上，換裝置或清除瀏覽器資料就會消失。綁定帳號即可備份並跨裝置同步。
              </p>
            )}

            {/* Manage My Account Button */}
            <button
              onClick={() => {
                playSound(SoundEffect.CLICK);
                setShowManageStats(!showManageStats);
              }}
              className="mt-5 w-full max-w-[240px] border border-island-line hover:bg-island-cream-2 active:scale-95 transition-all py-3.5 px-4 rounded-full text-xs font-bold text-island-navy tracking-wide flex items-center justify-center gap-1.5"
            >
              {showManageStats ? '隱藏詳細狀態' : '管理您的帳號資訊'}
              <ChevronRight size={14} className={`transition-transform duration-300 ${showManageStats ? 'rotate-90' : ''}`} />
            </button>
          </div>

          {/* Manage Stats Drawer Area */}
          <AnimatePresence>
            {showManageStats && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden bg-island-cream-2 border-t border-b border-island-line"
              >
                <div className="p-5 space-y-4 text-left">
                  {/* Copy User ID */}
                  <div className="flex flex-col gap-1.5">
                    <span className="text-[10px] text-island-navy-soft font-black uppercase tracking-wider">用戶獨立代碼 (UID)</span>
                    <div className="flex items-center justify-between bg-white p-2.5 rounded-xl border border-island-line">
                      <span className="text-xs font-mono text-island-navy truncate max-w-[200px]">{profile.userId}</span>
                      <button
                        onClick={handleCopyId}
                        className="text-island-navy-soft hover:text-island-navy transition-colors p-3 -m-2"
                        title="複製 UID"
                      >
                        {copied ? <Check size={14} className="text-island-teal" /> : <Copy size={14} />}
                      </button>
                    </div>
                  </div>

                  {/* Island Stats.

                      Three tiles rather than two: this is the 帳號中心, the one screen that is
                      supposed to be a complete statement of what the account holds, and a wallet
                      that lists one of its two currencies is not one. The 「健身取得」/「非健身取得」
                      captions are the whole point — they say WHY the two numbers are different
                      resources, which a colour alone cannot (§22).

                      「非健身取得」 rather than 「簽到取得」 since 2026-09-17: the 每日登入 round
                      stopped paying this currency (it pays 金幣 and 商品碎片 now, see
                      constants/dailyLogin.ts) and naming a source that no longer exists is worse
                      than naming none. What is left — 輪盤, 摸摸寵物, 島嶼秘寶 — has no one
                      name, and the rule they share is exactly the one worth saying. */}
                  <div className="grid grid-cols-2 gap-2">
                    <div className="bg-white p-3 rounded-xl border border-island-line flex items-center gap-2.5">
                      <Coins className="text-island-gold" size={16} />
                      <div>
                        <div className="text-[9px] text-island-navy-soft font-black tracking-widest uppercase">持有金幣・健身取得</div>
                        <div className="text-xs font-mono font-black text-island-navy">{getBalance(profile, 'coins').toLocaleString()}</div>
                      </div>
                    </div>
                    <div className="bg-white p-3 rounded-xl border border-island-line flex items-center gap-2.5">
                      <Gem className="text-island-teal-dark" size={16} />
                      <div>
                        <div className="text-[9px] text-island-navy-soft font-black tracking-widest uppercase">持有碎片・非健身取得</div>
                        <div className="text-xs font-mono font-black text-island-navy">{getBalance(profile, 'fragments').toLocaleString()}</div>
                      </div>
                    </div>
                    <div className="bg-white p-3 rounded-xl border border-island-line flex items-center gap-2.5 col-span-2">
                      <TrendingUp className="text-island-teal" size={16} />
                      <div>
                        <div className="text-[9px] text-island-navy-soft font-black tracking-widest uppercase">當前經驗</div>
                        <div className="text-xs font-mono font-black text-island-navy">{profile.currentXp} XP</div>
                      </div>
                    </div>
                  </div>

                  {/* Level Progress */}
                  <div className="space-y-1 bg-white p-3 rounded-xl border border-island-line">
                    <div className="flex justify-between items-center text-[10px] font-black text-island-navy-soft uppercase tracking-widest">
                      <span>等級進度</span>
                      <span>{xpIntoLevel(profile.currentXp)} / 100 XP</span>
                    </div>
                    <div className="w-full h-1.5 bg-island-cream-2 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-island-teal rounded-full"
                        style={{ width: `${xpPercent}%` }}
                      />
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Account binding — 「將 Guest 存檔綁定至正式帳號」.
              Rendered from `linkableProviders`, so this list grows on its own
              as providers are promoted to `ready` in the registry. For a
              Firebase anonymous guest the account is upgraded in place (same
              uid, nothing copied); for a device-only session the save is
              claimed into the new account by src/save/guestClaim.ts. */}
          {linkableProviders.length > 0 && (
            <div className="px-5 py-4 border-t border-island-line bg-island-cream-2/60 flex flex-col gap-2.5">
              <div>
                <span className="text-[10px] text-island-navy-soft font-black uppercase tracking-wider block">
                  {isGuest ? '綁定帳號以保存進度' : '綁定其他登入方式'}
                </span>
                <span className="text-[10px] text-island-navy-soft/80 leading-relaxed">
                  {isGuest
                    ? '綁定後即可在其他裝置登入並繼續你的島嶼。'
                    : '多綁一種登入方式，換裝置時更方便。'}
                </span>
              </div>

              {error && (
                <div
                  role="alert"
                  className="flex items-start gap-2 rounded-xl border border-island-coral/30 bg-island-coral/10 px-3 py-2 text-[11px] font-semibold text-island-coral leading-relaxed"
                >
                  <ShieldAlert size={13} className="mt-0.5 flex-shrink-0" />
                  <span className="flex-1">{error.message}</span>
                  <button onClick={clearError} className="opacity-60 hover:opacity-100" aria-label="關閉提示">
                    <X size={12} />
                  </button>
                </div>
              )}

              <div className="flex flex-col gap-2">
                {linkableProviders.map((descriptor) => (
                  <ProviderButton
                    key={descriptor.id}
                    descriptor={descriptor}
                    busy={pendingProviderId === descriptor.id}
                    disabled={pendingProviderId !== null && pendingProviderId !== descriptor.id}
                    onSelect={() => handleLink(descriptor.id)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Quick Actions List */}
          <div className="px-3 py-2 border-t border-island-line flex flex-col gap-0.5">
            {/* Editor profile link */}
            <button
              onClick={() => handleNavigateToSettings('account')}
              className="w-full py-3.5 px-4 rounded-2xl hover:bg-island-cream-2 active:scale-[0.98] transition-all flex items-center justify-between text-left group"
            >
              <div className="flex items-center gap-3">
                <IconTile size={36} active accent="teal">
                  <User size={16} />
                </IconTile>
                <div>
                  <span className="text-xs font-bold block text-island-navy">編輯個人資料</span>
                  <span className="text-[10px] text-island-navy-soft">更變暱稱 & 挑選您的專屬頭像</span>
                </div>
              </div>
              <ChevronRight size={14} className="text-island-navy-soft/50 group-hover:text-island-navy group-hover:translate-x-0.5 transition-all" />
            </button>

            {/* Sync configuration settings */}
            <button
              onClick={() => handleNavigateToSettings('general')}
              className="w-full py-3.5 px-4 rounded-2xl hover:bg-island-cream-2 active:scale-[0.98] transition-all flex items-center justify-between text-left group"
            >
              <div className="flex items-center gap-3">
                <IconTile size={36} className="text-island-navy-soft">
                  <Settings size={16} />
                </IconTile>
                <div>
                  <span className="text-xs font-bold block text-island-navy">偏好系統設定</span>
                  <span className="text-[10px] text-island-navy-soft">調整背景音樂與 AI 語音輔助</span>
                </div>
              </div>
              <ChevronRight size={14} className="text-island-navy-soft/50 group-hover:text-island-navy group-hover:translate-x-0.5 transition-all" />
            </button>

            {/* 每日補給與連續登入's re-grant button used to sit here, styled exactly like the two
                real account actions above it — which is precisely why it moved: a test hook that
                pays out gold and XP with no daily cap should not be one row away from 「偏好系統
                設定」. It is now in the 管理員測試 console (UI/admin/, 新手與登入流程). */}
          </div>

          {/* Three developer panels — 管理員數值調整, 離線回歸測試, 健身獎勵測試 — used to be
              stacked here, below the sign-out button's own divider, which turned 帳號中心 into the
              longest scroll in the game the moment 管理員測試模式 was switched on. All three moved
              into the 管理員測試 console (UI/admin/) unchanged; only their address did. */}

          {/* Sign Out Area */}
          <div className="p-5 border-t border-island-line bg-island-cream-2 flex flex-col items-center">
            <button
              onClick={handleSignOut}
              className="w-full py-4 px-5 rounded-full bg-island-coral/12 hover:bg-island-coral/20 border border-island-coral/25 text-island-coral active:scale-95 transition-all flex items-center justify-center gap-2 text-xs font-bold"
            >
              <LogOut size={14} />
              安全登出帳號
            </button>
          </div>
          </div>
        </div>
        </motion.div>
      </div>
    </FloatingPanelPortal>
  );
}
