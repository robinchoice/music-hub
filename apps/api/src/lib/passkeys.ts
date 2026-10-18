export function relyingParty() {
  const url = new URL(process.env.APP_URL || 'http://localhost:5173');
  return { rpID: url.hostname, origins: [url.origin] };
}
