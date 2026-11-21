import { placeholder } from '../ui.js';

export function mount(view) {
  view.append(placeholder('✈️', '機票', '依國家或機場產生 Skyscanner／Google Flights 搜尋連結（步驟 5），之後再接 Google Flights 價格追蹤信的 LINE 推播（步驟 6）。'));
}
