let globalSessionExpiredHandler: (() => void) | null = null;

export function setGlobalSessionExpiredHandler(handler: () => void) {
  globalSessionExpiredHandler = handler;
}

export function getGlobalSessionExpiredHandler() {
  return globalSessionExpiredHandler;
}
