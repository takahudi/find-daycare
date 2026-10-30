export const FACILITY_ID_ATTRIBUTE = 'data-facility-id';

let pendingFrame: number | undefined;

export function scrollToFacility(id: string) {
  if (pendingFrame !== undefined) cancelAnimationFrame(pendingFrame);
  pendingFrame = undefined;
  const card = document.querySelector<HTMLElement>(`[${FACILITY_ID_ATTRIBUTE}="${CSS.escape(id)}"]`);
  if (!card) return;

  let scrollParent = card.parentElement;
  while (scrollParent && !/(auto|scroll)/.test(getComputedStyle(scrollParent).overflowY)) {
    scrollParent = scrollParent.parentElement;
  }
  const scroller = scrollParent ?? document.documentElement;
  let previousScrollTop = scroller.scrollTop;
  let previousRect: DOMRect | undefined;
  let stableFrames = 0;
  let frames = 0;
  const scroll = () => {
    pendingFrame = undefined;
    if (!card.isConnected || card.getClientRects().length === 0) return;
    // 未描画カードの実寸への変化は遅れるため、補正前の位置が連続して安定するまで待つ。
    const rect = card.getBoundingClientRect();
    stableFrames = previousRect?.top === rect.top && previousRect.bottom === rect.bottom ? stableFrames + 1 : 0;
    const scrollTop = scroller.scrollTop;
    // hover の移動や小数の丸めは内容のレイアウト変化とみなさず、利用者のスクロールを優先する。
    const userScrolled =
      scrollTop !== previousScrollTop &&
      previousRect &&
      Math.abs(previousRect.top + previousScrollTop - (rect.top + scrollTop)) < 1;
    if (userScrolled || stableFrames === 4 || ++frames === 20) return;
    card.scrollIntoView({ block: 'nearest' });
    previousRect = card.getBoundingClientRect();
    previousScrollTop = scroller.scrollTop;
    pendingFrame = requestAnimationFrame(scroll);
  };
  scroll();
}
