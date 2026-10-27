export default function DatasetError({ error }: { error: Error }) {
  return (
    <div className="app">
      <header className="topbar">
        <h1>
          大阪市の保育施設 <span>空き状況マップ</span>
        </h1>
      </header>
      <main className="list">
        <div role="alert">
          <p>施設データを読み込めませんでした。</p>
          <p>{error.message}</p>
        </div>
        <button type="button" className="link-button" onClick={() => location.reload()}>
          再読み込み
        </button>
      </main>
    </div>
  );
}
