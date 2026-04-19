import {
  getFirebaseAuthSnapshot,
  getFirebaseIdToken,
  signInWithGoogle,
  subscribeFirebaseAuth,
  waitForFirebaseAuthReady,
} from '../../integrations/firebase/auth.js';
import { buildTrustedOauthCompleteUrl } from '../../integrations/oauth/config.js';

function normalizeValue(value) {
  return String(value || '').trim();
}

function readOauthRequest(query) {
  const requestedCompleteUrl = normalizeValue(query?.get?.('complete_url'));
  const trustedCompleteUrl = buildTrustedOauthCompleteUrl();
  const request = {
    client_id: normalizeValue(query?.get?.('client_id')),
    redirect_uri: normalizeValue(query?.get?.('redirect_uri')),
    response_type: normalizeValue(query?.get?.('response_type') || 'code'),
    scope: normalizeValue(query?.get?.('scope')),
    state: normalizeValue(query?.get?.('state')),
    complete_url: trustedCompleteUrl,
  };

  if (!request.client_id) throw new Error('Missing client_id');
  if (!request.redirect_uri) throw new Error('Missing redirect_uri');
  if (requestedCompleteUrl && requestedCompleteUrl !== trustedCompleteUrl) {
    throw new Error('Unexpected OAuth completion endpoint');
  }
  return request;
}

function clearChildren(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

export function renderOauthLinkView({ route } = {}) {
  const el = document.createElement('section');
  el.className = 'oauth-link-view';

  const panel = document.createElement('div');
  panel.className = 'oauth-link-panel';

  const eyebrow = document.createElement('p');
  eyebrow.className = 'oauth-link-eyebrow';
  eyebrow.textContent = 'Study Cards';

  const title = document.createElement('h1');
  title.className = 'oauth-link-title';
  title.textContent = 'Review ChatGPT Access';

  const lead = document.createElement('p');
  lead.className = 'oauth-link-lede';
  lead.textContent = 'ChatGPT is asking to link to your Study Cards account. Sign in if needed, then approve the request only if these details look correct.';

  const details = document.createElement('dl');
  details.className = 'oauth-link-details';

  const status = document.createElement('p');
  status.className = 'oauth-link-status';

  const error = document.createElement('p');
  error.className = 'oauth-link-error';

  const actions = document.createElement('div');
  actions.className = 'oauth-link-actions';
  actions.dataset.pending = 'false';

  const signInButton = document.createElement('button');
  signInButton.type = 'button';
  signInButton.className = 'btn primary';
  signInButton.textContent = 'Sign in with Google';
  signInButton.hidden = true;

  const approveButton = document.createElement('button');
  approveButton.type = 'button';
  approveButton.className = 'btn primary';
  approveButton.textContent = 'Approve ChatGPT Access';
  approveButton.hidden = true;

  const retryButton = document.createElement('button');
  retryButton.type = 'button';
  retryButton.className = 'btn';
  retryButton.textContent = 'Retry';
  retryButton.hidden = true;

  actions.append(signInButton, approveButton, retryButton);
  panel.append(eyebrow, title, lead, details, status, error, actions);
  el.append(panel);

  let oauthRequest = null;
  let activeRun = null;

  function setStatus(message) {
    status.textContent = normalizeValue(message);
  }

  function setError(message) {
    error.textContent = normalizeValue(message);
  }

  function setActions({
    showSignIn = false,
    showApprove = false,
    showRetry = false,
    pending = false,
  } = {}) {
    actions.dataset.pending = pending ? 'true' : 'false';
    signInButton.hidden = !showSignIn;
    approveButton.hidden = !showApprove;
    retryButton.hidden = !showRetry;
    signInButton.disabled = !!pending;
    approveButton.disabled = !!pending;
    retryButton.disabled = !!pending;
  }

  function renderDetails(request) {
    clearChildren(details);
    const rows = [
      ['Client', request.client_id],
      ['Scope', normalizeValue(request.scope) || '(default scope)'],
      ['Redirect', request.redirect_uri],
      ['State', request.state || '(empty)'],
    ];

    for (const [label, value] of rows) {
      const dt = document.createElement('dt');
      dt.textContent = label;
      const dd = document.createElement('dd');
      dd.textContent = value;
      details.append(dt, dd);
    }
  }

  function refreshReadyState() {
    const auth = getFirebaseAuthSnapshot();
    if (!oauthRequest) return;

    if (!auth?.isReady) {
      setStatus('Checking Firebase sign-in...');
      setError('');
      setActions({ pending: true });
      return;
    }

    if (!auth?.isSignedIn) {
      setStatus('ChatGPT wants to link to Study Cards. Sign in, then come back and approve the request.');
      setError('');
      setActions({ showSignIn: true });
      return;
    }

    const label = normalizeValue(auth.email || auth.displayName || auth.uid);
    setStatus(`Signed in as ${label}. If this request looks right, approve ChatGPT access.`);
    setError('');
    setActions({ showApprove: true });
  }

  async function completeOauth() {
    setActions({ pending: true });
    setError('');
    const auth = getFirebaseAuthSnapshot();
    if (!auth?.isSignedIn) {
      setStatus('Sign in to Study Cards to continue.');
      setActions({ showSignIn: true });
      return;
    }

    setStatus('Requesting Firebase ID token...');
    const firebaseIdToken = await getFirebaseIdToken(true);

    setStatus('Completing OAuth authorization...');
    const response = await fetch(oauthRequest.complete_url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${firebaseIdToken}`,
      },
      body: JSON.stringify({
        client_id: oauthRequest.client_id,
        redirect_uri: oauthRequest.redirect_uri,
        response_type: oauthRequest.response_type,
        scope: oauthRequest.scope,
        state: oauthRequest.state,
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

    setStatus('Redirecting back to ChatGPT...');
    window.location.assign(redirectTo);
  }

  async function runCompletion() {
    if (activeRun) return activeRun;
    activeRun = completeOauth()
      .catch((runError) => {
        setStatus('');
        setError(normalizeValue(runError?.message) || 'OAuth approval failed');
        setActions({
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

  async function handleSignIn() {
    setActions({ pending: true });
    setError('');
    setStatus('Opening Google sign-in...');
    await signInWithGoogle();
    refreshReadyState();
  }

  async function applyRoute(nextRoute) {
    try {
      oauthRequest = readOauthRequest(nextRoute?.query);
      renderDetails(oauthRequest);
      setError('');
      await waitForFirebaseAuthReady();
      refreshReadyState();
    } catch (routeError) {
      oauthRequest = null;
      clearChildren(details);
      setStatus('');
      setError(normalizeValue(routeError?.message) || 'Invalid OAuth request');
      setActions({ showRetry: false, showSignIn: false, showApprove: false });
    }
  }

  signInButton.addEventListener('click', () => {
    void handleSignIn().catch((signInError) => {
      setStatus('');
      setError(normalizeValue(signInError?.message) || 'Sign-in failed');
      setActions({ showSignIn: true, showRetry: true });
    });
  });

  approveButton.addEventListener('click', () => {
    void runCompletion();
  });

  retryButton.addEventListener('click', () => {
    refreshReadyState();
  });

  subscribeFirebaseAuth((snapshot) => {
    if (!oauthRequest) return;
    if (actions.dataset.pending === 'true' && snapshot?.isSignedIn) return;
    refreshReadyState();
  });

  el.__updateRoute = (nextRoute) => {
    void applyRoute(nextRoute);
  };
  el.__deactivate = () => {};
  el.__activate = () => {};

  void applyRoute(route);
  return el;
}
