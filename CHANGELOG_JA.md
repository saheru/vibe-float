# 更新履歴

[简体中文](CHANGELOG.md) · [English](CHANGELOG_EN.md) · [日本語](CHANGELOG_JA.md)

Vibe Float デスクトップアプリと StreamDock Vibe Control プラグインの主な変更点を記録します。

## [0.5.5] - 2026-08-04

### 修正

- 最近のタスク更新を 5 秒間隔から 0.8 秒間隔へ高速化し、Codex タスクイベントの約 0.12 秒後にも更新。
- Codex プロセスが開いている rollout ファイルと `OTTY_PANE_ID` から、実行中タスクを元の Otty ペインへ正確に関連付け。
- Otty DB に重複・古い対応情報がある場合は作業ディレクトリも検証し、誤った切り替えや新規ウィンドウを防止。
- 同じタスクを 8 秒以内に連続して押しても、ターミナルをアクティブにするだけで新しいウィンドウを作成しない。

## [0.5.4] - 2026-08-04

### 修正

- Otty が実行中ペインの `resume_key` を一時的に消去した際、新しいウィンドウが開く問題を修正。
- DB の対応情報がない場合、Codex セッション作成時刻とプロセスの `OTTY_PANE_ID` から元のペインを復元。
- 同じタスクが別ウィンドウで誤って再開されていても、最初にタスクを開始したペインを優先。

## [0.5.3] - 2026-08-04

### 追加

- セッション ID で Otty 上の実行中 Codex / Claude セッションを照合し、元のペインへ正確にフォーカス。
- CLI ターミナルの自動検出に加え、Otty、Terminal、iTerm2、Ghostty、Kitty、WezTerm を選択可能。
- macOS アプリでは共通ターミナルを、StreamDock ではタスクボタンごとのターミナルを設定可能。
- 元のペインが存在しない場合は、選択したターミナルでセッションを再開。

## [0.5.2] - 2026-08-04

### 追加

- Codex CLI と Codex Desktop のタスクを自動判別し、カードに由来を表示。
- CLI タスクは `codex resume <タスク ID>`、デスクトップタスクは Codex Desktop で再開。

### 修正

- Windows の CLI タスクランチャーのビルドを修正。
- macOS ユニバーサルパッケージのクラウドビルドとパネルサイズのビルドを修正。

## [0.5.1] - 2026-08-01

### 修正

- Codex アカウント切り替え時に古いキャッシュを消去し、StreamDock を即時更新。
- Windows を安定した self-contained ポータブル構成へ変更し、起動スクリプト、エラー表示、診断ログを追加。
- Windows パッケージ公開前に実際の起動スモークテストを実施。

## [0.5.0] - 2026-07-30

### 追加

- StreamDock に Claude の最近のタスク、Model、Effort、5h Usage、週間 Usage を追加。
- Claude Model / Effort をボタンまたはダイヤルで変更し、ローカル設定へ保存。
- 既存コマンドを保持しながら Status Line から Claude Usage をローカル取得。
- Claude の完了・入力待ち時に、強調音とタスク名入り通知を表示。

## [0.4.0] - 2026-07-30

### 追加

- Codex 5h Usage を週間 Usage の前に独立モジュールとして追加。
- 最近のタスク数を 1～8 件から設定可能。
- モジュールが多い場合のコンパクトな自動グリッドを追加。
- 中国語、英語、日本語の完全なトップページを追加。

## [0.3.2] - 2026-07-30

### 修正

- Finder やログイン項目から起動した際の Codex CLI 検出を修正。
- `codex app-server` の異常終了後、2 秒ごとに自動再接続。
- 単一リクエストの失敗で Codex 全体をオフライン表示しないよう修正。
- Codex の再接続中も Claude タスクを保持。

## [0.3.1] - 2026-07-30

### 改善

- タスクカードに明確な `CODEX` / `CLAUDE` ラベルを追加。
- 実行中、入力待ち、完了、エラーの色とタスク由来の表示を分離。
- モジュール数変更後に macOS ウィンドウが画面外へ移動する問題を修正。

## [0.3.0] - 2026-07-30

### メジャーアップデート

- Codex Float を Vibe Float へ改名。
- macOS / Windows に Claude Code の最近のタスク、Model、Effort、Usage を追加。
- すべてのタスク・制御モジュールを選択可能にし、配置を自動調整。
- Codex と Claude に個別の Usage 表示と進捗リングを追加。

## [0.2.5] - 2026-07-30

### 改善

- macOS で Dock アイコンを表示しないフローティングツールへ復帰。
- 更新、設定、終了を行えるメニューバー項目を追加。

## [0.2.4] - 2026-07-30

### 改善

- macOS アプリを Dock に表示し、Dock メニューと `⌘Q` で終了可能に変更。

## [0.2.3] - 2026-07-30

### デザイン

- タスクカード、Sol Effort、Usage リングを表現するアプリアイコンへ刷新。
- macOS と Windows 用のマルチサイズアイコンを生成。

## [0.2.2] - 2026-07-30

### 追加

- macOS と Windows へ統一アプリアイコンを導入。
- macOS DMG / ZIP、Windows ZIP、StreamDock プラグインのダウンロード方法を追加。

## [0.2.1] - 2026-07-30

### 改善

- タスク状態をイベント駆動更新へ変更し、独立した 0.8 秒ポーリングを追加。
- タスク、Usage、モデル、設定リクエストを分離。
- タスク、モデル、権限、Effort、Usage、通知に対応する汎用 StreamDock プラグインを公開。

## [0.2.0] - 2026-07-30

### 初回公開

- macOS 向け SwiftUI と Windows 向け WPF アプリを公開。
- 最近の Codex タスク 3 件、Sol Effort、週間 Usage、常に手前、移動、サイズ変更に対応。
- すべての状態をローカル Codex app-server から取得。

[0.5.5]: https://github.com/saheru/vibe-float/releases/tag/v0.5.5
[0.5.4]: https://github.com/saheru/vibe-float/releases/tag/v0.5.4
[0.5.3]: https://github.com/saheru/vibe-float/releases/tag/v0.5.3
[0.5.2]: https://github.com/saheru/vibe-float/releases/tag/v0.5.2
[0.5.1]: https://github.com/saheru/vibe-float/releases/tag/v0.5.1
[0.5.0]: https://github.com/saheru/vibe-float/releases/tag/v0.5.0
[0.4.0]: https://github.com/saheru/vibe-float/releases/tag/v0.4.0
[0.3.2]: https://github.com/saheru/vibe-float/releases/tag/v0.3.2
[0.3.1]: https://github.com/saheru/vibe-float/releases/tag/v0.3.1
[0.3.0]: https://github.com/saheru/vibe-float/releases/tag/v0.3.0
[0.2.5]: https://github.com/saheru/vibe-float/releases/tag/v0.2.5
[0.2.4]: https://github.com/saheru/vibe-float/releases/tag/v0.2.4
[0.2.3]: https://github.com/saheru/vibe-float/releases/tag/v0.2.3
[0.2.2]: https://github.com/saheru/vibe-float/releases/tag/v0.2.2
[0.2.1]: https://github.com/saheru/vibe-float/releases/tag/v0.2.1
[0.2.0]: https://github.com/saheru/vibe-float/releases/tag/v0.2.0
