import { AudioNote, AudioTrack } from "@/types/project";
import { convertPositionToStartTime } from "@/util/projectSettings";
import {
  createContext,
  useContext,
  useRef,
  useCallback,
  useMemo,
  useState,
  type ReactNode,
  useEffect,
} from "react";
//import { useTrackDataStore } from "./TrackDataStoreContext";

// コンテキストの型定義
export interface AudioContextType {
  playTone: (frequency: number) => void;
  playPiano: (frequency: number) => void;
  initialize: () => Promise<void>;
  getAudioBufferFromFile: (file: File) => Promise<AudioBuffer>;
  playNote: (buffer: AudioBuffer, when: number, offset: number, trackNode: GainNode) => void;
  playBackAll: (tracks: Map<string, AudioTrack>) => void;
  stopAll: () => void;
  getContext: () => AudioContext | null;
  addTrack: () => void;
  deleteTrack: (id: string) => void;
  addNote: (
    trackId: string,
    posX: number,
    noteName: string,
    audioBuffer: AudioBuffer
  ) => Map<string, AudioTrack>;
  commitNotePosition: (
    trackId: string,
    noteId: string,
    fixedPosX: number
  ) => Map<string, AudioTrack>;
  getTracksInfo: () => Map<string, AudioTrack>;
  getTrackFromIndex: (index: number) => AudioTrack;
  getNoteById: (trackId: string, noteId: string) => AudioNote | null;
  isPlay: boolean;
  getCurrentTime: () => number;
}

/*const defaultNotes = new Map<string, AudioNote>([
  [
    "defaultNode_1",
    {
      id: "defaultNode_1",
      noteName: "test1",
      posX: 50,
    },
  ],
  [
    "defaultNode_2",
    {
      id: "defaultNode_2",
      noteName: "test2",
      posX: 200,
    },
  ],
]);

const defaultTracks = new Map<string, AudioTrack>([
  [
    "default_id",
    {
      id: "default_id",
      trackName: "default_track",
      notes: defaultNotes,
    },
  ],
]);*/

// webkitAudioContext定義追加
declare global {
  interface Window {
    webkitAudioContext: typeof AudioContext;
  }
}

// eslint-disable-next-line react-refresh/only-export-components
export const AudioContext = createContext<AudioContextType | null>(null);

const AudioEngineProvider = ({ children }: { children: ReactNode }) => {
  const [tracks, setTracks] = useState<Map<string, AudioTrack>>(new Map());
  const [isPlay, setIsPlay] = useState<boolean>(false);

  // ポイント1: AudioContextの実体は useRef で持つ (Stateにしない)
  // これにより、AudioContextの中身が変わってもReactの再描画は発生しない
  //const { addTrack } = useTrackDataStore();
  const audioCtxRef = useRef<AudioContext | null>(null);
  const masterGainRef = useRef<GainNode | null>(null);
  const activeSourcesRef = useRef<Map<string, AudioBufferSourceNode>>(new Map());
  const startTime = useRef<number>(0);

  // AudioContextを取得、または生成するヘルパー関数
  const getContext = useCallback(() => {
    // コンテキストが存在しない場合は新規作成
    if (!audioCtxRef.current) {
      // Next.jsなどのSSR対策でwindowチェックを入れるのが一般的
      if (typeof window !== "undefined") {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        audioCtxRef.current = new Ctx();
      }
    }

    return audioCtxRef.current;
  }, []);

  const getCurrentTime = useCallback((): number => {
    if (!isPlay || !audioCtxRef.current) return 0;
    return audioCtxRef.current.currentTime - startTime.current;
  }, [isPlay]);

  const addTrack = useCallback(() => {
    if (!audioCtxRef.current) return;
    const newTrackNode = audioCtxRef.current.createGain();
    // マスターゲインに接続
    if (masterGainRef.current) newTrackNode.connect(masterGainRef.current);
    setTracks((prev) => {
      const newId = crypto.randomUUID();
      const newTrack: AudioTrack = {
        id: newId,
        trackName: `track_${prev.size + 1}`,
        trackNode: newTrackNode,
        notes: new Map<string, AudioNote>(),
      };
      const newTracks = new Map(prev);
      newTracks.set(newId, newTrack);
      return newTracks;
    });
  }, []);

  const deleteTrack = useCallback((id: string) => {
    setTracks((prev) => {
      const newTracks = new Map(prev);
      newTracks.delete(id);
      return newTracks;
    });
  }, []);

  const addNote = useCallback(
    (trackId: string, posX: number, noteName: string, audioBuffer: AudioBuffer) => {
      setTracks((prev) => {
        const targetTrack = prev.get(trackId);
        if (!targetTrack) {
          return prev;
        }
        const newNoteId = crypto.randomUUID();
        const when = convertPositionToStartTime(posX);
        const newNote: AudioNote = {
          id: newNoteId,
          noteName: noteName,
          when: when,
          posX: posX,
          audioBuffer: audioBuffer,
        };
        const newTracks = new Map(prev);
        const updatedTrack = { ...targetTrack };
        const newNotes = new Map(targetTrack.notes);
        newNotes.set(newNoteId, newNote);
        updatedTrack.notes = newNotes;
        newTracks.set(trackId, updatedTrack);

        // ★ 再生中の個別スケジュール更新
        if (isPlay) {
          const ctx = getContext();
          if (ctx) {
            const currentProgress = getCurrentTime();

            // 2. 「新しい位置」が現在時刻より未来であれば、新しく予約する
            if (when >= currentProgress) {
              const source = ctx.createBufferSource();
              if (newNote.audioBuffer) {
                source.buffer = newNote.audioBuffer;
                source.connect(targetTrack.trackNode);

                // startTime.current を基準にした新位置で開始
                source.start(startTime.current + when, 0);

                // 新しい Node を登録
                activeSourcesRef.current.set(newNoteId, source);
                source.onended = () => activeSourcesRef.current.delete(newNoteId);
              }
            }
          }
        }
        return newTracks;
      });
      return tracks;
    },
    [tracks, getContext, getCurrentTime, isPlay]
  );

  const commitNotePosition = useCallback(
    (trackId: string, noteId: string, fixedPosX: number) => {
      setTracks((prev) => {
        const track = prev.get(trackId);
        if (!track) return prev;
        const note = track.notes.get(noteId);
        if (!note) return prev;

        const newWhen = convertPositionToStartTime(fixedPosX);
        const newNote = { ...note, posX: fixedPosX, when: newWhen };

        const newNotes = new Map(track.notes);
        newNotes.set(noteId, newNote);

        const newTracks = new Map(prev);
        newTracks.set(trackId, { ...track, notes: newNotes });

        // ★ 再生中の個別スケジュール更新
        if (isPlay) {
          const ctx = getContext();
          if (ctx) {
            const currentProgress = getCurrentTime();

            // 1. 動かしたノートの「古い再生予約」があれば止める
            const oldSource = activeSourcesRef.current.get(noteId);
            if (oldSource) {
              try {
                oldSource.stop();
              } catch (e) {
                console.error(e);
              }
              oldSource.disconnect();
              activeSourcesRef.current.delete(noteId);
            }

            // 2. 「新しい位置」が現在時刻より未来であれば、新しく予約する
            if (newWhen >= currentProgress) {
              const source = ctx.createBufferSource();
              if (newNote.audioBuffer) {
                source.buffer = newNote.audioBuffer;
                source.connect(track.trackNode);

                // startTime.current を基準にした新位置で開始
                source.start(startTime.current + newWhen, 0);

                // 新しい Node を登録
                activeSourcesRef.current.set(noteId, source);
                source.onended = () => activeSourcesRef.current.delete(noteId);
              }
            }
          }
        }

        return newTracks;
      });
      return tracks;
    },
    [isPlay, getCurrentTime, getContext, tracks]
  );

  const getTracksInfo = useCallback(() => {
    return tracks;
  }, [tracks]);

  const getTrackFromIndex = useCallback(
    (index: number) => {
      const tracksArray = Array.from(tracks.values());
      return tracksArray[index];
    },
    [tracks]
  );

  const initialize = useCallback(async () => {
    const ctx = getContext();
    if (!ctx) return;

    // マスターノード作成、接続（初回のみ）
    if (!masterGainRef.current) {
      const masterGain = ctx.createGain();
      masterGain.connect(ctx.destination);
      masterGainRef.current = masterGain;
      console.log("addInitTrack");
      addTrack();
    }
  }, [getContext, addTrack]);

  const playNote = useCallback(
    async (buffer: AudioBuffer, when: number, offset: number, trackNode: GainNode) => {
      await initialize();
      const ctx = getContext();
      if (!ctx) return;

      if (ctx.state === "suspended") {
        await ctx.resume();
      }
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      // トラックのノードに接続（使い捨てのため再生の度に接続し直す）
      source.connect(trackNode);

      source.start(ctx.currentTime + when, offset);
    },
    [initialize, getContext]
  );

  const playBackAll = useCallback(
    async (tracks: Map<string, AudioTrack>) => {
      await initialize();
      const ctx = getContext();
      if (!ctx) return;

      if (ctx.state === "suspended") {
        await ctx.resume();
      }

      setIsPlay(true);
      startTime.current = ctx.currentTime;

      let maxDuration = 0;
      //let lastSource: AudioBufferSourceNode | null = null;

      // 以前のソースが残っている場合は念のためクリア
      activeSourcesRef.current.forEach((s) => {
        try {
          s.stop();
        } catch (e) {
          console.error(e);
        }
        s.disconnect();
      });
      activeSourcesRef.current.clear();

      tracks.forEach((track) => {
        track.notes.forEach((note) => {
          if (!note.audioBuffer) return;

          // SourceNodeの作成と接続
          const source = ctx.createBufferSource();
          source.buffer = note.audioBuffer;
          source.connect(track.trackNode);

          // 再生スケジュールの計算
          const nodeStartTime = startTime.current + note.when;
          const nodeEndTime = nodeStartTime + note.audioBuffer.duration;

          // Mapに保存 (後で個別操作できるように)
          activeSourcesRef.current.set(note.id, source);

          // 一番最後に終わる時間を記録（isPlayの自動オフ用）
          if (nodeEndTime > maxDuration) {
            maxDuration = nodeEndTime;
            //lastSource = source;
          }

          // 再生終了時のクリーンアップ
          source.onended = () => {
            // 自分のIDをMapから削除
            activeSourcesRef.current.delete(note.id);

            // 全ての音が鳴り終わったら再生状態を解除
            /*if (activeSourcesRef.current.size === 0) {
              setIsPlay(false);
            }*/
          };

          // 発音予約
          source.start(nodeStartTime, 0);
        });
      });

      // 再生するものがない場合
      if (activeSourcesRef.current.size === 0) {
        setIsPlay(false);
      }
    },
    [getContext, initialize]
  );

  const stopAll = useCallback(() => {
    // 全てのSourceNodeを停止
    activeSourcesRef.current.forEach((source) => {
      try {
        source.stop();
      } catch (e) {
        console.error(e);
      }
      source.disconnect();
    });
    // リストを空にする
    activeSourcesRef.current.clear();
    setIsPlay(false);
  }, []);

  // 音を鳴らす関数の例
  const playTone = useCallback(
    (frequency: number) => {
      const ctx = getContext();
      if (!ctx) return;

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.frequency.value = frequency;
      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start();
      gain.gain.exponentialRampToValueAtTime(0.00001, ctx.currentTime + 1);
      osc.stop(ctx.currentTime + 1);
    },
    [getContext]
  );

  const playPiano = useCallback(
    (frequency: number) => {
      const ctx = getContext();
      if (!ctx) return;

      const t = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      // 1. 波形を「トライアングル（三角波）」にする
      // sine(丸い音)より倍音が含まれ、ピアノやフルートに近い音になります
      osc.type = "triangle";
      osc.frequency.value = frequency;

      osc.connect(gain);
      gain.connect(ctx.destination);

      // 2. ピアノ特有の「減衰」を作る（エンベロープ）
      // アタック: 鍵盤を叩いた瞬間（0秒〜0.02秒）で急激に音量を上げる
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.5, t + 0.02); // 音量は0.5くらいに抑える

      // ディケイ: 叩いた後は、弦の振動が自然に消えるように長く減衰させる
      // 1.5秒かけて音が消えていく
      gain.gain.exponentialRampToValueAtTime(0.001, t + 1.5);

      osc.start(t);
      // 音が消えきるタイミングで停止
      osc.stop(t + 1.5);
    },
    [getContext]
  );

  const getAudioBufferFromFile = useCallback(
    async (file: File): Promise<AudioBuffer> => {
      const context = getContext();
      if (!context) {
        throw new Error("AudioBuffer デコード失敗");
      }

      const arrayBuffer = await file.arrayBuffer();
      const audioBuffer = await context.decodeAudioData(arrayBuffer);
      return audioBuffer;
    },
    [getContext]
  );

  const getNoteById = useCallback(
    (trackId: string, noteId: string): AudioNote | null => {
      // 1. 指定されたトラックを取得
      const targetTrack = tracks.get(trackId);

      if (!targetTrack) {
        console.warn(`Track with ID ${trackId} not found.`);
        return null;
      }

      // 2. トラック内の notes Map から指定されたノートを取得
      const targetNote = targetTrack.notes.get(noteId);

      if (!targetNote) {
        console.warn(`Note with ID ${noteId} not found in track ${trackId}.`);
        return null;
      }

      return targetNote;
    },
    [tracks]
  );

  useEffect(() => {
    const initializeAudio = async () => {
      await initialize();
    };
    initializeAudio();
  }, [initialize]);

  // ポイント3: 公開する値を useMemo で固定する
  // 依存配列が空（または固定）なので、このオブジェクトの参照は永続的に変わらない
  const contextValue = useMemo(
    () => ({
      initialize,
      playTone,
      playPiano,
      getAudioBufferFromFile,
      playNote,
      playBackAll,
      stopAll,
      getContext,
      addTrack,
      deleteTrack,
      addNote,
      commitNotePosition,
      getTracksInfo,
      getTrackFromIndex,
      getNoteById,
      isPlay,
      getCurrentTime,
    }),
    [
      initialize,
      playTone,
      playPiano,
      getAudioBufferFromFile,
      playNote,
      playBackAll,
      stopAll,
      getContext,
      addTrack,
      deleteTrack,
      addNote,
      commitNotePosition,
      getTracksInfo,
      getTrackFromIndex,
      getNoteById,
      isPlay,
      getCurrentTime,
    ]
  );

  return <AudioContext.Provider value={contextValue}>{children}</AudioContext.Provider>;
};

// eslint-disable-next-line react-refresh/only-export-components
export const useAudio = () => {
  const context = useContext(AudioContext);
  if (!context) {
    throw new Error("useAudio must be used within an AudioProvider");
  }
  return context;
};

export default AudioEngineProvider;
