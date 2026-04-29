"use client";

import React, { createContext, useCallback, useContext, useMemo, useState } from "react";

type Lang = "en" | "ja"

type Dict = Record<string, string>

const en: Dict = {
  // Nav
  "nav.datasets": "Datasets",
  "nav.training": "Training",
  "nav.inference": "Inference",
  "nav.playground": "Playground",
  "nav.settings": "Settings",

  // Datasets
  "datasets.title": "Datasets 📚",
  "datasets.subtitle": "Store, explore, and sparkle ✨",
  "datasets.search.placeholder": "Search datasets",
  "datasets.empty": "No datasets found",
  "datasets.panel": "Datasets",
  "datasets.select_filtered": "Select filtered",
  "datasets.none": "No datasets",
  "datasets.selected_suffix": "selected",
  "configuration.panel": "Configuration",
  "dataset.breadcrumb": "Datasets 📚",
  "upload.title": "Upload 📤",
  "upload.subtitle": "Drop files, we’ll handle the magic ✨",
  "upload.uploading": "Uploading ⏫",
  "upload.complete": "Upload Complete 🎉",
  "upload.explore": "Explore datasets",

  // Training
  "training.title": "Training Jobs 🚀",
  "training.badge": "Training",
  "training.subtitle": "Train models, chase SOTA, have fun 🎉",
  "training.search.placeholder": "Search jobs by name, model, task",
  "training.empty": "No jobs found",
  "training.create.title": "Create Training Job 🎛️",
  "training.create.subtitle": "Pick a task, choose a model, and let's train 🚀",
  "training.detail.breadcrumb": "Training 🚀",
  "training.new": "New Training",
  "training.job_name": "Job Name",
  "training.task_type": "Task Type",
  "training.model": "Model",
  "training.labels": "Labels",
  "training.labels.select_datasets": "Select datasets to load labels",
  "training.labels.none": "No labels found in selected datasets",
  "training.select_all": "Select all",
  "training.datasets": "Datasets",
  "training.train_test_split": "Train / Test Split",
  "training.train_test_ratio": "Train : Test",
  "training.epochs": "Epochs",
  "training.batch_size": "Batch Size",

  // Inference
  "inference.title": "Inference 🤖",
  "inference.badge": "Inference",
  "inference.subtitle": "Run models on your data — fast and fun ✨",
  "inference.create.title": "Create Inference Job 🧪",
  "inference.create.subtitle": "Pick a task, choose a model, then go infer ✨",
  "inference.detail.breadcrumb": "Inference 🤖",
  "inference.new": "New Inference",
  "playground.title": "Quick Playground ⚡",
  "playground.subtitle": "Try tasks instantly — no setup, just vibes 🎈",
  "inference.job_name": "Job Name",
  "inference.task_type": "Task Type",
  "inference.model_source": "Model Source",
  "inference.model_source.internet": "Internet",
  "inference.model_source.trained": "Trained",
  "inference.internet_model": "Internet Model",
  "inference.select_model": "Select model",
  "inference.select_task_first": "Select task type first",
  "inference.completed_training_job": "Completed Training Job",
  "inference.select_completed_job": "Select completed job",
  "inference.no_completed_jobs": "No completed jobs",
  "inference.datasets": "Datasets",
  "inference.detailed_analysis": "Detailed Analysis",

  // Common
  "common.clear": "Clear",
  "common.retry": "Retry",
  "common.start": "Start",
  "common.stop": "Stop",
  "common.remove": "Remove",
  "common.remove_job": "Remove Job",
  "common.cancel": "Cancel",
  "common.loading": "Loading...",
  "common.prev": "Prev",
  "common.next": "Next",
  "common.close": "Close",
  "common.auto_saved": "Auto-saved",

  // Object
  "object.delete_title": "Delete Object",
  "object.delete_confirm": "This object will be deleted. Proceed?",
  "object.delete_note": "Removes DB metadata first, then deletes MinIO object.",
  "object.info": "Info",
  "object.preview_unavailable": "Preview is not available.",
  "object.auto_anno": "Auto Annotation",
  "object.bbox_labels": "BBox Labels",
  "object.text_label": "Text Label",
  "object.mode_bbox": "Bounding Box",
  "object.mode_text": "Image to Text",
  "object.generate": "Generate🪄",
  "object.auto_text_unimpl": "Text auto-generation is not implemented",
  "object.auto_bbox_unimpl": "BBox auto-generation is not implemented",

  // Merge
  "merge.badge": "Merged",
  "merge.relation_button": "Sequence",
  "merge.drawer_title": "Merge Sequence",
  "merge.current": "(current)",
  "merge.annotate_only_first": "Annotations are allowed only on the first merged video.",

  // Charts
  "chart.type.line": "Line",
  "chart.type.frequency": "Frequency",
  "chart.type.derivative": "Derivative",
  "chart.type.histogram": "Histogram",
  "chart.type.cdf": "CDF",
  "chart.type.ccdf": "CCDF",
  "chart.type.scatter": "Scatter",
  "chart.type.correlation": "Correlation",
  "chart.type.cumsum": "Cumulative Sum",
  "chart.type.pctchange": "% Change",
  "chart.type.missing": "Missing Profile",
};

const ja: Dict = {
  // Nav
  "nav.datasets": "データセット",
  "nav.training": "トレーニング",
  "nav.inference": "推論",
  "nav.settings": "設定",
  "nav.playground": "お試しエリア",

  // Datasets
  "datasets.title": "データセット 📚",
  "datasets.subtitle": "たくさんためて、楽しく探索 ✨",
  "datasets.search.placeholder": "データセットを検索",
  "datasets.empty": "データセットが見つかりません",
  "dataset.breadcrumb": "データセット 📚",
  "upload.title": "アップロード 📤",
  "upload.subtitle": "ファイルを置くだけ。あとはおまかせ ✨",
  "upload.uploading": "アップロード中 ⏫",
  "upload.complete": "アップロード完了 🎉",
  "upload.explore": "データセットを見る",
  "datasets.panel": "データセット",
  "datasets.select_filtered": "絞り込みを選択",
  "datasets.none": "データセットはありません",
  "datasets.selected_suffix": "件選択中",
  "configuration.panel": "設定",

  // Training
  "training.title": "トレーニングジョブ 🚀",
  "training.badge": "Training",
  "training.subtitle": "モデルを鍛えてSOTAへ、楽しく🎉",
  "training.search.placeholder": "ジョブ名/モデル/タスクで検索",
  "training.empty": "ジョブが見つかりません",
  "training.create.title": "トレーニングジョブ作成 🎛️",
  "training.create.subtitle": "タスクとモデルを選んで、いざ学習！🚀",
  "training.detail.breadcrumb": "トレーニング 🚀",
  "training.new": "新規トレーニング",
  "training.job_name": "ジョブ名",
  "training.task_type": "タスク種別",
  "training.model": "モデル",
  "training.labels": "ラベル",
  "training.labels.select_datasets": "データセットを選択するとラベルを読み込みます",
  "training.labels.none": "選択したデータセットにラベルがありません",
  "training.select_all": "すべて選択",
  "training.datasets": "データセット",
  "training.train_test_split": "学習/評価の比率",
  "training.train_test_ratio": "学習 : 評価",
  "training.epochs": "エポック数",
  "training.batch_size": "バッチサイズ",

  // Inference
  "inference.title": "推論ジョブ 🤖",
  "inference.badge": "Inference",
  "inference.subtitle": "あなたのデータでサクッと推論 ✨",
  "inference.create.title": "推論ジョブ作成 🧪",
  "inference.create.subtitle": "タスクとモデルを選んで、すぐ推論 ✨",
  "inference.detail.breadcrumb": "推論 🤖",
  "inference.new": "新規推論",
  "playground.title": "クイック・お試しエリア ⚡",
  "playground.subtitle": "今すぐ試す — セットアップ不要でワクワク 🎈",
  "inference.job_name": "ジョブ名",
  "inference.task_type": "タスク種別",
  "inference.model_source": "モデルソース",
  "inference.model_source.internet": "インターネット",
  "inference.model_source.trained": "学習済み",
  "inference.internet_model": "インターネットモデル",
  "inference.select_model": "モデルを選択",
  "inference.select_task_first": "先にタスクを選択してください",
  "inference.completed_training_job": "完了したトレーニングジョブ",
  "inference.select_completed_job": "完了ジョブを選択",
  "inference.no_completed_jobs": "完了ジョブがありません",
  "inference.datasets": "データセット",
  "inference.detailed_analysis": "詳細分析",

  // Common
  "common.clear": "クリア",
  "common.retry": "再試行",
  "common.start": "開始",
  "common.stop": "停止",
  "common.remove": "削除",
  "common.remove_job": "ジョブを削除",
  "common.cancel": "キャンセル",
  "common.loading": "読み込み中...",
  "common.prev": "前へ",
  "common.next": "次へ",
  "common.close": "閉じる",
  "common.auto_saved": "自動保存されます",

  // Object
  "object.delete_title": "オブジェクトを削除",
  "object.delete_confirm": "このオブジェクトを削除します。よろしいですか？",
  "object.delete_note": "メタデータ（DB）削除後、MinIOの実体も削除します。",
  "object.info": "情報",
  "object.preview_unavailable": "プレビューを表示できません。",
  "object.auto_anno": "自動アノテーション",
  "object.bbox_labels": "BBoxラベル",
  "object.text_label": "テキストラベル",
  "object.mode_bbox": "バウンディングボックス",
  "object.mode_text": "画像→テキスト",
  "object.generate": "生成🪄",
  "object.auto_text_unimpl": "テキスト自動生成は未実装です",
  "object.auto_bbox_unimpl": "BBox自動生成は未実装です",

  // Merge
  "merge.badge": "連結",
  "merge.relation_button": "連番関係",
  "merge.drawer_title": "連結シーケンス",
  "merge.current": "(現在)",
  "merge.annotate_only_first": "連結動画のアノテーションは先頭の動画のみ可能です。",

  // Charts
  "chart.type.line": "折れ線",
  "chart.type.frequency": "頻度",
  "chart.type.derivative": "微分",
  "chart.type.histogram": "ヒストグラム",
  "chart.type.cdf": "CDF",
  "chart.type.ccdf": "CCDF",
  "chart.type.scatter": "散布図",
  "chart.type.correlation": "相関",
  "chart.type.cumsum": "累積和",
  "chart.type.pctchange": "変化率",
  "chart.type.missing": "欠損プロファイル",
};

const DICTS: Record<Lang, Dict> = { en, ja };

type Ctx = {
  lang: Lang
  setLang: (l: Lang) => void
  t: (key: string, fallback?: string) => string
}

const LanguageContext = createContext<Ctx | undefined>(undefined);

export function LanguageProvider({ children, initialLang }: { children: React.ReactNode; initialLang?: Lang }) {
  const [lang, setLangState] = useState<Lang>(() => {
    if (initialLang === "en" || initialLang === "ja") return initialLang;
    try {
      if (typeof window !== "undefined") {
        const saved = localStorage.getItem("mlops-ui.lang") as Lang | null;
        if (saved === "en" || saved === "ja") return saved;
        const nav = navigator?.language?.toLowerCase() || "en";
        return nav.startsWith("ja") ? "ja" : "en";
      }
    } catch { void 0; }
    return "en";
  });

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem("mlops-ui.lang", l);
      if (typeof document !== "undefined") {
        document.cookie = `mlops-ui.lang=${l}; path=/; max-age=${60 * 60 * 24 * 365}`;
      }
    } catch { void 0; }
  }, []);

  const t = useCallback((key: string, fallback?: string) => {
    const d = DICTS[lang];
    return d[key] ?? fallback ?? key;
  }, [lang]);

  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error("useI18n must be used within LanguageProvider");
  return ctx;
}
