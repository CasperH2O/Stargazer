'use strict';
// What Jibo says for a picture: the title and/or the description, as one clean utterance.
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

module.exports = {cleanDescription: cleanDescription, spokenText: spokenText};
