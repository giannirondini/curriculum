// Skill tokenization + fuzzy matching, shared by the classic site (main.js)
// and the terminal version (cli/). Pure functions, no DOM access.
//
// tokenizeSkill("Azure (Databricks, Functions)")
//   -> ["Azure (Databricks, Functions)", "Azure", "Azure Databricks",
//       "Databricks", "Azure Functions", "Functions"]
export function tokenizeSkill(text) {
  const out = [text];
  const m = text.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
  if (m) {
    const base = m[1].trim();
    out.push(base);
    m[2].split(',').forEach((item) => {
      const itm = item.trim();
      if (itm) {
        out.push(`${base} ${itm}`);
        out.push(itm);
      }
    });
  }
  return out;
}

// Word-boundary startsWith matching against a set of lowercase tokens, so
// "Java" does not match "JavaScript" but "Azure Databricks" matches the
// parenthesized "Azure (Databricks, ...)" form.
export function chipMatchesTokens(chipText, tokens) {
  const c = chipText.toLowerCase().trim();
  if (tokens.has(c)) return true;
  for (const tok of tokens) {
    if (tok === c) return true;
    if (tok.length > c.length && tok.startsWith(c) && /[\s/(\-]/.test(tok[c.length])) return true;
    if (c.length > tok.length && c.startsWith(tok) && /[\s/(\-]/.test(c[tok.length])) return true;
  }
  return false;
}
