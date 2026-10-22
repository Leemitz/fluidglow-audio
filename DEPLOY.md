# GitHub Pages 发布指南（账号：Leemitz）

> 当前 GitHub 连接不提供新建仓库或启用 Pages 的能力，因此这两步须在 GitHub 网页上操作。

1. 打开 https://github.com/new ，将仓库名设为 `fluidglow-audio`，可见性选择 **Public**，主分支使用 `main`。创建时不用勾选添加 README / .gitignore / License（压缩包内已提供）。
2. 解压 `fluidglow-audio.zip`，打开创建的仓库，使用 **Add file → Upload files**，将解压后文件夹内部的所有文件上传到仓库根目录。确保根目录直接有 `index.html`，不是嵌套文件夹。
3. 进入仓库 **Settings → Pages → Build and deployment**，选择 **Deploy from a branch**，Branch: **main**，Folder: **/(root)**，Save。
4. GitHub Pages 完成部署后，访问 **https://leemitz.github.io/fluidglow-audio/** 。首次部署可能不是立即生效；以 Pages 设置界面显示的实际站点地址为准。

验证：在页面选择自己的音频文件，确认三个频段表显示变化；麦克风模式需浏览器授予权限。音频仅在浏览器中处理。