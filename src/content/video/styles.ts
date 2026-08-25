import { OVERLAY_CLASS } from './subtitleOverlay.ts'
import { BUTTON_CLASS, PANEL_CLASS } from './controlButton.ts'

/**
 * 播放器上那一层的样式。
 *
 * 和整页翻译的样式一样，这些不能待在 shadow root 里——字幕层和按钮都长在 YouTube
 * 自己的 DOM 里（全屏、剧场模式、迷你播放器都靠它定位）。所以规则全部锚在我们自己的
 * 类名上，不碰播放器的任何选择器，只有一个例外：开着我们字幕的时候要把原生字幕藏起来，
 * 否则屏幕下方会有两层字。
 */
const STYLE_ID = 'fanfan-video-subtitle-style'

const CSS = `
.${OVERLAY_CLASS} {
  position: absolute;
  left: 0;
  right: 0;
  /* 控制栏收起时贴得低一些；下面那条规则在控制栏露出来时把它抬上去。 */
  bottom: 6%;
  z-index: 30;
  padding: 0 6%;
  box-sizing: border-box;
  text-align: center;
  pointer-events: none;
  font-family: "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", system-ui, sans-serif;
  line-height: 1.35;
  transition: bottom 120ms ease-out;
}

/*
 * 控制栏一露出来就顶着字幕。YouTube 自己也是这么让位的，
 * 不跟着让，读者拖进度条的时候正好挡住他要看的那一行。
 */
#movie_player:not(.ytp-autohide) .${OVERLAY_CLASS} {
  bottom: 14%;
}

.${OVERLAY_CLASS}-source,
.${OVERLAY_CLASS}-translation {
  display: inline-block;
  max-width: 100%;
  padding: 0.1em 0.42em;
  border-radius: 4px;
  /* 由叠加层按读者选的档位写进来，见 subtitleOverlay.ts */
  background: var(--ff-subtitle-bg, rgba(8, 8, 8, 0.7));
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.85);
  white-space: pre-wrap;
}

/*
 * 底衬关掉之后，可读性全靠描边。
 *
 * 四向 1px 的阴影比一层模糊管用得多：字幕会压在任意一帧画面上，
 * 浅色画面里模糊阴影等于没有。
 */
.${OVERLAY_CLASS}[data-bare="true"] .${OVERLAY_CLASS}-source,
.${OVERLAY_CLASS}[data-bare="true"] .${OVERLAY_CLASS}-translation {
  text-shadow:
    0 0 3px rgba(0, 0, 0, 0.95),
    1px 1px 0 rgba(0, 0, 0, 0.9),
    -1px 1px 0 rgba(0, 0, 0, 0.9),
    1px -1px 0 rgba(0, 0, 0, 0.9),
    -1px -1px 0 rgba(0, 0, 0, 0.9);
}

/* 原文退一步：它是给对照用的，主角是译文。 */
.${OVERLAY_CLASS}-source {
  color: rgba(255, 255, 255, 0.82);
  font-weight: 400;
  margin-bottom: 0.18em;
}

.${OVERLAY_CLASS}-translation {
  display: block;
  width: fit-content;
  margin: 0 auto;
  color: #fff;
  font-weight: 600;
}

/* 我们在画字幕的时候，原生字幕必须让位，否则下方会叠两层字。 */
#movie_player[data-fanfan-subtitles="on"] .ytp-caption-window-container {
  display: none !important;
}

/*
 * 按钮自己的盒子必须写死。
 *
 * ytp-button 本身不带宽度，YouTube 的原生按钮靠各自的图标撑开；而我们的 svg 是
 * width: 100%——宽度取决于按钮，按钮的宽度又取决于内容，这个循环的结果是塌成零宽，
 * 表现出来就是「按钮位置错乱」。48px 是控制栏里所有原生按钮的宽度。
 */
.${BUTTON_CLASS} {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 48px;
  height: 100%;
  padding: 0;
  /*
   * 行盒是这个按钮唯一会跑偏的地方：任何空白文本节点都会在图标下面撑出一行，
   * 把图标顶离垂直中心。归零之后，居中完全交给上面的 flex。
   */
  line-height: 0;
  font-size: 0;
  vertical-align: top;
}

/*
 * 图标高度跟着控制栏走，宽度由 viewBox 的比例自己算。
 *
 * 42% 是对着旁边的 CC、齿轮量出来的——它们在 48px 的按钮里大约 20px 高。
 * 用比例而不是写死 px，是为了全屏时控制栏变高，图标跟着变大。
 */
.${BUTTON_CLASS} svg {
  display: block;
  width: auto;
  height: 42%;
  color: #fff;
  opacity: 0.85;
  transition: opacity 120ms ease-out, color 120ms ease-out;
}

.${BUTTON_CLASS}:hover svg {
  opacity: 1;
}

/*
 * 只有字幕真的在屏幕上时，按钮才是橙的。
 *
 * 「开关开着」和「字幕在显示」是两件事，而且恰恰在广告播放、字幕还没取到的时候分开。
 * 图标要是那时候就亮着，它就在说谎，读者只会觉得功能坏了。
 */
.${BUTTON_CLASS}[data-status="on"] svg {
  color: #ff6a3d;
  opacity: 1;
}

/* 正在准备：橙色但呼吸着，说明「在动，还没好」。 */
.${BUTTON_CLASS}[data-status="loading"] svg {
  color: #ff6a3d;
  animation: fanfan-subtitle-pulse 1.4s ease-in-out infinite;
}

/* 出错：不亮，也不假装。 */
.${BUTTON_CLASS}[data-status="error"] svg {
  color: #ffb4a0;
  opacity: 0.7;
}

@keyframes fanfan-subtitle-pulse {
  0%, 100% { opacity: 0.35; }
  50% { opacity: 1; }
}

.${PANEL_CLASS} {
  position: absolute;
  right: 12px;
  bottom: 58px;
  /* 控制栏大约在 60，面板必须压在它上面，否则点不到。 */
  z-index: 72;
  width: 256px;
  padding: 10px 12px;
  box-sizing: border-box;
  border-radius: 10px;
  background: rgba(18, 18, 18, 0.96);
  color: #fff;
  font-family: "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", system-ui, sans-serif;
  font-size: 13px;
  line-height: 1.5;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.45);
  cursor: default;
}

.${PANEL_CLASS}[hidden] {
  display: none;
}

.${PANEL_CLASS}-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-height: 30px;
}

.${PANEL_CLASS}-row + .${PANEL_CLASS}-row {
  margin-top: 4px;
}

.${PANEL_CLASS}-toggle {
  position: relative;
  flex: none;
  width: 34px;
  height: 20px;
  padding: 0;
  border: 0;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.24);
  cursor: pointer;
  transition: background 120ms ease-out;
}

.${PANEL_CLASS}-toggle[data-on="true"] {
  background: #ff6a3d;
}

.${PANEL_CLASS}-toggle::after {
  content: "";
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #fff;
  transition: transform 120ms ease-out;
}

.${PANEL_CLASS}-toggle[data-on="true"]::after {
  transform: translateX(14px);
}

.${PANEL_CLASS}-segmented {
  display: flex;
  flex: none;
  border-radius: 7px;
  background: rgba(255, 255, 255, 0.12);
  padding: 2px;
  gap: 2px;
}

.${PANEL_CLASS}-segmented button {
  border: 0;
  border-radius: 5px;
  padding: 3px 8px;
  background: transparent;
  color: rgba(255, 255, 255, 0.72);
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
  white-space: nowrap;
}

/*
 * 选中态用白底黑字，不用品牌橙。
 *
 * 橙底 2.85:1，在一个随时会被视频画面反光干扰的小控件上不够。这里让位给可读性。
 */
.${PANEL_CLASS}-segmented button[data-active="true"] {
  background: #fff;
  color: #0f0f0f;
  font-weight: 600;
}

.${PANEL_CLASS}-note {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid rgba(255, 255, 255, 0.12);
  color: rgba(255, 255, 255, 0.6);
  font-size: 12px;
}

.${PANEL_CLASS}-note[data-error="true"] {
  color: #ffb4a0;
}

@media (prefers-reduced-motion: reduce) {
  .${BUTTON_CLASS}[data-status="loading"] svg {
    animation: none;
    opacity: 0.7;
  }

  .${OVERLAY_CLASS},
  .${PANEL_CLASS}-toggle,
  .${PANEL_CLASS}-toggle::after {
    transition: none;
  }
}
`

export function injectVideoStyles(): void {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = CSS
  document.head?.appendChild(style)
}
