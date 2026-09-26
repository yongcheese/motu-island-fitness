/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Loader2 } from 'lucide-react';
import type { ProviderDescriptor } from '../../auth/providers/types';
import { Button } from './DesignKit';

/**
 * One sign-in / account-binding button, rendered entirely from a
 * {@link ProviderDescriptor}.
 *
 * This component knows nothing about Google, Apple or anyone else — that is the
 * point. The sign-in screen maps over the registry, so adding Discord later
 * changes `providers/registry.ts` and no JSX at all. The previous screen had
 * one hand-written `<Button>` per provider, complete with a hotlinked
 * `google.com/favicon.ico`, which is exactly the 「將登入邏輯散落於 UI Component」
 * pattern the brief rules out.
 */
export function ProviderButton({
  descriptor,
  onSelect,
  busy = false,
  disabled = false,
  hint,
}: {
  descriptor: ProviderDescriptor;
  onSelect: () => void;
  /** This provider's own sign-in is in flight. */
  busy?: boolean;
  /** Some other provider is in flight, or the app is otherwise blocked. */
  disabled?: boolean;
  /** Small trailing note, e.g. 「上次使用」. */
  hint?: string;
}) {
  const isPlanned = descriptor.status === 'planned';

  return (
    <Button
      variant={descriptor.emphasis === 'primary' ? 'primary' : 'secondary'}
      onClick={onSelect}
      disabled={disabled || busy || isPlanned}
      aria-label={descriptor.label}
      className={`w-full gap-3 px-6 py-4 text-base ${
        descriptor.emphasis === 'secondary' ? 'hover:border-island-teal' : ''
      }`}
    >
      {busy ? (
        <Loader2 size={20} className="animate-spin" aria-hidden />
      ) : (
        <svg
          viewBox={descriptor.mark.viewBox}
          width={20}
          height={20}
          aria-hidden
          className="flex-shrink-0"
        >
          {descriptor.mark.paths.map((path, index) => (
            <path key={index} d={path.d} fill={path.fill ?? 'currentColor'} />
          ))}
        </svg>
      )}
      <span className="flex-1 text-left">{descriptor.label}</span>
      {isPlanned && (
        <span className="text-[10px] font-bold uppercase tracking-widest opacity-60">
          即將推出
        </span>
      )}
      {!isPlanned && hint && (
        <span className="text-[10px] font-bold uppercase tracking-widest opacity-60">{hint}</span>
      )}
    </Button>
  );
}
