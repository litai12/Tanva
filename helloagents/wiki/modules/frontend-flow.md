## 2026-06-17 Omni Flash Ext APIMart
- `omniFlashExtVideo` uses dedicated `text`, `image`, and `video` input handles. The `video` handle accepts video outputs only and is limited to one reference video.
- Runtime validation follows APIMart `omni-flash-ext`: prompt required; single-image mode accepts 1 image, reference mode accepts 1-3 images, and more than 3 images are rejected.
- Flow request assembly sends `managedModelKey=omni-flash-ext`, `referenceImages`, optional single `referenceVideos`, `aspectRatio`, `resolution`, and `videoMode`. When reference video is connected, `duration` is omitted and the run badge preview also omits duration.
- When any reference video is connected, the node UI and request path force `videoMode=reference`; frame mode is only for image-only runs. This prevents APIMart from receiving `frame` together with `video_urls`.
- Flow video failure display now formats upstream raw codes before writing them to node UI. `PUBLIC_ERROR_UNDERSPECIFIED_ANIMAL` becomes a localized prompt telling the user to describe the animal subject more clearly, and unknown `PUBLIC_ERROR_*` codes fall back to a localized upstream-rejected message while raw codes remain in console logs.

## 2026-06-05 Prompt Mention Stability
- Prompt `@` image mentions now treat the stored token as an anchored structured reference as long as the token text still exists, instead of requiring a trailing whitespace/token boundary. Continuing to type immediately after an inserted `@图...` token, including IME pinyin composition and ASCII suffix text, no longer removes the corresponding `data.mentions` entry or drops it from Generate runtime reference-image resolution.
- `TextPromptNode` renders selected image mentions as blue inline text with a non-layout background highlight drawn on the existing inline token, avoiding DOM or spacing changes that can drift from textarea wrapping. Selected image mentions also appear as thumbnail chips below the prompt input. The preview resolves thumbnails from current mention candidates first, then falls back to stored remote library URLs for project/personal assets; workflow mentions resolve from downstream image-input candidates in the `@` picker and are stored as `flow` node/handle refs rather than remote URLs.
- Prompt mention token matching uses longest-token-first ranges across both UI sync and runtime consumption, so `@猫-2` does not also activate `@猫`; automatic typed-token candidate sync fills missing mentions only, does not overwrite existing structured refs for the same token, and skips ambiguous same-token candidates instead of guessing. Workflow candidate lookup prefers exact `nodeId + handle` refs so multi-output nodes do not show another image from the same node.
- During IME composition, `TextPromptNode` temporarily disables the transparent mention overlay and shows the real textarea text. This keeps pinyin/Chinese input visible after an existing `@` image reference, then restores the blue inline mention rendering when composition ends.
- Project-library and personal-library `@` menu refreshes use a short list-request timeout and ref-backed in-flight guards. Existing candidate images remain selectable while a refresh is running, with only a small refreshing status shown; failed refresh attempts are throttled so the menu falls back to cached/local candidates or the empty state instead of repeatedly showing `加载中...`.
- Flow video Run paths now read active Prompt image mentions as virtual image inputs. Existing image edges keep priority; Prompt `@` images fill empty first/last-frame slots or append to reference-image lists, and the request prompt includes an explicit token-to-reference-image mapping when those mentions are used.

## 2026-06-05 HTML PPT Wheel Handling
- HTML PPT node internals no longer stop wheel propagation ahead of the shared Flow canvas wheel handler. The slide rail, style panel, code editor area, and prompt area now let canvas wheel zoom handling prevent browser page zoom while retaining the existing native-scroll rules for non-zoom wheel gestures.
- HTML PPT Run no longer performs an automatic generated-visual pre-pass. The node still prepares connected upstream images as remote assets where possible, then sends a single final text-chat rewrite request for slide/deck layout.

## 2026-06-04 Generate Auto Aspect
- Flow image generation nodes keep the Aspect selector's `Auto` value as an omitted `aspectRatio` during Run. Explicit aspect ratios are still passed through for all Generate tiers, including Fast (`banana-2.5`); Fast no longer silently clears a user-selected ratio.
- When Auto is used with image inputs, Flow now detects the first input image's natural dimensions and sends the nearest supported aspect ratio, so reference-image generate/edit/blend runs follow the source image shape instead of relying on an upstream square default.
- The backend new-api image provider no longer turns an omitted text-only aspect ratio into `1:1`, so Auto can be decided by the upstream model instead of being forced square.

## 2026-06-03 HTML PPT Node
- Flow now has an `htmlPpt` node for multi-slide HTML/CSS presentations. The node stores a deck of slide fragments, supports preview/code modes, slide add/duplicate/delete/revert controls, and exports the whole deck as a standalone HTML file.
- The node accepts upstream `text` input as edit context and can call the text model route from its Ultra button to rewrite only the currently selected slide.
- The node also accepts upstream `img` inputs. During Run it prepares connected images as remote assets where possible, sends them through the text-chat multimodal request, and instructs Ultra to infer semantic intent, choose each image's role, and place embeddable image URLs into the slide/deck layout instead of merely describing the images.
- The node does not auto-generate missing hero, background, illustration, poster, or similar visual assets. Those visuals should come from connected upstream image inputs, project/personal library assets, or user uploads before the PPT Run.
- Style preset data (`htmlPptStylePresets.ts`) remains for backward compatibility with existing nodes, but the visible Style panel focuses on the real `Bold 34` HTML template starters instead of mixing generated style-only previews with upstream templates.
- The Style panel also includes a `Bold 34` tab. `htmlPptBoldTemplates.ts` maps the 34 `zarazhangrui/beautiful-html-templates` entries to Tanva-safe structured metadata, including the shared `author:zarazhangrui` tag, while `htmlPptBeautifulTemplateDecks.ts` stores converted static starter decks from the upstream `template.html` files. Gallery tiles render the README-selected real template pages with an author chip, and applying one replaces the current deck with the converted 1920x1080 starter slides.
- Full HTML documents returned by AI or template-like prompts are not persisted directly. The node extracts safe slide bodies and style blocks into internal `HtmlPptDeck`/`HtmlPptSlide` fragments, strips document/runtime tags such as scripts/iframes/base, and then runs the same HTML PPT safety validation.
- The exported HTML deck now renders as a vertically paginated document with visible slide gaps, page numbers, scroll snapping, and print page breaks so the downloaded file reads like a real PPT deck instead of a single-slide viewer.
- Export uses a fixed design canvas (`1920x1080` for 16:9, `1440x1080` for 4:3) and scales each entire slide page to the viewport. This keeps imported HTML template typography and layout consistent between node preview and downloaded HTML.
- The node preview iframe, slide thumbnails, and style tiles use the same fixed design canvas scaling, measured from the preview frame when needed. The iframe viewport stays at the design canvas size and the whole iframe is scaled inside a dark centered viewer, so preview wrapping matches the exported HTML deck.
- Slide previews render inside an inert sandboxed iframe with scripts disabled. Manual and AI-generated slide code is validated to reject scripts, event handlers, `javascript:`, iframes/objects/embeds/base tags, and `data:`/`blob:`/base64 image references so design JSON persists only remote URLs/paths.
- The node now includes a thumbnail slide rail, template insertion menu, `16:9`/`4:3` aspect-ratio switch, title/notes editing in code mode, and a `Slide`/`Deck` AI rewrite scope so Ultra can either patch the current page or return a validated full-deck JSON replacement.
- The layout uses a wider default size, keeps `Run` in the top-right header, groups all presentation controls into one toolbar row, and keeps the slide rail as a fixed-height internal scroller with fixed thumbnail tiles and truncated titles so long decks do not stretch the node.

## 2026-06-03 Prompt Mention Image Sources
- `TextPromptNode` 的 `@` 菜单支持工作流、当前项目库图片（按 `sourceProjectId` 读取 Global History）和个人库 2D 图片；当当前 Prompt 下游节点存在已连接的图片输入时，菜单会显示独立“工作流”来源，候选来自这些下游图片输入对应的当前工作流图片，保存为 `flow` 节点/句柄引用。
- Prompt 节点会把选择结果保存到结构化 `data.mentions`，文本里仍插入可读 token（如 `@图1` / `@项目图1` / `@资产1`）。已选引用在输入区渲染为带图片图标的 chip；Backspace/Delete 命中 chip 时按整个 token 删除，并同步清理对应 mention，避免隐藏引用残留。
- `FlowOverlay` 在运行 `generate` / `generate4` / `generatePro` / `generatePro4` 时，会从连接的 Prompt 节点读取仍存在于文本中的 image mentions，并与图片输入边合并、去重、按模型参考图上限截断；项目库/个人库只保存并传递远程 URL/路径引用，不把 inline 图片写入设计 JSON。

## 2026-06-03 Image Input Target Preference
- `flow:createImageNode` now accepts an optional `screenPosition` from external image inputs so drag/drop-created Image nodes can appear near the drop point; paste/upload without coordinates still falls back to the Flow viewport center.
- Workspace AI settings can route external image paste, drag/drop, and picker upload into Flow Image nodes (`imageInputTarget = "node"`). Canvas-first remains the default and keeps direct canvas insertion.

## 2026-06-03 Dense Flow MiniMap Interaction Hide
- Project opening now treats Flow's first post-hydrate paint plus an idle/stabilization window as the workspace-ready signal. `FlowOverlay` queues a paint check after initial Flow hydrate, emits project-load debug timing, and sets `projectContentStore.projectViewReady` so `/app` can keep the full-screen loading overlay visible through dense graph first render and immediate post-paint settling.
- MiniMap stays visible while idle. Flow graphs with more than 80 nodes temporarily unmount MiniMap only during pan/zoom/object movement or node drag, then restore after the interaction becomes idle.
- Dense Flow node dragging now also enters interaction soft-detail mode. During that mode the real nodes, controls, edges, and resize affordances remain rendered, while only the visible connection-handle dots are hidden.
- Image-preview-heavy nodes (`Generate`, `GeneratePro`, `Analyze`, `Image`) now use stable selector equality for connected image/crop previews, reducing unrelated rerenders from position-only Flow store updates during node drag.
- Single-node drag skips position-only derived scans for selected viewport anchors, node-removal polling cleanup, collapsed-group signatures, group preview images, and running-node detection. When no group is collapsed, `nodesForRender` reuses `nodesWithHandlers` instead of mapping every node per drag frame.

## 2026-06-03 Flow Soft Detail Prompt Title
- `TextPromptNode` title now uses the shared `.tanva-flow-node-title` marker, so dense-graph pan/zoom soft-detail mode keeps the Prompt node title visible while hiding only the visible connection-handle dots.

## 2026-06-03 Flow Selection JSON Export
- Blank-canvas context menu now exposes `导出选中节点 JSON`, dispatching `flow:export-selected-template-request` to export the currently selected Flow nodes plus only their internal edges. The export path reuses the existing Flow template serialization/image-cleanup rules, so imported partial graphs stay compatible with the current JSON import flow.

## 2026-06-03 Prompt Focus Guard
- Prompt and Prompt Pro textareas are interactive only after their node is selected. In the unselected preview state, the textarea drops `nodrag/nopan`, disables pointer/focus entry, blurs any stale focus, and lets canvas/node drag gestures pass through instead of being swallowed by the editor.
- Generate node preset-prompt input follows the same selected-only editing rule: unselected nodes render the input as a pointer-transparent preview and blur stale focus; selected nodes restore normal text editing and node-drag suppression.

## 2026-05-14 Seed3D ZIP Preview Follow-up
- Flow zoom performance: `flow-settings` v4 defaults `onlyRenderVisibleElements` to `false` again to avoid ReactFlow node remount spikes when panning/zooming into dense graphs. Automatic low-zoom hard degradation is disabled for readability; dense pan/zoom/node-drag interactions use a CSS soft-detail state that keeps real nodes, text, inputs, media previews, controls, resize affordances, and edges mounted while hiding only the visible connection-handle dots. Flow also uses bounded viewport-near remote image prewarming instead of eager-loading every canvas image, so nodes approaching the viewport are more likely to have completed image decode/texture upload without creating full-graph network and memory pressure.
- Seed3D now attempts inline preview for .zip outputs by extracting the archive client-side and loading the first previewable glb/gltf model.
- Seed3D Send remains disabled until the preview renderer has actually loaded a model, preventing blank sends.
- Seed3D download file naming now follows detected blob type / URL extension (for example .zip, .glb, .gltf) instead of always forcing .glb.

# 鍓嶇妯″潡锛欶low锛坒rontend-flow锟? 

## 2026-05-14 Update
- MiniMap now unmounts while the canvas is panning/zooming, canvas objects are moving, or a Flow node is being dragged, then restores shortly after interaction idle, reducing ReactFlow overview SVG work during high-frequency viewport updates.
- `Seed3D` 鑺傜偣鐜板湪浼氭牴鎹ā鍨?URL 鍚庣紑鍖哄垎鈥滃彲鍦ㄧ嚎棰勮鈥濅笌鈥滀粎鍙笅杞解€濓細
  - `.glb/.gltf` 缁х画璧板唴宓?Three.js 棰勮锛?  - `.zip` 涓庡叾浠栭潪棰勮鏍煎紡浼氭樉绀烘槑纭彁绀猴紙鍙笅杞戒絾涓嶅彲鍐呭祵棰勮锛夈€?- `Seed3D` 涓嬭浇鏂囦欢鍚嶆敼涓烘寜鐪熷疄璧勬簮鍚庣紑鐢熸垚锛屼笉鍐嶅浐瀹氫繚瀛樹负 `.glb`锛堥伩鍏?ZIP 缁撴灉涓嬭浇鍚庢墿灞曞悕閿欒锛夈€?- `Seed3D` 棰勮鍔犺浇澶辫触淇℃伅鏀逛负鎼哄甫鍏蜂綋閿欒鍘熷洜锛屽苟鍦ㄩ潪棰勮鏍煎紡鏃剁鐢?`Send`锛岄伩鍏嶁€滄ā鍨嬩笉鍙浣嗕粛鍙彂閫佲€濈殑璇浜や簰銆?- Flow `seedanceModel` 褰掍竴鍖栬ˉ榻?`seed-2.0-pro / seed-2.0-lite / seed-2.0-mini`锛屼笉鍐嶆妸 `pro/mini` 璇洖閫€涓?`seedance-1.5-pro`銆?- `seedVideo/seedance20Video` 杩愯璇锋眰浼氭寜鑺傜偣瀹為檯妯″瀷鍊奸€忎紶 `seedanceModel`锛岄伩鍏嶅嚭鐜扳€淯I 閫?2.0 Pro锛屽悗绔疄闄呮彁浜?1.5 Pro鈥濄€?
## 2026-05-12 Update
- `Seedream` 鑺傜偣鏂板 `modelVersion`锛坄5.0/4.5`锛夋湰鍦扮姸鎬佷笌涓嬫媺閫夋嫨锛屼粎鍦ㄨ眴鍖呴€氶亾灞曠ず銆?- 鑺傜偣浼氳皟鐢?`GET /api/ai/seedream5/provider` 鑾峰彇褰撳墠閫氶亾锛涘綋閫氶亾涓鸿鐚规椂闅愯棌妯″瀷涓嬫媺骞跺己鍒跺洖钀?`modelVersion=5.0`銆?- Flow 杩愯 `seedream5` 鏃朵細鎶?`modelVersion` 鏄犲皠鍒板搴?Model ID锛坄doubao-seedream-5-0-260128` / `doubao-seedream-4-5-251128`锛夊苟闅忚姹傚彂閫併€?
## 2026-05-07 Update
- Image 鑺傜偣鏈湴涓婁紶鎴愬姛鍚庝細涓诲姩鏂紑褰撳墠鍥剧墖杈撳叆杩炵嚎锛屽苟娓呯悊鏃?`crop`锛涢伩鍏嶈妭鐐逛粛鎸変笂娓歌繛鎺?鏃ц鍓瑙堟樉绀猴紝瀵艰嚧 `imageUrl` 宸叉槸鏂板浘浣嗙敾闈㈣繕鏄棫鍥俱€?- `鎵归噺杩炴帴杈撳嚭` 鐨勯瑙堢嚎婧愮偣鍏滃簳鏀逛负鎸夋瘡涓簮鑺傜偣鑷繁鐨勮緭鍑虹鍙ｅ垪琛ㄨ绠楋紱褰撶湡瀹?DOM 鍙ユ焺鏆備笉鍙鏃讹紝鍗曡緭鍑鸿妭鐐逛粛鍥炲埌鍙充晶杈撳嚭鍙ユ焺涓績锛屽杈撳嚭鑺傜偣鎸夋湰鑺傜偣绔彛椤哄簭鍒嗗竷锛岄伩鍏嶇敤鏁存壒杩炵嚎搴忓彿瀵艰嚧婧愮偣鍋忕Щ銆?- Flow 瑕嗙洊灞傚唴鐨勬粴杞缉鏀?骞崇Щ鐜板湪涔熶細閫氳繃 RAF 鍚堝苟鍐欏叆 canvas viewport锛岄伩鍏嶅湪瑙︽帶鏉?婊氳疆楂橀浜嬩欢涓嬫瘡涓?wheel tick 閮藉悓姝ヨЕ鍙?Canvas store銆丳aper view 涓?ReactFlow viewport 鏇存柊銆?
## 2026-05-06 Update
- Canvas 鈫?Flow 瑙嗗彛鍚屾鐜板湪浼氫紭鍏堜互褰撳墠閫変腑 Flow 鑺傜偣涓洪敋鐐癸紝鎶?ReactFlow 鐨?`x/y` 骞崇Щ鍊煎榻愬埌鐗╃悊鍍忕礌锛屽噺灏戝悓涓€缂╂斁鍊嶇巼涓嬫枃瀛椼€佸浘鏍囥€佽竟妗嗗洜鍗婂儚绱?transform 鏁翠綋鍙戣櫄銆?- Flow viewport 涓嶅啀闀挎湡璁剧疆 `will-change: transform`锛岄伩鍏嶆祻瑙堝櫒鎶婃暣灞傛枃鏈?鍥剧墖鎸佺画鍚堟垚鏍呮牸鍖栧悗鍑虹幇闈欐鎬佸彂铏氾紱瑙嗗彛鍘熺偣浠嶄繚鎸佷笌 Canvas 鍚屾鎵€闇€鐨?`transform-origin: 0 0`銆?- Flow 閫変腑杩炵嚎鐨勭孩鑹插垹闄ゆ寜閽敼涓?`pointerdown` 鍗虫淳鍙?`flow:deleteEdge`锛岀敱 `FlowOverlay` 鏈湴鍙楁帶 `edges` 鐘舵€佺粺涓€鍒犻櫎銆佹竻鐞嗘爣绛剧紪杈戝櫒骞惰Е鍙?`flow:edgesChange`锛涢伩鍏嶈嚜瀹氫箟 Edge 鐩存帴璋冪敤 ReactFlow instance setter 鏃惰鍙楁帶鐘舵€佸洖鐏屾垨 click 鎶戝埗瀵艰嚧鍒犻櫎鏃犳晥銆?- Flow 杩炵嚎鏂板 `Shift` + 鐐瑰嚮鍒犻櫎鍏ュ彛锛歚onEdgeClick` 鍦ㄦ娴嬪埌 Shift 鏃剁洿鎺ヨ蛋 `deleteFlowEdgesByIds()`锛屽鐢ㄧ幇鏈夎竟鐘舵€佹竻鐞嗐€乣flow:edgesChange` 閫氱煡涓庡巻鍙叉彁浜ゃ€?- Flow 杩炵嚎鍛戒腑鐑尯鎵╁ぇ鍒?32px锛歚CustomEdge` 灏?`BaseEdge.interactionWidth` 涓嬮檺璁句负 `32`锛屽苟鍦?CSS 涓 `.react-flow__edge-interaction` 鏄庣‘鍙備笌 `stroke` 鍛戒腑妫€娴嬶紱鎸変綇 Shift 鎮仠杩炵嚎鏃堕€氳繃 body class 鍒囨崲绾㈣壊鍑忓彿鍒犻櫎鍏夋爣锛屾彁鍗囬€変腑涓?Shift 鍒犻櫎鐨勫彲鐐规€т絾涓嶆敼鍙樿瑙夌嚎瀹姐€?- Flow 杩炵嚎鏂囧瓧缂栬緫鏂板鎵嬪姩鍙屽嚮鍏滃簳锛歚onEdgeClick` 浼氳褰曞悓涓€鏉?edge 鐨勫揩閫熶簩娆＄偣鍑诲苟鎵撳紑鏍囩缂栬緫鍣紝鍚屾椂缂栬緫鍣ㄥ畾浣嶆敼鐢ㄩ紶鏍囧弻鍑荤偣锛岄伩鍏嶇涓€娆＄偣鍑婚€変腑杩炵嚎瀵艰嚧 DOM 閲嶆覆鏌撳悗 ReactFlow 鍘熺敓 `dblclick` 涓嶈Е鍙戞垨杈撳叆妗嗕綅缃亸绉汇€?- Flow 杩炵嚎鏂囧瓧鎻愪氦淇锛氳緭鍏ユ `Enter` 鐩存帴鎸夊綋鍓嶇紪杈戝櫒鐘舵€佸啓鍥?`edge.label`锛屽苟鍦?`CustomEdge` 涓敤 `EdgeLabelRenderer` 娓叉煋宸蹭繚瀛?label锛涜緭鍏ユ浼氭嫤鎴敭鐩?榧犳爣浜嬩欢锛岄伩鍏?Flow 鍏ㄥ眬蹇嵎閿垨鐢诲竷浜や簰鎶㈣蛋鎻愪氦銆?- GPT-Image-2 Flow 鑺傜偣浠庨殣钘忛泦鍚堟仮澶嶅睍绀猴紱鑺傜偣娣诲姞闈㈡澘涓?Quick Connect 浼氶噸鏂版樉绀?`gptImage2`锛岃繍琛岄€昏緫浠嶅鐢?`Nano2Node` 鐨?GPT-Image-2 鍒嗘敮銆?- `Generate`銆乣Multi Generate`銆乣Generate Refer` 鐨?Run 鎸夐挳杩愯鎬佷繚鐣?`Run` 鏂囨锛屽彧閫氳繃绂佺敤鐏拌壊鎬佽〃杈捐繍琛屼腑锛岄伩鍏嶆寜閽樉绀?`Running...`銆?- `analysis` 鑺傜偣澶栧眰鍚嶇О缁熶竴涓?`Image Chat`锛氳妭鐐规坊鍔犻潰鏉裤€佸墠绔?fallback銆佸悗鍙板鍏ユā鏉裤€佸悗绔?NodeConfig 鍏煎杈撳嚭鍜屽洖濉潎淇濇寔鍚屽悕锛屾弿杩版枃妗堜负鈥滃浘鍍忓璇濅笌鎻愮ず璇嶆彁鍙栤€濓紝鑺傜偣绫诲瀷浠嶄繚鐣?`analysis`銆?- Image Chat 鐨?Skill 鍒楄〃鏂板 `Custom`锛氶€変腑鍚庡睍绀?IME-safe 鐨勮嚜瀹氫箟鎻愮ず璇嶈緭鍏ユ锛岃繍琛屾椂浼氭妸鑷畾涔夎緭鍏ヤ笌 `text` 鍙ユ焺杩炴帴杈撳叆鍚堝苟鍚庡彂閫併€?
## 2026-05-05 Update
- `PromptOptimizeNode` 鐨勯瑙堣緭鍏ユ琛ラ綈涓枃杈撳叆娉?composition 闃叉姢锛氭嫾闊崇粍璇嶆湡闂村彧鏇存柊鏈湴 textarea锛屽€欓€夎瘝纭鍚庡啀鍐欏洖 Flow 鑺傜偣鏁版嵁锛岄伩鍏嶆棫鑺傜偣鏁版嵁閲嶆覆鏌撴墦鏂?IME 骞剁暀涓嬫嫾闊崇墖娈点€?- Flow 鏂囧瓧杈撳叆绫?`textarea` 缁熶竴琛ラ綈 IME-safe draft 澶勭悊锛岃鐩?`TextPrompt`銆乣TextPromptPro`銆乣GeneratePro`銆乣GeneratePro4`銆乣GenerateReference`銆乣VideoAnalyze`銆乣MinimaxMusic`銆乣KlingO3` 鑷畾涔夊垎闀滅瓑鑺傜偣锛涘凡瀛樺湪闃叉姢鐨?`TextChat`銆乣TextNote`銆乣StoryboardSplit` 淇濇寔鍘熼€昏緫銆?- 鐢诲竷姗＄毊鎿﹀ Flow 杩炵嚎淇濇寔鐐瑰嚮鍛戒腑鍒犻櫎锛歚FlowOverlay` 鍦ㄦ鐨ā寮忎笅鐐瑰嚮鍒?`.react-flow__edge-path` 浼氱洿鎺ュ垹闄ゆ暣鏉?edge 骞朵繚鐣欐鐨ā寮忥紱鎷栨嫿鍒掔嚎鍒犻櫎杩炵嚎宸插彇娑堬紝绌虹櫧鐐瑰嚮浠嶆寜鍘熼€昏緫娓呮帀宸查€変腑杩炵嚎锛孎low 鑺傜偣/鍙ユ焺浜や簰缁х画璺宠繃姗＄毊鎿︾洃鍚紝淇濊瘉姝ｅ父杩炵嚎涓嶅彈褰卞搷銆?- 鐢绘澘鍙抽敭鑿滃崟鏂板 `鑺傜偣鎵撶粍 (G)`锛岄€氳繃 `flow:create-group-from-selection` 澶嶇敤 FlowOverlay 涓?`G` 蹇嵎閿殑 `createGroupFromSelection()` 閫昏緫銆?- Flow 杩炴帴鏂板鐐瑰嚮寮忓緟杩炴帴妯″紡锛氬崟鍑昏緭鍑哄彞鏌勪細杩涘叆榧犳爣璺熼殢杩炵嚎锛屽啀鍗曞嚮鐩爣杈撳叆鍙ユ焺瀹屾垚杩炴帴锛涚敾鏉垮彸閿彍鍗曟柊澧?`鎵归噺杩炴帴杈撳嚭`锛屽彲鎶婂綋鍓嶉€変腑 Flow 鑺傜偣鐨勮緭鍑虹鍙ｆ壒閲忓甫鍒伴紶鏍囷紝鍙ユ焺鏈覆鏌撴椂鎸夎妭鐐圭被鍨嬪厹搴曠敓鎴愭簮绔彛锛屽緟杩炴帴鏈熼棿閿佸畾婊氳疆/鎷栨嫿瑙嗗彛骞舵寔缁噸绠楁簮鐐瑰睆骞曚綅缃紱鎵归噺妯″紡鐐瑰嚮鐩爣鑺傜偣浼氳嚜鍔ㄥ尮閰嶅吋瀹硅緭鍏ュ彞鏌勶紝骞跺厑璁稿 Prompt 杈撳嚭鎺ュ叆 GeneratePro/TextPrompt/TextChat/Analysis 绛夊彲鍏变韩鏂囨湰杈撳叆銆?- `TextChatNode` 瀵归綈 `lt-dev9` 杞婚噺褰㈡€侊細绉婚櫎鑺傜偣鍔ㄦ€?resize / ResizeObserver / 楂橀 `updateNodeInternals`锛岃繍琛屾椂鍥哄畾 `enableWebSearch: false`锛岄伩鍏嶇户鎵垮叏灞€鑱旂綉鎼滅储鐘舵€併€?- 鑺傜偣娣诲姞闈㈡澘涓?Quick Connect 闅愯棌闆嗗悎琛ラ綈 `generateRef`銆乣sora2Video`锛岄伩鍏嶉殣钘?鏆傜紦鑺傜偣浠庡揩鎹峰叆鍙ｈ鍒涘缓銆?- 鑺傜偣娣诲姞闈㈡澘婊氳疆浜嬩欢浼氬厛鍦ㄩ潰鏉垮唴娑堣垂锛涘弽杞粴杞ā寮忎笅锛岄紶鏍囦綅浜?`.tanva-add-panel` 鍐呮椂浼樺厛婊氬姩鑺傜偣鍒楄〃锛屼笉鍐嶆妸婊氳疆浼犵粰鑳屽悗鐨?Flow 鐢诲竷缂╂斁/骞崇Щ銆?- Flow 浣庣粏鑺傛ā寮忔仮澶嶄负 Zustand 澶栭儴璁㈤槄 `canvas.zoom`锛屽彧鍦ㄨ繘鍏?閫€鍑洪槇鍊兼椂鏇存柊 React 鐘舵€侊紱鐢诲竷缂╂斁涓笖鑺傜偣鏁拌緝澶氭椂涔熶細涓存椂杩涘叆浣庣粏鑺傛ā寮忥紝FPS overlay 閲嶆柊鏍囪 `Zoom` 妯″紡銆?- FPS overlay 寮€鍏宠縼绉诲埌銆岃缃?-> 楂樼骇 -> 甯ф娴嬨€嶏紝涓嶅啀寮€鍙戠幆澧冮粯璁よ嚜鍔ㄦ墦寮€锛涙娴嬫ā寮忔柊澧?`Canvas`锛岃鐩栫┖鏍?涓敭鎷栧姩鐢诲竷涓庢粴杞?瑙︽帶鏉垮钩绉汇€?- `ImageNode` 瑁佸垏棰勮澶嶇敤鍏变韩鍥剧墖鍔犺浇缂撳瓨锛屽苟鎶婂昂瀵歌娴嬫洿鏂板悎骞跺埌 RAF锛沗ViewAngleNode` 鐨?Three.js 棰勮灏哄鍚屾涔熸敼涓?RAF 鍚堝苟锛岄伩鍏?ResizeObserver 楂橀鐩存帴瑙﹀彂娓叉煋銆?- `FlowOverlay` 鐨勮妭鐐圭粍 Alt 鎷栨嫿澶嶅埗鐜板湪鍙湪澶嶅埗寮€濮嬫椂鎵╁睍閫変腑缁勭殑 `childNodeIds`锛屼负缁勫唴瀛愯妭鐐瑰缓绔嬪厠闅?`idMap`锛屽苟閲嶅啓鍏嬮殕缁勭殑 `childNodeIds` 涓庡唴閮ㄨ竟 `sourceHandle/targetHandle`锛岄伩鍏嶅彧澶嶅埗缁勫３鎴栧鍒跺悗缁勫唴杩炵嚎鏂紑銆?- 鑺傜偣缁?P0 杩佺Щ缁х画琛ラ綈锛欴elete/Backspace 涓庡彸閿垹闄や細鎶?`nodeGroup` 鐨?`childNodeIds` 鍜岀浉鍏宠竟涓€璧风Щ闄わ紱鏅€氭嫋鎷藉湪 dragStart 缂撳瓨缁勫唴瀛愯妭鐐逛綅缃苟鎸夊揩鐓ф淳鍙戝瓙鑺傜偣浣嶇Щ锛岄伩鍏嶆嫋鎷戒腑姣忓抚閲嶅缓鑺傜偣鏄犲皠锛汧low 澶嶅埗/绮樿创浼氭墿灞曠粍閫夊尯骞跺湪绮樿创鏃堕噸鏄犲皠 `childNodeIds`銆?- Flow 鑺傜偣鍙充笂瑙掑彂閫佸埌鐢诲竷鏃朵細鍏堟妸婧愯妭鐐硅В鏋愬埌鎵€灞?`nodeGroup`锛涚粍鍐呰妭鐐瑰彂閫佸浘鐗囦細浠ョ粍鑺傜偣搴曢儴浣滀负 `anchorClient`锛屽鍥惧彂閫佷篃寮哄埗浣跨敤璇ラ敋鐐癸紝閬垮厤钀藉埌瀛愯妭鐐规涓嬫柟鎴栬鏅鸿兘瀹氫綅鏀瑰啓銆?
## 2026-05-04 Update
- `GenerationProgressBar` accepts `runKey`/`startedAt`; flow generation and video nodes pass their node id as `runKey` so simulated progress is calculated from a stable run start instead of resetting on rerender.
- `FlowOverlay` maintains `progressStartedAt` as transient runtime state for running nodes and strips it from Flow copy/template export paths so it does not persist into design JSON.
- `NodeGroupNode` supports a stop state: when a group is running, the footer button switches from Play to Square and calls `FlowOverlay.stopGroupRun`; `FlowOverlay` marks the group as stopping and skips remaining queued child nodes after the current child run resolves.
- Group nodes bypass the generic `nodesWithHandlers` cache so `groupRunning/groupStopping` and injected callbacks stay current while preserving the cache for normal nodes.
- Global History has a shared `historyMedia.ts` helper for image/video detection, labels, media URLs, video thumbnails, and download names. The history page and detail modal now render video records with thumbnails/playback; AI Chat Seedance video success records remote video URL metadata through `recordVideoHistoryEntry`.
- Image Split downstream parsing now uses the shared `imageSplitHandles` helper in Generate/Agent/ImageCompress/ImageGrid/ViewAngle paths, preserving `imageN/imgN` compatibility for crop-based inputs.
- `VideoToGifNode` shows the run credit badge, and `VideoNode` isolates native video controls with `nodrag/nopan/nowheel` plus event capture guards.
- Workspace header has a quick Nano Banana/Gemini/GPT-Image-2 route switch that updates the existing `bananaImageRoute` setting and displays today's normal/stable route success rates.
- GPT-Image-2 resolution selection supports `1K/2K/4K` on both normal and stable routes; normal route no longer hides or downgrades `2K/4K` to `1K` at run time.
- Canvas drawing tools include an `arrow` mode exposed in the toolbar; the drawing hook creates a filled Paper path tagged with `data.tool = "arrow"`, and the layer panel maps it to an Arrow layer type/icon.
- `GeneratePro4Node` now uses node-local Fast/Pro/Ultra selection (`modelProvider`) and previews run credits with the connected reference-image count capped by shared `flowModelProvider` limits.
- `TextChatNode` no longer renders the bottom web-search checkbox/status row; `AnalyzeNode` keeps `Image Chat` / `Run` / `Skill` in English while localizing helper and placeholder copy in zh mode.
- `TextChatNode` run-button credit tooltip now uses the same localized `娑堣€?绉垎` wording as image/analysis run buttons.

## 2026-04-15 Update
- Analysis node now uses node-local Fast/Pro/Ultra selection (analysisProvider) and does not change global provider state.
- Analysis node requests are forced to Banana normal route, independent from global normal/stable channel toggles.

## 2026-04-16 Update
- Generate / Agent(`generatePro`) node model switch is now node-local (`modelProvider`) and no longer mutates global `aiProvider`.
- Text Chat node now supports node-local Fast/Pro/Ultra model switch via `modelProvider`.
- Switching model in global settings or AI dialog now emits a flow-wide sync event that bulk-updates related flow nodes (`generate`, `generatePro`, `generatePro4`, `analysis`, `textChat`) to the selected tier for quick consistency.
- Analysis node model routing now aligns with Text Chat model mapping (Fast/Pro/Ultra -> text multimodal models) instead of image-generation model mapping.
- Video nodes (`Seedance/Kling/Vidu/Wan/Sora2`) no longer hard-code running progress to `30%`; they now rely on the shared `GenerationProgressBar` simulated ramp (5 minutes to 95%, then 100% on success).
- Image generation nodes (`Generate/GeneratePro/GenerateReference/Midjourney/Nano2/Seedream5/ViewAngle`) now use the same simulated progress strategy with a shorter `60s` ramp to `95%` (then `100%` on success) via `GenerationProgressBar.simulateDurationMs`.

## 2026-04-21 Update
- Fixed legacy edge reconnection on project reopen: historical `sourceHandle` values such as `image` / `image1` / `image-1` are now normalized to current ids (`img` / `img1`) during Flow edge hydration/serialization.
- Added compatibility source handle on `ImageCompressNode` so both `image` and `img` references can reconnect safely, avoiding visual 鈥渁ll edges disconnected锟?regressions in older projects after reload.

## 2026-04-17 Update
- Flow 缂╂斁浜嬩欢鍦ㄨ妭鐐硅緭鍏ユ鍦烘櫙涓嬭皟鏁翠负鈥滅缉鏀句紭鍏堚€濓細`TextPrompt/TextPromptPro/Analysis/VideoAnalysis` 锟?`textarea` 鍦ㄧ缉鏀炬墜鍔夸笅浼氭斁琛岀粰 Flow 鐢诲竷锛堟寜 `wheelZoomMode` 璁＄畻锛夛紝閬垮厤杈撳叆妗嗘崟鑾锋粴杞悗瑙﹀彂娴忚鍣ㄦ暣椤电缉鏀撅紱闈炵缉鏀炬粴杞粛淇濈暀杈撳叆鍖哄師鐢熸粴鍔拷?
- `GlobalZoomCapture` 锟?`gesturestart/gesturechange` 锟?Flow 鍖哄煙涓嶅啀鏃佽矾锛屽彲灏嗚Е鎺ф澘 pinch锛堝惈 Safari 鎵嬪娍浜嬩欢锛夋槧灏勫埌鐢诲竷缂╂斁锟?D 瑙嗗彛鍖哄煙浠嶄繚鎸佹梺璺互閬垮厤鍐茬獊锟?
- Flow 鏂板浣庣粏鑺傛覆鏌撴ā寮忥細褰撹妭鐐规暟杈惧埌闃堝€间笖缂╂斁 `<= 40%` 鏃惰嚜鍔ㄥ惎鐢紙缂╂斁鎭㈠锟?`> 45%` 鏃堕€€鍑猴紝閬垮厤闃堝€兼姈鍔級锟?
- 浣庣粏鑺傛ā寮忎笅锛岃妭鐐圭缉鐣ュ浘涓嶅啀娓叉煋鐪熷疄鍥惧儚锛歚SmartImage` 鐩存帴闄嶇骇涓虹伆鑹插崰浣嶅潡锛屼笖閮ㄥ垎瑁佸垏缂╃暐锟?`canvas`锛堝 `Image/Generate/GeneratePro/Generate4/Analyze/ImageSplit/ImageGrid`锛変篃浼氭敼涓虹伆鍧楀崰浣嶏紝浠庤€屽噺灏戠缉灏忔椂鐨勫ぇ閲忓浘鍍忛噸缁樹笌瑙ｇ爜鍘嬪姏锟?
- 浣庣粏鑺傛ā寮忎笅浼氶殣钘忔墍鏈夎繛绾夸笌 MiniMap锛堝惈鍥剧墖鍙犲姞灞傦級锛岃妭鐐逛粛淇濈暀鍘熷 UI 缁撴瀯锛屼互鍏奸【鎬ц兘涓庡彲璇绘€э拷?
- Flow 鑺傜偣澶嶅埗鐜颁細鍚屾椂璁板綍鈥滈€変腑闆嗗悎澶栭儴杩炵嚎鈥濆揩鐓э紱`Ctrl/Cmd + V` 缁х画淇濇寔浠呮仮澶嶉€変腑闆嗗悎鍐呴儴杩炵嚎锛宍Ctrl/Cmd + Shift + V` 鏂板鈥滀繚鐣欏師杩炵嚎绮樿创鈥濇ā寮忥紙浼氬皾璇曟仮澶嶅鍒惰妭鐐逛笌鐜版湁澶栭儴鑺傜偣涔嬮棿鐨勮繛绾匡級锟?
- `GeneratePro / ImagePro / GeneratePro4` 鍙抽敭鑿滃崟鈥滃鍒惰妭鐐光€濆叆鍙ｅ凡鍒囨崲涓哄啓锟?Flow 鍓创鏉匡紙涓嶅啀鐩存帴鍒涘缓鍓湰锛夛紝渚夸簬缁熶竴浣跨敤 `Ctrl/Cmd + V` / `Ctrl/Cmd + Shift + V` 鎺у埗鏄惁淇濈暀鍘熻繛绾匡拷?
- 涓哄吋瀹归儴鍒嗘祻瑙堝櫒锟?`Ctrl/Cmd + Shift + V` 涓嶇ǔ瀹氳Е锟?`paste` 浜嬩欢锛孎low 澧炲姞浜嗘寜閿眰鍏滃簳锛氬綋鍐呴儴 Flow 鍓创鏉挎湁鑺傜偣鏁版嵁鏃朵細鐩存帴鎵ц鈥滀繚鐣欒繛绾跨矘璐粹€濓拷?

## 浣滅敤
- 鎻愪緵娴佺▼/鑺傜偣缂栨帓鑳藉姏锛圧eactFlow锛夛紝骞朵笌鐢诲竷/绱犳潗/鐢熸垚绛夎兘鍔涜仈鍔拷?

## 鍏抽敭鐩綍锛堣妭閫夛級
- `frontend/src/components/flow/FlowOverlay.tsx`锛欶low 涓诲叆鍙ｏ紙浣撻噺杈冨ぇ锟?
- `frontend/src/components/flow/nodes/`锛氳妭鐐瑰疄鐜帮紙鍚繘搴︽潯銆佺敓鎴愯妭鐐圭瓑锟?
- `frontend/src/components/flow/types.ts`锛氱被鍨嬪畾锟?
- `frontend/src/components/flow/utils/`锛氳緟鍔╅€昏緫
- `frontend/src/components/flow/PersonalLibraryPanel.tsx`锛氫釜浜哄簱闈㈡澘锛堜笌鍚庣 personal-library 鐩稿叧锟?

## 鍙岃閫傞厤琛ュ厖
- `FlowOverlay` 鐨勬坊鍔犻潰鏉夸腑锛宍Templates`/`Custom` 鐩稿叧绌烘€佹枃妗堛€佹ā鏉垮崰浣嶆枃妗堛€佹ā鏉垮垎绫荤瓫閫夋爣绛惧凡缁熶竴璧板弻璇枃妗堬紱骞跺鍒嗙被锟?`鍏朵粬/Other` 鍋氭樉绀哄眰鏄犲皠锛岄伩鍏嶈嫳鏂囨ā寮忎笅鍑虹幇涓枃鍒嗙被鑺墖锟?

## 鑺傜偣鍙鎬цˉ锟?
- `FlowOverlay` 浣跨敤缁熶竴闅愯棌闆嗗悎鎺у埗鑺傜偣鍙鎬э紱褰撳墠 `sora2Video`锛圫ora 2锛夈€乣sora2Character`锛圫ora2 Character锛変笌 `nano2`锛圢ano2锛夊湪鑺傜偣娣诲姞闈㈡澘锟?Quick Connect 鍊欓€変腑榛樿闅愯棌锟?
- 鑺傜偣娣诲姞闈㈡澘鍒嗙粍涓嶈兘鐩存帴锟?`category: "input"` 瑙嗕负鈥滄枃瀛楃被鑺傜偣鈥濓紱杈撳叆鑺傜偣浠嶉渶缁х画锟?`nodeKey`/瑙ｆ瀽鍚庣殑鑺傜偣绫诲瀷缁嗗垎锟?`text / image / video / audio`锛屽惁锟?`video` 杩欑被杈撳叆鑺傜偣浼氳璇綊鍒版枃瀛楀垎缁勶拷?
- `Vidu` 瑙嗛鑳藉姏宸叉敹鎷负鍗曚竴 `viduVideo` 鍏ュ彛锛涜妭鐐瑰唴妯″瀷鍙睍锟?`Q2 / Q3` 涓ゆ。锛岄潰鏉夸笉鍐嶉澶栧睍绀哄涓悓鍝佺墝 Vidu 鑺傜偣銆傝繍琛屾椂浠呮敮锟?`vidu-q2 / vidu-q3` 涓や釜鍚庣妯″瀷锛屽苟鏍规嵁 `viduModel` 鑷姩鍒囨崲 provider銆佹椂闀夸笌鍙傝€冨浘涓婇檺锟?
- `Seedance 2.0` 鑺傜偣宸蹭粠鈥滄墜鍔ㄦā寮忓垏鎹⑩€濇敹鏁涗负鈥滄渶澶ц緭鍏ヨ兘锟?+ 鑷姩鎺ㄥ妯″紡鈥濓細鑺傜偣濮嬬粓灞曠ず `text / 9 涓浘鐗囨Ы锟?/ 灏惧抚 / video / audio` 鍙ユ焺锛岃繍琛屾椂鎸夊凡杩炴帴杈撳叆鑷姩鎺ㄥ锟?`鏂囩敓瑙嗛 / 棣栧抚 / 棣栧熬锟?/ 澶氬浘鍙傦拷?/ 瑙嗛鍙傦拷?/ 鍥剧墖+闊抽 / 鍥剧墖+瑙嗛 / 瑙嗛+闊抽 / 鍥剧墖+瑙嗛+闊抽`锛屽苟閫氳繃 `video_mode` 涓嬪彂鍒颁笂娓歌姹傦拷?
- `Seedance 2.0` 澶氬浘杈撳叆缁熶竴锟?`image-slot-*` 鍙ユ焺锛屾渶澶氭敮锟?`1-9` 寮犲弬鑰冨浘锛涙棫娴佺▼涓殑 `smart_frames` 浼氬湪鍓嶇鑷姩锟?`reference_images` 鍏煎澶勭悊锛屼笉鍐嶅崟鐙睍绀衡€滄櫤鑳藉甯р€濇ā寮忥拷?
- 鑵捐 `Kling O3` 鑺傜偣鐨勨€滆嚜瀹氫箟鍒嗛暅鈥濋潰鏉垮凡鏀逛负鎮诞寮忕礌鏉愪笂浼犱氦浜掞細鏀寔鐩存帴涓婁紶鍙傝€冨浘锟?瑙嗛锛堜笉鍐嶈姹傜敤鎴锋墜锟?URL锛夛紝杩愯鏃朵細鑷姩骞跺叆璇锋眰鍙傛暟骞舵墽琛岃吘璁晶闄愬埗鏍￠獙锛堣棰戝弬锟?`3-10s`銆佸弬鑰冨浘 `<=7`锛屾湁鍙傝€冭棰戞椂 `<=4`锛夛拷?
- 妯″瀷绠＄悊鍒犻櫎妯″瀷鍚庯紝Flow 鑺傜偣娣诲姞闈㈡澘涓嶅簲缁х画灞曠ず瀵瑰簲妯″瀷鑺傜偣锟?
  - 鍚庣鍏紑鑺傜偣鎺ュ彛鍙細浠庘€滆妭鐐圭鐞嗏€濋噷璇诲彇鑺傜偣閰嶇疆锛屽啀锟?`model_provider_mapping_v2.models[]` 杩囨护锟?`metadata.modelKeys` 鐨勬ā鍨嬭妭鐐癸拷?
  - 鍓嶇鍦ㄦ湁鍚庣鑺傜偣閰嶇疆鏃讹紝涓嶅啀鎶婅繖绫婚粯璁ゆā鍨嬭妭鐐逛綔锟?fallback 鑷姩琛ュ洖闈㈡澘锛涘悗绔笉鍙敤鏃剁殑鏈湴 fallback 涔熶笉鍐嶇‖缂栫爜杩欎簺妯″瀷娲剧敓瑙嗛鑺傜偣锟?
- 绠＄悊鍚庡彴鈥滆妭鐐圭鐞嗏€濇敮鎸佲€滀粠妯″瀷绠＄悊瀵煎叆鈥濓細
  - 瀵煎叆鍏ュ彛浼氳鍙栧綋鍓嶅姩锟?`model_provider_mapping_v2`锛屽苟鍩轰簬閫変腑鐨勬ā鍨嬭嚜鍔ㄥ垱寤轰竴鏉℃樉锟?`NodeConfig`锟?
  - 瀵煎叆鍙礋璐ｅ姞閫熷垱寤猴紱鐢诲竷鑺傜偣浠嶅彧璁よ妭鐐圭鐞嗕腑鐨勬樉寮忛厤缃紝涓嶄細琚ā鍨嬬锟?JSON 鐩存帴娲剧敓锟?
- 绠＄悊鍚庡彴鈥滅郴缁熻缃€濆悓鏃舵彁渚涗袱绉嶆ā鍨嬬鐞嗗叆鍙ｏ細
  - `缁熶竴妯″瀷绠＄悊`锛氱洿鎺ョ紪杈戝畬锟?`model_provider_mapping_v2` JSON锛屽寘鎷ā锟?鍘傚晢鍚仠銆侀粯璁ょ嚎璺€佸巶鍟嗙Н鍒嗕笌 `metadata.specPricing` 瑙勬牸绉垎瑙勫垯锛涢粯璁や細甯﹀嚭褰撳墠骞冲彴宸叉帴鍏ョ殑鍥剧墖妯″瀷锛圢ano Banana / Gemini 绯诲垪锛変笌瑙嗛妯″瀷锛屽乏渚у垪琛ㄦ敮鎸佹寜鍏抽敭瀛楀拰浠诲姟绫诲瀷绛涢€夛紝鍥剧墖妯″瀷鐨勮鏍肩Н鍒嗙紪杈戜細鎸夋ā鍨嬭兘鍔涚淮搴﹀睍绀猴紝渚嬪鏂囩敓鍥句粎鏄剧ず灏哄/璐ㄩ噺/鍑哄浘鏁帮紝鍥惧儚缂栬緫涓庡弬鑰冨浘鐢熸垚浼氶澶栨樉绀哄弬鑰冨浘鏁伴噺锛屽浘鍍忓垎鏋愬垯鏀舵暃涓哄垎鏋愬崟浠凤拷?
  - `瑙嗛妯″瀷绠＄悊`锛氫粎鐢ㄤ簬蹇€熷垏锟?sora2 / seedance / kling / vidu 鐨勯粯璁や緵搴斿晢璺嚎锟?
- `Vidu` 鑺傜偣鍐呯殑妯″瀷涓嬫媺涔熷彈妯″瀷绠＄悊绾︽潫锟?
  - 鍚庣浼氭妸 `viduVideo.metadata.supportedModels` 瑁佸壀涓哄綋鍓嶄粛鍚敤锟?`vidu-q2 / vidu-q3` 瀛愰泦锛涘墠绔粠妯″瀷绠＄悊瀵煎叆鑺傜偣閰嶇疆鏃朵篃鍙細鍐欏叆 `q2 / q3`锟?
  - 鑻ョ敾甯冧笂宸叉湁鏃ц妭鐐规寚鍚戝凡鍒犻櫎瀛愭ā鍨嬶紝鍓嶇浼氳嚜鍔ㄥ洖閫€鍒扮涓€涓粛鍙敤锟?`viduModel`锟?
- 妯″瀷绠＄悊閲岀殑绾胯矾浠锋牸浼氳鐩栬妭鐐圭鐞嗕环鏍硷細
  - 鍏紑鑺傜偣閰嶇疆鎺ュ彛浼氭妸 `model_provider_mapping_v2` 涓粯锟?vendor 锟?`creditsPerCall` 鍔ㄦ€佸洖濉埌瀵瑰簲 Flow 鑺傜偣锟?
  - 鐢诲竷涓婄殑妯″瀷绠＄悊瑙嗛鑺傜偣鏀寔鍒囨崲 `vendorKey` 绾胯矾锛涘垏鎹㈠悗杩愯鎸夐挳鏃佺殑绉垎寰芥爣浼氬嵆鏃跺洖鏄捐绾胯矾浠锋牸锛屽苟锟?`managedModelKey/vendorKey/platformKey` 涓€璧蜂紶缁欏悗绔拷?
- 缁熶竴妯″瀷绠＄悊宸插紑濮嬩粠锟?`specPricing` 杩囨浮鍒版锟?`pricing`锟?
  - 绠＄悊鍙板巶鍟嗗崱鐗囩幇鍦ㄦ敮鎸侀粯璁ょН鍒嗐€侀粯璁や环锟?锟?浠ュ強瑙勬牸瑙勫垯鐨勭Н锟?浠锋牸缁存姢锟?
  - 鍚庣鍏紑鑺傜偣鎺ュ彛浼氫紭鍏堣锟?vendor `pricing.defaults`锛屾棫 `creditsPerCall` 浠嶄綔涓哄吋瀹瑰洖閫€锟?
- 鐢诲竷鍙充笂瑙掑府鍔╄彍鍗曟柊锟?`瀹氫环涓€瑙坄锟?
  - 鍏ュ彛浣嶄簬甯姪 icon 涓嬫媺锛屼綅缃湪鈥滅敤鎴锋墜鍐屸€濆拰鈥滄洿鏂版棩蹇椻€濅箣闂达拷?
  - 寮瑰眰鏀寔鏌ョ湅鍏ㄩ儴妯″瀷瀹氫环锛屾垨鎸夊崟涓ā鍨嬭仛鐒︽煡鐪嬶拷?
  - 绾挎€у畾浠蜂細鐩存帴鏄剧ず鍏紡锛屼緥锟?`priceYuan = durationSec 脳 0.8锛宑redits = ceil(priceYuan 脳 100)`锟?

## 闊抽鑺傜偣
- `minimaxSpeech`锛氭枃鏈浆璇煶鑺傜偣锛岃緭锟?`audio` 鍙ユ焺锟?
- `minimaxMusic`锛氶煶涔愮敓鎴愯妭鐐癸紝鏀寔 `prompt`銆乣lyrics`銆乣isInstrumental`銆乣lyricsOptimizer`锛岃皟锟?`/api/ai/minimax-music`锛岃緭锟?`audio` 鍙ユ焺锛屽彲杩炴帴 `wan26` / `audioUpload` / Kling 闊抽杈撳叆锟?

## 瑙勮寖
### 闇€锟? 瑙嗛锟?GIF 鑺傜偣
**妯″潡:** Flow 瑙嗛宸ュ叿鑺傜偣
鏀寔锟?Flow 涓皢瑙嗛鑺傜偣杈撳嚭杞崲锟?GIF锛屽苟浠ヨ繙锟?URL 鎸佷箙鍖栬緭鍑猴紙涓嶈惤锟?base64/blob锛夛拷?

#### 鍦烘櫙: 瑙嗛鑺傜偣 -> Video to GIF锛堢粓绔笅杞斤級
杩炴帴瑙嗛杈撳叆鍚庯紝涓ユ牸鎸夎緭鍏ヨ棰戞椂闀胯浆鎹紙鏃犻渶鎵嬪姩璁剧疆鏃堕暱锛夛紝鍙€夎皟锟?FPS/瀹藉害骞舵墽琛岃浆鎹拷?
- 缁撴灉杩斿洖鍙闂殑 GIF URL
- 鑺傜偣浠呬繚鐣欒緭鍏ュ彞鏌勶紝涓嶅啀鎻愪緵鍙充晶杈撳嚭鍙ユ焺
- 涓嶅啀鎻愪緵鈥滄棤闄愬惊鐜€濋€夐」锛堝浐瀹氫负闈炴棤闄愬惊鐜級
- 鐢熸垚鎴愬姛鍚庡彲鍦ㄨ妭鐐瑰彸涓婅鐩存帴涓嬭浇 GIF锛堜笉鍐嶅湪鑺傜偣搴曢儴灞曠ず鈥滄墦寮€鍘熷浘鈥濋摼鎺ワ級
- 鍚庣宸叉帴鍏ョН鍒嗙郴缁燂細姣忔杞崲棰勬墸 30 绉垎锛岃浆鎹㈠け璐ヨ嚜鍔ㄩ€€娆惧苟鍐欏叆绉垎娴佹按

### 闇€锟? 鍥剧墖鑺傜偣缂╂斁鍚庡埛鏂板昂瀵镐竴锟?
**妯″潡:** Flow 鍥剧墖鑺傜偣
鍥剧墖鑺傜偣鍦ㄧ敾甯冩斁澶у悗鍒锋柊椤甸潰锛屽唴閮ㄦ覆鏌撳昂瀵稿簲淇濇寔涓€鑷达紝涓嶉殢缂╂斁鍊嶆暟琚噸澶嶆斁澶э拷?

#### 鍦烘櫙: 鏀惧ぇ鍚庡埛锟?
鐢诲竷婊氳疆鏀惧ぇ鍚庡埛鏂伴〉闈拷?
- 鍥剧墖鑺傜偣鍐呴儴娓叉煋灏哄涓庣缉鏀惧墠涓€锟?

### 闇€锟? Image 鑺傜偣鏍囬鍙弻鍑婚噸鍛藉悕
**妯″潡:** Flow 鍥剧墖鑺傜偣
Image 鑺傜偣鏍囬鏀寔鍙屽嚮杩涘叆缂栬緫鎬侊紝鏂逛究鍦ㄦ祦绋嬩腑蹇€熷尯鍒嗗涓浘鐗囪緭鍏ヨ妭鐐癸拷?

#### 鍦烘櫙: 鍙屽嚮鏍囬閲嶅懡锟?
鐢ㄦ埛鍙屽嚮鑺傜偣鏍囬锛堥粯锟?`Image`锛夊悗鍙洿鎺ヨ緭鍏ユ柊鍚嶇О锟?
- `Enter` 鎴栧け鐒︿繚瀛樺苟鍥炲啓 `data.label`
- `Escape` 鍙栨秷鏈缂栬緫

### 闇€锟? MiniMap 鎷栨嫿鏃跺父锟?
**妯″潡:** Flow 鐢诲竷
鎷栧姩鐢诲竷鎴栨嫋鍔ㄨ妭鐐硅繃绋嬩腑锛孧iniMap 濮嬬粓鍙涓斾笉闂儊锟?

#### 鍦烘櫙: 鎷栧姩鐢诲竷/鑺傜偣
鍦ㄥ悓涓€椤甸潰鎷栧姩鐢诲竷鎴栬妭鐐癸拷?
- MiniMap 鎸佺画鍙

### 闇€锟? MiniMap 鍒锋柊鍚庡揩閫熷睍锟?
**妯″潡:** Flow Overlay
鍒锋柊椤甸潰鍚庯紝MiniMap 搴斿強鏃跺睍绀虹敾甯冨浘锟?鑺傜偣姒傝锟?

#### 鍦烘櫙: 鍒锋柊锟?1s 鍐呭睍锟?
鍒锋柊椤甸潰杩涘叆椤圭洰锟?
- MiniMap 锟?1s 鍐呭嚭鐜板浘锟?鑺傜偣姒傝锛堜笉绛夊緟闀垮欢杩燂級
- `frontend/src/components/flow/MiniMapImageOverlay.tsx` 宸叉竻鐞嗘畫浣欎腑鏂囨敞閲婏紙鏃犲姛鑳芥敼鍔級锛岀敤浜庝繚鎸佸弻璇壂鎻忓熀绾垮噯纭拷?

### 闇€锟? 鍙繛鎺ヨ妭鐐归椤瑰浐瀹氬熀纭€鑺傜偣
**妯″潡:** Flow Quick Connect
鑷姩閫夋嫨鍙繛鎺ヨ妭鐐规椂锛岄椤瑰繀椤诲浐瀹氫负褰撳墠杈撳叆绫诲瀷鐨勫熀纭€鑺傜偣锛岄伩鍏嶉珮棰戜娇鐢ㄦ帓搴忔妸鍩虹鍏ュ彛鎸ゅ嚭鍓嶅垪锟?

#### 鍦烘櫙: Prompt / Image 鑷姩杩炴帴
浠庢枃鏈緭鍑鸿Е鍙戣嚜鍔ㄨ繛鎺ユ椂锛岄椤逛负 `textPrompt`锛涗粠鍥剧墖杈撳嚭瑙﹀彂鑷姩杩炴帴鏃讹紝棣栭」锟?`image`锟?
- 鍏朵綑鍊欓€夎妭鐐逛粛鎸変娇鐢ㄩ鐜囨帓锟?

### 闇€锟? 杩炵嚎棰滆壊妯″紡鍙垏锟?
**妯″潡:** Flow Overlay / Flow 璁剧疆
鏀寔鍦ㄥ伐鍏锋爮鍒囨崲杩炵嚎棰滆壊鏄剧ず绛栫暐锛屽吋椤剧粺涓€瑙嗚涓庣被鍨嬭瘑鍒拷?

#### 鍦烘櫙: 鏍囧噯锟?/ 璺熼殢鍙ユ焺
鐢ㄦ埛鍙湪銆岃锟?-> 瑙嗗浘澶栬銆嶄腑鍒囨崲杩炵嚎棰滆壊妯″紡锛團low 宸ュ叿鏍忎篃鍙揩鎹峰垏鎹級锟?
- `鏍囧噯鑹瞏锛氬叏閮ㄨ繛绾夸娇鐢ㄧ粺涓€鐏拌壊
- `璺熼殢鍙ユ焺`锛氳繛绾块鑹茶窡闅忓彞鏌勭被鍨嬶紙鏂囨湰/鍥剧墖/瑙嗛/澶氬浘/闊抽锟?

### 闇€锟? 鑺傜偣鎷栨嫿鑷姩瀵归綈
**妯″潡:** Flow Overlay
Flow 鑺傜偣鎷栨嫿鏀寔涓庡叾浠栬妭鐐硅繘琛岃竟锟?涓績鍚搁檮锛屽苟鏄剧ず瀵归綈鍙傝€冪嚎锛堝鐢ㄧ敾甯冨浘鐗囪嚜鍔ㄥ榻愮殑鍚屾绠楁硶涓庡叏灞€寮€鍏筹級锟?

#### 鍦烘櫙: 鎷栨嫿鑺傜偣鎺ヨ繎鍏朵粬鑺傜偣
鐢ㄦ埛鎷栧姩涓€涓垨澶氫釜鑺傜偣闈犺繎鍏朵粬鑺傜偣鏃讹拷?
- 鍦ㄥ惛闄勯槇鍊煎唴鑷姩璐撮綈锛坙eft/right/top/bottom/center锟?
- 鏄剧ず锟?绮夎壊鍙傝€冪嚎鎻愮ず褰撳墠瀵归綈鍏崇郴
- 缁撴潫鎷栨嫿鍚庤嚜鍔ㄦ竻鐞嗗弬鑰冪嚎

### 闇€锟? Multi Generate 鍥哄畾 4 锟?
**妯″潡:** Flow 鐢熸垚鑺傜偣锛坄generate4`锟?
`Multi Generate` 鑺傜偣鍥哄畾杈撳嚭 4 寮犲浘锛屼笉鍐嶆毚闇插彲缂栬緫鐨勬暟閲忛厤缃紝閬垮厤 UI 閰嶇疆涓庡疄闄呮墽琛屾鏁板垎鍙夛拷?

#### 鍦烘櫙: 杩愯 Multi Generate
鐢ㄦ埛鐐瑰嚮杩愯 `Multi Generate` 鑺傜偣锟?
- 鑺傜偣鎵ц濮嬬粓锟?4 杞敓锟?
- 鑺傜偣闈㈡澘涓嶅啀鏄剧ず `Count/鏁伴噺` 杈撳叆锟?
- 鏂板缓鑺傜偣榛樿鏁版嵁鍙繚锟?`status/images`锛屼笉鍐嶆寔涔呭寲 `count`

## 鍥剧墖涓庡唴锟?
- **ImageSplit -> Image passthrough**: Image nodes treat `ImageSplit` outputs as first-class image inputs, including `imageN` and legacy `imgN` source handles plus `targetHandle=image` edges. Chained paths such as `ImageSplit -> Image -> Image` keep the cropped resource available for preview, canvas send, and downstream reads.
- **鍘熷垯**锛氫笉瑕佸湪 `content.flow`锛堥」鐩唴锟?JSON锛夐噷鎸佷箙鍖栧ぇ浣撶Н base64锛涜繖浼氬鑷村簭鍒楀寲/瀵规瘮/鑷姩淇濆瓨鏃朵骇鐢熷法鍨嬩复鏃跺瓧绗︿覆骞舵帹楂樺唴瀛橈拷?
- **Flow 鍥剧墖璧勪骇**锛歚frontend/src/services/flowImageAssetStore.ts` 锟?`flow-asset:<id>` 浠呯敤浜庤繍琛屾湡/鏈湴缂撳瓨锟?*淇濆瓨鍒板悗绔墠蹇呴』鏇挎崲涓鸿繙锟?URL/OSS key**锛堝惁鍒欎細琚樆姝繚锟?鎴栬鍚庣娓呮礂涓㈠純锛夈€傚綋鍓嶉€氳繃 `frontend/src/services/flowSaveService.ts` 鍦ㄤ繚瀛橀摼璺噷鑷姩琛ヤ紶骞舵浛鎹紙浼樺厛瑕嗙洊 `Image Split` 鐨勮緭鍏ュ浘寮曠敤锛夛拷?
- **Image Split 鎸佷箙鍖栵紙鏂规A锟?*锛氳繍琛屾椂鍙敤 `inputImageUrl=flow-asset:` 鍋氬垎锟?涓嬫父瑁佸垏锛涗繚瀛樺埌鍚庣鍓嶄細琛ヤ紶骞舵浛鎹负 `inputImageUrl`锛堣繙锟?URL/OSS key锟? `splitRects[]`锛堣鍒囩煩褰級+ `sourceWidth/sourceHeight`锛屽垏鐗囧浘鐗囨湰韬笉钀藉簱銆傛覆锟?涓嬫父锛堜緥锟?`Image Grid`锛夋寜闇€浠庡師鍥捐鍒囷拷?
- **Image Split 鍒嗗壊妯″紡**锛氳妭鐐规敮锟?`鏅鸿兘鍒嗗壊` 锟?`鑷畾涔夌綉鏍糮 涓ょ妯″紡銆俙鏅鸿兘鍒嗗壊` 淇濇寔鍘熻涓猴紙杩為€氬煙妫€娴嬶紝澶辫触鏃舵寜 `cols=ceil(sqrt(count))` 鍥為€€缃戞牸锛夛紱`鑷畾涔夌綉鏍糮 閫氳繃 `锟?脳 琛宍锛堜緥锟?`4 脳 2`锛夊浐瀹氬垏鐗囧竷灞€锛岃緭鍑虹鍙ｆ暟鑷姩鍚屾锟?`cols*rows`锛屽苟闄愬埗鎬绘暟涓嶈秴锟?`50`锟?
- **瑁佸垏杈撳嚭灏哄**锛氫笅娓告寜 `splitRects[].width/height`锛堟簮鍧愭爣绯伙級浣滀负杈撳嚭灏哄锛涘綋 base 鍥惧儚鍙姞杞藉埌缂╃暐鍥撅紙`naturalW < sourceWidth`锛夋椂锛屼粛浼氳緭鍑烘纭昂瀵革紙閬垮厤 1024 璇彉 200锛夛拷?
- **Image 鑺傜偣瑁佸垏閫忎紶**锛歚Image`/`ImagePro` 鑺傜偣锟?`crop` 鏃讹紝涓嬫父鑱氬悎锛堝 `Image Grid`锛変細浼樺厛锟?`crop` 瑁佸垏鍐嶆嫾鍚堬紝閬垮厤鍥為€€鍒版暣鍥撅紱鑺傜偣杩炴帴閾捐矾涓篃鏀寔璇诲彇涓婃父 `Image` 锟?`crop` 杩涜瑁佸壀棰勮锟?
- **Generate 杈撳叆棰勮涓€鑷达拷?*锛歚Generate` 鑺傜偣椤堕儴杈撳叆缂╃暐鍥句細璇嗗埆 `Image/ImagePro.crop` 锟?`ImageSplit.splitRects`锛屾寜瑁佸垏鍖哄煙娓叉煋缂╃暐鍥撅紱閬垮厤棰勮鏄剧ず鏁村浘浣嗗疄闄呰繍琛屽凡鎸夎鍒囦紶鍙傜殑璁ょ煡鍋忓樊锟?
- **Image 鑺傜偣鍙戦€佸埌鐢诲竷**锛欼mage 鑺傜偣鍦ㄦ湁鍥剧墖璧勬簮鏃跺彲涓€閿彂閫佸埌鐢诲竷锛涘彂閫佸唴瀹逛互鑺傜偣褰撳墠娓叉煋璧勬簮涓哄噯锛堝惈 `crop`/ImageSplit 瑁佸壀棰勮锛夛紝閬垮厤鍥為€€涓烘暣鍥撅拷?
- **Analysis 瑁佸垏缁ф壙**锛歚Analysis` 鑺傜偣鍦ㄨ緭鍏ヤ负 `Image/ImagePro` 鏃朵細閫掑綊鍚戜笂娓告煡锟?`crop`/`ImageSplit`锛屼互纭繚閾捐矾涓浆鍚庝粛浣跨敤瑁佸壀缁撴灉锟?
- **Analysis 鏂紑娓呯┖**锛氭柇寮€鍥剧墖杩炵嚎鍚庝細娓呯悊鑺傜偣鍐呮畫鐣欑殑 `imageData/imageUrl`锛岄瑙堟仮澶嶄负绌虹姸鎬侊拷?
- **Worker 璁＄畻**锛歚Image Split` 浣跨敤 `frontend/src/workers/imageSplitWorker.ts` 锟?Worker 鍐呰В鐮佸苟璁＄畻瑁佸垏鐭╁舰锛岄伩鍏嶄富绾跨▼鍋氬儚绱犵骇鎵弿锟?`toDataURL` 浜х敓鐨勫嘲鍊硷拷?

## 缂洪櫡澶嶇洏
- **闂鐜拌薄:** 鐢诲竷鏀惧ぇ鍚庡埛鏂帮紝Image 鑺傜偣瑁佸壀棰勮灏哄鍙樺ぇ锟?
- **鏍瑰洜:** 棰勮灏哄浣跨敤 `getBoundingClientRect`锛岃 ReactFlow 瑙嗗彛缂╂斁 transform 褰卞搷锟?
- **淇:** 鏀圭敤甯冨眬灏哄锛坄offsetWidth/clientWidth`锛変綔涓哄熀鍑嗭紝鍥為€€鏃舵墠璇诲彇 `getBoundingClientRect`锟?
- **棰勯槻:** 娓叉煋灏哄璁＄畻浼樺厛浣跨敤甯冨眬灏哄锛岄伩鍏嶅彈 transform 褰卞搷锟?
- **闂鐜拌薄:** 鎷栧姩鐢诲竷/鑺傜偣锟?MiniMap 娑堝け锟?
- **鏍瑰洜:** MiniMap 锟?`isNodeDragging` 锟?true 鏃惰鏉′欢闅愯棌锟?
- **淇:** 鍘婚櫎鎷栨嫿鎬侀殣钘忛€昏緫锛屼繚鎸佷粎鍦ㄤ笓娉ㄦā寮忎笅闅愯棌锟?
- **棰勯槻:** 鍙鎬т緷璧栦笟鍔℃ā寮忥紙濡備笓娉ㄦā寮忥級锛岄伩鍏嶄笌浜や簰鎬佺粦瀹氾拷?
- **闂鐜拌薄:** 鍒锋柊锟?MiniMap 鍥剧墖/鑺傜偣姒傝寤惰繜 30s 鎵嶅嚭鐜帮拷?
- **鏍瑰洜:** MiniMap 浠呬緷璧栬疆璇㈣锟?`window.tanvaImageInstances`锛屼笖缂哄皯瀹炰緥鏇存柊浜嬩欢閫氱煡锟?
- **淇:** 澧炲姞 `tanva-image-instances-updated` 浜嬩欢椹卞姩鏇存柊锛屼繚锟?1s 鍏滃簳杞锟?
- **棰勯槻:** 瀵圭敾甯冨疄渚嬪彉鏇存彁渚涗簨浠堕€氱煡锛岄伩鍏嶅崟涓€杞锟?
- **闂鐜拌薄:** 鍒锋柊锟?MiniMap 鏈樉绀哄浘鐗囧崰浣嶏紝闇€瑕佹嫋鍔ㄥ浘鐗囧悗鎵嶅嚭鐜帮拷?
- **鏍瑰洜:** 鍙嶅簭鍒楀寲绛夊緟 Raster 鍔犺浇鍚庢墠瑙﹀彂閲嶅缓浜嬩欢锛屼笖浜嬩欢鍙兘鏃╀簬鐩戝惉娉ㄥ唽瀵艰嚧涓㈠け锛涢噸寤哄け璐ユ椂涔熸湭鍥為€€鍒板揩鐓ф暟鎹拷?
- **淇:** 鍙嶅簭鍒楀寲瀹屾垚绔嬪嵆瑙﹀彂 `paper-project-imported` 骞惰褰曞鍏ユ椂闂存埑鍏滃簳瑙﹀彂锛涙仮澶嶈矾寰勬寜 `data.imageId` 鍖归厤骞跺湪澶辫触鏃剁敤蹇収 bounds 鍏滃簳绉嶅瓙锟?`imageInstances`锟?
- **棰勯槻:** 瀵煎叆瀹屾垚鍗宠Е鍙戦噸寤轰簨浠讹紝骞舵彁渚涗竴娆℃€у厹搴曡Е鍙戦伩鍏嶄涪浜嬩欢锟?
- **闂鐜拌薄:** Multi-generate 锟?Image 锟?Generate 閾捐矾涓紝Generate 鏈娇鐢ㄤ笂锟?Image 鑺傜偣灞曠ず鍥撅拷?
- **鏍瑰洜:** Generate 杈撳叆瑙ｆ瀽锟?Image 鑺傜偣浼樺厛鍥炴函涓婃父锛屽拷锟?Image 鑺傜偣鏈韩鐨勫綋鍓嶆覆鏌撴暟鎹拷?
- **淇:** 杈撳叆瑙ｆ瀽浼樺厛浣跨敤 Image 鑺傜偣锟?`imageData/imageUrl/thumbnail`锛屽啀鍥炴函涓婃父锛涜В鏋愬け璐ユ椂锟?proxy URL 杩涜甯﹂壌鏉冨厹搴曟媺鍙栵拷?
- **棰勯槻:** 涓嬫父杈撳叆瑙ｆ瀽闇€浠ュ綋鍓嶈妭鐐瑰睍绀鸿祫婧愪负鍑嗭紝鍐嶅仛閾捐矾鍥炴函锟?
- **闂鐜拌薄:** Generate 璇诲彇 OSS 鐩撮摼鏃惰法鍩熷鑷村浘鐗囨湭琚娇鐢拷?
- **鏍瑰洜:** 鍓嶇闇€瑕佸皢鍥剧墖杞垚 dataURL锛岃法鍩熸媺鍙栧け璐ュ鑷磋緭鍏ヤ负绌猴拷?
- **淇:** 鐢熸垚閾捐矾鍏佽浼犻€掕繙锟?URL锛岀敱鍚庣涓嬭浇杞爜鍚庡鐞嗭拷?
- **棰勯槻:** 瀵硅法鍩熻祫婧愪紭鍏堣蛋鍚庣鎷夊彇锛岄伩鍏嶅墠锟?CORS 闄愬埗锟?
- **闂鐜拌薄:** `Analysis` 鑺傜偣鍦ㄧ敓浜х幆澧冨伓鍙戔€滃浘鐗囧姞杞藉け锟?缂哄皯鍥剧墖杈撳叆鈥濓紝鏈湴闅惧鐜帮拷?
- **鏍瑰洜:** 杈撳叆瑙ｆ瀽鍙皾璇曢涓€欓€夊瓧娈碉紙甯镐负澶辨晥 `imageData` 涓存椂寮曠敤锛夎€屾湭鍥為€€锟?`imageUrl`锛涘悓鏃惰繙锟?URL 锟?`VITE_PROXY_ASSETS=false` 涓嬪彲鑳戒粎璧版祻瑙堝櫒鐩磋繛锛屽彈 CDN CORS 宸紓褰卞搷锟?
- **淇:** `AnalyzeNode` 鏀逛负澶氬€欓€夐『搴忓洖閫€锛坄imageData 锟?imageUrl 锟?output/thumbnail`锛夛紝瑁佸垏閾捐矾鏀寔锟?baseRef 鍥為€€锛沗resolveImageToDataUrl/resolveImageToBlob` 瀵圭櫧鍚嶅崟杩滅▼ URL 澧炲姞鈥滃己锟?`/api/assets/proxy`鈥濆€欓€夊厹搴曪紱绉婚櫎鍒嗘瀽缂╃暐鍥鹃瑙堜腑锟?`crossOrigin=anonymous` 鐨勭‖渚濊禆锟?
- **棰勯槻:** 鍒嗘瀽/鐢熸垚绛変笅娓稿彇鍥剧粺涓€閲囩敤鈥滃鍊欙拷?+ 浠ｇ悊鍏滃簳鈥濈瓥鐣ワ紝閬垮厤杩愯鏃朵复鏃跺紩鐢ㄥけ鏁堜笌璺ㄥ煙鐜宸紓鏀惧ぇ锟?
- **闂鐜拌薄:** `ViewAngle` 鑺傜偣鍋跺彂鎶ラ敊鈥滅己灏戝浘鐗囪緭鍏モ€濓紝浣嗕笂锟?`Image` 鑺傜偣鐢婚潰鍙锟?
- **鏍瑰洜:** 杈撳叆瑙ｆ瀽鍦ㄥ涓€欓€夊瓧娈碉紙`imageData/imageUrl/thumbnail`锛変腑鍙皾璇曠涓€涓€硷紱褰撻涓€兼槸澶辨晥涓存椂寮曠敤锛堝锟?`blob:`锛夋椂锛屾湭鍥為€€鍒板悗缁湁锟?`imageUrl`锟?
- **淇:** 锟?`FlowOverlay.runNode` 瑙ｆ瀽閾捐矾鏂板鈥滃€欓€夊浘鐗囬€愪釜鍥為€€鈥濋€昏緫锛宍resolveNodeImageToDataUrl` 锟?`image/imageGrid/imageCompress/videoFrameExtract/generate4` 绛夊垎鏀潎鏀逛负鎸夊€欓€夐『搴忛€愪竴瑙ｆ瀽锛岀洿鍒版垚鍔燂拷?
- **棰勯槻:** 涓嬫父鍙栧浘涓嶅簲鍗曠偣渚濊禆鏌愪竴涓瓧娈碉紱搴斾互鈥滃鍊欙拷?+ 鍙仮澶嶅け璐モ€濇柟寮忚В鏋愶紝閬垮厤涓存椂鎬佹畫鐣欏紩鍙戣鍒わ拷?
- **闂鐜拌薄:** 绾夸笂鐢熸垚/涓婁紶鍥剧墖鍚庡埛鏂帮紝鍋跺彂鍑虹幇鍙€変腑浣嗕笉鏄剧ず鐨勨€滃菇鐏靛浘鈥濓拷?
- **鏍瑰洜:** 涓婁紶寮€濮嬫椂鍏堝啓鍏ラ鍒嗛厤 OSS key锛坄imageUrl`锛夛紝澶辫触鍚庢湭鍥炴粴锛涗繚瀛橀摼璺細娓呯悊 `blob:/data:` 棰勮锛屽鑷村埛鏂板悗鍙墿涓嶅瓨鍦ㄧ殑 key锟?
- **淇:** `ImageNode` 涓婁紶澶辫触鏃跺洖婊氶鍒嗛厤 key锛堜粎鍦ㄥ綋鍓嶈妭鐐逛粛浣跨敤锟?key 鏃剁敓鏁堬級锛屽苟淇濈暀鍙噸璇曠殑杩愯鏃堕瑙堬紱淇濆瓨鏍￠獙鏂板鈥渀uploading=true` 涓旀惡甯﹀浘鐗囨暟鎹€濈殑 Flow 鑺傜偣闃绘柇锛岄伩鍏嶄笂浼犳湭瀹屾垚鏃惰惤搴撲笉绋冲畾寮曠敤锟?
- **棰勯槻:** 涓婁紶涓紩鐢ㄤ笉寰楄浣滃彲鎸佷箙鍖栨潵婧愶紱浠呭湪涓婁紶鎴愬姛骞舵嬁鍒板彲楠岃瘉鐨勮繙绋嬪紩鐢ㄥ悗鍐欏叆 `imageUrl`锟?

## 3D 妯″瀷鑺傜偣
- 涓夌淮鑺傜偣锛坄frontend/src/components/flow/nodes/ThreeNode.tsx`锛夐€夋嫨妯″瀷鏂囦欢鍚庝細涓婁紶锟?OSS锛屽苟锟?`modelUrl` 鎸佷箙鍖栦负杩滅▼寮曠敤锛岄伩锟?`blob:` 绛変复锟?URL 杩涘叆 `content.flow`锟?
- 鍔犺浇杩滅▼妯″瀷/鍥剧墖鏃堕粯璁ゅ彲閫氳繃 `proxifyRemoteAssetUrl` 锟?`/api/assets/proxy`锛屼互瑙勯伩 OSS CORS锛堝彈 `VITE_PROXY_ASSETS` 鎺у埗锛夈€傝嫢 OSS 宸查厤锟?CORS 涓斿笇鏈涚锟?proxy锛岃璁剧疆 `VITE_PROXY_ASSETS=false` 骞堕厤锟?`VITE_ASSET_PUBLIC_BASE_URL`锛堢敤浜庢妸 `projects/...` 杩欑被 key 鐩存帴鎷兼垚鍙锟?URL锛夛拷?
- Three.js 娓叉煋鍣ㄥ昂瀵镐互瀹瑰櫒 `clientWidth/clientHeight` 涓哄噯锛屽苟浣跨敤 `renderer.setSize(w, h, false)` 浠呮洿鏂扮粯鍒剁紦鍐诧紙涓嶆敼锟?canvas 鐨勬牱寮忓昂瀵革級锛岄伩鍏嶈妭锟?resize 锟?canvas 鏈摵婊″彲瑙嗗尯鍩燂拷?
- `ThreeNode` 锟?Path Tracing 妯″紡涓嶈兘鍙緷锟?`scene.background`锛涢渶瑕佸彲閲囨牱锟?`scene.environment` 鎵嶈兘閬垮厤灏勭嚎鎵撶┖鍚庡洖钀藉埌榛戝簳銆傚綋鍓嶄娇鐢ㄤ唬鐮佺敓鎴愮殑 equirect 娓愬彉鐜鍥撅紝骞朵负鏅€氭爡鏍兼覆鏌撻澶栫敓锟?PMREM 鐗堟湰锛汸T 浣跨敤鍘熷 equirect 鐜锛屾爡鏍间娇锟?PMREM锛岄厤鍚堝亸鐧借儗鏅拰鏌斿拰涓诲厜妯℃嫙鍏嬪埗鐨勭櫧澶╂晥鏋滐拷?

## 渚濊禆
- `reactflow`

## 璇煶鑺傜偣琛ュ厖
- 鏂板 `TencentSpeechNode`锛坄frontend/src/components/flow/nodes/TencentSpeechNode.tsx`锛夛紝瀵瑰簲鑺傜偣绫诲瀷 `tencentSpeech`锟?
- 鏂板绯荤粺闊宠壊鏁版嵁锟?`frontend/src/components/flow/nodes/tencentSystemVoices.ts`锟?52 鏉★紝鏉ユ簮鑵捐浜戞枃锟?`https://cloud.tencent.com/document/product/862/129151`锛夛紝鐢ㄤ簬鑺傜偣鍐呭彲妫€绱笅鎷夐€夋嫨锟?
- 璇ヨ妭鐐瑰鎺ュ悗锟?`POST /api/ai/tencent-speech`锛屽弬鏁版寜鑵捐 MPS AI 閰嶉煶鏂囨。鏄犲皠锟?
  - `text + voiceId` 妯″紡锛氬墠绔€氳繃 `text` 鍙ユ焺鎺ュ叆 Prompt 鑺傜偣鏂囨湰锛屽苟鍙～锟?`voiceId`锛涘悗绔細浼樺厛鑷姩鐢熸垚 `speaker.json` 骞朵笂锟?OSS锛屽啀鍙戣捣閰嶉煶浠诲姟锛堥€傜敤浜庢棤鍘熼煶杞ㄨ棰戯級锟?
  - `text` 妯″紡锛堝洖閫€锛夛細鑻ユ湭鎻愪緵 `voiceId`锛堜笖鏈厤缃粯璁ら煶鑹诧級锛屽悗绔嚜鍔ㄥ垏鍒嗕负 SRT 骞朵笂锟?OSS锛屽啀鑷姩鍙戣捣閰嶉煶浠诲姟锟?
  - 杈撳叆瑙嗛棰勫鐞嗭細鍚庣鍦ㄦ彁浜よ吘璁换鍔″墠浼氭帰娴嬭緭鍏ヨ棰戦煶杞紱鑻ユ娴嬪埌鏃犻煶杞紙`AudioStreamSet` 涓虹┖锛夛紝浼氳嚜鍔ㄨˉ涓€鏉￠潤闊抽煶杞ㄥ苟涓婁紶 OSS锛屽啀鐢ㄨˉ杞ㄥ悗鐨勮棰戝湴鍧€鎻愪氦锛堥粯璁ゅ紑鍚紝鍙敤 `TENCENT_MPS_AUTO_INJECT_SILENT_AUDIO` 鍏抽棴锛夛拷?
  - 璺ㄨ锟?`srcLang -> dstLang`锛氬綋涓よ€呬笉鍚屼笖浣跨敤 `text` 妯″紡鏃讹紝鍚庣浼氬厛鍋氳嚜鍔ㄧ炕璇戯紝鍐嶇敓鎴愮洰鏍囧瓧锟?鐩爣閰嶉煶鏂囨湰锛堝彲閫氳繃 `TENCENT_MPS_ENABLE_AUTO_TRANSLATE` 閰嶇疆寮€鍏筹級锟?
  - `speakerUrl` 妯″紡锛氫紶 `speakerUrl`锟?
  - `subtitleUrls` 妯″紡锛氫紶 `srcSubtitleUrl + dstSubtitleUrl`锛堝墠绔畝鍖栧崟鐩爣璇█锛夛紝骞跺彲闄勫甫 `srcLang/dstLang`锟?
  - 瀛楀箷鏍峰紡锛歚embedSubtitle/font/fontSize/marginV/outputPattern`锟?
- 鑺傜偣闊宠壊浜や簰锟?
  - 楂樼骇璁剧疆涓彁渚涒€滅郴缁熼煶鑹测€濇悳锟?+ 涓嬫媺锛岄粯璁ゆ寜 `srcLang` 杩囨护锛堟棤鍖归厤鏃跺洖閫€鍏ㄩ噺锛夛拷?
  - 涓嬫媺閫変腑闊宠壊鍚庝細鑷姩鍚屾 `speakerGender`锛堢敺/濂筹級锟?
  - 浠嶄繚锟?`voiceId` 鎵嬪姩杈撳叆妗嗭紝鍙鐩栦笅鎷夌粨鏋滐紙鍏煎鑷畾锟?鏂板闊宠壊锛夛拷?
- 杩炴帴瑙勫垯锟?
  - 杈撳叆锛氬乏锟?`video` 鍙ユ焺锛堝繀椤昏繛鎺ヨ棰戣妭鐐癸紝涓嶆敮鎸佹墜锟?URL锛夛拷?
  - 杈撳嚭锛氬彸锟?`audio` 锟?`video` 鍙屽彞鏌勶拷?
  - `audio` 鍙ユ焺浼樺厛杈撳嚭闊抽 URL锛岃嫢涓婃父浠呰繑鍥炶锟?URL 鍒欏洖閫€瑙嗛 URL锛沗video` 鍙ユ焺杈撳嚭閰嶉煶鍚庤棰戯紝鏀寔缁х画涓插埌瑙嗛鍒嗘瀽/鎶藉抚/瑙嗛铻嶅悎绛変笅娓歌妭鐐癸拷?

## 2026-04 monochrome theme note
- `FlowOverlay` now reads `chatTheme` and applies `tanva-flow-theme-mono-dark` in black theme mode.
- Black theme monochrome overrides map media placeholders/waiting states to `Elevated #161616` to avoid white empty areas in image/video result regions.
- Video-node history panels/items are normalized to elevated dark surfaces with secondary text color (`#888888`) under monochrome theme.
- Video history containers in `GenericVideoNode` / `KlingO1VideoNode` / `Wan26Node` / `Wan2R2VNode` / `Sora2VideoNode` use shared hooks: `tanva-video-history` and `tanva-video-history-item`.

## 2026-04-12 Tencent Stable Route Pricing
- `FlowOverlay.tsx` updates `BANANA_STABLE_ROUTE_PRICING` for stable route display and run badges.
- Pricing matrix: Fast `1K=30`; Pro `1K/2K/4K=90/100/170`; Ultra `0.5K/1K/2K/4K=30/50/70/110`.
- Stable route (`bananaImageRoute = stable`) remains Tencent-specific; other routes keep their own pricing logic.

## Tencent Kling2.6 Routing Note (2026-04-13)
- In Tencent route, kling-v2-6 now allows image-2 input in both std and pro modes on the node UI.
- Connection validation in FlowOverlay was aligned: Tencent kling-v2-6 accepts image-2 in std/pro, while non-Tencent routes remain pro-only for image-2.
- Legacy-node fallback: even when `vendorKey/platformKey` is empty, if managed metadata default vendor is `tencent_vod`, image-2 remains enabled for kling-v2-6.
- Tencent route detection for `kling-o3` is now strict: only explicit Tencent vendor/platform keys or metadata default vendor (`tencent_vod`) trigger Tencent-specific Kling request shaping.
- Tencent-specific sound mapping is now shared by both `kling-v2-6` and `kling-v3-0` request paths, so Tencent Kling no longer inherits non-Tencent `pro => sound=on` forcing.

## 2026-04-13 Run Trigger Guard
- Flow `runNode` now has a per-node in-flight guard to block duplicate concurrent runs caused by rapid repeated clicks.
- Video provider request layer now sends `Idempotency-Key` in `generate-video-provider` calls for backend-side dedupe.
- AI backend image/video request layer now sends `Idempotency-Key` for generation APIs to avoid duplicate pre-deduct on retry/race.

## 2026-05-04 Main-Based Flow Performance Migration
- Node palette search filters visible groups by node key, localized names, descriptions, and managed node captions.
- Quick Connect options are constrained to node types currently present in the visible palette and skip hidden/disabled/maintenance nodes.
- Flow store hydration compares serialized node/edge signatures against the local ReactFlow snapshot before applying state, and debounced write-back skips when the project store already matches.
- `TextChatNode` builds text-generation prompts from connected/manual node inputs only; it does not prepend global chat context.
- `AnalyzeNode` uses `analysisSkillId` to switch between Analysis / Prompt / JSON built-in skill prompts; text-handle inputs are appended as extra instructions.
- `TextChatNode` supports node-local Skill presets (`custom`, `shotSplit`, `promptOptimize`, `translate`). Custom mode uses the manual prompt field; preset modes run the built-in instruction and optionally append connected text inputs.
- `StoryboardSplitNode` can split by a custom sample format (`splitFormat`) and auto-derives output handle count from parsed segments, clearing stale `promptN` outputs after re-split.
- Image generation reference previews use shared model-tier limits from `flowModelProvider`: Fast 3, Pro 11, Ultra 14.
- `VideoAnalyzeNode` localizes its default prompt and sends Banana route/channel hints with analysis requests.
- `VideoAnalyzeNode` run-credit preview follows the `lt-dev9` route/tier matrix: normal Fast/Pro/Ultra = `60/90/120`, stable Fast/Pro/Ultra = `80/120/160`.
- `Generate4Node` uses the shared Image Split handle helper for `imageN/imgN` reference inputs.
- `Seedream5Node` can use `thumbnails[]` as its lightweight first-image preview while full-image preview still uses `imageUrls/images`.
- AI Chat text responses preserve backend `metadata` on messages/context; context prompts are constrained to answer the current input directly instead of surfacing internal analysis.

## 2026-05-05 lt-dev9 Selective Migration
- Flow connection admission and `runNode` request assembly now share model-tier reference-image limits (`Fast=3`, `Pro=11`, `Ultra=14`) for `Generate`, `Generate4`, `Agent`, and `GeneratePro4`; `GenerateNode` also keeps hidden legacy handles through `img14`.
- Image Grid connection validation now accepts Image Split `imageN` and `imgN` source handles through the shared `isImageSplitHandle` helper.
- Successful Flow video runs write remote video references to Global History for Wan, HappyHorse, Sora2, provider-video nodes (`Seedance/Kling/Vidu` families), and Tencent Speech video output. This records existing remote URLs only and does not change project/design JSON persistence.

## 2026-04-24 Update
- `gptImage2` node now enables explicit `Resolution` selector (`1K/2K/4K`) and defaults to `1K`.
- `gptImage2` now enforces APIMart 4K ratio constraint in-node: when `resolution=4K`, aspect ratio options are restricted to `16:9 / 9:16 / 2:1 / 1:2 / 21:9 / 9:21`; invalid existing ratio auto-corrects to a supported one.
- `gptImage2` runtime request now carries `official_fallback` and defaults it to `true` (official channel fallback on).
- `gptImage2` runtime request carries `official_fallback`; default fallback is now `false` unless node data/defaultData explicitly sets it.
- `gptImage2` UI now hard-fixes resolution options to `1K/2K/4K` even if metadata payload only provides a partial subset (for compatibility with old node configs).
- `gptImage2` aspect-ratio/resolution dropdowns are now rendered with the same visual style and interaction pattern as video-node dropdown menus (`video-dropdown` + `video-dropdown-menu`).

## 2026-05-12 GPT-Image-2 Async Flow Runtime
- `FlowOverlay` now routes `gptImage2` node runs to async image task APIs instead of the synchronous `generate-image` path.
- Runtime creates a task, polls every 3s, and waits up to 15 minutes before timing out.
- Failed/timeout task messages are surfaced as node errors; credit refund is handled by backend async task status flow.

## 2026-05-12 Seedance Update
- Seedance video node model selector now uses Seedance 2.0 + Seed 2.0 Lite (removed 2.0 Fast UI option), and mode selector now supports eference_images / irst_frame / start_end / smart_frames with mode-specific validation and limit tips.

