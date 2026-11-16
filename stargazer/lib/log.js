'use strict';
// Log lines tagged [stargazer], to the skill's own logger when Be gives one, else the console.
// A line is cut at LINE_MAX characters: some arguments are error messages carrying remote text.
var LINE_MAX = 500;
module.exports = function createLog(base) {
    function line(level) {
        return function () {
            var text = '[stargazer] ' + Array.prototype.slice.call(arguments).join(' ');
            if (text.length > LINE_MAX) text = text.slice(0, LINE_MAX) + '...';
            try {
                if (base && typeof base[level] === 'function') base[level](text);
                else (console[level] || console.log).call(console, text);
            } catch (_) {}
        };
    }
    return {info: line('info'), warn: line('warn'), error: line('error')};
};
