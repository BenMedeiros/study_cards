const params = new URLSearchParams(window.location.search);
const target = new URL('./', window.location.href);
const query = params.toString();
target.hash = query ? `/oauth-link?${query}` : '/oauth-link';
window.location.replace(target.toString());
