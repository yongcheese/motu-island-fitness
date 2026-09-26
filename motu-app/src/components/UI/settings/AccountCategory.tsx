/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from 'react';
import { getBalance } from '../../../constants/currency';
import { LogOut, Check, Edit2, Copy, ShieldAlert, X, Coins, TrendingUp , Gem } from 'lucide-react';
import { useApp } from '../../../context/AppContext';
import { useAuth } from '../../../auth/useAuth';
import { providerLabel } from '../../../auth/errors';
import { playSound, SoundEffect } from '../../../lib/soundUtils';
import { AVATAR_IDS, AvatarIcon, resolveAvatarId } from '../AvatarIcon';
import { Button, PortholeFrame } from '../DesignKit';
import { ProviderButton } from '../ProviderButton';
import { SettingsSection } from './SettingsSection';

// Everything here reads the same hooks/handlers AccountPanel.tsx already
// uses (useAuth's linkableProviders/linkProvider/signOut/error, useApp's
// profile) — no new identity/auth logic, just a full-page layout instead of
// a popover, so Settings can be the "manage everything" destination
// AccountPanel's own "偏好系統設定" button already promises to jump to.
export function AccountCategory() {
  const { user, profile, updateProfile } = useApp();
  const { linkableProviders, linkProvider, signOut, pendingProviderId, error, clearError } = useAuth();

  const [isEditingName, setIsEditingName] = useState(false);
  const [newName, setNewName] = useState(profile?.displayName || '');
  const [copied, setCopied] = useState(false);

  if (!profile) return null;

  const isGuest = !!user?.isGuest;
  // True only when the session never reached Firebase at all — the save is on
  // this device and nowhere else. Distinct from an ordinary anonymous guest,
  // whose progress *is* in the cloud and already syncs.
  const isLocalOnly = !!user?.isLocalOnly;
  const userEmail = user?.email || 'guest-session@island.local';
  const providerNames = (user?.linkedProviders ?? []).map(providerLabel).join('、');
  const selectedAvatarId = resolveAvatarId(profile.avatar);

  const handleUpdateName = async () => {
    if (!newName.trim()) return;
    playSound(SoundEffect.CLICK);
    await updateProfile({ displayName: newName });
    setIsEditingName(false);
  };

  const handleAvatarSelect = async (avatarId: string) => {
    playSound(SoundEffect.CLICK);
    await updateProfile({ avatar: avatarId });
  };

  const handleCopyId = () => {
    playSound(SoundEffect.CLICK);
    navigator.clipboard.writeText(profile.userId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleLink = (providerId: Parameters<typeof linkProvider>[0]) => {
    playSound(SoundEffect.CLICK);
    void linkProvider(providerId);
  };

  return (
    <div className="w-full flex flex-col gap-6">
      <SettingsSection title="個人資料">
        <div className="grid sm:grid-cols-2 gap-6">
          <div className="flex flex-col gap-2">
            <label className="text-[10px] font-black text-island-navy-soft uppercase tracking-widest pl-4">我的暱稱</label>
            {isEditingName ? (
              <div className="flex-1 flex gap-2">
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="flex-1 bg-white border border-island-line rounded-2xl px-4 py-3 font-bold text-sm outline-none focus:ring-2 focus:ring-island-teal-light"
                  autoFocus
                />
                <Button variant="primary" onClick={handleUpdateName} className="p-3">
                  <Check size={20} />
                </Button>
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-between bg-white border border-island-line rounded-2xl px-5 py-4 group">
                <span className="font-bold">{profile.displayName}</span>
                <button
                  onClick={() => setIsEditingName(true)}
                  className="text-island-navy-soft hover:text-island-teal transition-all p-1 hover:bg-island-teal/10 rounded-lg active:scale-95"
                >
                  <Edit2 size={16} />
                </button>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-[10px] font-black text-island-navy-soft uppercase tracking-widest pl-4">通訊頭像</label>
            <div className="grid grid-cols-4 gap-2 justify-items-center">
              {AVATAR_IDS.map((avatarId) => {
                const isSelected = selectedAvatarId === avatarId;
                return (
                  <button
                    key={avatarId}
                    onClick={() => handleAvatarSelect(avatarId)}
                    className={`transition-all active:scale-95 ${isSelected ? 'scale-105' : ''}`}
                  >
                    <PortholeFrame size={52}>
                      <div className={`w-full h-full flex items-center justify-center transition-colors ${
                        isSelected ? 'bg-island-teal/12' : 'bg-white hover:bg-island-line/30'
                      }`}>
                        <AvatarIcon id={avatarId} size={30} />
                      </div>
                    </PortholeFrame>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </SettingsSection>

      <SettingsSection title="帳號資訊">
        <div className="flex flex-col gap-1.5">
          <span className="text-[10px] text-island-navy-soft font-black uppercase tracking-wider">登入狀態</span>
          <div className="flex items-center justify-between bg-white border border-island-line rounded-2xl px-4 py-3">
            <span className="text-xs font-mono text-island-navy truncate">{isGuest ? '訪客存檔' : userEmail}</span>
            {/* Sync badge. Three states, not two: an anonymous guest with a real
                Firebase account already syncs, and conflating that with a
                device-only session is what let players believe their progress
                was safe when it was sitting in one browser's localStorage. */}
            <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black tracking-wide uppercase flex-shrink-0 ${
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
          </div>
          {isLocalOnly && (
            <p className="text-[11px] leading-relaxed text-island-coral/90 bg-island-coral/8 border border-island-coral/20 rounded-2xl px-3 py-2.5">
              你的島嶼目前只儲存在這台裝置上，換裝置或清除瀏覽器資料就會消失。綁定帳號即可備份並跨裝置同步。
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-[10px] text-island-navy-soft font-black uppercase tracking-wider">用戶獨立代碼 (UID)</span>
          <div className="flex items-center justify-between bg-white p-2.5 rounded-2xl border border-island-line">
            <span className="text-xs font-mono text-island-navy truncate max-w-[220px]">{profile.userId}</span>
            <button
              onClick={handleCopyId}
              className="text-island-navy-soft hover:text-island-navy transition-colors p-3 -m-2"
              title="複製 UID"
            >
              {copied ? <Check size={14} className="text-island-teal" /> : <Copy size={14} />}
            </button>
          </div>
        </div>

        {/* Same three tiles as AccountPanel's, and for the same reason — see the note there. The
            two screens show the same wallet and must not disagree about what is in it. */}
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
      </SettingsSection>

      {/* Account binding — 「將 Guest 存檔綁定至正式帳號」. Rendered from
          `linkableProviders`, so this list grows on its own as providers are
          promoted to `ready` in the registry. Same list/handlers as
          AccountPanel.tsx. */}
      {linkableProviders.length > 0 && (
        <SettingsSection title={isGuest ? '綁定帳號以保存進度' : '綁定其他登入方式'}>
          <p className="text-[10px] text-island-navy-soft/80 leading-relaxed -mt-2">
            {isGuest
              ? '綁定後即可在其他裝置登入並繼續你的島嶼。'
              : '多綁一種登入方式，換裝置時更方便。'}
          </p>

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
        </SettingsSection>
      )}

      <Button
        variant="danger"
        onClick={() => { playSound(SoundEffect.CLICK); void signOut(); }}
        className="w-full py-3 text-xs uppercase tracking-widest"
      >
        <LogOut size={16} />
        安全登出
      </Button>
    </div>
  );
}
