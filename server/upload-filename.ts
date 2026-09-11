/** Restore browser UTF-8 multipart names exposed by Busboy as latin-1. */
export function normalizeUploadFilename(value: string) {
  if ([...value].some((character) => (character.codePointAt(0) ?? 0) > 0xff)) return value;
  const bytes = Uint8Array.from(value, (character) => character.charCodeAt(0));
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return value;
  }
}
