import { Box, styled } from "@mui/material";
import { Stage } from "@pixi/react";
import * as PIXI from "pixi.js";
import { useCallback, useRef, useState } from "react";
import TrackArea, { type DragPreviewState } from "@/components/TrackArea";
import PlayHeader from "@/components/PlayHeader";
import DawRuler from "@/components/DawRuler";
import { useContainerSize } from "@/hooks/useContainerSize";
import {
  TRACK_AREA_OFFSET_Y,
  TRACK_BORDER_HEIGHT,
  TRACK_CONTAINER_WIDTH,
  TRACK_HEADER_WIDTH,
  TRACK_HEIGHT,
} from "@/util/trackSettings";
import { AudioContext, useAudio } from "@/contexts/AudioEngineContext";
import { VirtualHorizontalScrollbar } from "./VirtualHorizontalScrollbar";
import TrackHeaderArea from "./TrackHeaderArea";
import PlaybackHead from "./PlaybackHead";

// ... (スタイル定義 DawEditorContainer, TrackContainer はそのまま) ...
const DawEditorContainer = styled(Box)({
  padding: "0",
  margin: "0",
  width: "100%",
  height: "100%",
  boxSizing: "border-box",
  display: "flex",
  flexFlow: "column",
  backgroundColor: "cyan",
  overflow: "hidden",
});

const TrackContainer = styled(Box)({
  padding: "0",
  margin: "0",
  width: "100%",
  height: "100%",
  boxSizing: "border-box",
  display: "block",
  backgroundColor: "#1e1e1e",
  overflowY: "auto",
  overflowX: "hidden",
  position: "relative",
});

const DawEditor = () => {
  const audioValue = useAudio();
  const { getAudioBufferFromFile, getTracksInfo, getTrackFromIndex, addNote } = audioValue;
  const tracks = getTracksInfo();

  const { ref: containerRef, size } = useContainerSize();
  const trackAreaPixiRef = useRef<PIXI.Container>(null);
  const [scrollTop, setScrollTop] = useState(0);
  // ★ドラッグプレビュー用のState
  const [dragPreview, setDragPreview] = useState<DragPreviewState>({
    isVisible: false,
    x: 0, // トラックヘッダーを含まない座標
    trackIndex: 0,
  });

  const [scrollX, setScrollX] = useState(0);

  const unitHeight = TRACK_HEIGHT + TRACK_BORDER_HEIGHT;
  const contentHeight = TRACK_AREA_OFFSET_Y + tracks.size * unitHeight + 200;

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  }, []);

  const handleDragOver = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = "copy";

      if (!containerRef.current || !trackAreaPixiRef.current) return;

      // 1. 座標取得
      const rect = containerRef.current.getBoundingClientRect();
      const globalX = e.clientX - rect.left;
      const globalY = e.clientY - rect.top;

      // 2. toLocal変換
      const globalPoint = new PIXI.Point(globalX, globalY);
      const localPoint = trackAreaPixiRef.current.toLocal(globalPoint);

      // --- ここから範囲判定の追加 ---

      // TrackAreaのサイズを取得 (getBounds または直接のサイズ変数)
      // getBounds()を使うと、スクロールやスケールを加味した現在の実サイズが取れます
      //const bounds = trackAreaPixiRef.current.getBounds();

      // ローカル座標での幅と高さを判定基準にする場合
      // もし TrackArea に width/height プロパティを設定しているならそれを使います
      const areaWidth = trackAreaPixiRef.current.width;
      const areaHeight = tracks.size * unitHeight; // トラック全体の高さ

      const isOutside =
        localPoint.x < TRACK_HEADER_WIDTH ||
        localPoint.x > areaWidth ||
        localPoint.y < 0 ||
        localPoint.y > areaHeight;

      if (isOutside) {
        setDragPreview((prev) => (prev.isVisible ? { ...prev, isVisible: false } : prev));
        return;
      }

      // --- 範囲判定ここまで ---

      const trackIndex = Math.floor(localPoint.y / unitHeight);
      const maxIndex = tracks.size - 1;
      const clampedIndex = Math.max(0, Math.min(trackIndex, maxIndex));

      setDragPreview({
        isVisible: true,
        x: localPoint.x - TRACK_HEADER_WIDTH + scrollX,
        trackIndex: clampedIndex,
      });
    },
    [tracks.size, unitHeight, containerRef, trackAreaPixiRef, scrollX]
  );

  const handleDrop = useCallback(
    async (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      if (!containerRef.current || !trackAreaPixiRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const globalX = e.clientX - rect.left;
      const globalY = e.clientY - rect.top;
      const globalPoint = new PIXI.Point(globalX, globalY);
      const localPoint = trackAreaPixiRef.current.toLocal(globalPoint);
      //const droppedY = localPoint.y;
      if (localPoint.x < TRACK_HEADER_WIDTH) {
        setDragPreview((prev) => {
          return { ...prev, isVisible: false };
        });
        return;
      }
      const droppedX = localPoint.x - TRACK_HEADER_WIDTH + scrollX;
      console.log(droppedX);
      const trackIndex = Math.floor(localPoint.y / unitHeight);

      if (trackIndex > tracks.size - 1 || trackIndex < 0) {
        // 範囲外の場合は処理を終了する
        return;
      }

      const currentTrack = getTrackFromIndex(trackIndex);

      const file = e.dataTransfer.files[0];
      if (!file || !file.type.startsWith("audio/")) {
        setDragPreview((prev) => {
          return { ...prev, isVisible: false };
        });
        alert("音声ファイルをドロップしてください");
        return;
      }

      // AudioBuffer変換
      try {
        const audioBuffer = await getAudioBufferFromFile(file);
        addNote(currentTrack.id, droppedX, file.name, audioBuffer);
      } catch (err) {
        alert(err);
      } finally {
        setDragPreview((prev) => {
          return { ...prev, isVisible: false };
        });
      }
    },
    [containerRef, unitHeight, getTrackFromIndex, addNote, tracks, getAudioBufferFromFile, scrollX]
  );

  const onDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragPreview((prev) => {
      return { ...prev, isVisible: false };
    });
  }, []);

  return (
    <DawEditorContainer>
      <PlayHeader />

      <TrackContainer
        ref={containerRef}
        onScroll={handleScroll}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onDragLeave={onDragLeave}
      >
        {/* 1. ダミーの高さを持つdiv (スクロールバー生成用) */}
        <div style={{ height: contentHeight, width: "100%" }}>
          {/* 2. スティッキーコンテナ 
            【重要修正】
            height: "100%" ではなく、size.height (画面の高さ) を指定します。
            これで「中身は5000pxあるけど、表示窓は300pxだよ」とブラウザに伝わり、
            stickyが正しく機能して画面内に固定されます。
          */}
          <div
            style={{
              position: "sticky",
              top: 0,
              height: size.height, // ★ここを修正 (100% -> size.height)
              overflow: "hidden",
              display: "flex",
              flexFlow: "row",
            }}
          >
            <Stage
              width={size.width}
              height={size.height}
              options={{ backgroundColor: 0x1e1e1e, antialias: true }}
              style={{ display: "block" }}
            >
              <AudioContext.Provider value={audioValue}>
                {/* 1. トラックの中身（スクロールする） */}
                <TrackArea
                  tracks={tracks}
                  pixiRef={trackAreaPixiRef}
                  scrollTop={scrollTop}
                  scrollX={scrollX}
                  dragPreview={dragPreview}
                />

                {/* 2. トラックヘッダー（横には固定、縦には scrollTop で動く） */}
                <TrackHeaderArea
                  tracks={tracks}
                  width={TRACK_HEADER_WIDTH}
                  height={size.height}
                  scrollTop={scrollTop}
                />

                {/* 3. ルーラー（最前面に固定） */}
                <DawRuler width={size.width} height={TRACK_AREA_OFFSET_Y} scrollX={scrollX} />
                <PlaybackHead scrollX={scrollX} />
              </AudioContext.Provider>
            </Stage>
          </div>
        </div>
      </TrackContainer>

      {/* 水平方向スクロールバー */}
      {size.width > 0 && (
        <VirtualHorizontalScrollbar
          viewportWidth={size.width}
          contentWidth={TRACK_CONTAINER_WIDTH}
          scrollX={scrollX}
          onScrollXChange={setScrollX}
        />
      )}
    </DawEditorContainer>
  );
};

export default DawEditor;
