const SENDER_SDK_URL = 'https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1';
export const STUDY_CARDS_CAST_NAMESPACE = 'urn:x-cast:study_cards.main_field';

let senderSdkPromise = null;

function loadSenderSdk() {
  if (senderSdkPromise) return senderSdkPromise;
  senderSdkPromise = new Promise((resolve, reject) => {
    if (window.cast?.framework && window.chrome?.cast) {
      resolve(window.cast.framework);
      return;
    }
    const previous = window.__onGCastApiAvailable;
    window.__onGCastApiAvailable = (isAvailable, ...rest) => {
      try {
        if (typeof previous === 'function') previous(isAvailable, ...rest);
      } catch (e) {}
      if (isAvailable && window.cast?.framework && window.chrome?.cast) resolve(window.cast.framework);
      else reject(new Error('Google Cast sender SDK is not available'));
    };
    const script = document.createElement('script');
    script.src = SENDER_SDK_URL;
    script.async = true;
    script.onerror = () => reject(new Error('Failed to load Google Cast sender SDK'));
    document.head.appendChild(script);
  });
  return senderSdkPromise;
}

function normalizePayload(payload = {}) {
  return {
    type: 'main-field-card',
    sentAt: Date.now(),
    entry: payload?.entry || null,
    indexText: String(payload?.indexText || ''),
    title: String(payload?.title || 'Study Cards Cast'),
    mode: String(payload?.mode || ''),
    visibilityMap: payload?.visibilityMap && typeof payload.visibilityMap === 'object' ? { ...payload.visibilityMap } : {},
    cardConfig: payload?.cardConfig && typeof payload.cardConfig === 'object'
      ? {
          ...payload.cardConfig,
          layout: payload.cardConfig.layout && typeof payload.cardConfig.layout === 'object'
            ? { ...payload.cardConfig.layout }
            : {},
        }
      : {},
  };
}

export function createGoogleCastSender({
  getReceiverAppId = () => '',
  setReceiverAppId = () => {},
  onStateChange = null,
} = {}) {
  let currentAppId = '';
  let listenersRegistered = false;

  function notifyState() {
    try { if (typeof onStateChange === 'function') onStateChange(); } catch (e) {}
  }

  function isActive() {
    try {
      return !!window.cast?.framework?.CastContext?.getInstance?.().getCurrentSession?.();
    } catch (e) {
      return false;
    }
  }

  async function ensureContext(receiverAppId) {
    await loadSenderSdk();
    const castContext = window.cast.framework.CastContext.getInstance();
    if (!listenersRegistered) {
      listenersRegistered = true;
      try {
        castContext.addEventListener(
          window.cast.framework.CastContextEventType.SESSION_STATE_CHANGED,
          () => notifyState(),
        );
      } catch (e) {}
      try {
        castContext.addEventListener(
          window.cast.framework.CastContextEventType.CAST_STATE_CHANGED,
          () => notifyState(),
        );
      } catch (e) {}
    }
    if (receiverAppId && receiverAppId !== currentAppId) {
      castContext.setOptions({
        receiverApplicationId: receiverAppId,
        autoJoinPolicy: window.chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED,
      });
      currentAppId = receiverAppId;
    }
    return castContext;
  }

  async function resolveReceiverAppId({ forcePrompt = false } = {}) {
    let receiverAppId = String(getReceiverAppId() || '').trim();
    if (!receiverAppId || forcePrompt) {
      const next = window.prompt('Enter your Google Cast receiver application ID', receiverAppId || '');
      receiverAppId = String(next || '').trim();
      if (!receiverAppId) return '';
      try { setReceiverAppId(receiverAppId); } catch (e) {}
    }
    return receiverAppId;
  }

  async function send(payload = {}, { forcePrompt = false } = {}) {
    const receiverAppId = await resolveReceiverAppId({ forcePrompt });
    if (!receiverAppId) return false;
    const castContext = await ensureContext(receiverAppId);
    let session = castContext.getCurrentSession();
    if (!session) {
      await castContext.requestSession();
      session = castContext.getCurrentSession();
    }
    if (!session) return false;
    await session.sendMessage(STUDY_CARDS_CAST_NAMESPACE, JSON.stringify(normalizePayload(payload)));
    notifyState();
    return true;
  }

  async function configure() {
    const receiverAppId = await resolveReceiverAppId({ forcePrompt: true });
    if (!receiverAppId) return false;
    await ensureContext(receiverAppId);
    notifyState();
    return true;
  }

  function endSession() {
    try {
      const session = window.cast?.framework?.CastContext?.getInstance?.().getCurrentSession?.();
      if (session) session.endSession(true);
    } catch (e) {}
    notifyState();
  }

  return {
    send,
    configure,
    endSession,
    isActive,
    isSupported: () => true,
  };
}
