import remarkGfm from "remark-gfm";

// remark-gfm's autolink parser creates a lookbehind RegExp at render time.
// Safari 15 parses the bundle but throws when that plugin is first executed.
const supportsRegExpLookbehind = (() => {
  try {
    return new RegExp("(?<=a)b").test("ab");
  } catch {
    return false;
  }
})();

export const compatibleRemarkPlugins = supportsRegExpLookbehind
  ? [remarkGfm]
  : [];

