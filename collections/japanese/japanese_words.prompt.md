---
name: Japanese Words Prompt
description: Generate new entries for the Japanese words collection.
---

Context:
You will receive collection metadata and example entries from a Japanese vocabulary collection.
Produce new entries that match the schema and style.

Output Requirements:
- Return only a JSON array.
- No extra text.

Prompt Schema Summary:
- kanji: string
  Canonical dictionary/headword kanji form if one exists. If no established kanji exists, use the standard kana or katakana headword.

- reading: string
  Pronunciation written in kana. Usually hiragana, but katakana is allowed for katakana words.

- meaning: string
  Short English gloss.

- type: enum
  noun, proper-noun, morpheme, ichidan-verb, godan-verb, irregular-verb, i-adjective, na-adjective, particle, adverb, counter, expression, numeral, descriptive-phrase, phrase-sentence, conjunction

- semanticClass: string
  Optional semantic grouping such as onomatopoeia, greeting, food, city, or sfx.

- tags: string[]
  Optional machine-friendly tags. Use short snake_case or existing collection-style tags only when useful.

Samples:
[{"kanji":"全部","reading":"ぜんぶ","meaning":"all; entirely","type":"noun"},{"kanji":"直ぐ","reading":"すぐ","meaning":"right away; immediately","type":"adverb","tags":["game-center-story"]},{"kanji":"読む","reading":"よむ","meaning":"to read","type":"godan-verb"},{"kanji":"ビリビリ","reading":"ビリビリ","meaning":"tingle; electric shock feeling (onomatopoeia)","type":"adverb","tags":["origin:Japanese","pokemon-name-root"],"semanticClass":"onomatopoeia"}]

Instructions:
- Follow the schema exactly.
- Match the concise dictionary style of the collection.
- Prefer common useful vocabulary, but keep specialized item types consistent with the collection when requested.
- Prefer canonical dictionary headword forms.
- Keep `kanji` as the canonical headword field even when the most common display form is kana or katakana.
- Use `reading` in kana only.
- Keep English meanings short and learner-friendly.
- Use `semanticClass` and `tags` only when they add clear value.
- Use `morpheme` only for bound elements mainly used inside compounds rather than normal standalone words.
- Use `expression`, `descriptive-phrase`, or `phrase-sentence` for fixed multi-word units when a single-word type would be misleading.
- For verb entries, use dictionary form.
- For adjectives, distinguish carefully between `i-adjective` and `na-adjective`.
- For onomatopoeia and sound-symbolic words, usually use `semanticClass` like `onomatopoeia` or `sfx` when appropriate.
- Return only a JSON array of new entries.

Prompt Request:
{prompt}
