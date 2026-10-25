# 发布 FluidGlow Audio v2.5 到 GitHub Pages

仓库：<https://github.com/Leemitz/fluidglow-audio>

这是静态网页，无构建步骤。将本地修改提交到用于 Pages 的分支后，在仓库 **Settings → Pages → Build and deployment** 选择 **Deploy from a branch**、`main`、`/(root)`。

## 必需的网页文件

`index.html`、`styles.css`、`app.js`、`audio-dynamics.js`、`lenses.js`、`audio/` 文件夹内的全部五首 MP3 与 `LICENSE`。页面不再加载旧版 `fluidglow.js`；可以继续保留它作为历史源文件。`package.json` 和 `tests/` 只用于开发验证，无需在部署时安装依赖。

Pages 预计地址：<https://leemitz.github.io/fluidglow-audio/>。是否已发布以仓库 Pages/Actions 状态为准。推送是否成功以远程提交为准，Pages 是否上线以部署状态为准。

## 验收

1. 体验歌单显示五首音乐，默认等待点击；每首均能播放，支持上一首/下一首、进度定位与曲终顺序循环。三片透镜分析真实音乐，暂停后不再生成模拟节奏。
2. 确认“大透镜圆心 → 小透镜圆心”为 +Y，平面朝 +Y、凸面朝 −Y；侧壁导光体现厚度，上下不再有独立硬圆环描边。
3. 用鼠标或单指拖动画面，可观察正反两面；双击或“恢复视角”复位。
4. 粒子默认玫瑰金且密度为旧版两倍；发射高度与低频透镜 −Y 凸面顶点对齐，扩散时沿 +Y 抬升、增加频谱高度并淡出。
5. 拖动视角检查玫瑰金/白色主反射、低频上的中频倒影、中频上的高频倒影、随视角移动的平面菲涅尔亮边，以及低饱和珍珠侧壁。
6. 用“涟漪预览”测试单圈；关闭涟漪后立即清空，再开启后恢复触发。
7. 恢复默认应为暮光玫瑰配色、运动幅度 70%、鼓点灵敏度 1.45×、间隔 300 ms，中/高频运动倍率 2×/2.25×；低频鼓点规则保持不变。切换配色、手机竖屏与减少动态效果继续正常。
8. 麦克风在 HTTPS/localhost 环境下请求浏览器权限；音频仅在本地分析。

如需自动回归，按 README 的开发验证步骤运行 `npm test`。发布后检查资源 URL 的 `v=2.5.0`，并确认 `lenses.js` 及五首 `audio/*.mp3` 返回成功。音频使用项目相对路径，GitHub Pages 子目录也可运行；请通过 HTTP/HTTPS 打开。
