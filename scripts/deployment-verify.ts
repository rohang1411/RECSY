import { execFileSync } from 'node:child_process';

async function main() {
  const credential = execFileSync(
    'git',
    ['-c', 'credential.interactive=false', 'credential', 'fill'],
    {
      input: 'protocol=https\nhost=github.com\n\n',
      encoding: 'utf8',
      timeout: 15_000,
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  );
  const token = credential
    .split(/\r?\n/)
    .find((line) => line.startsWith('password='))
    ?.slice('password='.length);
  if (!token) throw new Error('No existing GitHub credential is available.');
  const branch = execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim();
  const repo = 'rohang1411/RECSY';
  async function get(path: string) {
    const response = await fetch(`https://api.github.com/repos/${repo}/${path}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'RECSY-deployment-check',
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok)
      throw new Error(`GitHub ${path.split('?')[0]} returned HTTP ${response.status}.`);
    return response.json();
  }
  const remoteBranch = await get(`branches/${encodeURIComponent(branch)}`);
  const secrets = await get('actions/secrets?per_page=100');
  const wanted = [
    'GEMINI_API_KEY',
    ...Array.from({ length: 5 }, (_, index) => `GEMINI_API_KEY_${index + 2}`),
    'GEMINI_API_KEYS_EXTRA',
  ];
  const names = new Set(secrets.secrets.map((secret: { name: string }) => secret.name));
  console.log(
    JSON.stringify(
      {
        branch,
        remoteCommit: remoteBranch.commit.sha,
        githubSecrets: wanted.map((name) => ({ name, present: names.has(name) })),
      },
      null,
      2,
    ),
  );
  const runs = await get(`actions/runs?branch=${encodeURIComponent(branch)}&per_page=5`);
  console.log(
    'actions',
    JSON.stringify(
      runs.workflow_runs.map(
        (run: {
          name: string;
          status: string;
          conclusion: string | null;
          html_url: string;
          head_sha: string;
        }) => ({
          name: run.name,
          status: run.status,
          conclusion: run.conclusion,
          commit: run.head_sha,
          url: run.html_url,
        }),
      ),
      null,
      2,
    ),
  );
  const checks = await get(`commits/${remoteBranch.commit.sha}/status`);
  console.log(
    'commit_statuses',
    JSON.stringify(
      checks.statuses.map((status: { context: string; state: string; target_url: string }) => ({
        context: status.context,
        state: status.state,
        url: status.target_url,
      })),
      null,
      2,
    ),
  );
  const deployments = await get(`deployments?sha=${remoteBranch.commit.sha}&per_page=5`);
  for (const deployment of deployments) {
    const statuses = await get(`deployments/${deployment.id}/statuses?per_page=1`);
    console.log(
      'deployment',
      JSON.stringify({
        environment: deployment.environment,
        commit: deployment.sha,
        status: statuses[0]?.state ?? 'unknown',
        url: statuses[0]?.environment_url ?? statuses[0]?.target_url ?? null,
      }),
    );
  }
  console.log('Secret names and deployment metadata only; credential values were never printed.');
}

main().catch(() => {
  console.error(
    'GitHub deployment verification could not complete with the existing credential or API access. No credentials were printed.',
  );
  process.exitCode = 1;
});
