import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=(p:string)=>readFileSync(p,'utf8');
test('navegação analítica usa o mesmo tema e conserva os destinos funcionais',()=>{
 const nav=source('components/vigia-analyst-topbar.tsx');
 const layout=source('app/layout.tsx');
 assert.match(layout,/<VigiaAnalystTopbar>/);
 assert.match(nav,/VigiaAppearanceToggle/);
 for(const path of ['/listening','/insights','/report','/settings'])
  assert.ok(nav.includes(path),path);
 assert.match(nav,/aria-current=/);
});
test('exportação e cabeçalhos usam tokens e português',()=>{
 const css=source('app/vigia-design-tokens.css');
 const exportBar=source('components/export-bar.tsx');
 const ui=source('components/ui.tsx');
 assert.match(exportBar,/vigia-export-dialog bg-\[var\(--vigia-paper\)\]/);
 assert.match(css,/vigia-export-dialog button\[class\*="bg-sky-600"\]/);
 assert.match(ui,/Sobre: /);
 assert.match(ui,/localeTag\(clientLocale\(\)\)/);
});
