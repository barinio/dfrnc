function currentSearch(): string {
  return typeof window === "undefined" ? "" : window.location.search;
}

export function debugVideoNoCropFromSearch(search = currentSearch()): boolean {
  const params = new URLSearchParams(search);
  return params.has("debugVideoNoCrop") || params.get("videoCrop") === "off";
}
