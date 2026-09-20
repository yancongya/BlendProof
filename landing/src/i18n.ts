/**
 * Minimal i18n: Simplified Chinese is the source of truth baked into the
 * static HTML (and stays what no-JS visitors and crawlers see). English is a
 * runtime overlay — a map keyed by the normalized Chinese text, applied by
 * walking text nodes and common attributes. Dynamic copy in main.ts /
 * hero3d.ts goes through t() / ifEn().
 *
 * Switching the language persists the choice and reloads, so every render
 * path simply reads the current lang once at startup.
 */

export type Lang = 'zh' | 'en'

const STORE_KEY = 'bp-lang'

export function getLang(): Lang {
  try {
    const stored = localStorage.getItem(STORE_KEY)
    if (stored === 'en' || stored === 'zh') return stored
  } catch {
    /* private mode */
  }
  return navigator.language?.toLowerCase().startsWith('zh') ? 'zh' : 'en'
}

/** zh text → en text, keyed by whitespace-collapsed Chinese source. */
const EN: Record<string, string> = {
  /* chrome / top actions */
  '☀ 亮色': '☀ Light',
  '☾ 暗色': '☾ Dark',
  '切换亮色 / 暗色模式': 'Toggle light / dark theme',

  /* tarot identity portal */
  '🎴 身份': '🎴 Identity',
  '重新选择身份': 'Choose identity again',
  '选择你的身份': 'CHOOSE YOUR ROLE',
  '跳过 ✕': 'Skip ✕',
  '你是造物者，还是审视者？': 'Are you the Creator, or the Seer?',
  '先告诉我们，你在这次审稿中负责什么？': 'First, tell us what you do in this review.',
  '选择身份：造物者（3D 创作者）': 'Select identity: Creator (3D Artist)',
  '大阿卡那·造物者 The Artificer': 'Major Arcana · The Artificer',
  'I · 造物者': 'I · The Artificer',
  '模型创作者': '3D Creator',
  '我制作模型，也负责发起审稿': 'I create the model and start the review',
  '进入创作者工作台 ↵': 'Enter Creator Workspace ↵',
  '选择身份：审视者（审稿客户与总监）': 'Select identity: Seer (Client & Director)',
  '大阿卡那·审视者 The Seer': 'Major Arcana · The Seer',
  'II · 审视者': 'II · The Seer',
  '客户、负责人或团队审稿人': 'Client, lead, or team reviewer',
  '我负责查看模型并提出修改意见': 'I review the model and leave feedback',
  '进入审稿视角 ↵': 'Enter Review View ↵',

  /* hero review pins */
  '耳朵这圈布线，比我的周报还乱': 'This ear loop is messier than my weekly report',
  '减两段再发，别让拓扑背锅。': 'Relax two loops before sending — do not let the topology take the blame.',
  '王工': 'Wang',
  '眼睛瞪这么大，看见 Deadline 了？': 'Eyes this wide — can you see the deadline?',
  '换 3 号灰模，帮它先冷静一下。': 'Switch to gray #3 and help it calm down.',
  '李监制': 'Li',
  '这个下巴弧度，天生的表情包圣体': 'That chin curve is a born meme material',
  '建议原样保留，谁都别动它。': 'Keep it exactly as is — nobody touch it.',
  '阿烟': 'Yan',
  '地面反光差点晃瞎甲方': 'The ground glare nearly blinded the client',
  '粗糙度拉满，反射压一半。': 'Roughness to max, reflections cut in half.',
  '耳朵后面穿模了': 'Clipping behind the ear',
  '小键盘 . 过来看——就这，一模一眼。': 'Press Numpad . and look — there it is, plain as day.',
  '主光已按 01 号批注调整 ✓': 'Key light adjusted per comment #01 ✓',
  '现在照的是颧骨，不是天灵盖。': 'It lights the cheekbone now, not the crown of the head.',
  '已按 02 号批注换灰模 ✓': 'Switched to gray per comment #02 ✓',
  '这回的眼睛终于不像欠薪的。': 'The eyes finally do not look unpaid.',
  '已解决': 'Resolved',
  '待处理': 'Open',
  '查看与批注': 'View & comment',
  '仅查看': 'View only',
  '我': 'Me',
  'GitHub 仓库': 'GitHub repository',
  '切换到 English': 'Switch to 中文',

  /* interactive demo copy (injected after boot) */
  '由本机 Blender 转换': 'Convert via local Blender',
  '处理中…': 'Processing…',
  '已发布 · 审稿凭证已生成': 'Published · review credential generated',
  '已复制': 'Copied',
  '复制链接': 'Copy link',
  '复制这条演示链接：': 'Copy this demo link:',
  '已收到链接 · 点「前往」打开': 'Link received · press Go to open',
  '未找到该分享——试试下面的演示链接。': 'Share not found — try the demo link below.',
  '正在验证口令…': 'Verifying passphrase…',
  '口令通过 · 正在载入模型…': 'Passphrase accepted · loading model…',
  '模型已载入 · 拖拽旋转，滚轮缩放': 'Model loaded · drag to orbit, scroll to zoom',
  '重开': 'Reopen',
  '解决': 'Resolve',
  'Monkey_Head · 李监制': 'Monkey_Head · Li',
  'Monkey_Head · 阿烟': 'Monkey_Head · Yan',
  'Monkey_Head · 我': 'Monkey_Head · Me',

  /* hero */
  'Blender 风格 3D 审稿': 'Blender-style 3D review',
  '原始工程，': 'Your source file,',
  '不出本机': 'never leaves your machine',
  '。': '.',
  '打开链接，': 'Open a link,',
  '就能看模型': 'start reviewing',
  '就能审稿': 'start reviewing',
  '打开链接，\n就能看模型': 'Open a link,\nstart reviewing',
  '打开链接，\n就能审稿': 'Open a link,\nstart reviewing',
  '再也不用，': 'No more',
  '截图发来发去了': 'sending screenshots back and forth',
  '再也不用，\n截图发来发去了': 'No more\nsending screenshots back and forth',
  '在浏览器里就地转成 GLB，复杂文件才回退到你本机的 Blender；云端只接收派生后的模型与清单。 审稿的人打开一条链接就能查看、能在模型表面写批注——不需要安装 Blender。':
    'is converted to GLB right in the browser — only complex files fall back to the Blender on your own machine, and the cloud only ever receives the derived model and manifest. Reviewers open one link to inspect and annotate on the model surface. No Blender install required.',
  '客户不装 Blender，打开链接就能查看模型并写批注。上传方只需处理 .blend 转换，原件永不离开本机。':
    'Clients skip the Blender install — open a link to view the model and leave comments. Uploaders convert .blend locally; the source never leaves your machine.',
  '客户视角 · 立即体验审批': 'Try as reviewer · view & annotate',
  '我是上传方 · 选择 .blend 转换': "I'm uploading · convert .blend",
  '我是创作者': "I'm a creator",
  '我是客户': "I'm a client",
  '创作者 · 3D 审稿': 'Creator · 3D review',
  '客户 · 3D 审稿': 'Reviewer · 3D review',
  '一个链接发给客户，模型直接在浏览器里转。原件从头到尾留在你电脑上，云端拿不走。客户的批注直接落在模型上，你也能标注回复，意见闭环不用再来回截图。':
    "Send one link to your client — the model loads directly in the browser. Your source file stays on your machine; the cloud never gets it. Their comments land right on the model, and you can reply with your own pins — feedback closes the loop without screenshots.",
  '不用装 Blender，不用装任何东西。哪里不满意直接点在模型上，批注钉在准确的位置，不用再截图圈来圈去。':
    "No Blender, no installs. Click exactly where it bothers you — pins land on the spot, no more screenshot-and-circle.",
  '审稿凭证': 'Review credential',
  '配置权限 · 设置有效期 · 复制链接': 'Set permissions · configure expiry · copy link',
  '分享凭证。': 'Share credential.',
  '权限、有效期、密码都在这里定，发出之后随时可以撤销。':
    'Set permission, expiry and password here — revocable anytime after you send it.',
  '快速上手': 'Quick start',
  '3 步搞定审稿': 'Review in 3 steps',
  '从上传到客户收到链接，整个过程不超过一分钟。':
    'From upload to client link — under one minute.',
  '选择 .blend': 'Choose .blend',
  '浏览器就地转换，原件不出本机': 'Convert in-browser, source stays local',
  '配置凭证': 'Configure credential',
  '权限、有效期、密码，随时可撤销': 'Permission, expiry, password — revocable anytime',
  '发给客户': 'Send to client',
  '一条链接 · 客户的批注直接落在模型上，你也能标注回复':
    'One link · their comments land on the model, and you can reply with pins of your own',
  '打开链接': 'Open the link',
  '不用装 Blender，不用装任何东西': 'No Blender, no installs',
  '口令验证': 'Passphrase check',
  '输入对方给的口令，一键进入': "Enter the passphrase, you're in",
  '查看 + 批注': 'View + comment',
  '中键旋转，点击模型表面写批注': 'Middle-drag to orbit, click to annotate',
  '点击选择 .blend 文件': 'Click to choose .blend file',
  '仅接受 .blend · 文件不会上传': '.blend only · file is never uploaded',
  '立即体验': 'Try it now',
  '上传我的 .blend': 'Upload my .blend',
  '预览客户看到的画面': "Preview what your client sees",
  '源文件不出本机 · 一条链接搞定审稿 · 你也能在模型上批注回复':
    'Source stays local · one link to review · reply right on the model',
  '零安装 · 链接直达 · 点击模型写批注':
    'Zero installs · one link away · click the model to comment',
  '原件永不上传 · 客户只需一条链接 · 支持批注与解决闭环':
    'Source stays local · one link for reviewers · comment & resolve loop',
  '共享空间，大家共用': 'shared pool, capped at 5 GiB',
  '到期自动清空，一件不留': 'auto-cleaned after 48 h, nothing kept',
  '服务器硬拒 .blend，想绕也绕不过': 'server rejects .blend at HTTP 415, no exceptions',
  '注册和审稿都不收费': 'registration and review are free',
  '中键旋转 · 点击模型表面添加批注 · 右侧可解决/重开':
    'Middle-drag orbit · click surface to annotate · resolve / reopen on the right',
  '单指旋转 · 点击模型表面添加批注':
    'One-finger orbit · tap surface to annotate',
  '打开线上站点': 'Open the live site',
  '登录注册': 'Sign in',
  '公益存储池': 'public storage pool',
  '48 小时': '48 h',
  '自动清理': 'auto cleanup',
  '拒绝源文件': 'rejects source files',
  '0 元': '$0',
  '免费使用': 'to use',
  '实体': 'Solid',
  '审稿中': 'In review',
  '已批示': 'Resolved',
  'Suzanne · 演示模型': 'Suzanne · demo model',
  '中键旋转 · Shift+中键平移 · 滚轮缩放': 'Middle-drag orbit · Shift+middle pan · scroll zoom',
  '单指旋转 · 双指缩放平移': 'One-finger orbit · pinch zoom & pan',
  '线上审稿视口即此观感 ·': 'The live review viewport looks exactly like this ·',
  '演示视口：Suzanne 模型，可拖拽旋转': 'Demo viewport: Suzanne, drag to orbit',
  '演示状态': 'Demo states',

  /* card 01 — pain */
  '为什么要有它': 'Why it exists',
  '把工程发出去审稿，本来不该这么别扭。': 'Sending a file out for review was never supposed to be this awkward.',
  '给客户或外包看一个模型，常见做法是把工程文件整个发过去，或者截一堆图来回传。 BlendProof 把审稿放进浏览器，同时把原始工程留在你自己的机器上。':
    'To show a model to a client or contractor, the usual move is shipping the whole project file — or trading screenshots back and forth. BlendProof moves the review into the browser while your source project stays on your own machine.',
  '给客户或外包看模型，常见做法是甩工程文件或截图来回传。BlendProof 把审稿搬进浏览器，原始工程留在你自己机器上。':
    'To show a model to a client or contractor, you usually ship the project file or trade screenshots. BlendProof moves the review into the browser; your source stays on your machine.',
  '旧做法': 'The old way',
  '对方得先装 Blender': 'They must install Blender first',
  '先甩一个 3 GB 的安装包过去，装完还可能因为版本不对打不开。':
    'You send a 3 GB installer, and after it finishes the file still may not open due to a version mismatch.',
  '悬停或回车，看 BlendProof 怎么解 →': 'Hover or press Enter to see how BlendProof fixes it →',
  '悬停或回车查看解法': 'Hover or press Enter for the fix',
  '一条链接就能看': 'One link is all it takes',
  '审稿者浏览器打开': 'Opening',
  '，模型、相机角度、显示模式按发送方保存的状态还原。':
    " in the reviewer's browser restores the model, camera angles and display mode exactly as the sender saved them.",
  '工程文件整个外发': 'The whole project goes out',
  '未发布的资产、贴图、路径全都在里面，发出去就收不回来。':
    'Unpublished assets, textures and local paths are all inside — once sent, they cannot be recalled.',
  '只发出裁剪后的模型': 'Only a trimmed model goes out',
  '原始': 'The source',
  '只交给本机的转换进程，云端拿到的是 GLB、去敏后的清单和可选缩略图。':
    ' only ever reaches the local converter; the cloud gets a GLB, a sanitized manifest and an optional thumbnail.',
  '截图来回传，说不清位置': 'Screenshot ping-pong, vague feedback',
  '"左上角那个球再大一点"——是哪个球？哪张图？':
    '"Make that ball in the top-left bigger" — which ball? Which image?',
  '直接在模型上标': 'Annotate on the model directly',
  '批注锚定在模型表面并编号，带稳定的相机状态，对方点开就能回到你当时看的那一面。':
    'Comments anchor to the model surface with a number and a stable camera state; one click brings reviewers to exactly what you saw.',

  /* card 02 — features */
  '能力': 'Capabilities',
  '一个能真正干活的审稿台。': 'A review desk that actually works.',
  '下面这些不是功能清单，是你实际会做的事——全部在浏览器里完成，不需要装任何东西。 操作方式以 Blender 为基线，你的手不用换一套肌肉记忆。':
    "These aren't bullet points — they're things you'll actually do, entirely in the browser with nothing to install. The controls follow Blender, so your muscle memory carries over.",
  '以下不是功能清单——是你实际会做的事。全部在浏览器里完成，操作方式以 Blender 为基线，手感不用换。':
    "Not a feature list — these are things you'll actually do, all in the browser. Controls follow Blender, so your muscle memory carries over.",
  '场景集合': 'Scene Collection',
  '已选择': 'Selected',
  '产品内的 Outliner。': 'The in-product Outliner.',
  '行选中即 Blender 的 #2f5582 蓝，眼睛列可隐藏对象，小键盘 . 聚焦选中。':
    'Row selection uses the Blender #2f5582 blue, the eye column hides objects, and Numpad . frames the selection.',
  '批注': 'Comments',
  '耳根布线太硬，减两段再发': 'Ear topology is too stiff — relax two loops before sending',
  '眼睛材质换成 3 号灰模': 'Switch eye material to gray #3',
  'Eyes · 李监制': 'Eyes · Li',
  '地面反光强度偏高': 'Ground reflection is too strong',
  'Ground_Plane · 王工': 'Ground_Plane · Wang',
  '主光角度已按 01 号批注调整 ✓': 'Key light adjusted per comment #01 ✓',
  'Key_Light · 阿烟': 'Key_Light · Yan',
  '添加': 'Add',
  '在模型表面写一条批注…': 'Write a comment on the model surface…',
  '新建批注': 'New comment',
  '产品内的批注列表。': 'The in-product comment list.',
  '橙色序号锚定模型表面点，点开即回到发送方当时的相机视角。':
    'Orange numbers anchor to points on the model; clicking one returns to the exact camera the sender had.',
  '像操作 Blender 一样操作': 'Operate it like Blender',
  '中键旋转、Shift+中键平移、滚轮缩放——你在 Blender 里练出的手感原样保留，不用重新学。':
    'Middle-drag orbit, Shift+middle pan, scroll zoom — the muscle memory you built in Blender carries over untouched.',
  '线框 / 灰模 / 材质显示模式': 'Wireframe / solid / material display modes',
  '文件相机与 1 / 3 / 7 / 0 预设视角': 'File cameras and 1 / 3 / 7 / 0 view presets',
  '透视与正交投影切换': 'Perspective and orthographic toggles',
  '把场景结构随身带走': 'Take the scene graph with you',
  'Outliner 对象树照 Blender 的习惯组织，按名称或类型搜索，键盘就能选择并聚焦。':
    'The Outliner follows Blender conventions — search by name or type, select and frame from the keyboard.',
  '小键盘': 'Numpad',
  '聚焦选中对象': 'frames the selection',
  '网格与坐标轴叠加层开关': 'Grid and axis overlay toggles',
  '面板分隔条可拖拽调整': 'Draggable panel separators',
  '批注直接钉在模型上': 'Comments pin onto the model',
  '点哪儿标哪儿，编号和相机状态一起存下来；对方点开批注，就站在你当时的视角。':
    'Click anywhere to pin a comment — number and camera state are saved together, and opening it puts the reviewer in your seat.',
  '点击模型表面落点标注': 'Click the surface to place a pin',
  '点开即回到当时视角': 'Open a pin to restore that view',
  'open / resolved 轻量闭环': 'A light open / resolved loop',
  '分享的规矩你定': 'You set the sharing rules',
  '每条分享单独设权限与有效期，可选密码；发出去的链接随时可以撤销。':
    'Each share has its own permission, expiry and optional password — and any link can be revoked at any time.',
  '只读或可评论两种权限': 'Read-only or comment access',
  '可选访问密码': 'Optional access password',
  '随时撤销，到期自动失效': 'Revoke anytime; links expire on their own',
  '5 GiB 共享池': '5 GiB shared pool',
  '2.1 GiB 已用': '2.1 GiB used',
  '空间用量一目了然': 'Your usage at a glance',
  '邀请码注册后，自己的项目、有效分享和占用空间都在一个页面看得清清楚楚。':
    'After invite-code sign-up, your projects, active shares and storage footprint sit on one clear page.',
  '角色只有 admin 与 user': 'Just two roles: admin and user',
  '个人空间占用统计': 'Per-user storage accounting',
  '邀请码可撤销、可限次': 'Invite codes can be capped and revoked',
  '管理后台心里有底': 'An admin console you can trust',
  '成员用量、邀请码发放、容量与保留期阈值——全部可见可控，且有硬上限兜底。':
    'Member usage, invite issuance, capacity and retention thresholds — all visible, all controlled, with hard ceilings as the backstop.',
  '成员用量查看与停用': 'View usage, deactivate members',
  '邀请码创建、限次与撤销': 'Create, cap and revoke invites',
  '5 GiB / 48 小时内调整阈值': 'Tune thresholds within 5 GiB / 48 h',
  '复杂文件 → 本机 Blender': 'Complex → local Blender',
  '不装 bridge 也能转': 'Convert without the bridge',
  '浏览器优先在页面内解析受支持的静态': 'The browser first parses supported static',
  '；超出范围的文件自动回退到你本机的 Blender，流程不中断。':
    ' files in-page; anything out of scope falls back to the Blender on your machine without interrupting the flow.',
  '静态 Mesh、相机、基础材质': 'Static meshes, cameras, basic materials',
  '已评估的 Mirror / Array Modifier': 'Evaluated Mirror / Array modifiers',
  '回退路径保证复杂文件也能用': 'The fallback path keeps complex files working',
  '新批注有人回音': 'New comments get heard',
  '项目作者每 15 秒检查一次新批注，右侧显示未读数量与站内提示——不必额外部署实时服务。':
    'The project owner polls for new comments every 15 seconds and sees an unread badge and in-app notice — no extra realtime service to deploy.',
  '未读数量角标': 'Unread count badge',
  '点开直达那条批注': 'Click through to the comment',
  '轻量轮询，不引入新依赖': 'Light polling, no new dependencies',

  /* card 03 — boundary */
  '信任边界': 'Trust boundary',
  '你的工程文件，云端拿不到。': 'Your project file never reaches the cloud.',
  '服务器只收两样东西：转换后的展示模型，和一份「怎么摆、怎么转」的小清单。 你的':
    'The server accepts exactly two things: the converted display model and a small manifest of "how it sits, how it turns". Your',
  '原件——没发布的资产、贴图、工程结构——从头到尾都留在你自己的电脑上。 这不是隐私条款里的措辞：真把':
    ' — unpublished assets, textures, project structure — stays on your machine from start to finish. This is not privacy-policy wording: actually send a',
  '传过来，服务器门口直接弹回 415，想绕都绕不过去。':
    ' and the server bounces it at the door with HTTP 415. There is no way around it.',
  '服务器只收两样东西：转换后的展示模型，和一份「怎么摆、怎么转」的小清单。你的':
    'The server accepts exactly two things: the converted display model and a small manifest. Your',
  '原件从头到尾留在自己电脑上——真传过来，服务器直接 415 弹回，想绕也绕不过。':
    ' source stays on your machine — send a .blend and the server bounces it with HTTP 415, no exceptions.',
  '你的电脑': 'Your computer',
  '没拿走的：你的原件': 'What stays: your originals',
  '文件不会离开你的电脑': 'The .blend never leaves your computer',
  '浏览器在页面里直接读取转换；复杂文件才回退到你本机的 Blender':
    'The browser reads and converts in-page; only complex files fall back to your local Blender',
  '云端从头到尾没见过这个文件': 'The cloud never sees this file',
  '拒绝': 'rejected',
  '服务器': 'Server',
  '拿走的：只有能看的': 'What leaves: only the viewable',
  '转换后的轻量模型，打开就能转': 'A lightweight converted model, orbit-ready on open',
  '一份小清单：怎么摆、怎么转、怎么标': 'A small manifest: placement, camera, annotations',
  '上传工作台': 'Upload workbench',
  '浏览器直转 · 复杂文件回退本机': 'In-browser conversion · complex files fall back locally',
  '点击选择 .blend 文件，浏览器就地转换': 'Pick a .blend — the browser converts it in place',
  '12.4 MB · 场景 Scene · 7 个对象': '12.4 MB · scene Scene · 7 objects',
  '开始转换': 'Start conversion',
  '浏览器转换': 'Browser conversion',
  '页面内解析，必要时调用本机 Blender': 'Parsed in-page; local Blender when needed',
  '上传派生资产': 'Upload derived assets',
  '发布审稿': 'Publish for review',
  '生成分享凭证': 'Issue the share credential',
  '产品内的上传工作台。': 'The in-product upload workbench.',
  '整个流程里 scene.blend 都不会被上传到云端：浏览器在页面内解析，复杂文件才交给本机 Blender；发出去的始终是派生资产。':
    'At no point does scene.blend get uploaded: the browser parses in-page, complex files go to your local Blender, and only derived assets are ever sent.',

  /* card 04/05 — share */
  '发出分享': 'Create a share',
  '配置一张审稿凭证。': 'Configure a review credential.',
  '上一步生成的审稿凭证，权限、有效期、密码都在这里定，发出之后随时可以撤销。':
    'Permission, expiry and password for the credential you just generated are set here — and it stays revocable after you send it.',
  '可评论': 'Can comment',
  '只读': 'Read-only',
  '密码': 'Password',
  '权限': 'Permission',
  '到期': 'Expiry',
  '24 小时后': 'in 24 hours',
  '已设置': 'Set',
  '无': 'None',
  '打开检查': 'Open to verify',
  'chips 切换会实时改写明细，并同步到右边接收方的通行证。码框里的':
    'The chips rewrite the details live and sync to the receiver pass on the right. The',
  '是': 'in the code box is a',
  '真实可开': 'genuinely openable',
  '的公开演示（口令': 'public demo (passphrase',
  '），现在就能在别的电脑上验证。': ') — verify it from another machine right now.',
  '读取分享': 'Open a share',
  '对方打开链接，看到的是这个。': "This is what the reviewer sees.",
  '这就是审稿者的浏览器：输入链接、通过口令，模型就地载入——复用的正是上方那只猴头。':
    "This is the reviewer's browser: enter the link, pass the check, and the model loads in place — reusing the very monkey head above.",
  '输入链接、通过口令，模型就地载入——复用的正是上方那只猴头。':
    'Enter the link, pass the check, and the model loads in place — reusing the very monkey head above.',
  '前往': 'Go',
  '输入分享链接，或': 'Enter a share link, or',
  '填入演示链接 /s/suzanne': 'Fill in the demo link /s/suzanne',
  '打开后会自动通过口令并载入模型': 'The passphrase auto-fills and the model loads',
  '口令已自动填充': 'Passphrase auto-filled',
  '打开审稿': 'Open review',
  '收到一条审稿链接': 'You received a review link',
  '分享链接': 'Share link',
  '输入分享链接，如 blendproof.itycon.cn/s/suzanne': 'Enter a share link, e.g. blendproof.itycon.cn/s/suzanne',
  '试试点「填入演示链接」——口令自动通过，模型载入。左边改权限，这张通行证的明细会跟着变。':
    'Try "Fill in the demo link" — the passphrase passes and the model loads. Change permissions on the left and this pass follows along.',
  '口令': 'Passphrase',
  // Pain cards — reviewer voice
  '看一次 3D 模型，': 'Reviewing a 3D model —',
  '凭什么要装一套 Blender。': 'why should you install Blender first.',
  '对方甩来一个 .blend 你打不开，发来的截图又说不清位置。BlendProof 让你点开链接就能转模型，哪里不满意直接点在模型上。':
    "They send a .blend you can't open, then screenshots that never say where. BlendProof opens the model in your browser — click exactly where it bothers you.",
  '先让我装个 3 GB 的软件': 'First, install 3 GB of software',
  '为了看一眼模型先装 Blender，装完还可能因为版本不对打不开。':
    "Install Blender just to look at a model — and it may still fail over a version mismatch.",
  '链接一点就开': 'One click, the link just opens',
  '浏览器直接打开，模型、相机角度、显示模式都替你还原好，零安装、零学习。':
    'Opens straight in the browser with camera angles and shading already set up. Zero installs, zero learning.',
  '发来的文件我打不开': "The file they sent won't open",
  '.blend 双击没反应，让对方导出又多等一轮，来回都是时间。':
    'Double-click the .blend and nothing happens; asking for an export costs another round of waiting.',
  '打开就是能转的模型': 'It opens as a model you can orbit',
  '分享链接里的模型已经是浏览器格式，加载即看，不用等任何人导出。':
    'The shared model is already browser-ready — load and look, no waiting for anyone to export.',
  '截图圈半天，说不清在哪': 'Circling screenshots, never clear where',
  '"左边那个球大一点"——哪个左边？模型一转又对不上了。':
    '"Make the ball on the left bigger" — which left? The moment the model turns, it no longer matches.',
  '点在模型上，位置不会错': 'Pin it on the model, spot on',
  '你的批注钉在模型表面并带编号，对方点开就回到你当时看的视角，不用来回确认。':
    'Your comments anchor to the model surface with numbers; opening one brings back your exact view. No back-and-forth.',
  // Annotation-loop illustration (reviewer)
  '你在模型上点一下': 'Click anywhere on the model',
  '批注钉在准确位置': 'The pin lands exactly there',
  '对方解决并回信': 'They resolve and reply',
  '"左边那个球大一点"': '"Make the ball on the left bigger"',
  '左边那个球…': 'The ball on the left…',
  '王工 · #1': 'Wang · #1',
  '待解决': 'Open',
  '已解决 ✓': 'Resolved ✓',
  '你点的每一针，都会变成对方模型上的待办。':
    'Every pin you drop becomes a to-do on their model.',

  /* card 06 — public pool */
  '公益性质': 'Public good',
  '一个不打算收费的存储池。': 'A storage pool that does not intend to charge.',
  'BlendProof 更像一个': 'BlendProof works more like a',
  '审稿件的临时快递柜': 'temporary parcel locker for review files',
  '：包裹只在转运期间被持有，到期自动清空， 全程无人开箱查看。它目前是个人维护的公益项目，不做付费档位，也不靠留存用户数据运营。':
    ': parcels are held only in transit, auto-purged on expiry, and nobody opens the box along the way. It is a personally maintained public-good project — no paid tiers, and it does not run on retained user data.',
  '：包裹到期自动清空，全程无人开箱。个人维护的公益项目，不做付费档位。':
    ': parcels are auto-purged on expiry, nobody opens the box. A personally maintained public-good project with no paid tiers.',
  '免费使用。': 'Free to use.',
  '注册与审稿都不收费，也没有付费解锁的功能。': 'Sign-up and review cost nothing, and no features sit behind a paywall.',
  '5 GiB 共享容量。': '5 GiB shared capacity.',
  '所有用户共用一个总量上限，用完即止，不超额透支。': 'All users share one total ceiling — when it is full, it is full. No overdraft.',
  '到期自动清理。': 'Automatic expiry cleanup.',
  '项目最长保留 48 小时，分享默认 24 小时，每小时定时任务按精确 key 删除。':
    'Projects live at most 48 hours, shares default to 24, and an hourly job deletes by exact key.',
  '上限优先于便利。': 'Ceilings before convenience.',
  '容量与保留期被硬约束保护，管理员只能在 5 GiB / 48 小时内调低，不能调高。':
    'Capacity and retention are hard-bounded; admins can only tune them downward within 5 GiB / 48 h, never up.',
  '邀请码注册。': 'Invite-code sign-up.',
  '不开放自由注册，是为了让容量和清理节奏可控——这是公益池能长期跑下去的前提。':
    'Open registration stays closed so capacity and cleanup pacing remain predictable — the precondition for a public pool to keep running.',
  '不看你的内容。': 'Your content stays unseen.',
  '服务端只转发派生资产，没有人工查看环节；日志只记操作，不看模型。':
    'The server only relays derived assets, with no human inspection step; logs record operations, never models.',
  '开源，可自行部署。': 'Open source, self-hostable.',
  '不放心公益池？': 'Not sure about the public pool?',
  '代码全部公开': 'The code is fully public',
  '，可以自己搭一套一模一样的。': ' — you can stand up an identical copy yourself.',

  /* card 07 — live status */
  '运行状态': 'Live status',
  '平台此刻的真实状态。': 'The platform as it is right now.',
  '以下数据直接来自生产接口': 'The figures below come straight from the production endpoint',
  '，随页面加载实时读取，不做缓存包装。 项目刚上线，累计用量从零开始增长。':
    ', read live on page load with no cache dressing. The project just launched — cumulative usage is growing from zero.',
  '，随页面加载实时读取，不缓存。':
    ', read live on page load with no caching.',
  '服务状态': 'Service',
  '未读取': 'Not read',
  '跨域或网络受限': 'CORS or network restricted',
  '已运行': 'Uptime',
  '自 2026-09-12 上线': 'online since 2026-09-12',
  '公益池': 'Public pool',
  '共享容量上限': 'shared capacity ceiling',
  '当前项目': 'Projects',
  '— 条活跃分享': '— active shares',
  '累计处理': 'Processed',
  '已清理': 'Cleaned up',
  '到期资产自动删除': 'expired assets auto-deleted',
  '正在读取实时数据……': 'Reading live data…',
  '运行中': 'Running',
  '部分可用': 'Partially available',
  '检测中': 'Checking',
  '读取 /api/health': 'reading /api/health',
  '无法连接生产接口（跨域或网络受限），实时数据仅在线上站点可见。':
    'Cannot reach the production API (CORS or network restricted) — live data is only visible on the live site.',

  /* card 08 — stack & scope */
  '技术栈与支持范围': 'Stack & scope',
  '它是怎么工作的，以及能覆盖多少。': 'How it works, and how far it reaches.',
  '没有魔法——就是浏览器的标准能力、Blender 的官方能力和一层薄薄的服务端。免安装路径覆盖静态场景，复杂文件自动回退本机 Blender。项目开源，每一行都欢迎审阅。':
    'No magic — just standard browser capabilities, official Blender capabilities, and a thin server layer. The install-free path covers static scenes; complex files fall back to your local Blender automatically. The project is open source — audit every line.',
  '没有魔法——浏览器标准能力 + Blender 官方能力 + 一层薄服务端。免安装路径覆盖静态场景，复杂文件自动回退本机 Blender。':
    'No magic — standard browser APIs + official Blender capabilities + a thin server layer. The install-free path covers static scenes; complex files fall back to your local Blender.',
  '前端': 'Frontend',
  '转换': 'Conversion',
  '浏览器解析优先 · 复杂回退本机 Blender': 'In-browser parsing first · complex files fall back locally',
  '服务端': 'Backend',
  'Cloudflare Workers · D1 · R2 · 每小时 cron 清理': 'Cloudflare Workers · D1 · R2 · hourly cleanup cron',
  '本地桥接': 'Local bridge',
  'Node 22 · Express · 仅监听 loopback': 'Node 22 · Express · loopback only',
  '浏览器优先转换。': 'Browser-first conversion.',
  '页面内直接解析受支持的': 'Supported',
  '；不支持的文件回退到你本机的 Blender 导出 GLB 与清单。原件不参与任何网络传输。':
    ' files are parsed in-page; unsupported files fall back to the Blender on your machine to export the GLB and manifest. Originals never touch the network.',
  '受控上传。': 'Controlled uploads.',
  '只有派生资产被推到云端，415 硬门槛挡住一切工程原件。':
    'Only derived assets reach the cloud; a hard 415 gate stops every project original.',
  '凭证分享。': 'Credential sharing.',
  '一条带权限与有效期的链接，对方浏览器直接渲染，无需安装。':
    'One link with permission and expiry; the other side renders it in their browser, no install.',
  '到期清空。': 'Purged on expiry.',
  '每小时定时任务按精确 key 删除过期资产，不做长期留存。':
    'An hourly job deletes expired assets by exact key — no long-term retention.',
  '转换为 GLB：留下什么，丢掉什么': 'GLB conversion: what survives, what is lost',
  '转换后能看到': 'Survives conversion',
  '修改器求值后的网格与拓扑': 'Meshes and topology after modifier evaluation',
  '对象层级、名称与集合结构': 'Object hierarchy, names and collections',
  'PBR 材质基础属性（基础色 / 粗糙度 / 金属度 / 贴图）': 'Core PBR properties (base color / roughness / metallic / textures)',
  '场景相机与灯光': 'Scene cameras and lights',
  '动画与骨骼绑定（经本机 Blender 导出时）': 'Animation and armatures (via local Blender export)',
  'GLB 带不走': 'Lost in conversion',
  '物理、粒子、流体、布料等模拟': 'Physics, particles, fluids, cloth and other simulations',
  '程序化节点的可调参数——几何节点只留烘焙结果': 'Adjustable procedural parameters — geometry nodes keep only baked results',
  '合成器 / 世界节点与后期效果': 'Compositor / world nodes and post effects',
  'Blender 专有着色，以及 Cycles / Eevee 的像素级观感': 'Blender-specific shading and the pixel-level Cycles / Eevee look',
  '插件数据、链接库与工程内部结构': 'Add-on data, linked libraries and internal project structure',
  '两条转换路径，能力不同。': 'Two conversion paths, different capabilities.',
  '浏览器直转只覆盖静态网格子集，材质按首材质近似；需要动画、骨骼或完整着色时会自动回退到你本机的 Blender 导出。无论哪条路径，审稿者看到的都是':
    'In-browser conversion covers only the static-mesh subset and approximates materials by the first slot; animation, armatures or full shading fall back to your local Blender automatically. On either path, reviewers see the',
  '转换后的展示模型': 'converted display model',
  '，不是 Blender 里的实时画面。': ', not a live Blender render.',

  /* legal */
  '隐私政策': 'Privacy Policy',
  '服务条款': 'Terms of Service',
  '关闭': 'Close',
  '数据处理范围': 'Scope of data processing',
  '文件仅在浏览器页面内或您本机的 Blender bridge 中读取和转换，不会上传至 BlendProof 云端。您确认发布后，云端仅保存用于审阅的轻量 GLB、裁剪后的 manifest、可选缩略图、分享设置和批注。':
    'Raw .blend files are read and converted only inside the browser page or the Blender bridge on your own machine, and are never uploaded to the BlendProof cloud. Once you confirm publishing, the cloud stores only the lightweight GLB used for review, the trimmed manifest, an optional thumbnail, share settings and comments.',
  '账号与日志': 'Accounts and logs',
  '邀请码注册会处理邮箱、显示名称、账号角色、会话与邀请码使用记录。为保障安全、容量控制和故障排查，服务会保留必要的访问、发布、分享和清理日志。':
    'Invite-code registration processes your email, display name, account role, sessions and invite usage. For security, capacity control and troubleshooting, the service keeps necessary access, publish, share and cleanup logs.',
  '保留与删除': 'Retention and deletion',
  '普通审阅资产默认建议在 24 小时内使用，最长保留时间受平台配置限制（默认不超过 48 小时），到期后自动清理。管理员维护的公开演示模型不适用该临时保留规则。':
    'Review assets are recommended for use within 24 hours; maximum retention is bounded by platform configuration (48 hours by default) and they are cleaned up automatically on expiry. The admin-maintained public demo model is exempt from this temporary-retention rule.',
  '联系': 'Contact',
  '如需隐私相关协助，请联系': 'For privacy-related assistance, contact',
  '生效日期：2026 年 9 月 12 日': 'Effective: September 12, 2026',
  '服务定位': 'What this service is',
  'BlendProof 是轻量 3D 审阅工具，不替代 Blender、专业归档、备份或法律存证服务。分享访问者应依分享人设置的权限使用审阅内容。':
    'BlendProof is a lightweight 3D review tool. It does not replace Blender, professional archiving, backup or legal evidence services. Share visitors should use review content according to the permissions set by the sender.',
  '允许与禁止': 'Allowed and prohibited',
  '您须确保拥有上传、转换、发布和分享内容的必要权利。严禁上传或传播色情、暴力、恐怖主义、违法、侵权、恶意程序或其他可能危害他人的文件与内容。':
    'You must hold the necessary rights to upload, convert, publish and share content. Uploading or distributing pornographic, violent, terrorist, illegal, infringing, malicious or otherwise harmful files or content is strictly prohibited.',
  '账号与邀请码': 'Accounts and invite codes',
  '注册仅可使用管理员发放的邀请码。您应妥善保管账号和分享密码；管理员可基于安全、容量或违规情况撤销邀请码、停用账号或清理相关审阅资产。':
    'Registration requires an invite code issued by the admin. Safeguard your account and share passwords; the admin may revoke invite codes, deactivate accounts or clean up review assets for security, capacity or violation reasons.',
  '免责声明': 'Disclaimer',
  '用户提交、评论和分享的内容仅代表其作者，不代表 BlendProof 立场。平台在法律允许的范围内按现状提供服务，不保证临时审阅资产的永久保存或所有格式的转换结果。':
    'User-submitted comments and shared content represent their authors only, not BlendProof. The platform is provided as-is to the extent permitted by law, and does not guarantee permanent storage of temporary review assets or conversion results for every format.',
  '禁止上传色情、暴力、恐怖主义、违法或侵犯他人权益的文件与内容。 用户提交内容仅代表其作者，不代表 BlendProof 立场。':
    'Uploading pornographic, violent, terrorist, illegal or rights-infringing files or content is prohibited. User-submitted content represents its author only, not BlendProof.',

  /* footer */
  '浏览器里的 Blender 风格 3D 审稿工具。': 'A Blender-style 3D review tool in the browser.',
  '原始工程不出本机，审稿一条链接。': 'Source files never leave your machine; review is one link away.',
  '个人维护的公益项目 · 按现状提供服务 · 当前仅支持 macOS':
    'Personally maintained public-good project · provided as-is · macOS only for now',
  '探索': 'Explore',
  '线上站点': 'Live site',
  '公开演示 /s/suzanne': 'Public demo /s/suzanne',
  'GitHub 源码': 'GitHub source',
  '法律与联系': 'Legal & contact',
}

const normalize = (s: string): string => s.replace(/\s+/g, ' ').trim()

/** Translate a dynamic string. Chinese input is returned as-is when missing. */
export function t(zh: string): string {
  if (getLang() !== 'en') return zh
  return EN[normalize(zh)] ?? zh
}

/** Bilingual choice for template literals that embed values. */
export function ifEn(en: string, zh: string): string {
  return getLang() === 'en' ? en : zh
}

const ATTRS = ['title', 'aria-label', 'placeholder'] as const

/** Backups so language can toggle back and forth without losing the source. */
const textBackup = new WeakMap<Text, string>()
const attrBackup = new WeakMap<Element, Partial<Record<string, string>>>()

/**
 * Set an element's text while remembering the Chinese source, so a later
 * language switch can re-translate or restore it. Use this for any copy that
 * is injected after boot (demo status lines, annotation bubbles, …).
 */
export function setNodeText(el: HTMLElement, zh: string): void {
  const key = normalize(zh)
  el.dataset.i18nKey = key
  el.textContent = getLang() === 'en' ? (EN[key] ?? zh) : zh
}

/** Controls handled manually so their bilingual labels never get walked. */
const CONTROL_IDS = ['lang-toggle', 'theme-toggle']

/**
 * Overlay English onto the document (or restore Chinese), in place — no reload.
 * Chinese stays the no-JS / crawler view; this runs on boot and on every
 * language switch. Text nodes and elements carrying `data-i18n-key` are both
 * covered, and Chinese sources are backed up so toggling back is lossless.
 */
export function applyStaticI18n(): void {
  const en = getLang() === 'en'

  // 1. Every text node in <body>.
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  const nodes: Text[] = []
  while (walker.nextNode()) nodes.push(walker.currentNode as Text)
  for (const node of nodes) {
    if (node.parentElement?.closest(CONTROL_IDS.map((id) => `#${id}`).join(','))) continue
    const raw = node.nodeValue ?? ''
    const hasZh = /[\u4e00-\u9fff]/.test(raw)
    if (en) {
      if (!hasZh) continue
      if (!textBackup.has(node)) textBackup.set(node, raw)
      const lead = raw.slice(0, raw.length - raw.trimStart().length)
      const trail = raw.slice(raw.trimEnd().length)
      const tr = EN[normalize(raw)]
      if (tr !== undefined) node.nodeValue = `${lead}${tr}${trail}`
    } else {
      const orig = textBackup.get(node)
      if (orig !== undefined) node.nodeValue = orig
    }
  }

  // 2. Elements that opted in with data-i18n-key (dynamic content).
  document.querySelectorAll<HTMLElement>('[data-i18n-key]').forEach((el) => {
    if (el.closest(CONTROL_IDS.map((id) => `#${id}`).join(','))) return
    const key = el.dataset.i18nKey
    if (!key) return
    el.textContent = en ? (EN[key] ?? key) : key
  })

  // 3. Localizable attributes.
  document.querySelectorAll<HTMLElement>('body [title], body [aria-label], body [placeholder]').forEach((el) => {
    for (const attr of ATTRS) {
      const value = el.getAttribute(attr)
      if (!value) continue
      const norm = normalize(value)
      if (en) {
        const b = attrBackup.get(el) ?? {}
        if (b[attr] === undefined) {
          b[attr] = value
          attrBackup.set(el, b)
        }
        const tr = EN[norm]
        if (tr !== undefined) el.setAttribute(attr, tr)
      } else {
        const b = attrBackup.get(el)
        if (b && b[attr] !== undefined) el.setAttribute(attr, b[attr])
      }
    }
  })

  document.documentElement.lang = en ? 'en' : 'zh'

  // 4. The two top controls, kept out of the walker above.
  const langBtn = document.getElementById('lang-toggle')
  if (langBtn) {
    langBtn.textContent = en ? '中文' : 'EN'
    langBtn.setAttribute('aria-label', en ? 'Switch to 中文' : '切换到 English')
  }
  const themeBtn = document.getElementById('theme-toggle')
  if (themeBtn) {
    const light = document.documentElement.dataset.theme === 'light'
    const zh = light ? '☾ 暗色' : '☀ 亮色'
    themeBtn.textContent = en ? (EN[normalize(zh)] ?? zh) : zh
    themeBtn.setAttribute('aria-label', en ? 'Toggle light / dark theme' : '切换亮色 / 暗色模式')
  }
}
