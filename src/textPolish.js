const REPLACEMENTS = [
  [/说白了[，,]?/g, '从本质上看，'],
  [/我(?:个人)?(?:感觉|觉得)[，,]?/g, '在我看来，'],
  [/让我想到/g, '这使我联想到'],
  [/其实[，,]?/g, '本质上，'],
  [/但是[，,]?/g, '然而，'],
  [/所以[，,]?/g, '因此，'],
  [/因为[，,]?/g, '其原因在于'],
  [/然后[，,]?/g, '随后，'],
  [/这(?:个|种)东西/g, '这一内容'],
  [/挺有意思/g, '颇具启发性'],
  [/挺好(?:的)?/g, '颇具价值'],
  [/很有用/g, '具有实践价值'],
  [/很重要/g, '至关重要'],
  [/有点/g, '在一定程度上'],
  [/很多/g, '诸多'],
  [/看了/g, '阅读了'],
];

/**
 * 本地轻量表达优化。仅调整措辞和逻辑连接词，不扩写事实，避免改变原意。
 */
export function polishText(input) {
  if (typeof input !== 'string') return '';

  let result = input
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(line => line.trim().replace(/[ \t]+/g, ' '))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (!result) return '';

  REPLACEMENTS.forEach(([pattern, replacement]) => {
    result = result.replace(pattern, replacement);
  });

  result = result
    .replace(/，{2,}/g, '，')
    .replace(/，\s*([。！？；])/g, '$1')
    .replace(/([。！？])([^\n])/g, '$1$2')
    .replace(/([!！]){2,}/g, '！')
    .replace(/([?？]){2,}/g, '？');

  // 为完整陈述补齐句末标点；标题、摘录符号等保持原样。
  result = result.split('\n').map(line => {
    if (!line || /[。！？；…：”’）》】]$/.test(line)) return line;
    return `${line}。`;
  }).join('\n');

  return result;
}

export function normalizeStoredNotes(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter(note => note && typeof note.note === 'string' && note.note.trim())
    .slice(0, 50)
    .map((note, index) => ({
      id: typeof note.id === 'string' ? note.id : `restored-${index}`,
      title: typeof note.title === 'string' && note.title.trim() ? note.title.trim() : '随手记',
      author: typeof note.author === 'string' ? note.author : '林默',
      cover: typeof note.cover === 'string' ? note.cover : 'note',
      coverUrl: typeof note.coverUrl === 'string' && /^https:\/\//.test(note.coverUrl) ? note.coverUrl : '',
      bookId: typeof note.bookId === 'string' ? note.bookId : '',
      note: note.note.trim().slice(0, 1200),
      tags: Array.isArray(note.tags) ? note.tags.filter(tag => typeof tag === 'string').slice(0, 5) : ['思考'],
      type: ['感悟', '摘录', '问题', '行动'].includes(note.type) ? note.type : '感悟',
      category: typeof note.category === 'string' ? note.category : '随手记',
      date: typeof note.date === 'string' ? note.date : '最近',
      saved: true,
    }));
}
