# 開發流程

- 不要直接在 `main` 上開發，開 branch
- branch 開好 → push → 開 PR → 對方看過 → merge
- 想知道對方在做什麼？看 PR 列表

## 分支命名

- 新功能：`feature/簡短描述`（例：`feature/npc-pathing`）
- 修 bug：`fix/簡短描述`（例：`fix/z-fighting-floor`）

## 開始一項新工作

```bash
git checkout main
git pull
git checkout -b feature/簡短描述
```

正常開發、commit，跟平常一樣。

## 開發中想同步 main 的最新進度（可跳過，PR 前一定要做一次）

```bash
git checkout main
git pull
git checkout feature/簡短描述
git merge main
```

如果這裡跳出衝突，代表你和對方動到同一塊。**在自己電腦上解完衝突再繼續**，不要留給 PR 時才處理。

## 完成了，開 PR

```bash
git push -u origin feature/簡短描述
```

push 完，GitHub 網頁上該分支會出現「Compare & pull request」按鈕，點下去：

1. 標題寫這次做了什麼（PR 模板會自動帶出來，照著填就好）
2. 右側 Reviewers 選對方
3. 建 PR

## 你是 Reviewer，要在本機測對方的分支

```bash
git fetch origin
git checkout 對方的分支名稱
npm run dev
```

看完想切回自己原本的工作：

```bash
git checkout feature/自己的分支
```

## PR 通過後

在 GitHub 網頁上點 **Squash and merge**（不要用一般 merge，squash 可以讓 `main` 的 log 保持一行一個功能，不會有一堆 `Merge branch main` 的雜訊）。

本機同步：

```bash
git checkout main
git pull
git branch -d feature/簡短描述
```

## 卡住了怎麼辦

- CI 紅了：點開 GitHub Actions 的錯誤訊息，通常是 `tsc` 型別錯誤，本機跑 `npm run lint` 重現
- merge 衝突解不開：不要用 `git checkout --theirs`/`--ours` 亂猜，直接把檔案內容貼給對方或用 AI agent 一起看
- 不確定該不該開新 branch 還是接著改：只要會動到別人可能也在動的檔案（例如共用元件、型別定義），就開新 branch，不要賭運氣
