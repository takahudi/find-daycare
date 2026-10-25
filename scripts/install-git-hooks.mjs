import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

// ZIP で展開したコピーやビルド用のコピーには .git がないので、フックを入れずにインストールを続ける。
// 別のリポジトリの中に置かれたコピーもここに .git がないので、外側のリポジトリには入れない
if (!existsSync('.git')) {
  console.warn('.git がないため、Git フックは入れません');
  process.exit(0);
}

const { status } = spawnSync('lefthook install', { stdio: 'inherit', shell: true });
process.exit(status ?? 1);
