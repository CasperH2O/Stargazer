'use strict';
// "Look up" on the body: Jibo tilts his head towards the sky while the picture opens, then
// centres again. Skills on BEam's SDK have no jibo.animate; motion goes through jibo.expression
// and jibo.animDB, as BEam's own dance and radio skills do: attention OFF (so he does not look
// straight back at a face), a stock pose played on the BODY channels only (so our screen and
// eye drawing are untouched), then centerRobot on the body and the attention mode released.
// Every call is guarded: without them (or on error) the effect simply has no body part.
// Runs on the robot's Node 6: ES2015 only.

var POSE = 'Body_Look_Center_Up_01';

function Motion(jibo, log) {
    this.jibo = jibo; this.log = log || {info: function () {}, warn: function () {}};
    this.attention = null; this.busy = null; this.closed = false;
}
Motion.prototype.available = function () {
    var j = this.jibo, ex = j && j.expression;
    return !!(ex && ex.dofs && ex.dofs.BODY && typeof ex.centerRobot === 'function' && j.animDB && typeof j.animDB.getAnimByName === 'function');
};
// direction: 'up' | 'centre' (the presenter's onLookUp hook).
Motion.prototype.move = function (direction) {
    if (this.closed || !this.available()) return Promise.resolve();
    return direction === 'up' ? this.up() : this.centre();
};
Motion.prototype.up = function () {
    var self = this, j = this.jibo, ex = j.expression, BODY = ex.dofs.BODY;
    this.busy = Promise.resolve().then(function () {
        if (!self.attention && typeof ex.pushAttentionMode === 'function' && ex.AttentionMode) return ex.pushAttentionMode(ex.AttentionMode.OFF);
        return null;
    }).then(function (handle) {
        if (handle) self.attention = handle;
        var pose = j.animDB.getAnimByName(POSE);
        if (!pose || typeof pose.play !== 'function') throw Error('pose_missing');
        var playing = pose.play({cache: j.loader && j.loader.activeCache, dofs: BODY});
        return playing && playing.result;
    }).catch(function (error) { self.log.warn('look up:', error && error.message || error); });
    return this.busy;
};
Motion.prototype.centre = function () {
    var self = this, ex = this.jibo.expression;
    return Promise.resolve(this.busy).then(function () {
        return ex.centerRobot({dofs: ex.dofs.BODY});
    }).catch(function (error) { self.log.warn('centre:', error && error.message || error); }).then(function () { self.release(); });
};
Motion.prototype.release = function () {
    var handle = this.attention;
    this.attention = null;
    if (handle && typeof handle.release === 'function') try { handle.release(); } catch (_) {}
};
Motion.prototype.close = function () {
    if (this.closed) return;
    var hadAttention = !!this.attention;
    this.closed = true;
    if (hadAttention) {
        var ex = this.jibo.expression;
        try { Promise.resolve(ex.centerRobot({dofs: ex.dofs.BODY})).catch(function () {}); } catch (_) {}
    }
    this.release();
};

module.exports = {Motion: Motion, POSE: POSE};
