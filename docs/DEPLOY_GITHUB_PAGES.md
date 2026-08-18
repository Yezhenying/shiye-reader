# 使用 GitHub 网页发布拾页（无需命令行 Git）

本说明将项目发布为公开网站。默认仓库名为 `shiye-reader`，发布地址会是：

```text
https://<你的 GitHub 用户名>.github.io/shiye-reader/
```

> 网站、源代码和发布链接均为公开内容；但每位访问者导入的书籍、笔记、分类和进度只保存在其**自己的浏览器**中，不会上传到 GitHub，也不会自动跨设备同步。

## 你需要准备

- 一个 GitHub 免费账户；
- 本项目文件夹（不要上传 `node_modules`、`dist`、`vite.log` 或任何个人电子书）；
- 无需安装 Git、无需使用命令行、无需提供密码或访问令牌给任何人。

## 首次发布（仅使用网页）

1. 登录 [GitHub](https://github.com)，点击右上角 **+ → New repository**。
2. Repository name 填写 `shiye-reader`，选择 **Public**；不要勾选自动生成 README、`.gitignore` 或 license，然后点击 **Create repository**。
3. 在新仓库页面点击 **uploading an existing file**。
4. 打开本项目文件夹，在文件资源管理器中选择并拖入这些内容：
   - `.github`、`docs`、`public`、`src`、`tests` 文件夹；
   - `index.html`、`package.json`、`package-lock.json`、`vite.config.js`、`README.md`。
   - 不要拖入 `node_modules`、`dist`、`vite.log`、`.pi`、个人电子书或任何备份文件。
5. 页面底部点击 **Commit changes**。首次上传后，GitHub Actions 会自动开始构建。
6. 打开仓库 **Settings → Pages**，在 **Build and deployment → Source** 中选择 **GitHub Actions**。
7. 打开仓库顶部 **Actions**，等待名为 **Deploy GitHub Pages** 的工作流显示绿色成功标记。点击该工作流的部署链接，或回到 **Settings → Pages** 查看公网地址。

## 后续更新

每次需要更新时，在 GitHub 仓库网页进入相应文件，使用 **Add file → Upload files** 上传改过的文件并 Commit。等待 Actions 再次变绿即可。不要直接上传 `dist`；工作流会从源码重新构建。

## 发布前检查

- 打开生成的公网链接，确认书架为空或只显示自己导入的数据；
- 导入一份无版权风险的 TXT/EPUB/PDF 测试文件；
- 刷新页面，确认书籍仍存在；
- 打开 **设置 → 导出备份**，保留一份本地备份；
- 安装 PWA 后断网重启，确认“离线资源已缓存”；
- 从地址栏直接打开 `.../shiye-reader/#/library`，确认页面可访问。

## 常见问题

### Actions 构建失败

打开 **Actions → Deploy GitHub Pages → build** 查看红色步骤。最常见原因是漏传 `package-lock.json`、`src` 或 `public` 文件夹。补传后再次 Commit 即可。

### 页面没有样式、图标或离线状态不正常

确保仓库名仍是 `shiye-reader`。如果改名，需要同步调整发布构建的 base path；请在改名前先联系维护者。

### 换电脑后看不到以前的数据

这是本产品当前的本地优先设计：数据只在原浏览器保存。请在旧设备的设置中导出完整备份，再在新设备恢复。

### 能否只让某些人访问

GitHub Pages 公开项目不提供可靠的站点密码保护。本期网站完全公开，但用户数据不上传；若需真实账号或受控访问，必须单独建设后端鉴权服务。
