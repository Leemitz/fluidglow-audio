# 发布 FluidGlow Audio 到 GitHub Pages

仓库：**https://github.com/Leemitz/fluidglow-audio**

所有网页源码已经上传至 `main` 分支根目录（包括 `index.html`、`fluidglow.js`、`app.js` 和 `styles.css`）。无需重新上传文件，也无需任何构建命令。

## 仅需开启 GitHub Pages

1. 打开 https://github.com/Leemitz/fluidglow-audio/settings/pages
2. 在 **Build and deployment** 下，将 **Source** 设为 **Deploy from a branch**。
3. 在 **Branch** 中选择 **main**，文件夹选择 **/(root)**，点击 **Save**。
4. 部署成功后，预计访问地址：https://leemitz.github.io/fluidglow-audio/

注意：在 GitHub Pages 未开启、部署未完成时，上方只是预计地址，不代表已上线。

## 验收

- 用 Chrome / Safari 打开网页，确认 WebGL 油滴可以流动。
- 点击 **选择音乐**，载入本地 MP3 或 WAV，低中高频表随声音变化。
- 观察低频改变体积、中频改变虹彩油膜、高频改变边缘光泽；液滴中心的融合参数 `merge`、`spread` 不随音乐跳变。
- 麦克风模式需要浏览器同意权限，且在 HTTPS（GitHub Pages）环境使用。
- 音频数据仅在设备本地处理，不会上传到服务器。

如果打不开网页，先检查 Pages 设置界面里的发布状态与 Actions 构建结果。
