/** Svelte action: attach listeners for custom events fired by the Lit components. */
export function listen(node: HTMLElement, handlers: Record<string, (e: CustomEvent) => void>) {
  let current = handlers;
  const proxies = new Map<string, EventListener>();
  const bind = (h: typeof handlers) => {
    for (const name of Object.keys(h)) {
      if (!proxies.has(name)) {
        const p: EventListener = (e) => current[name]?.(e as CustomEvent);
        proxies.set(name, p); node.addEventListener(name, p);
      }
    }
  };
  bind(handlers);
  return {
    update(h: typeof handlers) { current = h; bind(h); },
    destroy() { proxies.forEach((p, n) => node.removeEventListener(n, p)); proxies.clear(); }
  };
}
