import { placeholder } from '../ui.js';

export function mount(view) {
  view.append(placeholder('📅', '台北／桃園活動', '自訂日期區間查詢文化部藝文活動，每週五自動推播下週活動到 LINE。步驟 3 實作。'));
}
