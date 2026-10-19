// Just enough shell syntax to split and quote the command lines in a config: single
// quotes, double quotes with `\"` and `\\`, and backslash escapes outside quotes.

export function shellSplit(line: string): string[] {
  const words: string[] = [];
  let current = "";
  let inWord = false;
  let quote: "'" | '"' | null = null;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (quote === "'") {
      if (char === "'") {
        quote = null;
      } else {
        current += char;
      }
    } else if (quote === '"') {
      if (char === '"') {
        quote = null;
      } else if (char === "\\" && i + 1 < line.length && '"\\$`'.includes(line[i + 1])) {
        current += line[++i];
      } else {
        current += char;
      }
    } else if (char === "'" || char === '"') {
      quote = char;
      inWord = true;
    } else if (char === "\\" && i + 1 < line.length) {
      current += line[++i];
      inWord = true;
    } else if (/\s/.test(char)) {
      if (inWord) {
        words.push(current);
        current = "";
        inWord = false;
      }
    } else {
      current += char;
      inWord = true;
    }
  }
  if (quote) {
    throw new Error(`unterminated ${quote === "'" ? "single" : "double"} quote`);
  }
  if (inWord) {
    words.push(current);
  }
  return words;
}

// A word safe to paste into a shell command line; plain words stay as they are.
export function shellQuote(word: string): string {
  if (/^[A-Za-z0-9_./:=@%+,-]+$/.test(word)) {
    return word;
  }
  return `'${word.replace(/'/g, `'\\''`)}'`;
}

export function shellJoin(words: string[]): string {
  return words.map(shellQuote).join(" ");
}
