/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { ItemDefinition } from './items';
import { getItemCategoryLabel } from '../utils/categoryUtils';

/**
 * 揭曉文案 — the three lines that land under an item during its 稀有度揭曉.
 *
 * Separate from `ItemDefinition.description` on purpose, and the difference is who is being
 * addressed. A card's `description` is a *catalogue entry*: it describes an object to someone
 * deciding whether to buy it, in the third person, at whatever length the object needs (鳳凰's runs
 * to four clauses about 梧桐 and 醴泉). What plays after the purchase is a *greeting*: the thing is
 * already yours, so the copy's job is to introduce a new companion rather than to sell one, and it
 * has about two seconds of screen time to do it in.
 *
 * Reusing the catalogue line for the greeting was the obvious first idea and it reads wrong twice
 * over — it is too long to take in against a moving background, and having just spent 4800 gold the
 * player is re-read the sales pitch they already agreed to.
 *
 * ## The template
 *
 *   認識【名稱】！這是一隻／一個【類型與特徵】的【寵物／物品】，最喜歡【喜好或用途】，
 *   將為你的【日常／旅程】帶來【溫暖、陪伴或實用價值】。
 *
 * Every `intro` below is that sentence. Keeping the shape identical is what makes nine different
 * animals read as nine members of one shelf; a table where each entry found its own phrasing would
 * read as nine unrelated pieces of marketing copy.
 *
 * ## Why only the pets are written out
 *
 * The reveal is reachable by 史詩 and above (constants/rarityFx.ts), whose pets are 柴犬 and 鳳凰
 * — both pets — and, through the `?rarity=` debug override, anything at all. So the pet shelf is
 * hand-written and everything else falls back (see {@link getRevealCopy}). Writing greeting copy for
 * 121 items that can never show it would be 121 strings to keep in step with their descriptions for
 * no visible gain.
 *
 * The whole shelf is written rather than just the two that can reach the reveal, because the tier on
 * a pet is a balance value that has already moved once; copy that exists only for the tiers that
 * happen to be high today would silently fall back to the generic line the first time 賓士貓 is
 * promoted.
 */
export interface RevealCopy {
  /**
   * 類型 — what kind of thing this is, in two to four characters.
   *
   * Note this is NOT the 稀有度. The tier is deliberately wordless everywhere in the game
   * (constants/rarity.ts) and the reveal is the one place a 「神話」 caption would be easiest to
   * justify and still be the same mistake: the player is being shown what they now own, not read
   * their receipt. What they are told instead is what it IS — 「短毛犬」, 「神鳥」 — which is the
   * useful half of that line and stays true whatever the tier is tuned to later. The tier is still
   * said, at full volume, by the colour of everything around this text.
   */
  kind: string;
  /** One warm sentence in the template above. Two or three lines at reveal width; never four. */
  intro: string;
  /**
   * Two or three short badges.
   *
   * Two to three because one badge is an afterthought and four wrap onto a second row, which turns
   * the calmest part of the reveal into a paragraph. Four characters each, at most — these are read
   * at a glance while the item is still bobbing, not studied.
   */
  tags: string[];
}

/** Keyed by item id, matching constants/items.ts. */
export const REVEAL_COPY: Record<string, RevealCopy> = {
  // --- 狗 ---
  'pet-dog-dachshund': {
    kind: '短腿犬',
    intro: '認識臘腸犬！牠是一隻長腰短腿、走起路來整條背都在晃的小獵犬，最喜歡貼著地板到處嗅聞，將為你的日常帶來慢悠悠的好心情。',
    tags: ['忠心', '愛嗅聞', '長腰短腿'],
  },
  'pet-dog-poodle': {
    kind: '捲毛犬',
    intro: '認識紅貴賓犬！牠是一隻杏紅色、從頭蓬到腳踝的捲毛小狗，最喜歡被抱在懷裡撒嬌，將為你的日常帶來柔軟而療癒的時光。',
    tags: ['愛撒嬌', '蓬鬆', '好抱'],
  },
  // 柴犬 is the shelf's earned companion — unlocked at 100 XP, not bought — so its greeting is the
  // one that mentions how it arrived. 「陪你走過的每一次訓練」 is literally true of this pet and of
  // no other on the shelf.
  'pet-dog-shiba': {
    kind: '立耳犬',
    intro: '認識柴犬！牠是一隻結實挺拔、尾巴驕傲捲在背上的赤色夥伴，最喜歡陪你走過每一次訓練，將為你的旅程帶來穩穩的信賴與陪伴。',
    tags: ['訓練夥伴', '驕傲', '結實'],
  },

  // --- 貓 ---
  'pet-cat-orange': {
    kind: '虎斑貓',
    intro: '認識橘貓！牠是一隻暖橘毛色、額頭帶著 M 字紋的圓潤家貓，最喜歡趴在有陽光的地方打盹，將為你的日常帶來慵懶又安心的午後。',
    tags: ['愛睡覺', '溫暖', '圓潤'],
  },
  'pet-cat-tabby': {
    kind: '虎斑貓',
    intro: '認識虎斑貓！牠是一隻身側排著細直紋、眼角向後拉長的褐灰色貓咪，最喜歡從高處靜靜觀察你，將為你的日常帶來安靜的默契。',
    tags: ['優雅', '愛觀察', '安靜'],
  },
  'pet-cat-tuxedo': {
    kind: '賓士貓',
    intro: '認識賓士貓！牠是一隻黑毛配雪白胸兜與四隻白襪的紳士貓，最喜歡端正地坐在你身旁，將為你的日常帶來體面又親近的陪伴。',
    tags: ['紳士', '親人', '天生正裝'],
  },

  // --- 鳥 ---
  'pet-bird-budgie': {
    kind: '小鸚鵡',
    intro: '認識虎皮鸚鵡！牠是一隻草綠帶黃、後頸鋪著整片虎斑的小鸚鵡，最喜歡歪著頭學你說話，將為你的日常帶來熱鬧又逗趣的聲音。',
    tags: ['愛說話', '好奇', '活潑'],
  },
  'pet-bird-javasparrow': {
    kind: '小文鳥',
    intro: '認識文鳥！牠是一隻灰背粉肚、頂著黑頭罩與雪白臉頰的圓潤小鳥，最喜歡停在你的指尖上打盹，將為你的日常帶來小小的溫熱重量。',
    tags: ['圓潤', '親人', '愛停手'],
  },
  'pet-bird-canary': {
    kind: '鳴禽',
    intro: '認識金絲雀！牠是一隻通身金黃、臉頰暈著暖橘的歌唱家，最喜歡在清晨對著光唱上一段，將為你的日常帶來明亮而清脆的開場。',
    tags: ['歌聲動人', '明亮', '晨型'],
  },
  // 鳳凰 is the game's only 神話 item and the greeting is allowed to be the grandest on the shelf —
  // but still warm, and still about companionship. 「浴火重生」 belongs to the catalogue line; what
  // this one promises is that it stays with you, which is what a reveal is for.
  'pet-bird-phoenix': {
    kind: '神鳥',
    intro: '認識鳳凰！牠是一隻朱紅羽衣鑲著流金翎邊、頂著火冠的傳說神鳥，最喜歡在你身邊靜靜盤旋，將為你的旅程帶來溫暖而長久的守護。',
    tags: ['傳說', '守護', '火羽'],
  },
};

/** The first sentence of a catalogue line — up to and including its first 。, ！ or ，. */
function firstClause(description: string): string {
  const end = description.search(/[。！]/);
  if (end >= 0) return description.slice(0, end);
  const comma = description.indexOf('，');
  return comma >= 0 ? description.slice(0, comma) : description;
}

/**
 * The greeting for an item, including everything the table above does not name.
 *
 * The fallback builds the template's opening from what every item already has — its name and its
 * category — and borrows the first clause of its catalogue line for the middle. That is a weaker
 * sentence than a written one and it is meant to be: it exists so a debug override
 * (`?rarity=mythic` on a floor tile) still renders a complete reveal instead of a hole where the
 * copy should be, not so that the table can be left unfilled.
 *
 * It returns NO tags rather than inventing them. Tags are the one part of the block that cannot be
 * derived — 「愛撒嬌」 is a judgement about an animal, not a fact about a record — and three plausible
 * guesses would be worse than an empty row the layout already handles.
 */
export function getRevealCopy(item: ItemDefinition): RevealCopy {
  const written = REVEAL_COPY[item.id];
  if (written) return written;

  const kind = getItemCategoryLabel(item.id);
  return {
    kind,
    intro: `認識${item.name}！這是一件${firstClause(item.description)}的${kind}，將為你的島嶼帶來一點新的樂趣。`,
    tags: [],
  };
}
