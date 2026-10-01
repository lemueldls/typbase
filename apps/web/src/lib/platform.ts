/**
 * macOS gets the command-key hint and the command-key navigation shortcut;
 * everywhere else the control key does.
 */
export function isMac(): boolean {
  if (typeof navigator === "undefined") return false;

  return /mac|iphone|ipad|ipod/i.test(navigator.userAgent);
}
