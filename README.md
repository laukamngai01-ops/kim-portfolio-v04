# Kim V04

Kim 的影片、攝影與設計作品集。首頁進入 Films，Gallery 展示攝影與設計。

- [公開網站](https://laukamngai01-ops.github.io/kim-portfolio-v04/)
- Films 入口為 `a24/index.html`，Gallery 入口為 `glass/index.html#helix`。
- 作品與媒體資料位於 `data.js` 及 `selected/data.js`，可播放素材位於 `media/assets/`。

GitHub Pages 從 `main` 的根目錄發布。後續在本倉庫開分支修改，合併至 `main` 後，GitHub 會重新部署。

修改 Films 的入口模板、Gallery 的共用查看器，或新增影片時，運行 `node scripts/prepare-film-pages.mjs`，把生成的作品頁一同提交。網站使用靜態 HTML、CSS 和原生 JavaScript，無需額外安裝構建依賴。

網站內的 AI 輔助與虛構作品依各作品說明標註。字體與 Three.js 的許可文件隨相應資源附上。
