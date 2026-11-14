'use strict';
// Stargazer: an astronomy picture of the day for Jibo, as a BEam (5x1) custom skill.
// Pictures come from NASA, ESA/Hubble, ESA/Webb, ESO, NOIRLab and NASA EPIC; they are kept in
// memory only and never written to disk.
var jibo = require('jibo'), BeSkill = require('@be/be-framework').BeSkill;
var createScreen = require('./lib/screen');

module.exports = createScreen(jibo, BeSkill);
