/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Dog, Cat, Bird, PawPrint } from 'lucide-react';
import type { ItemDefinition } from '../../constants/items';
import { PET_SPECIES_TABLE, type PetSpecies } from '../../constants/pets';
import { speciesServedBy } from '../../lib/petCompatibility';
import { playSound, SoundEffect } from '../../lib/soundUtils';

/** `all` is a real choice, not the absence of one — see the file doc. */
export type PetSpeciesFilterValue = PetSpecies | 'all';

const SPECIES_GLYPH: Record<PetSpecies, typeof Dog> = { dog: Dog, cat: Cat, bird: Bird };

/**
 * 寵物用品的物種篩選 — the chip row above the 寵物用品 and 寵物窩 shelves.
 *
 * The brief's §5 is the whole reason it exists: a player who owns a bird should not have to work
 * out which of ten homes on a shelf a bird can use. It opens on THEIR animal's species (see
 * {@link defaultSpeciesFilter}), so the shelf a bird owner walks into is a shelf of bird homes.
 *
 * ## Why it is a filter and not a hard narrowing
 *
 * §5 also says the wrong option should not be shown at all, and in the two places where the player
 * is ACTING on a specific animal — the in-world feeding list (UI/PetInteractionPanel.tsx) and the
 * resting-spot resolver (lib/petRestingSpots.ts) — it is exactly that: incompatible things do not
 * exist. A shop is the one surface where that would be wrong, because the shop is also where the
 * player buys their SECOND pet. A cat owner saving up for a bird has to be able to see that birds
 * have homes, and a shelf that hid them would be a dead end reached by following the game's own
 * advice. So 全部 stays one tap away and nothing is ever unreachable.
 *
 * ## Nothing here knows what a dog is
 *
 * The chips are built from {@link speciesServedBy} over the items on the shelf, so a species with
 * nothing on this shelf gets no chip (a filter that can only empty the screen is not offered), and
 * a future 寵物玩具 shelf grows this row for free the moment its rows declare a species. The row
 * hides itself entirely below two species — one chip plus 全部 is not a choice.
 */
export function PetSpeciesFilter({
  items,
  value,
  onChange,
  className = '',
}: {
  /** The shelf's items, unfiltered. What the chips are derived from. */
  items: readonly ItemDefinition[];
  value: PetSpeciesFilterValue;
  onChange: (value: PetSpeciesFilterValue) => void;
  className?: string;
}) {
  const species = speciesServedBy(items);
  if (species.length < 2) return null;

  const options: { id: PetSpeciesFilterValue; label: string; Glyph: typeof Dog }[] = [
    { id: 'all', label: '全部', Glyph: PawPrint },
    ...species.map((id) => ({
      id: id as PetSpeciesFilterValue,
      label: PET_SPECIES_TABLE[id].label,
      Glyph: SPECIES_GLYPH[id],
    })),
  ];

  return (
    <div
      className={`flex flex-wrap items-center justify-center gap-2 select-none ${className}`}
      role="group"
      aria-label="依寵物種類篩選"
    >
      {options.map(({ id, label, Glyph }) => {
        const active = value === id;
        return (
          <button
            key={id}
            onClick={() => {
              playSound(SoundEffect.CLICK);
              onChange(id);
            }}
            aria-pressed={active}
            className={`h-9 px-3.5 rounded-xl border flex items-center gap-1.5 transition-all active:scale-95 flex-shrink-0 ${
              active
                ? 'bg-island-teal border-island-teal text-white shadow-[0_4px_12px_rgba(42,157,143,0.25)]'
                : 'bg-white border-island-line text-island-navy-soft hover:border-island-teal hover:text-island-teal'
            }`}
          >
            <Glyph size={14} strokeWidth={2.75} />
            <span className="text-[11px] font-black tracking-tight whitespace-nowrap">{label}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * Which chip a pet shelf opens on: the player's own companion's species, when the shelf has
 * anything for it.
 *
 * This is the half of §5 that is actually about being kind — the filter existing is not much use if
 * the player has to find and press it. The fallback to 全部 covers a player with no pet out and a
 * shelf that happens to serve nobody they own, both of which want the whole shelf.
 */
export function defaultSpeciesFilter(
  items: readonly ItemDefinition[],
  species: PetSpecies | undefined,
): PetSpeciesFilterValue {
  if (!species) return 'all';
  return speciesServedBy(items).includes(species) ? species : 'all';
}
