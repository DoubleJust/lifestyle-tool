import { placeholder } from '../ui.js';

export function mount(view) {
  view.append(placeholder('💳', '信用卡通路推薦', '輸入店名，依預估實際回饋金額推薦要刷哪張卡。步驟 2 實作，需要先提供你整理的回饋規則檔。'));
}
