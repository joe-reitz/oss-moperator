/**
 * GitHub API Client
 * Fetches commit history via REST API for release notes / "what shipped" queries
 */

interface Commit {
  sha: string
  message: string
  author: string
  date: string
}

interface GitHubCommitResponse {
  sha: string
  commit: {
    message: string
    author: {
      name: string
      date: string
    }
  }
}

const GITHUB_API = "https://api.github.com"

function getRepo(): string {
  return process.env.GITHUB_REPO || ""
}

function getToken(): string | undefined {
  return process.env.GITHUB_TOKEN
}

export async function getCommits(since?: string, until?: string): Promise<Commit[]> {
  const token = getToken()
  const repo = getRepo()

  if (!token || !repo) {
    console.warn("[GitHub] GITHUB_TOKEN or GITHUB_REPO not set")
    return []
  }

  const url = new URL(`${GITHUB_API}/repos/${repo}/commits`)
  if (since) url.searchParams.set("since", since)
  if (until) url.searchParams.set("until", until)
  url.searchParams.set("per_page", "100")

  try {
    const res = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    })

    if (!res.ok) return []

    const data: GitHubCommitResponse[] = await res.json()

    return data.map((c) => ({
      sha: c.sha.slice(0, 7),
      message: c.commit.message.split("\n")[0],
      author: c.commit.author.name,
      date: c.commit.author.date,
    }))
  } catch {
    return []
  }
}
