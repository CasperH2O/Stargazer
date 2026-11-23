'use strict';
// What Jibo says for a picture: the title and/or the description, cleaned, and split into pieces
// for the speech engine.
var text = require('./sources/text');

// The description without links, bracketed notes and markup characters, in whole sentences.
function cleanDescription(description) {
    var s = String(description || '')
        .replace(/https?:\/\/\S+/g, ' ')
        .replace(/\[[^\]]*\]/g, ' ')
        .replace(/[<>*_#|~^`]/g, '')
        .replace(/\s+/g, ' ')
        .replace(/\s+([.,;:!?])/g, '$1')
        .trim();
    return text.upTo(s, text.DESCRIPTION_MAX).replace(/\s*…$/, '');
}

// {text, readsTitle, readsDescription} for the picture; `text` is empty when nothing is to be said.
// `values` are the settings readTitle and readDescription.
function spokenText(item, values) {
    var parts = [], title = values.readTitle && item.title ? String(item.title).trim() : '';
    var description = values.readDescription ? cleanDescription(item.description) : '';
    if (title) parts.push(title);
    if (description) parts.push(description);
    return {
        text: parts.map(function (part) { return /[.!?…]$/.test(part) ? part : part + '.'; }).join(' '),
        readsTitle: !!title,
        readsDescription: !!description
    };
}

// The text as the speech engine gets it: pieces of at most `max` characters (450, like Jibo's own
// skills), split after a sentence, else a word, with & < > escaped because the engine reads markup.
function utterances(text, max) {
    max = max || 450;
    var out = [], rest = String(text || '').replace(/\s+/g, ' ').trim();
    while (rest.length > max) {
        var head = rest.slice(0, max);
        var cut = Math.max(head.lastIndexOf('. '), head.lastIndexOf('! '), head.lastIndexOf('? '), head.lastIndexOf('… '));
        if (cut < max / 3) cut = head.lastIndexOf(' ');
        if (cut < 1) cut = max - 1;
        out.push(rest.slice(0, cut + 1).trim());
        rest = rest.slice(cut + 1).trim();
    }
    if (rest) out.push(rest);
    return out.map(function (piece) { return piece.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); });
}

module.exports = {cleanDescription: cleanDescription, spokenText: spokenText, utterances: utterances};
