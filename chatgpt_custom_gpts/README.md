# chatgpt_custom_gpts

This folder stores my local, git-tracked record of ChatGPT Custom GPT setups.

It is not application runtime code. It is a configuration workspace for keeping the important parts of a Custom GPT in files I can diff, review, and update outside the ChatGPT editor UI.

## Purpose

- Keep a durable local copy of each GPT's instructions, defaults, actions, and bundled knowledge.
- Make Custom GPT changes easier to review in git.
- Preserve supporting files that are awkward to manage only through the ChatGPT editor.
- Keep a reference back to the live GPT and its editor page.

## Folder Structure

Each GPT should live in its own subfolder, named in a stable and readable way.

Example:

- `gpt_japanese_session_tutor/`

Typical files inside a GPT folder:

- `gpt_config.json` — the main stored representation of the GPT: GPT id, links, name, description, instructions, conversation starters, knowledge file references, capabilities, and action definitions.
- `knowledge_files/` — files uploaded to the GPT as knowledge, or source files intended to mirror those uploads.
- `privacy_policy.md` — optional policy or disclosure text associated with that GPT.
- `README.md` — optional GPT-specific notes if a single GPT needs extra setup or maintenance instructions.
- `export_gpt_editor_dom.console.js` — a browser-console helper for capturing the current GPT editor state into a repo-friendly object.

## How To Treat These Files

- Treat this folder as the source-controlled record of the GPT, not as a guaranteed one-click export/import format.
- Some values may be copied from the ChatGPT editor manually, so the repo should be kept in sync when the live GPT changes.
- If a GPT depends on uploaded knowledge files or actions, keep those files here so the full setup is understandable later.
- If a GPT is shared publicly or uses external services, keep the relevant privacy or operational notes in the same GPT folder.

## Export Script

`export_gpt_editor_dom.console.js` is meant to be pasted into the browser console while the ChatGPT GPT editor page is open.

What it does:

- Monitors the current GPT editor page.
- Reads visible GPT fields from the DOM.
- Watches the editor's own action validation request so it can capture action OpenAPI specs without manually replaying private requests.
- Replaces any previous monitor instance when rerun, so updating the script does not require a page refresh.
- Waits when the main GPT form is temporarily hidden, such as while an action panel is open.
- Warns when the DOM shape differs from what the script expects.

What it outputs:

- `gpt_id`
- `links`
- `name`
- `description`
- `instructions`
- `conversation_starters`
- `knowledge_files`
- `recommended_model`
- `capabilities`
- `actions`
- `warnings`

What it intentionally does not persist:

- auth tokens, cookies, or headers
- direct icon asset URLs
- timestamp-only metadata that creates noisy diffs

Useful globals after running the script:

- `window.__gptEditorExport` — the latest captured export object
- `window.__gptEditorExportWarnings` — current warning list
- `window.__gptEditorExportMonitor.cleanup()` — stops the monitor manually

Normal usage:

1. Open the GPT editor page.
2. Paste and run `export_gpt_editor_dom.console.js` in DevTools.
3. Click each visible action so the editor validates and exposes its OpenAPI spec.
4. Read `window.__gptEditorExport`.
5. Copy the relevant values back into the repo-managed `gpt_config.json`.

Limitations:

- This script depends on the current ChatGPT editor DOM and may need updates if the UI changes.
- It is a capture/sync helper, not an official import/export API.
- It only captures what the editor page exposes or sends during normal interaction.

## Maintenance Guidance

- Prefer one clear source of truth for defaults and behavior whenever possible.
- Keep links to the live GPT and editor in `gpt_config.json` so the stored config can be traced back to the actual deployed GPT.
- If a GPT changes meaningfully, update the stored files in the same change so git history stays useful.
