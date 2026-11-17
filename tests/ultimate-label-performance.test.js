'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const source = file => fs.readFileSync(path.join(root, file), 'utf8');

test('semantic discovery normalizes a whitelist once and reads each candidate text once', () => {
  let textReads = 0;
  const candidate = (text, attrs = {}) => ({
    nodeType:1, tagName:'DIV', isConnected:true,
    get childNodes() { textReads++; return [{nodeType:3, nodeValue:text}]; },
    getAttribute: name => attrs[name] || null,
    closest: () => null,
    contains: () => false,
    getBoundingClientRect: () => ({width:100, height:20}),
  });
  const match = candidate('Team (24)');
  const titled = candidate('Icon', {title:'On_Hold'});
  const nodes = Array.from({length:1000}, (_, i) => candidate('Ticket activity ' + i)).concat(match, titled);
  const window = {
    __HPX:{config:{selectors:{ULTIMATE_MODE:{
      OWN_UI_ROOT_SELECTORS:['.hpx-toolbar'], TEXT_CANDIDATE_SELECTORS:['div'],
      MAX_LABEL_TEXT_LENGTH:100, TEXT_SUBTREE_SKIP_SELECTOR:'ul',
    }}}},
    getComputedStyle: () => ({display:'block', visibility:'visible'}),
  };
  const document = {querySelectorAll:() => nodes};
  const context = vm.createContext({window, document});
  vm.runInContext(`globalThis.normalizations = 0;
    const lower = String.prototype.toLocaleLowerCase;
    String.prototype.toLocaleLowerCase = function(...args) { normalizations++; return lower.apply(this,args); };`, context);
  vm.runInContext(source('src/ultimate-mode/shared.js'), context);
  const result = window.__HPX.ultimate.shared.findByLabels(document,
    ['Status','Priority','Assigned Agent','Service Desk','Projects','Calendar','Customers','Assets','Reporting','Dashboard','Team','On Hold'],
    {allowTrailingCounter:true});
  assert.deepEqual(Array.from(result), [match,titled]);
  assert.equal(textReads, nodes.length, 'each label subtree is traversed only once');
  assert.ok(context.normalizations < 1100, 'normalization work must scale with candidates plus whitelist, not their product');
});

for (const nativeRail of [true,false]) {
  test('partial icon rail ' + (nativeRail ? 'stays scoped to native navigation' : 'retains unknown-layout discovery'), () => {
    const label = {}, rail = {}, body = {};
    let searched, boundary, hidden;
    const window = {__HPX:{config:{}}, location:{href:'https://example.halopsa.com/timesheets', pathname:'/timesheets'}};
    vm.runInNewContext(source('src/config/selectors.js'), {window});
    const document = {body, querySelector:()=>null, getElementById:()=>nativeRail ? rail : null};
    window.__HPX.ultimate = {shared:{
      cfg:window.__HPX.config.selectors.ULTIMATE_MODE,
      reconcileSection:(_name,fn)=>fn(), safeQueryAll:()=>[],
      findByLabels(scope) {searched=scope; return [label];},
      elementRect:()=>({left:0,right:60}),
      boundedOwner(node,scope) {boundary=scope; return node;},
      hide(node) {hidden=node; return true;},
    }};
    vm.runInNewContext(source('src/ultimate-mode/sidebar.js'), {window,document});
    const result=window.__HPX.ultimate.sidebar.apply();
    assert.equal(searched,nativeRail ? rail : document);
    assert.equal(boundary,nativeRail ? rail : body);
    assert.equal(hidden,label);
    assert.equal(result.hidden,1);
  });
}
