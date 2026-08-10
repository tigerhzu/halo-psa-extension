/**
 * pet-animator.js
 * Codex Pets sprite-atlas player. Built-in legacy pets use 8 × 9; imported
 * Codex Pets v2 packages use 8 × 11 and retain the same standard row timings.
 */
(function () {
  'use strict';
  const NS = window.__HPX;

  const ATLAS = {
    columns: 8,
    rows: 9,
    animations: {
      idle:            { row: 0, frames: 6, durations: [280, 110, 110, 140, 140, 320] },
      'running-right': { row: 1, frames: 8, durations: [120, 120, 120, 120, 120, 120, 120, 220] },
      'running-left':  { row: 2, frames: 8, durations: [120, 120, 120, 120, 120, 120, 120, 220] },
      waving:          { row: 3, frames: 4, durations: [140, 140, 140, 280] },
      jumping:         { row: 4, frames: 5, durations: [140, 140, 140, 140, 280] },
      failed:          { row: 5, frames: 8, durations: [140, 140, 140, 140, 140, 140, 140, 240] },
      waiting:         { row: 6, frames: 6, durations: [150, 150, 150, 150, 150, 260] },
      running:         { row: 7, frames: 6, durations: [120, 120, 120, 120, 120, 220] },
      review:          { row: 8, frames: 6, durations: [150, 150, 150, 150, 150, 280] },
    },
  };

  function reducedMotion() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  function paint(target, animationName, frame) {
    const animation = ATLAS.animations[animationName] || ATLAS.animations.idle;
    const safeFrame = Math.max(0, Math.min(Number(frame) || 0, animation.frames - 1));
    const rows = Number(target && target.getAttribute('data-atlas-rows')) || ATLAS.rows;
    const x = ATLAS.columns > 1 ? (safeFrame / (ATLAS.columns - 1)) * 100 : 0;
    const y = rows > 1 ? (animation.row / (rows - 1)) * 100 : 0;
    target.style.backgroundPosition = x + '% ' + y + '%';
    target.setAttribute('data-atlas-animation', animationName);
    target.setAttribute('data-atlas-frame', String(safeFrame));
  }

  function createVisual(url, className, options) {
    const config = options || {};
    const rows = Number(config.rows) === 11 ? 11 : 9;
    const visual = document.createElement('span');
    visual.className = className || 'hpx-sp-pet-img hpx-sp-pet-atlas';
    visual.style.backgroundImage = 'url("' + url + '")';
    visual.style.backgroundSize = (ATLAS.columns * 100) + '% ' + (rows * 100) + '%';
    visual.setAttribute('data-atlas-rows', String(rows));
    paint(visual, 'idle', 0);
    return visual;
  }

  function play(target, animationName, options) {
    const animation = ATLAS.animations[animationName] || ATLAS.animations.idle;
    const config = options || {};
    const loop = config.mode !== 'once';
    let frame = 0;
    let timer = null;
    let stopped = false;

    function stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
    }

    function finish() {
      stop();
      if (typeof config.onComplete === 'function') config.onComplete();
    }

    function advance() {
      if (stopped || !target || !target.isConnected) return;
      paint(target, animationName, frame);
      if (reducedMotion()) {
        if (!loop) setTimeout(finish, 0);
        return;
      }
      const duration = animation.durations[frame] || 140;
      timer = setTimeout(function () {
        frame += 1;
        if (frame >= animation.frames) {
          if (!loop) {
            finish();
            return;
          }
          frame = 0;
        }
        advance();
      }, duration);
    }

    advance();
    return { stop: stop, name: animationName };
  }

  NS.ui.petAnimator = {
    atlas: ATLAS,
    createVisual: createVisual,
    paint: paint,
    play: play,
  };
})();
