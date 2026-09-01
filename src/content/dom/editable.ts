/**
 * 读者是不是正在这里打字。
 *
 * 属性和计算属性**都要看**：`isContentEditable` 是继承来的、更准，但 jsdom 里
 * 没有实现——只靠它，这条行为在测试里永远是绿的，而它恰恰是最该被测的那一条。
 *
 * 两个地方靠它做决定，而且都是「弄错了就在坏别人的页面」：
 * 翻翻模式不在输入框里画高亮（会挡住光标），划词的回车快捷键不在输入框里接管回车
 * （那里的回车是换行或提交）。所以放一处共用，而不是各写一遍——各写一遍的结局是
 * 其中一份先学会认属性，另一份还在只认计算属性。
 */
export function isEditable(element: Element): boolean {
  if (element instanceof HTMLElement && element.isContentEditable) return true
  const attribute = element.getAttribute('contenteditable')
  return attribute !== null && attribute !== 'false'
}

/** 焦点/事件目标落在输入区域里吗。 */
export function isTypingTarget(target: EventTarget | null): boolean {
  const element = target instanceof Element ? target : null
  if (!element) return false
  if (isEditable(element)) return true
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName)
}
