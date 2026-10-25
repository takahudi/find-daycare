import { spawnSync } from 'node:child_process';
import path from 'node:path';

// ZIP で展開したコピーやビルド用のコピーには .git がないので、フックを入れずにインストールを続ける。
// 別のリポジトリの中に置かれたコピーで、そのリポジトリにフックを入れないよう、ルートがここかも確かめる
const git = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' });
if (git.status !== 0 || path.relative(git.stdout.trim(), process.cwd()) !== '') process.exit(0);

const { status } = spawnSync('lefthook', ['install'], { stdio: 'inherit', shell: true });
process.exit(status ?? 1);
