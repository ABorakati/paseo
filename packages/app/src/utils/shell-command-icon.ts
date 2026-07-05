export type ShellCommandKind = "git" | "gh" | "other";

const ENV_ASSIGNMENT_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*=\S*$/;

// Deliberately simple, first-token classification: pipes, subshells, multi-hop
// `&&` chains, and quoted paths containing `&&` all fall through to "other" —
// that just means the generic terminal icon, which is fine.
export function classifyShellCommand(command: string): ShellCommandKind {
  const tokens = command.trim().split(/\s+/).filter(Boolean);

  let index = 0;
  while (index < tokens.length && ENV_ASSIGNMENT_PATTERN.test(tokens[index])) {
    index += 1;
  }

  if (tokens[index] === "cd" && tokens[index + 2] === "&&") {
    index += 3;
  }

  switch (tokens[index]) {
    case "git":
      return "git";
    case "gh":
      return "gh";
    default:
      return "other";
  }
}
