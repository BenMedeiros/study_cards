export async function detectBackend() {
  // Relative URL so GitHub Pages subpaths work.
  // When running locally via Express, this should succeed.
  const url = './api/health';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 600);

  try {
    const res = await fetch(url, { signal: controller.signal, cache: 'no-store' });
    if (!res.ok) return { connected: false, label: 'Backend: not connected' };
    const json = await res.json().catch(() => null);
    const mode = json?.mode ?? 'local';
    return { connected: true, label: `Backend: connected (${mode})` };
  } catch {
    return { connected: false, label: 'Backend: not connected' };
  } finally {
    clearTimeout(timeout);
  }
}
