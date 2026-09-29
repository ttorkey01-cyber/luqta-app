type PlaybackStatus = { isLoaded: boolean; didJustFinish: boolean };

export type StartupAudioPlayer = {
  volume: number;
  loop: boolean;
  currentStatus: PlaybackStatus;
  addListener(
    event: 'playbackStatusUpdate',
    listener: (status: PlaybackStatus) => void,
  ): { remove(): void };
  seekTo(seconds: number): Promise<void>;
  play(): void;
  pause(): void;
  release(): void;
};

/**
 * One controller per JS process. Claim the cold launch before loading audio so
 * failures, navigation and a background/resume cycle never retry the sound.
 */
export function createStartupSonicLogoController(createPlayer: () => StartupAudioPlayer) {
  let claimed = false;
  let stopCurrent: (() => void) | undefined;
  let resolveStart: ((played: boolean) => void) | undefined;
  const started = new Promise<boolean>((resolve) => { resolveStart = resolve; });
  const settleStart = (played: boolean) => {
    resolveStart?.(played);
    resolveStart = undefined;
  };

  return {
    start(isForeground = true) {
      if (claimed) return;
      claimed = true;
      if (!isForeground) {
        settleStart(false);
        return;
      }

      let player: StartupAudioPlayer;
      try {
        player = createPlayer();
      } catch {
        settleStart(false);
        return;
      }

      let cleaned = false;
      let playRequested = false;
      let subscription: { remove(): void } | undefined;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const stop = () => {
        if (cleaned) return;
        cleaned = true;
        settleStart(false);
        if (timeout) clearTimeout(timeout);
        try { subscription?.remove(); } catch { /* Never delay app startup. */ }
        try { player.pause(); } catch { /* The player may have failed to load. */ }
        try { player.release(); } catch { /* The native resource may already be gone. */ }
        stopCurrent = undefined;
      };
      stopCurrent = stop;

      const onStatus = (status: PlaybackStatus) => {
        if (cleaned) return;
        if (status.didJustFinish) {
          stop();
          return;
        }
        if (!status.isLoaded || playRequested) return;
        playRequested = true;
        try {
          void player.seekTo(0)
            .then(() => {
              if (cleaned) return;
              try {
                player.play();
                settleStart(true);
              } catch { stop(); }
            })
            .catch(stop);
        } catch {
          stop();
        }
      };

      try {
        player.loop = false;
        player.volume = 0.6;
        subscription = player.addListener('playbackStatusUpdate', onStatus);
        // A failed load may never emit a completion event; release it anyway.
        timeout = setTimeout(stop, 10_000);
        onStatus(player.currentStatus);
      } catch {
        stop();
      }
    },
    stop() {
      stopCurrent?.();
    },
    /** Give the native splash a brief chance to overlap playback, never the whole clip. */
    async waitForStart(maxWaitMs: number): Promise<boolean> {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          started,
          new Promise<boolean>((resolve) => {
            timer = setTimeout(() => resolve(false), maxWaitMs);
          }),
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    },
  };
}