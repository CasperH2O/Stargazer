'use strict';
// Log lines tagged [stargazer], to the skill's own logger when Be gives one, else the console.
module.exports = function createLog(base) {
    function line(level) {
        return function () {
            var text = '[stargazer] ' + Array.prototype.slice.call(arguments).join(' ');
            try {
                if (base && typeof base[level] === 'function') base[level](text);
                else (console[level] || console.log).call(console, text);
            } catch (_) {}
        };
    }
    return {info: line('info'), warn: line('warn'), error: line('error')};
};
