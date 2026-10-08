import { gunzipSync } from 'node:zlib';
import { strFromU8, unzipSync } from 'fflate';

/** Extracts the zip entries whose path matches `name` (directories excluded) and decodes them as UTF-8 text. */
export function unzipTexts(bytes: Uint8Array, name: RegExp): Record<string, string> {
  const files = unzipSync(bytes, {
    filter: (f) => {
      name.lastIndex = 0; // a /g or /y regex would otherwise skip every other entry
      return !f.name.endsWith('/') && name.test(f.name);
    },
  });
  return Object.fromEntries(Object.entries(files).map(([path, data]) => [path, strFromU8(data)]));
}

export function gunzipText(bytes: Uint8Array): string {
  return gunzipSync(bytes).toString('utf8');
}
