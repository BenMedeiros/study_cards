### 2. Split into sentences

* Break `json.paragraph.ja` into individual sentences and place them in `json.sentences[]`.

* Each sentence object must include:

  * `ja` — the exact Japanese sentence text
  * `en` — **standalone** translation derived **only** from that `ja` sentence (do **not** import missing subject/pronouns or facts from the surrounding paragraph; if the subject is omitted/ambiguous, keep `en` neutral, e.g. “(someone) …”, “(the speaker) …”, or passive/subjectless phrasing)
  * `pattern` — reusable grammar pattern(s) in Japanese notation (avoid story-specific nouns/verbs when possible; prefer structural forms like `Nは`, `Nで`, `Vていく`, `〜ので`, etc.)
  * `words` — list of dictionary-form words used in the sentence (inline array)

* Output the full recombined JSON: `{ paragraph, sentences }`.
