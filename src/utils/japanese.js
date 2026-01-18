/**
 * Japanese text utilities: romaji conversion, kana detection, normalization
 */

/**
 * Check if character is a vowel
 */
export function isVowel(ch) {
  return ch === 'a' || ch === 'i' || ch === 'u' || ch === 'e' || ch === 'o';
}

/**
 * Check if character is hiragana or katakana
 */
export function isHiraganaOrKatakana(ch) {
  return /[\u3040-\u30ff]/.test(ch);
}

/**
 * Romaji to hiragana mapping
 */
export const ROMAJI_MAP = {
  a: 'あ', i: 'い', u: 'う', e: 'え', o: 'お',

  ka: 'か', ki: 'き', ku: 'く', ke: 'け', ko: 'こ',
  sa: 'さ', shi: 'し', si: 'し', su: 'す', se: 'せ', so: 'そ',
  ta: 'た', chi: 'ち', ti: 'ち', tsu: 'つ', tu: 'つ', te: 'て', to: 'と',
  na: 'な', ni: 'に', nu: 'ぬ', ne: 'ね', no: 'の',
  ha: 'は', hi: 'ひ', fu: 'ふ', hu: 'ふ', he: 'へ', ho: 'ほ',
  ma: 'ま', mi: 'み', mu: 'む', me: 'め', mo: 'も',
  ya: 'や', yu: 'ゆ', yo: 'よ',
  ra: 'ら', ri: 'り', ru: 'る', re: 'れ', ro: 'ろ',
  wa: 'わ', wo: 'を', n: 'ん',

  ga: 'が', gi: 'ぎ', gu: 'ぐ', ge: 'げ', go: 'ご',
  za: 'ざ', ji: 'じ', zi: 'じ', zu: 'ず', ze: 'ぜ', zo: 'ぞ',
  da: 'だ', di: 'ぢ', du: 'づ', de: 'で', do: 'ど',
  ba: 'ば', bi: 'び', bu: 'ぶ', be: 'べ', bo: 'ぼ',
  pa: 'ぱ', pi: 'ぴ', pu: 'ぷ', pe: 'ぺ', po: 'ぽ',

  kya: 'きゃ', kyu: 'きゅ', kyo: 'きょ',
  gya: 'ぎゃ', gyu: 'ぎゅ', gyo: 'ぎょ',
  sha: 'しゃ', shu: 'しゅ', sho: 'しょ',
  sya: 'しゃ', syu: 'しゅ', syo: 'しょ',
  ja: 'じゃ', ju: 'じゅ', jo: 'じょ',
  jya: 'じゃ', jyu: 'じゅ', jyo: 'じょ',
  cha: 'ちゃ', chu: 'ちゅ', cho: 'ちょ',
  cya: 'ちゃ', cyu: 'ちゅ', cyo: 'ちょ',
  nya: 'にゃ', nyu: 'にゅ', nyo: 'にょ',
  hya: 'ひゃ', hyu: 'ひゅ', hyo: 'ひょ',
  bya: 'びゃ', byu: 'びゅ', byo: 'びょ',
  pya: 'ぴゃ', pyu: 'ぴゅ', pyo: 'ぴょ',
  mya: 'みゃ', myu: 'みゅ', myo: 'みょ',
  rya: 'りゃ', ryu: 'りゅ', ryo: 'りょ',

  xa: 'ぁ', xi: 'ぃ', xu: 'ぅ', xe: 'ぇ', xo: 'ぉ',
  la: 'ぁ', li: 'ぃ', lu: 'ぅ', le: 'ぇ', lo: 'ぉ',
  xya: 'ゃ', xyu: 'ゅ', xyo: 'ょ',
  lya: 'ゃ', lyu: 'ゅ', lyo: 'ょ',
  xtsu: 'っ', ltsu: 'っ',
  '-': 'ー',
};

/**
 * Convert romaji to hiragana incrementally
 * Returns { kana: string, rest: string }
 * Keeps incomplete tails like "k" or "n" as rest
 */
export function convertRomajiIncremental(buffer) {
  let i = 0;
  let out = '';
  const s = String(buffer ?? '').toLowerCase();

  while (i < s.length) {
    const ch = s[i];

    if (!/[a-z]/.test(ch)) {
      i++;
      continue;
    }

    if (ch === 'n') {
      const next = s[i + 1];
      if (!next) {
        return { kana: out, rest: s.slice(i) };
      }
      if (next === 'n') {
        out += 'ん';
        i += 2;
        continue;
      }
      if (isVowel(next) || next === 'y') {
        // Part of syllable
      } else {
        out += 'ん';
        i += 1;
        continue;
      }
    }

    const next = s[i + 1];
    if (next && ch === next && !isVowel(ch) && ch !== 'n') {
      out += 'っ';
      i += 1;
      continue;
    }

    const tri = s.slice(i, i + 3);
    const bi = s.slice(i, i + 2);
    const uni = s.slice(i, i + 1);

    if (ROMAJI_MAP[tri]) {
      out += ROMAJI_MAP[tri];
      i += 3;
      continue;
    }
    if (ROMAJI_MAP[bi]) {
      out += ROMAJI_MAP[bi];
      i += 2;
      continue;
    }
    if (ROMAJI_MAP[uni]) {
      out += ROMAJI_MAP[uni];
      i += 1;
      continue;
    }

    return { kana: out, rest: s.slice(i) };
  }

  return { kana: out, rest: '' };
}

/**
 * Normalize Japanese text for comparison (convert katakana to hiragana)
 */
export function normalizeJapanese(text) {
  return String(text).split('').map(ch => {
    const code = ch.charCodeAt(0);
    // Convert katakana (30A0-30FF) to hiragana (3040-309F)
    if (code >= 0x30A0 && code <= 0x30FF) {
      return String.fromCharCode(code - 0x60);
    }
    return ch;
  }).join('').toLowerCase();
}

/**
 * Split Japanese text into kana units, combining yōon (e.g. きょ, しゅ)
 */
export function splitKana(str) {
  const raw = Array.from(String(str ?? '').trim());
  const out = [];

  const isSmallYoon = (ch) => ch === 'ゃ' || ch === 'ゅ' || ch === 'ょ' || ch === 'ャ' || ch === 'ュ' || ch === 'ョ';
  const isYoonBase = (ch) =>
    ch === 'き' || ch === 'ぎ' || ch === 'し' || ch === 'じ' || ch === 'ち' || ch === 'ぢ' || ch === 'に' || ch === 'ひ' ||
    ch === 'び' || ch === 'ぴ' || ch === 'み' || ch === 'り' ||
    ch === 'キ' || ch === 'ギ' || ch === 'シ' || ch === 'ジ' || ch === 'チ' || ch === 'ヂ' || ch === 'ニ' || ch === 'ヒ' ||
    ch === 'ビ' || ch === 'ピ' || ch === 'ミ' || ch === 'リ';

  for (const ch of raw) {
    const prev = out[out.length - 1];
    if (prev && prev.length === 1 && isSmallYoon(ch) && isYoonBase(prev)) {
      out[out.length - 1] = prev + ch;
    } else {
      out.push(ch);
    }
  }

  return out;
}
