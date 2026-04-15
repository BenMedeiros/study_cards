(() => {
  const hadExistingMonitor = Boolean(window.__gptEditorExportMonitor?.cleanup);
  if (hadExistingMonitor) {
    console.log("Existing GPT editor monitor found. Cleaning it up before starting a new one.");
    window.__gptEditorExportMonitor.cleanup();
  }

  const text = (value) => (value ?? "").trim();
  const originalFetch =
    window.__gptEditorExportMonitor?.originalFetch ?? window.fetch.bind(window);
  const originalConsoleLog = console.log.bind(console);
  const originalConsoleWarn = console.warn.bind(console);
  const warnings = [];
  let isActionPanelActive = false;
  let hasLoggedWaitingForActionPanel = false;
  let missingCoreFormSince = null;
  let hasWarnedLongMissingCoreForm = false;

  const warn = (message) => {
    warnings.push(message);
    originalConsoleWarn(`[gpt-export warning] ${message}`);
    window.__gptEditorExportWarnings = [...warnings];
  };

  const queryOne = (selector, label) => {
    const nodes = document.querySelectorAll(selector);
    if (nodes.length !== 1) {
      if (!isCoreEditorFormVisible()) {
        return nodes[0] ?? null;
      }
      warn(`Expected 1 ${label} for selector "${selector}", found ${nodes.length}.`);
    }
    return nodes[0] ?? null;
  };

  const coreSelectorCounts = () => ({
    name: document.querySelectorAll('[data-testid="gizmo-name-input"]').length,
    description: document.querySelectorAll('[data-testid="gizmo-description-input"]').length,
    instructions: document.querySelectorAll('[data-testid="gizmo-instructions-input"]').length,
  });

  const isCoreEditorFormVisible = () => {
    const counts = coreSelectorCounts();
    return counts.name === 1 && counts.description === 1 && counts.instructions === 1;
  };

  const shouldPauseForActionPanel = () => !isCoreEditorFormVisible();

  const byTestIdValue = (testId) =>
    text(queryOne(`[data-testid="${testId}"]`, testId)?.value);

  const parseInstructions = (raw) => {
    const trimmed = text(raw);
    if (!trimmed) return [];

    try {
      return JSON.parse(`[${trimmed}]`);
    } catch {
      return trimmed
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
    }
  };

  const parseJsonIfPossible = (raw) => {
    if (typeof raw !== "string") return raw;
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  };

  const getConversationStarters = () =>
    Array.from(
      document.querySelectorAll('div.mb-6 input[type="text"][maxlength="300"]')
    )
      .map((input) => text(input.value))
      .filter(Boolean);

  const getKnowledgeFiles = () =>
    Array.from(document.querySelectorAll('[role="group"][aria-label]'))
      .map((node) => {
        const name = text(node.getAttribute("aria-label"));
        return name
          ? {
              name,
              repo_path: `chatgpt_custom_gpts/gpt_japanese_session_tutor/knowledge_files/${name}`,
            }
          : null;
      })
      .filter(Boolean);

  const getRecommendedModel = () => {
    const selects = document.querySelectorAll("select");
    if (selects.length !== 1) {
      warn(`Expected 1 recommended model select, found ${selects.length}.`);
    }
    const select = selects[0] ?? null;
    return select ? text(select.value) : "";
  };

  const getCapabilities = () => ({
    web_search: Boolean(document.querySelector('[data-testid="browser"]')?.checked),
    canvas: Boolean(document.querySelector('[data-testid="canvas"]')?.checked),
    image_generation: Boolean(
      document.querySelector('[data-testid="image_gen"]')?.checked
    ),
    code_interpreter: Boolean(
      document.querySelector('[data-testid="python"]')?.checked
    ),
  });

  const getActionLabels = () =>
    Array.from(
      document.querySelectorAll(
        ".space-y-1 .border.rounded-lg, .space-y-1 .border-token-border-medium.flex.rounded-lg.border.text-sm"
      )
    )
      .map((node, index) => {
        const labelNode = node.querySelector("div.h-9.grow");
        if (!labelNode) {
          warn(`Action row ${index + 1} is missing the expected label node "div.h-9.grow".`);
        }
        return text(labelNode?.textContent);
      })
      .filter(Boolean);

  const getGptId = () => {
    const match = window.location.href.match(/gpts\/editor\/(g-[a-zA-Z0-9]+)/);
    return match?.[1] ?? "";
  };

  const makeActionKey = (rawSpec) => {
    if (!rawSpec) return "";
    let hash = 0;
    for (let i = 0; i < rawSpec.length; i += 1) {
      hash = (hash * 31 + rawSpec.charCodeAt(i)) | 0;
    }
    return String(hash);
  };

  const capturedActionEntries = [];
  const capturedActionKeys = new Set();
  let pendingActionLabel = null;
  let lastSerializedPayload = "";
  let emitTimer = null;
  let isCleanedUp = false;

  const hasCapturedAllVisibleActions = () => {
    const labels = getActionLabels();
    if (!labels.length) return true;

    return labels.every((label, index) => {
      const byLabel = capturedActionEntries.find((entry) => entry.label === label)?.openapi;
      const byIndex = capturedActionEntries[index]?.openapi;
      return Boolean(byLabel ?? byIndex);
    });
  };

  const buildPayload = () => {
    const gptId = getGptId();
    const actionLabels = getActionLabels();
    if (!gptId) {
      warn("Could not derive GPT id from the current editor URL.");
    }

    return {
      gpt_id: gptId,
      links: {
        editor: window.location.href,
        chatgpt: gptId ? `https://chatgpt.com/g/${gptId}` : "",
      },
      name: byTestIdValue("gizmo-name-input"),
      description: byTestIdValue("gizmo-description-input"),
      instructions: parseInstructions(
        document.querySelector('[data-testid="gizmo-instructions-input"]')?.value
      ),
      conversation_starters: getConversationStarters(),
      knowledge_files: getKnowledgeFiles(),
      recommended_model: getRecommendedModel(),
      capabilities: getCapabilities(),
      actions: actionLabels.map((label, index) => ({
        label,
        openapi:
          capturedActionEntries.find((entry) => entry.label === label)?.openapi ??
          capturedActionEntries[index]?.openapi ??
          null,
      })),
      warnings: [...warnings],
    };
  };

  const emitPayloadIfChanged = (reason) => {
    if (isCleanedUp) return;
    if (shouldPauseForActionPanel()) {
      const now = Date.now();
      if (missingCoreFormSince == null) {
        missingCoreFormSince = now;
      }
      if (!hasLoggedWaitingForActionPanel) {
        originalConsoleLog("Main GPT form is temporarily hidden. Waiting before validating/exporting again.");
        hasLoggedWaitingForActionPanel = true;
      }
      if (!hasWarnedLongMissingCoreForm && now - missingCoreFormSince > 1500) {
        warn("Main GPT form has been missing for over 1.5s. The editor may be in a modal/panel state or the DOM may have changed.");
        hasWarnedLongMissingCoreForm = true;
      }
      return;
    }

    missingCoreFormSince = null;
    hasWarnedLongMissingCoreForm = false;
    hasLoggedWaitingForActionPanel = false;
    if (!hasCapturedAllVisibleActions()) return;

    const payload = buildPayload();
    const serialized = JSON.stringify(payload);

    if (serialized === lastSerializedPayload) return;

    lastSerializedPayload = serialized;
    window.__gptEditorExport = payload;
    originalConsoleLog(`GPT editor export updated: ${reason}`);
    originalConsoleLog(payload);
  };

  const scheduleEmit = (reason) => {
    if (isCleanedUp) return;
    window.clearTimeout(emitTimer);
    emitTimer = window.setTimeout(() => emitPayloadIfChanged(reason), shouldPauseForActionPanel() ? 500 : 150);
  };

  const actionLabels = getActionLabels();
  if (hadExistingMonitor) {
    originalConsoleLog("Previous GPT editor monitor removed.");
  } else {
    originalConsoleLog("No existing GPT editor monitor found. Starting a new one.");
  }
  originalConsoleLog("Monitoring GPT editor for changes.");
  if (actionLabels.length) {
    originalConsoleLog(`Click these actions to capture their specs: ${actionLabels.join(", ")}`);
  } else {
    originalConsoleLog("No visible actions found in the editor.");
  }

  if (!queryOne('[data-testid="gizmo-name-input"]', "gizmo-name-input")) {
    warn('Name input was not found.');
  }
  if (!queryOne('[data-testid="gizmo-description-input"]', "gizmo-description-input")) {
    warn('Description input was not found.');
  }
  if (!queryOne('[data-testid="gizmo-instructions-input"]', "gizmo-instructions-input")) {
    warn('Instructions input was not found.');
  }
  if (!document.querySelector('[data-testid="browser"]')) {
    warn('Web Search capability checkbox was not found.');
  }
  if (!document.querySelector('[data-testid="canvas"]')) {
    warn('Canvas capability checkbox was not found.');
  }
  if (!document.querySelector('[data-testid="image_gen"]')) {
    warn('Image Generation capability checkbox was not found.');
  }
  if (!document.querySelector('[data-testid="python"]')) {
    warn('Code Interpreter capability checkbox was not found.');
  }

  const observer = new MutationObserver(() => scheduleEmit("dom change"));
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
  });

  const onInput = () => scheduleEmit("input change");
  const onChange = () => scheduleEmit("form change");
  document.addEventListener("input", onInput, true);
  document.addEventListener("change", onChange, true);

  const onClick = (event) => {
    const button = event.target instanceof Element
      ? event.target.closest("button")
      : null;
    if (!button) return;

    const actionRow = button.closest(
      ".space-y-1 .border.rounded-lg, .space-y-1 .border-token-border-medium.flex.rounded-lg.border.text-sm"
    );
    if (!actionRow) return;

    pendingActionLabel = text(actionRow.querySelector("div.h-9.grow")?.textContent);
    isActionPanelActive = true;
    hasLoggedWaitingForActionPanel = false;
  };

  document.addEventListener("click", onClick, true);

  window.fetch = async (...args) => {
    if (isCleanedUp) {
      return originalFetch(...args);
    }

    try {
      const [resource, init] = args;
      const url =
        typeof resource === "string"
          ? resource
          : resource instanceof Request
            ? resource.url
            : String(resource ?? "");

      if (url.includes("/backend-api/gizmos/validate_openapi")) {
        const body =
          init?.body ??
          (resource instanceof Request ? await resource.clone().text() : null);

        if (typeof body === "string") {
          const parsed = JSON.parse(body);
          if (typeof parsed?.raw_spec === "string") {
            const rawSpec = parsed.raw_spec;
            const actionKey = makeActionKey(rawSpec);

            if (!capturedActionKeys.has(actionKey)) {
              capturedActionKeys.add(actionKey);
              capturedActionEntries.push({
                label: pendingActionLabel || `action_${capturedActionEntries.length + 1}`,
                openapi: parseJsonIfPossible(rawSpec),
              });
            } else if (pendingActionLabel) {
              const existing = capturedActionEntries.find(
                (entry) => JSON.stringify(entry.openapi) === JSON.stringify(parseJsonIfPossible(rawSpec))
              );
              if (existing && !existing.label) {
                existing.label = pendingActionLabel;
              }
            }

            scheduleEmit(
              pendingActionLabel
                ? `captured action spec for ${pendingActionLabel}`
                : "captured action spec"
            );
            if (!hasCapturedAllVisibleActions()) {
              originalConsoleLog(
                `Waiting for remaining actions. Captured ${capturedActionEntries.length}/${getActionLabels().length}.`
              );
            } else {
              originalConsoleLog("All visible actions captured. Emitting export object.");
            }
            pendingActionLabel = null;
            isActionPanelActive = false;
          }
        }
      }
    } catch {
      // Ignore observer errors and preserve page behavior.
    }

    return originalFetch(...args);
  };

  const cleanup = () => {
    if (isCleanedUp) return;
    isCleanedUp = true;
    window.clearTimeout(emitTimer);
    observer.disconnect();
    document.removeEventListener("input", onInput, true);
    document.removeEventListener("change", onChange, true);
    document.removeEventListener("click", onClick, true);
    window.fetch = originalFetch;
  };

  window.__gptEditorExportMonitor = {
    cleanup,
    originalFetch,
  };
  window.__gptEditorExportWarnings = [...warnings];

  emitPayloadIfChanged("initial snapshot");
  return "Monitoring GPT editor. Updates will be logged to window.__gptEditorExport.";
})();
