
**3. Fragment Splitting**

* Identify natural fragment boundaries inside `ja` (commas or logical mid-points).
* Add `ja_fragments` to each sentence object. `ja_fragments` is an array of fragment objects with:

  * `ja` — fragment text in Japanese
  * `en` — neutral standalone meaning (preserve JP order if helpful)
  * `pattern` — fragment-level pattern (if applicable)
  * `words` — dictionary-form words

**Fragment recursion (optional)**

* A fragment may also contain its own `ja_fragments` **only if** it has meaningful internal structure (multiple clauses, helper constructions, or noun-clause packaging such as の / こと / ところ).

* Split into 2+ child fragments at natural clause or particle boundaries.

* Omit `ja_fragments` if no useful split exists.

* Recombine/print the whole JSON: `{ sentences }`