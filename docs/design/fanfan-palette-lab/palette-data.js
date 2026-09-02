(function exposePaletteData(global) {
  'use strict'

  const LEVELS = [
    { id: 0, name: '陌生', cue: '需要停下来处理' },
    { id: 1, name: '学习中', cue: '正在建立记忆' },
    { id: 2, name: '熟悉', cue: '轻提醒，不打断阅读' },
    { id: 3, name: '已掌握', cue: '确认存在，可选择隐藏' },
  ]

  const PALETTES = {
    warmField: {
      name: '暖日麦田',
      tag: '推荐',
      badge: '橙金综合色调',
      summary: '从日光橙走向麦穗金与土壤褐，温暖但不发出警报；注意力坡道最自然，适合作为默认。',
      light: ['rgba(255, 70, 0, .277)', 'rgba(210, 100, 0, .257)', 'rgba(150, 112, 0, .218)', 'rgba(115, 100, 80, .175)'],
      dark: ['rgba(255, 125, 20, .282)', 'rgba(255, 190, 30, .187)', 'rgba(220, 210, 60, .155)', 'rgba(190, 175, 150, .162)'],
    },
    glacierBay: {
      name: '冰川蓝湾',
      tag: '清冽',
      badge: '钴蓝综合色调',
      summary: '由钴蓝沉入湖蓝和钢蓝，整套保持冷静清晰；适合技术文档和偏理性的阅读界面。',
      light: ['rgba(0, 85, 225, .219)', 'rgba(0, 105, 195, .208)', 'rgba(20, 105, 165, .184)', 'rgba(95, 110, 135, .184)'],
      dark: ['rgba(40, 150, 255, .311)', 'rgba(55, 170, 255, .244)', 'rgba(80, 180, 230, .201)', 'rgba(160, 185, 215, .155)'],
    },
    wisteriaNocturne: {
      name: '紫藤夜曲',
      tag: '沉浸',
      badge: '紫藤综合色调',
      summary: '从洋红紫逐步沉到灰紫，色彩感明确又保持阅读秩序；深色网页上的层次尤其完整。',
      light: ['rgba(205, 0, 220, .204)', 'rgba(155, 25, 210, .181)', 'rgba(110, 50, 175, .162)', 'rgba(115, 100, 130, .179)'],
      dark: ['rgba(235, 80, 255, .315)', 'rgba(195, 105, 255, .280)', 'rgba(160, 120, 235, .248)', 'rgba(190, 170, 205, .162)'],
    },
    mintForest: {
      name: '薄荷森林',
      tag: '自然',
      badge: '森林综合色调',
      summary: '鲜绿转入薄荷与苔藓，带来安静的自然感；四档都清楚，但不会把文章变成警示色块。',
      light: ['rgba(0, 135, 55, .258)', 'rgba(0, 120, 85, .216)', 'rgba(45, 105, 55, .183)', 'rgba(100, 115, 102, .188)'],
      dark: ['rgba(30, 220, 100, .231)', 'rgba(40, 215, 145, .206)', 'rgba(100, 205, 115, .183)', 'rgba(160, 195, 170, .151)'],
    },
    cherryCloud: {
      name: '樱粉云霞',
      tag: '柔亮',
      badge: '樱粉综合色调',
      summary: '由明快樱红退到柔粉和烟灰粉，亲和而不甜腻；适合偏生活方式与人文内容。',
      light: ['rgba(255, 0, 30, .200)', 'rgba(230, 35, 70, .200)', 'rgba(190, 65, 95, .188)', 'rgba(125, 100, 108, .181)'],
      dark: ['rgba(255, 80, 90, .340)', 'rgba(255, 110, 130, .259)', 'rgba(240, 140, 160, .201)', 'rgba(205, 175, 185, .158)'],
    },
    mistStudy: {
      name: '雾灰书房',
      tag: '克制',
      badge: '棕灰综合色调',
      summary: '咖棕、石板蓝灰与纸张灰组成低彩度阶梯；视觉干扰最低，适合长时间专注阅读。',
      light: ['rgba(100, 70, 45, .215)', 'rgba(75, 90, 105, .206)', 'rgba(70, 80, 105, .170)', 'rgba(100, 98, 95, .170)'],
      dark: ['rgba(205, 165, 125, .247)', 'rgba(175, 185, 200, .201)', 'rgba(165, 175, 200, .187)', 'rgba(185, 180, 175, .160)'],
    },
  }

  const DEFAULT_CONFIG = {
    palette: 'warmField',
    backdrop: 'light',
    showMastered: true,
  }

  global.FanfanPaletteLabData = Object.freeze({
    DEFAULT_CONFIG: Object.freeze(DEFAULT_CONFIG),
    LEVELS: Object.freeze(LEVELS.map((level) => Object.freeze(level))),
    PALETTES: Object.freeze(PALETTES),
  })
})(window)
