第一章学习中心
==============

公开内容以第一章的 1.1～1.7 七节完整学习笔记和同页 70 道自测题为主，
辅以 49 个术语说明以及 1.2～1.7 六节讲解视频。
笔记可搜索、打印；自测含参考答案、评分要点和原文复习链接。
页面同时提供题目版、答案解析版 TXT 下载，以及视频、字幕和旁白稿下载。

本地构建
--------
需要 Node.js 20 或以上、npm 和 Python 3.10 或以上（python 命令应指向 Python 3）。
在仓库根目录执行：

    npm ci
    npm run build

构建顺序为：生成并校验题库 → 生成学习笔记 → 组装公开站点。
npm 锁定 marked 17.0.5；Python 构建步骤只使用标准库。
也可用对应的 python / py 命令分别执行各步：

    python 可视化页面/测试题/build_quiz.py
    node 可视化页面/build-notes.mjs
    python scripts/build-site.py

输出目录是 _site。双击 _site/index.html 可以离线打开，
也可在仓库根目录执行 python3 -m http.server 8000 --directory _site，
再打开 http://localhost:8000/。

GitHub Pages
------------
仓库 Settings → Pages → Build and deployment → Source 选择 GitHub Actions。
推送 main 分支或在 Actions 手动运行发布工作流，会构建并发布 _site。
工作流使用 GitHub 提供的 Pages 权限和身份令牌，无须另配部署密钥。
页面只使用相对站内路径，可放在 https://用户名.github.io/仓库名/ 子路径下。

公开文件范围
------------
scripts/build-site.py 仅组装公开首页、生成的笔记与自测兼容入口、两份题库 TXT、
以及 讲解视频/成片 中获准的成片和学习附件。
允许的视频附件是 mp4 / vtt / srt / jpg / png、index.html、使用说明.txt、
每节的 *-旁白稿.txt、课程目录.json 和 1.2～1.7 的章节时间轴 JSON。
视频目录中的其他文件会导致构建失败；生成日志和媒体诊断不进入发布目录。
站点不收集履历文件、私人首页或联系方式。
笔记里的履历入口会移除，飞书内部图片授权链接会替换为公开学习主线入口。
构建会拒绝符号链接及 Windows 目录连接，并校验站内相对链接和公开输出中的授权串。
脚本允许覆盖相同公开文件，不自动删除文件；若 _site 存在非白名单旧文件，会报错。

作答进度
--------
作答记录尝试保存于当前浏览器的本地存储，不上传服务器。
不同浏览器、设备和站点地址之间不会自动同步；清除站点数据可能删除记录。
可以在自测页面导出作答记录备份，再在另一浏览器或设备导入。
