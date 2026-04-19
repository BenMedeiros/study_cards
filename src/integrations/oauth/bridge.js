import {
  getFirebaseAuthSnapshot,
  getFirebaseIdToken,
  signInWithGoogle,
  subscribeFirebaseAuth,
  waitForFirebaseAuthReady,
} from '../firebase/auth.js';

const TRUSTED_OAUTH_API_BASE = 'https://api-pdrd3q42fa-uc.a.run.app';

function normalizeValue(value) {
  return String(value || '').trim();
}

function buildTrustedCompleteUrl() {
  return new URL('/oauth/authorize/complete', TRUSTED_OAUTH_API_BASE).toString();
}

function requireElement(id) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing required element: ${id}`);
  return el;
}

function readBridgeRequest() {
  const params = new URLSearchParams(window.location.search);
  const requestedCompleteUrl = normalizeValue(params.get('complete_url'));
  const trustedCompleteUrl = buildTrustedCompleteUrl();
  const request = {
    client_id: normalizeValue(params.get('client_id')),
    redirect_uri: normalizeValue(params.get('redirect_uri')),
    response_type: normalizeValue(params.get('response_type') || 'code'),
    scope: normalizeValue(params.get('scope')),
    state: normalizeValue(params.get('state')),
    complete_url: trustedCompleteUrl,
  };

  if (!request.client_id) throw new Error('Missing client_id');
  if (!request.redirect_uri) throw new Error('Missing redirect_uri');
  if (requestedCompleteUrl && requestedCompleteUrl !== trustedCompleteUrl) {
    throw new Error('Unexpected OAuth completion endpoint');
  }
  return request;
}

function createUi() {
  return {
    status: requireElement('oauth-bridge-status'),
    error: requireElement('oauth-bridge-error'),
    action: requireElement('oauth-bridge-action'),
    signInButton: requireElement('oauth-bridge-sign-in'),
    approveButton: requireElement('oauth-bridge-approve'),
    retryButton: requireElement('oauth-bridge-retry'),
    details: requireElement('oauth-bridge-details'),
  };
}

function setStatus(ui, message) {
  ui.status.textContent = normalizeValue(message);
}

function setError(ui, message) {
  ui.error.textContent = normalizeValue(message);
}

function setActions(ui, {
  showSignIn = false,
  showApprove = false,
  showRetry = false,
  pending = false,
} = {}) {
  ui.action.dataset.pending = pending ? 'true' : 'false';
  ui.signInButton.hidden = !showSignIn;
  ui.approveButton.hidden = !showApprove;
  ui.retryButton.hidden = !showRetry;
  ui.signInButton.disabled = !!pending;
  ui.approveButton.disabled = !!pending;
  ui.retryButton.disabled = !!pending;
}

function describeRequest(ui, request) {
  const scope = normalizeValue(request.scope) || '(default scope)';
  ui.details.innerHTML = '';

  const rows = [
    ['Client', request.client_id],
    ['Scope', scope],
    ['Redirect', request.redirect_uri],
    ['State', request.state || '(empty)'],
  ];

  for (const [label, value] of rows) {
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = value;
    ui.details.append(dt, dd);
  }
}

async function completeOauth(request, ui) {
  setActions(ui, { pending: true });
  setError(ui, '');
  const auth = getFirebaseAuthSnapshot();
  if (!auth?.isSignedIn) {
    setStatus(ui, 'Sign in to Study Cards to continue.');
    setActions(ui, { showSignIn: true });
    return;
  }

  setStatus(ui, 'Requesting Firebase ID token...');
  const firebaseIdToken = await getFirebaseIdToken(true);

  setStatus(ui, 'Completing OAuth authorization...');
  const response = await fetch(request.complete_url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${firebaseIdToken}`,
    },
    body: JSON.stringify({
      client_id: request.client_id,
      redirect_uri: request.redirect_uri,
      response_type: request.response_type,
      scope: request.scope,
      state: request.state,
    }),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = normalizeValue(payload?.error || payload?.error_description) || 'OAuth authorization failed';
    throw new Error(message);
  }

  const redirectTo = normalizeValue(payload?.redirectTo);
  if (!redirectTo) {
    throw new Error('OAuth completion response did not include redirectTo');
  }

  setStatus(ui, 'Redirecting back to ChatGPT...');
  window.location.assign(redirectTo);
}

async function handleSignIn(ui) {
  setActions(ui, { pending: true });
  setError(ui, '');
  setStatus(ui, 'Opening Google sign-in...');
  await signInWithGoogle();
  setActions(ui, {});
}

async function bootstrap() {
  const request = readBridgeRequest();
  const ui = createUi();
  describeRequest(ui, request);

  function refreshReadyState() {
    const auth = getFirebaseAuthSnapshot();
    if (!auth?.isReady) {
      setStatus(ui, 'Checking Firebase sign-in...');
      setError(ui, '');
      setActions(ui, { pending: true });
      return;
    }

    if (!auth?.isSignedIn) {
      setStatus(ui, 'ChatGPT is requesting access. Sign in to Study Cards, then review and approve.');
      setError(ui, '');
      setActions(ui, { showSignIn: true });
      return;
    }

    const label = normalizeValue(auth.email || auth.displayName || auth.uid);
    setStatus(ui, `Signed in as ${label}. Review the request details, then approve ChatGPT access.`);
    setError(ui, '');
    setActions(ui, { showApprove: true });
  }

  let activeRun = null;

  async function runCompletion() {
    if (activeRun) return activeRun;

    activeRun = completeOauth(request, ui)
      .catch((error) => {
        setStatus(ui, '');
        setError(ui, normalizeValue(error?.message) || 'OAuth bridge failed');
        setActions(ui, {
          showSignIn: !getFirebaseAuthSnapshot()?.isSignedIn,
          showApprove: !!getFirebaseAuthSnapshot()?.isSignedIn,
          showRetry: true,
        });
      })
      .finally(() => {
        activeRun = null;
      });

    return activeRun;
  }

  ui.signInButton.addEventListener('click', async () => {
    try {
      await handleSignIn(ui);
      refreshReadyState();
    } catch (error) {
      setStatus(ui, '');
      setError(ui, normalizeValue(error?.message) || 'Sign-in failed');
      setActions(ui, { showSignIn: true, showRetry: true });
    }
  });

  ui.approveButton.addEventListener('click', () => {
    void runCompletion();
  });

  ui.retryButton.addEventListener('click', () => {
    refreshReadyState();
  });

  subscribeFirebaseAuth((snapshot) => {
    if (ui.action.dataset.pending === 'true' && snapshot?.isSignedIn) return;
    refreshReadyState();
  });

  await waitForFirebaseAuthReady();
  refreshReadyState();
}

bootstrap().catch((error) => {
  const ui = createUi();
  setStatus(ui, '');
  setError(ui, normalizeValue(error?.message) || 'OAuth bridge failed to start');
  setActions(ui, { showRetry: false, showSignIn: false });
});
