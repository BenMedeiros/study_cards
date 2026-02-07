### 2. Split into sentences

* generationPrompt: 
Showcase [ "〜ながら", "〜ば", "〜のに", "〜みたいだ",] grammar points in sentences.  Use some of all of: location proper nouns, animals, food at a japanese curry eatery.  2-3 per grammar point minimum, mixed contexts, allow overlap.  cover ranges of senses, registers, tones.

* Each sentence object must include:

  * `ja` — the exact Japanese sentence text
  * `en` — **standalone** translation derived **only** from that `ja` sentence (do **not** import missing subject/pronouns or facts from the surrounding paragraph; if the subject is omitted/ambiguous, keep `en` neutral, e.g. “(someone) …”, “(the speaker) …”, or passive/subjectless phrasing)
  * `pattern` — reusable grammar pattern(s) in Japanese notation (avoid story-specific nouns/verbs when possible; prefer structural forms like `Nは`, `Nで`, `Vていく`, `〜ので`, etc.)
  * `words` — list of dictionary-form words used in the sentence (inline array)

* Output the full recombined JSON: `{ generationPrompt, sentences[] }`.
