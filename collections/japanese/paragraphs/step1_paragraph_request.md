
## 1. Generate Paragraph

### Goal

Create a short learner-level Japanese paragraph from a user idea, optionally localizing it into a natural Japanese context before writing the final Japanese.

---

### Instructions

* Create a short **2–4 sentence paragraph** using **N5–N3 grammar**.
* Keep **one continuous scenario** (same person, same day, same goal).
* Include a **small problem, decision, or consequence**.
* Avoid teleporting locations unless a **transition word** is used (そのあと, 結局, 翌日, etc.).
* Prefer **cause → action → result** structure.
* **Use provided vocabulary naturally** if any is supplied.
* If the user provides an English or vague prompt, first **localize / contextualize** it into a natural Japanese-setting outline in English.

  * Add realistic details (station, line, reason, time) when helpful.
  * Adjust tone from comedic / abstract → diary / narrative if appropriate.
  * Do **not** change the core scenario or goal.
* The final English output must be a **translation of the Japanese paragraph**, not a rewrite of the original prompt.

---

### Output Schema

Output to `json.paragraph` with the following structure:

```json
{
  "paragraph": {
    "englishStoryPrompt": "string | null",
    "localizedOutlineEn": "string",
    "ja": "string",
    "en": "string"
  }
}
```

---

### Field Rules

* **englishStoryPrompt**

  * Raw user story idea if provided.
  * `null` if no prompt was given.

* **localizedOutlineEn**

  * Short 1–3 sentence English outline rewritten into a natural Japanese context.
  * May add specificity (places, trains, motivations).
  * Must preserve the same person, same day, same objective.

* **ja**

  * Final 2–4 sentence Japanese paragraph.
  * N5–N3 grammar only.
  * Must reflect the localized outline.

* **en**

  * Direct, faithful translation of `ja`.
  * Not a paraphrase of the original prompt.

---

### User Input Shape

```
User Input:
  Prompt: free-form English idea, notes, or rough story (optional)
  Words: vocabulary / grammar items to include if possible (optional)
```

---

### Behavioral Notes

* If **no Prompt** is given:

  * Set `englishStoryPrompt` to `null`.
  * Invent a simple scenario and still produce `localizedOutlineEn`.
* If **Words** are given:

  * Integrate them naturally; do not force unnatural phrasing.
* Do not output explanations, only the JSON.

---
---

User Input:
  Prompt: <...>
  Words: <...>
```