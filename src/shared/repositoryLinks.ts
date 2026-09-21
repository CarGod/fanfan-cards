/** Navigation only: credentials never appear in browser URLs. */
export function repositoryLinks(owner: string, repo: string): { view: string; name: string } | null {
  if (!/^[a-z\d][a-z\d-]*$/i.test(owner) || !/^[a-z\d_.-]+$/i.test(repo) || repo === '.' || repo === '..') return null
  const view = `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`
  return { view, name: `${owner}/${repo}` }
}
