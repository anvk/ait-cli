import pc from "picocolors";
import { EscapePressed, readLine } from "../ui/tui.js";

export const NONE = "none";

// Thrown by any prompt when the user presses Esc; the init loop catches it, drops that
// many answers and replays the rest.
export class Rewind extends Error {
  constructor(public readonly steps: number) {
    super(`back ${steps}`);
  }
}

// Sequential prompts with an answer log. Given `replay`, the first answers come from
// the log instead of the terminal and are printed dimmed, which rebuilds the transcript
// after a rewind; once the log is exhausted the wizard reads live. Every prompt goes
// through `ask`, so Esc works everywhere and the log stays complete.
export class Wizard {
  private readonly log: string[] = [];
  private replay: string[];

  constructor(replay: string[] = []) {
    this.replay = [...replay];
  }

  answers(): string[] {
    return [...this.log];
  }

  // Drops the most recent answer, for a prompt whose answer means "go back" itself
  // (the review's "n") rather than being something to replay.
  forget(): void {
    this.log.pop();
  }

  // Raw answer after trimming, with the default applied to a blank line. The label
  // is printed exactly like a live prompt when replaying so both read the same.
  async ask(label: string, defaultValue?: string): Promise<string> {
    const prompt = defaultValue === undefined ? `${label}: ` : `${label} (${defaultValue}): `;
    if (this.replay.length > 0) {
      const recorded = this.replay.shift() as string;
      console.log(`${prompt}${pc.dim(recorded || defaultValue || "")}`);
      this.log.push(recorded);
      return recorded || defaultValue || "";
    }

    const raw = (await readLineOrRewind(prompt)).trim();
    this.log.push(raw);
    return raw || defaultValue || "";
  }

  // Re-asks until `validate` accepts. A replayed answer that no longer validates
  // (an earlier change made it invalid) is dropped along with the rest of the replay
  // and asked live, so nothing stale is applied to a later question.
  async validated(
    label: string,
    defaultValue: string | undefined,
    validate: (value: string) => string | null
  ): Promise<string> {
    while (true) {
      const replaying = this.replay.length > 0;
      const answer = await this.ask(label, defaultValue);
      const error = answer ? validate(answer) : "A value is required.";
      if (!error) {
        return answer;
      }
      console.log(pc.yellow(error));
      this.log.pop();
      if (replaying) {
        this.replay = [];
      }
    }
  }

  required(label: string, validate: (value: string) => string | null): Promise<string> {
    return this.validated(label, undefined, validate);
  }

  // Empty is a real answer here: the default reads `none`, and typing `none` clears
  // a value that was previously set.
  async optional(label: string, current: string): Promise<string> {
    const answer = await this.ask(`${label} ('${NONE}' to clear)`, current || NONE);
    return answer === NONE ? "" : answer;
  }

  async yesNo(label: string, defaultYes: boolean): Promise<boolean> {
    const answer = await this.validated(`${pc.bold(label)} [y/n]`, defaultYes ? "y" : "n", (value) =>
      /^(y|yes|n|no)$/i.test(value) ? null : "Answer y or n."
    );
    return /^y/i.test(answer);
  }

  // Closes a block of prompts, so it gets a blank line to stand apart from the fields.
  addAnother(label: string, defaultYes: boolean): Promise<boolean> {
    console.log("");
    return this.yesNo(label, defaultYes);
  }

  async positiveInt(label: string, current: number): Promise<number> {
    const answer = await this.validated(label, String(current), (value) => {
      const parsed = Number.parseInt(value, 10);
      return Number.isInteger(parsed) && parsed > 0 && String(parsed) === value
        ? null
        : "Enter a positive whole number.";
    });
    return Number.parseInt(answer, 10);
  }

  async choice(label: string, choices: readonly string[], current: string): Promise<string> {
    const answer = await this.validated(`${label} [${choices.join("/")}]`, current, (value) =>
      choices.includes(value.toLowerCase()) ? null : `Choose one of: ${choices.join(", ")}.`
    );
    return answer.toLowerCase();
  }
}

// Esc in a prompt goes back that many questions.
async function readLineOrRewind(prompt: string): Promise<string> {
  try {
    return await readLine(prompt);
  } catch (error) {
    throw error instanceof EscapePressed ? new Rewind(error.steps) : error;
  }
}
