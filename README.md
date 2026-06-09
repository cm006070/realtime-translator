# Realtime Voice Translator - fixed test version

OpenAI Realtime API を使ったリアルタイム音声翻訳アプリです。

## この修正版の目的

オンライン英会話で「相手 → 自分 → 相手」の2回目の相手音声が認識されない問題を切り分けるため、以下を変更しました。

- オンライン会議モードを追加
  - `echoCancellation: false`
  - `noiseSuppression: false`
  - `autoGainControl: false`
- OpenAI側の `near_field` noise reduction をデフォルトOFF
- 録音開始時に入力音声バッファをクリア
- `speech_started` / `speech_stopped` / `committed` などを画面の診断ログに表示
- 音量メーターを追加
- `public/index.html` を正しい配置に整理

## 使い方

```bash
npm install
OPENAI_API_KEY=your_api_key npm start
```

ブラウザで `http://localhost:3000` を開きます。

## テスト手順

1. 「オンライン会議モード（エコー除去OFF）」を選ぶ
2. 録音開始
3. 相手が話す
4. 自分が話す
5. 相手がもう一度話す
6. 診断ログに `speech_started` が出るか確認

相手2回目で音量メーターは動くのに `speech_started` が出ない場合、VAD/音声前処理の問題です。
音量メーターも動かない場合、ブラウザやOS側で相手音声がマイク入力に入っていません。
