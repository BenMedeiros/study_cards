---
name: Collection Prompt Generator
description: Create a collection-specific .prompt.md file from an existing collection JSON file, matching the style of the collection prompt docs in this workspace.
argument-hint: Attach or reference the target collection JSON file, for example ./collections/spanish/spanish_words.json
agent: agent
---

Create a `.prompt.md` document for the provided collection JSON file.

Use these prompt documents as style references:
- [spanish_words.prompt.md](./spanish/spanish_words.prompt.md)
- [spanish_sentences.prompt.md](./spanish/spanish_sentences.prompt.md)

Critical requirement:
- You must inspect the actual collection JSON file that the prompt is being created for.
- If the collection JSON file is not attached, linked, or otherwise available in context, do not guess. Ask for that file first.
- The collection JSON is the source of truth for metadata, schema, field names, entry style, and representative samples.

What to infer from the collection JSON:
- Collection purpose from `metadata.name`, `metadata.description`, `metadata.category`, and `metadata.source`.
- Entry shape from `metadata.schema` and actual `entries`.
- Required vs optional fields from the schema and observed examples.
- Writing style from real entries: brevity, terminology, formatting, and level of detail.

Output requirements:
- Return only the full markdown contents of the new `.prompt.md` file.
- Include YAML frontmatter.
- Include at least `name` and `description` in the frontmatter.
- Match the concise structure and tone used by the existing collection prompt files.
- Do not return explanations, notes, or fenced code blocks.

Required body structure:

Context:
- State that the model will receive collection metadata and example entries from the target collection.
- State that it should produce new entries matching that collection's schema and style.

Output Requirements:
- Tell the model to return only the requested payload format.
- Tell the model to return no extra text.

Prompt Schema Summary:
- List each relevant output field.
- For each field, give the field name, expected type, and a short description.
- Mention enums and optional fields when relevant.
- Keep each field description concise.

Samples:
- Include a short JSON array with 2 to 4 representative entries copied from the target collection.
- Choose entries that clearly show the collection's schema and style.

Instructions:
- Follow the schema exactly.
- Match the collection's existing style.
- Prefer natural, learner-useful, internally consistent content.
- Omit optional fields when they add no value.
- Add collection-specific rules only when supported by the source collection.
- Return only the requested payload.

Prompt Request:
- End with reusable placeholder requests in angle brackets.
- Tailor the request patterns to the target collection type.
- Include 4 to 6 useful request patterns.
- Examples: create entries for specific terms, create entries from meanings, create entries by category, create entries for a scenario, create sentences for grammar targets, create items from source text.

Quality bar:
- Preserve exact field names from the collection.
- Do not invent fields that are not supported by the collection.
- Do not describe schema fields that are absent from both `metadata.schema` and real entries unless the collection clearly supports them.
- Keep the prompt compact and practical.
- Prefer the collection's own wording over generic wording.

When the target collection is attached, produce the `.prompt.md` file content directly.