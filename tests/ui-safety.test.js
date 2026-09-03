const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const projectRoot = path.resolve(__dirname, '..');
const context = vm.createContext({ window: {} });

vm.runInContext(fs.readFileSync(path.join(projectRoot, 'js', 'ui.js'), 'utf8'), context);

test('player supplied HTML is escaped before use in templates', () => {
    const escaped = context.window.UI.escapeHTML('<img src=x onerror="alert(1)"> O\'Brien & Co.');

    assert.equal(
        escaped,
        '&lt;img src=x onerror=&quot;alert(1)&quot;&gt; O&#039;Brien &amp; Co.'
    );
});
