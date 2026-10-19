import { REMOTE_PREFIX } from "../core/git.js";
import { run } from "../core/process.js";

// A branch on origin that matched a search.
export interface RemoteBranch {
  name: string;
  // `null` when neither GitHub nor a local fetch says when it was last committed to.
  committedAtMs: number | null;
  subject: string | null;
}

export interface BranchSearchResult {
  // The best matches, at most SEARCH_LIMIT of them.
  branches: RemoteBranch[];
  // How many branches matched in all.
  total: number;
}

const SEARCH_LIMIT = 10;

// GitHub hands refs out 100 at a time. A query broad enough to need more than this many
// is one to narrow down, not to page through.
const GITHUB_PAGE_SIZE = 100;
const GITHUB_MAX_PAGES = 3;

// Ranks how well a branch name matches: the whole name, then a name part (split at
// `/`, `-`, `_` or `.`) starting with the query, then the query anywhere in it.
// `558` puts `someone/558-fix` ahead of `anvk/api-1558-foo`.
function matchTier(name: string, needle: string): number {
  const lower = name.toLowerCase();
  if (lower === needle) {
    return 0;
  }
  const index = lower.indexOf(needle);
  for (let at = index; at !== -1; at = lower.indexOf(needle, at + 1)) {
    if (at === 0 || "/-_.".includes(lower[at - 1])) {
      return 1;
    }
  }
  return 2;
}

// Best match first, the most recently committed first within a tier, by name after that.
export function rankBranches(branches: RemoteBranch[], needle: string): RemoteBranch[] {
  return branches
    .map((branch) => ({ branch, tier: matchTier(branch.name, needle) }))
    .sort(
      (a, b) =>
        a.tier - b.tier ||
        (b.branch.committedAtMs ?? 0) - (a.branch.committedAtMs ?? 0) ||
        a.branch.name.localeCompare(b.branch.name)
    )
    .map(({ branch }) => branch);
}

// `owner/name` of a github.com remote, in any of its URL spellings; `null` for anything else.
function githubRepo(repoRoot: string): { owner: string; name: string } | null {
  const url = run("git", ["remote", "get-url", "origin"], { cwd: repoRoot }).stdout;
  const match = /^(?:git@github\.com:|ssh:\/\/git@github\.com\/|https:\/\/(?:[^@/]+@)?github\.com\/)([^/]+)\/(.+?)(?:\.git)?\/?$/.exec(
    url
  );
  return match ? { owner: match[1], name: match[2] } : null;
}

const GITHUB_REFS_QUERY = `
query($owner: String!, $name: String!, $q: String!, $first: Int!, $after: String) {
  repository(owner: $owner, name: $name) {
    refs(refPrefix: "refs/heads/", query: $q, first: $first, after: $after) {
      totalCount
      pageInfo { hasNextPage endCursor }
      nodes { name target { ... on Commit { committedDate messageHeadline } } }
    }
  }
}`;

interface GithubRefsPage {
  totalCount: number;
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
  nodes: { name: string; target: { committedDate?: string; messageHeadline?: string } | null }[];
}

// GitHub matches the query as a case-insensitive substring of the name and returns each
// branch's latest commit with it, fetched or not. Its `orderBy` sorts branches by name
// whatever field is asked for, so the ranking is done here.
function searchGithub(repo: { owner: string; name: string }, needle: string): BranchSearchResult {
  const branches: RemoteBranch[] = [];
  let total = 0;
  let after: string | null = null;
  for (let page = 0; page < GITHUB_MAX_PAGES; page += 1) {
    const args = [
      "api",
      "graphql",
      "-f",
      `query=${GITHUB_REFS_QUERY}`,
      "-f",
      `owner=${repo.owner}`,
      "-f",
      `name=${repo.name}`,
      "-f",
      `q=${needle}`,
      "-F",
      `first=${GITHUB_PAGE_SIZE}`,
      ...(after ? ["-f", `after=${after}`] : [])
    ];
    const response = JSON.parse(run("gh", args).stdout) as { data?: { repository?: { refs?: GithubRefsPage } } };
    const refs = response.data?.repository?.refs;
    if (!refs) {
      throw new Error("GitHub returned no refs for this repository.");
    }
    total = refs.totalCount;
    for (const node of refs.nodes) {
      const committedAt = node.target?.committedDate ? Date.parse(node.target.committedDate) : Number.NaN;
      branches.push({
        name: node.name,
        committedAtMs: Number.isFinite(committedAt) ? committedAt : null,
        subject: node.target?.messageHeadline ?? null
      });
    }
    if (!refs.pageInfo.hasNextPage || !refs.pageInfo.endCursor) {
      break;
    }
    after = refs.pageInfo.endCursor;
  }
  return { branches: rankBranches(branches, needle).slice(0, SEARCH_LIMIT), total };
}

// Without GitHub: branch names from origin, with dates only for branches an earlier
// fetch brought down.
function searchLsRemote(repoRoot: string, needle: string): BranchSearchResult {
  const names = run("git", ["ls-remote", "--heads", "origin"], { cwd: repoRoot })
    .stdout.split("\n")
    .map((line) => line.split("\t")[1]?.replace(/^refs\/heads\//, "") ?? "")
    .filter((name) => name && name.toLowerCase().includes(needle));

  const known = new Map<string, { committedAtMs: number; subject: string }>();
  const localRefs = run(
    "git",
    ["for-each-ref", "--format=%(refname)%09%(committerdate:unix)%09%(subject)", REMOTE_PREFIX],
    { cwd: repoRoot }
  ).stdout;
  for (const line of localRefs.split("\n").filter(Boolean)) {
    const [refname, unixSeconds, ...subjectParts] = line.split("\t");
    known.set(refname.slice(REMOTE_PREFIX.length), {
      committedAtMs: Number.parseInt(unixSeconds, 10) * 1000,
      subject: subjectParts.join("\t")
    });
  }

  const branches = names.map((name) => ({
    name,
    committedAtMs: known.get(name)?.committedAtMs ?? null,
    subject: known.get(name)?.subject ?? null
  }));
  return { branches: rankBranches(branches, needle).slice(0, SEARCH_LIMIT), total: names.length };
}

// One search per ⏎ in the branch picker. GitHub (through `gh`) when origin is on
// github.com, since it knows every branch's last commit; `git ls-remote` when `gh` is
// missing, logged out or failing, or origin is hosted elsewhere.
export function searchRemoteBranches(repoRoot: string, query: string): BranchSearchResult {
  const needle = query.trim().toLowerCase();
  const repo = githubRepo(repoRoot);
  if (repo) {
    try {
      return searchGithub(repo, needle);
    } catch {
      // Fall through to plain git.
    }
  }
  return searchLsRemote(repoRoot, needle);
}
