import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
function src(path:string){return readFileSync(join(process.cwd(),path),'utf8');}
test('dashboard claro/escuro tem a mesma árvore e escolha persistida',()=>{
 const shell=src('components/vpx-dashboard-shell.tsx');
 const appearance=src('components/vigia-appearance.tsx');
 const sidebar=src('components/sidebar.tsx');
 const css=src('app/vpx-dashboard.css');
 const root=src('app/layout.tsx');
 assert.match(shell,/data-vpx-theme={theme}/);
 assert.match(shell,/useVigiaAppearance/);
 assert.match(appearance,/VIGIA_THEME_STORAGE_KEY = 'vigiaplus-dashboard-theme'/);
 assert.match(appearance,/localStorage\.setItem\(VIGIA_THEME_STORAGE_KEY/);
 assert.match(sidebar,/VigiaAppearanceToggle/);
 assert.match(shell,/Ativar modo escuro/);
 assert.match(shell,/Ativar modo claro/);
 assert.match(css,/data-vpx-theme="dark"/);
 assert.match(css,/grid-template-columns:minmax\(0,1\.09fr\) minmax\(0,1fr\)/);
 assert.match(css,/@media\(max-width:640px\)/);
 assert.match(root,/pageIsConsole/);
 assert.match(root,/vpx-dashboard\.css/);
});
test('medidor não inventa pontuação de reputação',()=>{
 const shell=src('components/vpx-dashboard-shell.tsx');
 const portal=src('app/portal/page.tsx');
 const admin=src('components/console-owner-dashboard.tsx');
 assert.match(shell,/pct===null\?'—'/);
 assert.match(portal,/Cobertura de análise/);
 assert.match(portal,/Não é nota de reputação/);
 assert.match(admin,/Projetos com histórico/);
 assert.match(admin,/Não indica saúde da reputação/);
});
test('cliente recebe evidências e proprietário recebe dados da operação',()=>{
 const client=src('app/portal/page.tsx');
 const owner=src('components/console-owner-dashboard.tsx');
 assert.match(client,/Promise\.allSettled/);
 assert.match(client,/VigiaDashboardShell/);
 assert.match(client,/Nenhuma publicação coletada/);
 assert.match(owner,/api\/console\/operations/);
 assert.match(owner,/operation\?\.clients/);
 assert.match(owner,/VigiaDashboardShell/);
});
