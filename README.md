# 櫻坂46 歷年歌單與參戰統計

純 HTML 靜態網站（部署於 Netlify）。

## 檔案結構

```
.
├── index.html            頁面結構、內建公演資料（#builtin-events-seed）
├── assets/
│   ├── css/style.css     自訂樣式
│   ├── js/app.js         網站主程式（Firebase 同步、歌單與統計）
│   └── images/bg-*.jpg   公演背景圖（檔名為內容雜湊，相同圖片只存一份）
└── README.md
```

## 備註

- 公演資料目前內嵌在 `index.html` 的 `<script id="builtin-events-seed">` 中，圖片以 `assets/images/...` 路徑引用。
- 網站內建的「匯出最新版 index.html」會把整個畫面快照一起匯出，檔案會再次變大；更新資料前請先確認流程。
