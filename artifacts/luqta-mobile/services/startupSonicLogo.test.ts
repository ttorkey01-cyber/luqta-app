import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createStartupSonicLogoController,
  type StartupAudioPlayer,
} from './startupSonicLogo';

type Status = StartupAudioPlayer['currentStatus'];

function fakePlayer(initiallyLoaded = false) {
  const calls = { play: 0, pause: 0, release: 0, seek: [] as number[], removed: 0 };
  let listener: ((status: Status) => void) | undefined;
  const player: StartupAudioPlayer = {
    volume: 1,
    loop: true,
    currentStatus: { isLoaded: initiallyLoaded, didJustFinish: false },
    addListener(_event, next) {
      listener = next;
      return { remove() { calls.removed += 1; listener = undefined; } };
    },
    async seekTo(seconds) { calls.seek.push(seconds); },
    play() { calls.play += 1; },
    pause() { calls.pause += 1; },
    release() { calls.release += 1; },
  };
  return {
    player,
    calls,
    emit(status: Status) { player.currentStatus = status; listener?.(status); },
  };
}

test('cold foreground start plays from zero once, does not loop, and releases on completion', async () => {
  const sound = fakePlayer();
  const startup = createStartupSonicLogoController(() => sound.player);
  startup.start();
  assert.equal(sound.calls.play, 0);
  assert.equal(sound.player.volume, 0.6);
  assert.equal(sound.player.loop, false);

  sound.emit({ isLoaded: true, didJustFinish: false });
  await Promise.resolve();
  sound.emit({ isLoaded: true, didJustFinish: false });
  assert.deepEqual(sound.calls.seek, [0]);
  assert.equal(sound.calls.play, 1);

  sound.emit({ isLoaded: true, didJustFinish: true });
  assert.equal(sound.calls.release, 1);
  assert.equal(sound.calls.removed, 1);
  startup.start();
  assert.equal(sound.calls.play, 1);
});

test('cached-font splash waits briefly for first playback, not for the clip to finish', async () => {
  const sound = fakePlayer();
  const startup = createStartupSonicLogoController(() => sound.player);
  startup.start();
  const overlap = startup.waitForStart(300);
  let resolved = false;
  void overlap.then(() => { resolved = true; });
  await Promise.resolve();
  assert.equal(resolved, false);
  sound.emit({ isLoaded: true, didJustFinish: false });
  assert.equal(await overlap, true);
  assert.equal(sound.calls.play, 1);
  assert.equal(sound.calls.release, 0);
  startup.stop();

  const late = fakePlayer();
  const anotherStartup = createStartupSonicLogoController(() => late.player);
  anotherStartup.start();
  assert.equal(await anotherStartup.waitForStart(1), false);
  late.emit({ isLoaded: true, didJustFinish: false });
  await Promise.resolve();
  assert.equal(late.calls.play, 1);
  anotherStartup.stop();
});

test('background-only launch never plays on later foreground start', () => {
  let created = 0;
  const startup = createStartupSonicLogoController(() => {
    created += 1;
    return fakePlayer(true).player;
  });
  startup.start(false);
  startup.start(true);
  assert.equal(created, 0);
});

test('background stop unloads audio without replay on resume or navigation', async () => {
  const sound = fakePlayer(true);
  const startup = createStartupSonicLogoController(() => sound.player);
  startup.start();
  await Promise.resolve();
  assert.equal(sound.calls.play, 1);
  startup.stop();
  startup.stop();
  startup.start();
  assert.equal(sound.calls.release, 1);
  assert.equal(sound.calls.play, 1);
});

test('creation and seek failures cannot block startup or retry the sound', async () => {
  let attempts = 0;
  const failed = createStartupSonicLogoController(() => {
    attempts += 1;
    throw new Error('Audio unavailable');
  });
  assert.doesNotThrow(() => failed.start());
  failed.start();
  assert.equal(attempts, 1);

  const sound = fakePlayer(true);
  sound.player.seekTo = async () => { throw new Error('Audio unavailable'); };
  const startup = createStartupSonicLogoController(() => sound.player);
  assert.doesNotThrow(() => startup.start());
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(sound.calls.release, 1);
  assert.equal(sound.calls.play, 0);
});