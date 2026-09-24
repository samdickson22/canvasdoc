/** Fills the manifest's page lists from extension/origins.json. Web-accessible matches cannot carry ports. */
export function withOrigins(manifest, pages) {
  const unique = (values) => [...new Set(values)];
  const patterns = pages.map((origin) => `${origin}/*`);
  const hosts = unique(pages.map((origin) => { const url = new URL(origin); return `${url.protocol}//${url.hostname}/*`; }));
  return {
    ...manifest,
    content_scripts: manifest.content_scripts.map((script) => ({ ...script, matches: patterns })),
    web_accessible_resources: manifest.web_accessible_resources.map((resource) => ({ ...resource, matches: hosts })),
    host_permissions: unique([...patterns, ...manifest.host_permissions]),
  };
}
