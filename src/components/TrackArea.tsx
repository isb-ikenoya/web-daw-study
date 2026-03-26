import { Container, Graphics, Text } from "@pixi/react";
import { Fragment, memo, useCallback, useRef, type ReactNode } from "react";
import * as PIXI from "pixi.js";
import {
  TRACK_AREA_OFFSET_Y,
  TRACK_BORDER_HEIGHT,
  TRACK_COLOR_BG,
  TRACK_CONTAINER_WIDTH,
  TRACK_HEADER_WIDTH,
  TRACK_HEIGHT,
} from "@/util/trackSettings";
//import type { AudioTrack } from "@/contexts/AudioEngineContext";
import { AudioNote, AudioTrack } from "@/types/project";
import { convertDurationToPixel, convertStartTimeToPosition } from "@/util/projectSettings";
import { TrackSeparator } from "./PixiTrackComponents";
import { useAudio } from "@/contexts/AudioEngineContext";

// ==========================================
// 定数定義 (親コンポーネントでも計算に使うため export します)
// ==========================================

// ==========================================
// 型定義
// ==========================================
interface TrackAreaProps {
  tracks: Map<string, AudioTrack>;
  scrollTop: number; // ★追加: 親からのスクロール量
  scrollX: number;
  pixiRef: React.Ref<PIXI.Container>; // ★追加: 座標変換(toLocal)用
  dragPreview: DragPreviewState;
}

interface TrackContainerProps {
  posY: number;
  width: number;
  children?: ReactNode;
}

interface TrackNoteProps {
  trackId: string;
  noteId: string;
  noteName: string;
  color: number;
  posX: number;
  duration: number;
  dragStart: (event: PIXI.FederatedPointerEvent) => void;
}

interface TrackListProps {
  width: number;
  tracks: Map<string, AudioTrack>;
}

export interface DragPreviewState {
  isVisible: boolean;
  x: number; // ローカルX座標
  trackIndex: number; // 何番目のトラックか
}

// ==========================================
// 2. トラックコンテナ (背景のみ)
// ==========================================
const TrackContainer = memo(({ posY, width, children }: TrackContainerProps) => {
  const drawBackground = useCallback(
    (g: PIXI.Graphics) => {
      g.clear();
      g.beginFill(TRACK_COLOR_BG);
      g.drawRect(0, 0, width, TRACK_HEIGHT);
      g.endFill();
    },
    [width]
  );

  return (
    <Container position={[0, posY]}>
      {/* 背景 */}
      <Graphics draw={drawBackground} />
      {/* コンテンツ */}
      {children}
    </Container>
  );
});

// ==========================================
// 3. トラックコンテンツ (中身)
// ==========================================
const TrackNote = memo((props: TrackNoteProps) => {
  const { trackId, noteId, noteName, color, posX, duration, dragStart } = props;
  const { commitNotePosition } = useAudio();

  // 1. PixiJS の Container インスタンスへの参照
  const containerRef = useRef<PIXI.Container>(null);

  // ドラッグ管理用の変数 (レンダリングに影響させない)
  const dragData = useRef<{ isDragging: boolean; startX: number; dragStartX: number } | null>(null);

  const onDragMove = useCallback(
    (event: PIXI.FederatedPointerEvent) => {
      if (!dragData.current || !dragData.current.isDragging || !containerRef.current) return;

      // 1. 親コンテナ内でのマウス位置を取得
      const localPos = event.getLocalPosition(containerRef.current.parent);

      // 2. 移動量の計算
      const deltaX = localPos.x - dragData.current.startX;
      let newX = dragData.current.dragStartX + deltaX;

      // 3. 範囲の制限 (クランプ)
      // ノートの幅を取得 (durationから計算するか、Graphicsの幅を使用)
      const noteWidth = convertDurationToPixel(duration);
      const minX = 0 - TRACK_HEADER_WIDTH; // 左端 (0秒地点)
      const maxX = TRACK_CONTAINER_WIDTH - noteWidth; // 右端

      // newX を minX と maxX の間に収める
      newX = Math.max(minX, Math.min(newX, maxX));

      // 4. 直接座標を更新
      containerRef.current.x = newX;
    },
    [duration]
  ); // duration が変わった場合も考慮

  const onDragStart = useCallback(
    (event: PIXI.FederatedPointerEvent) => {
      if (!containerRef.current) return;

      // 現在のマウス位置を取得
      const localPos = event.getLocalPosition(containerRef.current.parent);

      dragData.current = {
        isDragging: true,
        startX: localPos.x,
        dragStartX: containerRef.current.x,
      };

      // イベントをこのオブジェクトで固定する（画面外に出ても追跡するため）
      event.currentTarget.on("pointermove", onDragMove);
    },
    [onDragMove]
  );

  const onDragEnd = useCallback(() => {
    if (!dragData.current || !containerRef.current) return;

    // 3. ドラッグ終了時に React の State に最終座標を反映させる
    const finalX = containerRef.current.x + TRACK_HEADER_WIDTH;
    commitNotePosition(trackId, noteId, finalX); // ここで初めて再描画が走る

    dragData.current.isDragging = false;
    // イベント解除
    containerRef.current.off("pointermove", onDragMove);
  }, [trackId, noteId, commitNotePosition, onDragMove]);

  console.log("再描画", noteName);
  const width = convertDurationToPixel(duration);
  const drawRect = useCallback(
    (g: PIXI.Graphics) => {
      g.clear();
      g.beginFill(color);
      g.drawRect(0, 0, width, TRACK_HEIGHT);
      g.endFill();
    },
    [color, width]
  );

  return (
    <Container
      ref={containerRef}
      position={[posX, 0]}
      pointerdown={onDragStart}
      pointerup={onDragEnd}
      pointerupoutside={onDragEnd}
      eventMode="static"
      cursor="pointer"
    >
      <Graphics draw={drawRect} />
      <Text
        text={noteName}
        style={
          new PIXI.TextStyle({
            fill: "white",
            fontSize: 11,
            // 1. 折り返しを有効にする
            wordWrap: true,
            // 2. 幅を「Containerの幅(100) - 左右の余白」に設定する
            wordWrapWidth: width - 10,
            // 3. 行の高さを極端に小さくするか、高さを固定的に捉える
            breakWords: true,
          })
        }
        anchor={[0, 0]}
        x={3}
        y={3}
        // 4. 文字が縦にはみ出るのを防ぐために、高さを制限する（マスク代わり）
        mask={null}
      />
    </Container>
  );
});

const TrackList = memo(({ width, tracks }: TrackListProps) => {
  const unitHeight = TRACK_HEIGHT + TRACK_BORDER_HEIGHT;
  const dragStart = useCallback((event: PIXI.FederatedPointerEvent) => {
    console.log(event);
  }, []);

  return (
    <Container>
      {Array.from(tracks.values()).map((track, index) => {
        const trackY = TRACK_BORDER_HEIGHT + index * unitHeight;
        const bottomLineY = trackY + TRACK_HEIGHT;

        return (
          <Fragment key={track.id || index}>
            {/* 1. トラック本体 */}
            <TrackContainer posY={trackY} width={width}>
              <Container position={[TRACK_HEADER_WIDTH, 0]}>
                {Array.from((track.notes as Map<string, AudioNote>).values()).map(
                  (note: AudioNote) => {
                    return (
                      <TrackNote
                        key={note.id}
                        trackId={track.id}
                        noteId={note.id}
                        noteName={note.noteName}
                        color={0xff0000}
                        posX={convertStartTimeToPosition(note.when)}
                        duration={note.audioBuffer?.duration ?? 0}
                        dragStart={dragStart}
                      />
                    );
                  }
                )}
              </Container>
            </TrackContainer>

            {/* 2. トラックの下にある線を描画 */}
            <TrackSeparator posY={bottomLineY} width={width} />
          </Fragment>
        );
      })}
    </Container>
  );
});

const GhostNote = memo(({ x, trackIndex }: { x: number; trackIndex: number }) => {
  const unitHeight = TRACK_HEIGHT + TRACK_BORDER_HEIGHT;

  // Y座標の計算:
  // (トラック番号 * 1ユニットの高さ) + 線(border)の高さ
  // これにより、線の上に重ならず、トラックの内側に綺麗に収まります
  const y = trackIndex * unitHeight + TRACK_BORDER_HEIGHT;

  const draw = useCallback((g: PIXI.Graphics) => {
    g.clear();
    // 半透明の白枠 + 赤い縁取り
    g.lineStyle(2, 0xff0000, 0.8);
    g.beginFill(0xffffff, 0.3);
    g.drawRect(0, 0, 100, TRACK_HEIGHT);
    g.endFill();
  }, []);

  return (
    /* トラックヘッダー分ずらす */
    <Container position={[x /*- TRACK_HEADER_WIDTH*/, y]}>
      <Graphics draw={draw} />
    </Container>
  );
});

// ==========================================
// 4. メインコンポーネント
// Stageは親にあるので、ここは Container を返すだけにする
// ==========================================
const TrackArea = memo(({ tracks, scrollTop, scrollX, pixiRef, dragPreview }: TrackAreaProps) => {
  const currentY = TRACK_AREA_OFFSET_Y - scrollTop;

  return (
    // 全体の基準となるコンテナ（垂直スクロールのみ適用）
    <Container position={[0, currentY]} ref={pixiRef} eventMode="static">
      {/* 1. 横スクロールするレイヤー (波形・グリッドなど) */}
      <Container x={-scrollX + TRACK_HEADER_WIDTH}>
        {/* 最上部の線 */}
        <TrackSeparator posY={0} width={TRACK_CONTAINER_WIDTH} />

        {/* トラックリスト (背景とノート) */}
        <TrackList width={TRACK_CONTAINER_WIDTH} tracks={tracks} />

        {/* ドラッグ中のプレビュー */}
        {dragPreview.isVisible && (
          <GhostNote x={dragPreview.x} trackIndex={dragPreview.trackIndex} />
        )}
      </Container>

      {/* 注: もし DawEditor.tsx 側で TrackHeaderArea を別に呼んでいる場合は、
         このファイル内には書かず、DawEditor.tsx 側で順番（Z-index）を調整します。
      */}
    </Container>
  );
});

export default TrackArea;
