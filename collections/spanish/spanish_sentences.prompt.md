---
name: Spanish Sentences Prompt
description: Generate new entries for the Spanish sentences collection.
---

Context:
You will receive requests for Spanish learner sentences that may also need chunk-level references into the Spanish words collection.
Produce new sentence entries that match the schema and style.

Output Requirements:
- Return only a JSON array.
- No extra text.

Prompt Schema Summary:
- es: string
  Full natural Spanish sentence.

- en: string
  Natural English translation of the full sentence.

- notes: string[]
  Optional learner notes. Omit when unnecessary.

- chunks: sentenceChunk[]
  Ordered learner-friendly chunks covering the sentence.

- chunks[].es: string
  Chunk text exactly as it appears in the sentence.

- chunks[].gloss: string
  Short learner-friendly gloss for the chunk.

- chunks[].refs: string[]
  Referenced Spanish terms for that chunk.

Samples:
[{"es":"El gobierno anunció nuevas medidas económicas para reducir la inflación y apoyar a las pequeñas empresas.","en":"The government announced new economic measures to reduce inflation and support small businesses.","notes":["This sentence is useful for government, business, and economy vocabulary."],"chunks":[{"es":"El gobierno anunció","gloss":"the government announced","refs":["gobierno","anunciar"]},{"es":"nuevas medidas económicas","gloss":"new economic measures","refs":["nuevo","medida","económico"]},{"es":"para reducir la inflación","gloss":"to reduce inflation","refs":["reducir","inflación"]},{"es":"y apoyar a las pequeñas empresas","gloss":"and support small businesses","refs":["apoyar","pequeño","empresa"]}]}

Instructions:
- Follow the schema exactly.
- Write natural Spanish and natural English.
- Keep chunks ordered and faithful to the sentence surface form.
- Use refs only for meaningful Spanish terms actually present in the chunk.
- Omit optional fields when they add no value.
- Return only a JSON array of new entries.

Prompt Request:
<Create beginner-friendly sentence entries for the following words: [word1, word2, word3]>
<Create sentence entries from the following Spanish sentence ideas: [idea1, idea2, idea3]>
<Create sentence entries that practice the following grammar points: [present tense, gustar, ir a + infinitive]>
<Create sentence entries in the following categories: [travel, food, school, daily routines]>
<Create sentence entries for the following scenario: "ordering food at a cafe"> 
