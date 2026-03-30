---
name: Japanese Sentences Prompt
description: Generate new entries for the Japanese sentences collection.
---

Context:
You will receive requests for Japanese learner sentences that may also need chunk-level references into the Japanese words collection.
Produce new sentence entries that match the schema and style.

Output Requirements:
- Return only a JSON array.
- No extra text.

Prompt Schema Summary:
- ja: string
  Full natural Japanese sentence.

- en: string
  Natural English translation of the full sentence.

- notes: string[]
  Optional learner notes. Omit when unnecessary.

- grammarNotes: string[]
  Optional high-value grammar recognition notes. Omit when unnecessary.

- chunks: sentenceChunk[]
  Ordered learner-friendly chunks covering the sentence.

- chunks[].ja: string
  Chunk text exactly as it appears in the sentence.

- chunks[].en: string
  Short learner-friendly English rendering of the chunk.

- chunks[].refs: string[]
  Referenced Japanese terms for that chunk.

Samples:
[{"ja":"フーディーニは三回も冷たい水を浴びた。","en":"Houdini even bathed in cold water three times.","grammarNotes":["回 is a general counter for occurrences/actions."],"notes":["三回も adds surprise or emphasis, roughly \"as many as three times\"."],"chunks":[{"ja":"フーディーニは三回も","en":"Houdini even three times","refs":["フーディーニ","三回"]},{"ja":"冷たい水を浴びた","en":"bathed in cold water","refs":["冷たい","水","浴びる"]}]}]

Instructions:
- Follow the schema exactly.
- Write natural Japanese and natural English.
- Keep chunks ordered and faithful to the sentence surface form.
- Use refs only for meaningful Japanese terms actually present in the chunk.
- Do not include particles in `refs`.
- Prefer chunking that helps a learner read the sentence naturally.
- Use `grammarNotes` only for short, high-value recognition notes or contrast notes.
- Omit optional fields when they add no value.
- Return only a JSON array of new entries.

Prompt Request:
{prompt}
