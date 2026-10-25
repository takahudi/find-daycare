import { spawnSync } from 'node:child_process';

// ZIP で展開したコピーやビルド用のコピーには .git がないので、フックを入れずにインストールを続ける
const git = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { stdio: 'ignore' });
if (git.status !== 0) process.exit(0);

const { status } = spawnSync('lefthook', ['install'], { stdio: 'inherit', shell: true });
process.exit(status ?? 1);
