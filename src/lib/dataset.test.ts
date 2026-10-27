import { afterEach, describe, expect, it, vi } from 'vitest';
import { ValiError } from 'valibot';
import rawData from '../data/facilities.json';
import { loadDataset } from './dataset';

const url = '/assets/facilities-test.json';
const networkMessage = '施設データを取得できませんでした。通信状態を確かめてください。';
const timeoutMessage = '施設データの取得に時間がかかりすぎました。';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('loadDataset', () => {
  it('指定URLを30秒の期限付きで取得し、検証済みの施設データを返す', async () => {
    const signal = new AbortController().signal;
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(signal);
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(Response.json(rawData));
    vi.stubGlobal('fetch', fetchMock);
    await expect(loadDataset(url)).resolves.toEqual(rawData);
    expect(timeout).toHaveBeenCalledExactlyOnceWith(30_000);
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(url, { signal });
  });

  it('読み込み先がなければ日本語エラーを返す', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(loadDataset(null)).rejects.toThrow('施設データの読み込み先が見つかりません。');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('HTTPエラーなら本文が正しくてもステータス付きの日本語エラーを返す', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(rawData, { status: 500 })));
    await expect(loadDataset(url)).rejects.toThrow('施設データの取得に失敗しました（HTTP 500）。');
  });

  it.each([new TypeError('Failed to fetch'), 'network unavailable'])(
    '通信失敗の原因 %s を保持し、日本語エラーを返す',
    async (cause) => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(cause));
      await expect(loadDataset(url)).rejects.toMatchObject({ message: networkMessage, cause });
    },
  );

  it('200のHTML応答なら構文エラーを原因に保持した日本語エラーを返す', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html></html>')));
    await expect(loadDataset(url)).rejects.toMatchObject({
      message: '施設データの形式が正しくありません。',
      cause: expect.any(SyntaxError),
    });
  });

  it('本文の通信が切れた場合も原因を保持した日本語エラーを返す', async () => {
    const cause = new TypeError('terminated');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.reject(cause) }));
    await expect(loadDataset(url)).rejects.toMatchObject({ message: networkMessage, cause });
  });

  it.each(['応答待ち', '本文読み取り'])('%sの期限切れは元の原因を保持した日本語エラーを返す', async (stage) => {
    const controller = new AbortController();
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
    const cause = new DOMException('signal timed out', 'TimeoutError');
    const pending = () => new Promise<never>((_, reject) => controller.signal.addEventListener('abort', () => reject(cause)));
    vi.stubGlobal('fetch', stage === '応答待ち' ? vi.fn(pending) : vi.fn().mockResolvedValue({ ok: true, json: pending }));
    const result = expect(loadDataset(url)).rejects.toMatchObject({ message: timeoutMessage, cause });
    await Promise.resolve();
    controller.abort(cause);
    await result;
  });

  it('JSONの形が施設データと違えば原因を保持した日本語エラーを返し、issuesをログに残す', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ facilities: [] })));
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(loadDataset(url)).rejects.toMatchObject({
      message: '施設データの形式が正しくありません。',
      cause: expect.any(ValiError),
    });
    expect(errorLog).toHaveBeenCalledExactlyOnceWith('施設データの検証に失敗しました。', expect.any(Array));
    expect(errorLog.mock.calls[0][1]).not.toHaveLength(0);
  });
});
