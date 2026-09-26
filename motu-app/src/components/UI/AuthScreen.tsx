/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Anchor, AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useAuth } from '../../auth/useAuth';
import { PortholeFrame } from './DesignKit';
import { ProviderButton } from './ProviderButton';

// "登島手續" (boarding formalities) — the very first screen a player sees,
// so it's the highest-leverage spot for the Dock & Signpost motif. Flat
// island-teal/cream, no glass blur or amber — see feedback-ui-style-preference.
//
// The buttons are rendered from the provider registry rather than written out
// one by one, and every failure now lands in the banner below. Previously this
// screen called `signInWithGoogle()` from `onClick` with no error handling at
// all, so `auth/unauthorized-domain` — the actual bug — looked to the player
// like a dead button, leaving Guest as the only way in.
export function AuthScreen() {
  const { signInProviders, signIn, pendingProviderId, status, error, clearError, lastProviderId } =
    useAuth();

  const isBusy = status === 'signing-in';

  return (
    <div className="fixed inset-0 z-hud-topbar bg-island-teal-dark flex items-center justify-center overflow-hidden">
      {/* Flat gradient sky, no blur orbs */}
      <div
        className="absolute inset-0"
        style={{ background: 'linear-gradient(180deg, var(--color-island-teal) 0%, var(--color-island-teal-dark) 100%)' }}
      />

      {/* Distant shoreline silhouette, purely decorative */}
      <svg
        className="absolute bottom-0 left-0 w-full h-[18%] text-island-navy/20 pointer-events-none"
        viewBox="0 0 400 60"
        preserveAspectRatio="none"
      >
        <path d="M0,40 Q50,10 100,35 T200,30 T300,42 T400,25 L400,60 L0,60 Z" fill="currentColor" />
      </svg>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        // Shadow is `.notch-shadow-lg` on this wrapper, not a `shadow-[...]` on
        // the clipped card — a clip-path clips the element's own box-shadow
        // away entirely (see index.css).
        className="relative notch-shadow-lg flex max-w-sm w-full mx-4"
      >
        <div className="bg-white dock-notch p-8 md:p-10 rounded-[2.5rem] flex flex-col items-center w-full max-h-[92vh] overflow-y-auto">
        <PortholeFrame size={88} className="mb-5 shadow-[0_10px_24px_rgba(42,157,143,0.3)]">
          <div className="w-full h-full rounded-full bg-island-teal flex items-center justify-center">
            <Anchor size={38} className="text-white" strokeWidth={2.2} />
          </div>
        </PortholeFrame>

        <h1 className="text-2xl md:text-3xl font-black text-island-navy mb-2 tracking-tight text-center">健身海島 Fitness Island</h1>
        <p className="text-island-navy-soft text-center text-sm mb-6 px-2">
          在熱帶天堂運動、賺取獎勵並客製化你的海島生活。
        </p>

        <div className="rope-stitch w-full mb-6" />

        {/* Failure banner. Configuration problems get a distinct, louder
            treatment because they are not the player's fault and they are the
            developer's cue to open docs/AUTH_SETUP.md. */}
        <AnimatePresence>
          {error && (
            // Opacity/translate rather than an `height: 0 → 'auto'` reveal: this
            // card is a flex column, where motion cannot resolve `auto` and the
            // wrapper stays at height 0 — which clips the banner away entirely
            // and reproduces the very "login fails with no feedback" bug this
            // banner exists to fix.
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.22 }}
              className="w-full mb-4"
            >
              <div
                role="alert"
                className={`flex gap-2.5 items-start rounded-2xl border px-4 py-3 text-xs font-semibold leading-relaxed ${
                  error.isConfigurationError
                    ? 'bg-island-coral/10 border-island-coral/30 text-island-coral'
                    : 'bg-island-sand border-island-line text-island-navy-soft'
                }`}
              >
                <AlertTriangle size={15} className="mt-0.5 flex-shrink-0" />
                <span className="flex-1">{error.message}</span>
                <button
                  onClick={clearError}
                  className="text-[10px] font-black uppercase tracking-widest opacity-60 hover:opacity-100 px-1"
                  aria-label="關閉提示"
                >
                  關閉
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Every sign-in method, straight from the registry. */}
        <div className="w-full flex flex-col gap-3">
          {signInProviders.map((descriptor) => (
            <ProviderButton
              key={descriptor.id}
              descriptor={descriptor}
              busy={pendingProviderId === descriptor.id}
              disabled={isBusy && pendingProviderId !== descriptor.id}
              hint={lastProviderId === descriptor.id ? '上次使用' : undefined}
              onSelect={() => void signIn(descriptor.id)}
            />
          ))}
        </div>

        <p className="mt-6 text-island-navy-soft/70 text-[10px] text-center leading-relaxed px-2">
          以訪客身分開始也沒問題 —— 之後可以在「帳號資訊」把進度綁定到 Google 或 Apple 帳號。
        </p>

        <p className="mt-4 text-island-navy-soft/50 text-[10px] uppercase tracking-widest font-mono">
          © 2026 Tropical Fitness AI
        </p>
        </div>
      </motion.div>
    </div>
  );
}
