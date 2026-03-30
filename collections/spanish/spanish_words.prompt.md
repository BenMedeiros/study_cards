---
name: Spanish Words Prompt
description: Generate new entries for the Spanish words collection.
---

Context:
You will receive collection metadata and example entries from a Spanish vocabulary collection.
Produce new entries that match the schema and style.

Output Requirements:
- Return only a JSON array.
- No extra text.

Prompt Schema Summary:
- term: string
  Main study term. Usually a single word, but short useful phrases are allowed.

- meaning: string
  Short English gloss.

- type: enum
  noun, proper-noun, verb, adjective, adverb, pronoun, determiner, preposition, conjunction, interjection, expression

- semanticClass: string
  Optional semantic grouping such as food, home, animals, people, city, or time.

- gender: enum
  m, f, mf, f_el
  Only for nouns when relevant.
  `f_el` = feminine noun that takes singular "el" before stressed /a/.

- tags: string[]
  Optional. Use only when useful.

Samples:
[{"term":"agua","meaning":"water","type":"noun","semanticClass":"food","gender":"f_el"},{"term":"pan","meaning":"bread","type":"noun","semanticClass":"food","gender":"m"},{"term":"ser","meaning":"to be","type":"verb","semanticClass":"core"},{"term":"haber","meaning":"to have; there to be","type":"verb","semanticClass":"core"}]

Instructions:
- Follow the schema exactly.
- Match the concise dictionary style of the examples.
- Prefer common useful vocabulary.
- Prefer dictionary headword forms when possible, such as verbs in the infinitive and nouns in the singular.
- Use `expression` for fixed multi-word expressions.
- Omit optional fields when they add no value.
- Return only a JSON array of new entries.

Prompt Request:
{prompt}
