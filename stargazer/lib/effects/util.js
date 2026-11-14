'use strict';
// Small helpers shared by the effects. Plain ES2015 for the robot's Node 6 / Chromium 53.

// Seeded random (mulberry32), so a plan can be reproduced in tests and videos.
function rng(seed) {
    var a = (seed >>> 0) || 1;
    return function () {
        a = (a + 0x6D2B79F5) >>> 0;
        var t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

var ease = {
    linear: function (t) { return t; },
    inOutSine: function (t) { return -(Math.cos(Math.PI * t) - 1) / 2; },
    outCubic: function (t) { return 1 - Math.pow(1 - t, 3); },
    inCubic: function (t) { return t * t * t; },
    inOutCubic: function (t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; },
    outBack: function (t) { var c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); }
};

function clamp01(t) { return t < 0 ? 0 : t > 1 ? 1 : t; }
// Progress of `now` through [start, start + duration], clamped to 0..1.
function progress(now, start, duration) { return duration <= 0 ? (now >= start ? 1 : 0) : clamp01((now - start) / duration); }
function lerp(a, b, t) { return a + (b - a) * t; }

module.exports = { rng: rng, ease: ease, clamp01: clamp01, progress: progress, lerp: lerp };
