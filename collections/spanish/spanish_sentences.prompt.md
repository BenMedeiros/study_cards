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

- chunks[].en: string
  Short learner-friendly English rendering of the chunk.

- chunks[].refs: string[]
  Referenced Spanish terms for that chunk.

Samples:
[{"es":"El gobierno anunció nuevas medidas económicas para reducir la inflación y apoyar a las pequeñas empresas.","en":"The government announced new economic measures to reduce inflation and support small businesses.","notes":["This sentence is useful for government, business, and economy vocabulary."],"chunks":[{"es":"El gobierno anunció","en":"the government announced","refs":["gobierno","anunciar"]},{"es":"nuevas medidas económicas","en":"new economic measures","refs":["nuevo","medida","económico"]},{"es":"para reducir la inflación","en":"to reduce inflation","refs":["reducir","inflación"]},{"es":"y apoyar a las pequeñas empresas","en":"and support small businesses","refs":["apoyar","pequeño","empresa"]}]} 

Instructions:
- Follow the schema exactly.
- Write natural Spanish and natural English.
- Keep chunks ordered and faithful to the sentence surface form.
- Use refs only for meaningful Spanish terms actually present in the chunk.
- Omit optional fields when they add no value.
- Return only a JSON array of new entries.

Prompt Request:
{prompt}
