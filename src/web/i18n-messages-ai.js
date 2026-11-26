/**
 * 「AIで白黒に」(画像の2値化)の文言。i18n.js でまとめて使う。
 * 他の機能と同時に手を入れてもぶつからないよう、ファイルを分けている
 */
export const AI_BINARIZE_MESSAGES = {
  aibw_button: { ja: "AIで白黒に", en: "AI B&W" },
  aibw_button_title: { ja: "背景を消したり、線画にしたりして、感熱印刷で見栄えのする白黒にします", en: "Remove the background or turn the photo into line art so it prints well in black and white" },
  aibw_title: { ja: "AIで白黒にする", en: "Convert to black & white with AI" },
  aibw_mode: { ja: "加工の種類", en: "Conversion" },
  aibw_mode_removeBg: { ja: "背景を消す", en: "Remove background" },
  aibw_mode_lineArt: { ja: "線画にする", en: "Line art" },
  aibw_mode_edges: { ja: "輪郭線", en: "Outline" },
  aibw_desc_removeBg: { ja: "人物や物だけを残して、背景を白にします。濃淡はディザで表します", en: "Keeps the subject and makes the background white. Shading uses dithering" },
  aibw_desc_lineArt: { ja: "写真をペンで描いたような線だけの絵にします", en: "Turns the photo into a pen-like drawing" },
  aibw_desc_edges: { ja: "明るさの境目を線にします。AIを使わないのですぐに終わります", en: "Draws lines where brightness changes. No AI, so it is instant" },
  aibw_badge_ai: { ja: "AI・初回 {mb}MB", en: "AI · {mb} MB first time" },
  aibw_badge_fast: { ja: "すぐ・ダウンロードなし", en: "Instant · no download" },
  aibw_remove_bg_first: { ja: "先に背景を消す", en: "Remove background first" },
  aibw_strength: { ja: "線の濃さ", en: "Line darkness" },
  aibw_before: { ja: "変換前", en: "Before" },
  aibw_after: { ja: "変換後", en: "After" },
  aibw_need_download: { ja: "初回だけAIモデル(約{mb}MB)をダウンロードします", en: "The AI model (about {mb} MB) is downloaded the first time only" },
  aibw_download_run: { ja: "ダウンロードして変換", en: "Download and convert" },
  aibw_downloading: { ja: "AIモデルをダウンロード中… {pct}%", en: "Downloading the AI model… {pct}%" },
  aibw_processing: { ja: "変換しています…", en: "Converting…" },
  aibw_retry: { ja: "もう一度試す", en: "Try again" },
  aibw_err_failed: { ja: "変換できませんでした({message})", en: "Could not convert ({message})" },
  aibw_err_image: { ja: "画像を読み込めませんでした", en: "Could not load the image" },
  aibw_privacy_note: { ja: "画像はこの端末の中だけで処理され、外部には送られません。AIモデルは初回だけダウンロードし、ブラウザに保存します。適用したあとも Ctrl+Z で元に戻せます。", en: "Images are processed on this device only and never uploaded. The AI model is downloaded once and kept in your browser. You can undo with Ctrl+Z after applying." },
  aibw_apply: { ja: "適用", en: "Apply" },
  status_aibw_applied: { ja: "画像を白黒に変換しました(Ctrl+Z で元に戻せます)", en: "Converted the image to black & white (Ctrl+Z to undo)" },
};
