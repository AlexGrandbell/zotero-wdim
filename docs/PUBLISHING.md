# 和意为 0.1.3：网页上传步骤

发布仓库：https://github.com/AlexGrandbell/zotero-wdim

此包已配置真实仓库地址及更新地址，但尚未替你上传或公开发布。无需命令行、密码或 Token。

## 第一步：上传源码

1. 解压「和意为-0.1.3-网页发布包.zip」。
2. 浏览器登录 GitHub，打开上面的仓库，确认它是 Public。
3. 如果仓库为空，点页面上的「uploading an existing file」；已有文件时点「Add file → Upload files」。
4. 打开解压后的「01-源码上传」文件夹，选中里面的文件和子文件夹，一起拖到上传页面。
   **上传里面的内容，不要直接上传 ZIP，也不要把「01-源码上传」这个外层文件夹一起套进去。**
5. 提交信息可填「发布和意为 0.1.3」，点 Commit changes 提交。
6. 完成后，仓库首页应直接显示 README.md、manifest.json、bootstrap.js、updates.json，以及 src、assets 等文件夹。若这些文件被套在另一个目录里，需要调整到仓库根目录。

隐藏文件 .gitignore 和 .gitattributes 可以一起上传；Mac Finder 用 ⌘⇧. 显示隐藏文件。遗漏这两个文件不会影响插件运行。

## 第二步：发布安装包

1. 打开：https://github.com/AlexGrandbell/zotero-wdim/releases/new
2. Choose a tag 输入 `v0.1.3`，选择创建这个标签；Target 选择刚才上传源码的分支。
3. Release title 填：`和意为 0.1.3`。
4. 将「03-发布文案.md」的正文复制到发布说明框。
5. 把「02-Release附件」里的下面三个文件全部拖入附件区域：
   - `zotero-wdim-0.1.3.xpi`
   - `SHA256SUMS`
   - `updates.json`
6. 等附件上传完成，勾选「Set as latest release」（如显示），不要勾「This is a pre-release」。
7. 点 Publish release。

**三个附件不要改文件名。** 插件的更新地址指向最新 Release 下的 updates.json，更新清单内的下载地址与校验和对应这份 XPI。

## 第三步：核对发布结果

- 发布页应为：https://github.com/AlexGrandbell/zotero-wdim/releases/tag/v0.1.3
- 页面 Assets 中应有上述三个附件，除此之外 GitHub 还会自动提供源码 ZIP / TAR。
- 更新清单地址应能显示或下载 JSON：
  https://github.com/AlexGrandbell/zotero-wdim/releases/latest/download/updates.json
- 从发布页下载 XPI，在 Zotero → 工具 → 插件中覆盖安装，**重启 Zotero**。
- 插件列表应显示「和意为」0.1.3，快捷键仍为 ⌘/。

旧的 0.1.2 和本地候选包不会凭空知道新的更新地址，先手动安装这次正式包；后续新版可以沿用正式更新机制。

## 第四步：申请中文社区收录

等 GitHub Release 发布成功后，再打开：
https://github.com/zotero-chinese/zotero-plugins/issues/new

标题与正文已准备在「04-社区收录申请.md」中。收录需要社区维护者处理，GitHub 发布成功不等于已经进入社区商店。

## 下次更新

保持插件 ID 不变；修改 manifest.json 与 package.json 的版本号；运行 scripts/configure_release.py AlexGrandbell/zotero-wdim 重新测试、构建并生成更新清单。发布新标签和新的三个附件，并设为 latest。不要复用旧版本号或旧 SHA256SUMS。

参考：
- 上传文件：https://docs.github.com/en/repositories/working-with-files/managing-files/adding-a-file-to-a-repository
- 发布 Release：https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository
