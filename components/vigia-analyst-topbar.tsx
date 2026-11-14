'use client';
import Link from 'next/link';
import {usePathname} from 'next/navigation';
import {BarChart3,FileText,RadioTower,Settings2} from 'lucide-react';
import {VigiaAppearanceToggle} from '@/components/vigia-appearance';
import type {ReactNode} from 'react';
const tabs=[
 {href:'/listening',label:'Monitoramento',icon:RadioTower,paths:['/listening','/vigia','/alerts','/media','/changes']},
 {href:'/insights',label:'Análises',icon:BarChart3,paths:['/insights','/kpi','/graph','/audience','/benchmark','/content','/emv','/measures','/people']},
 {href:'/report',label:'Relatórios',icon:FileText,paths:['/report','/brief','/studio']},
 {href:'/settings',label:'Configurações',icon:Settings2,paths:['/settings','/impostazioni','/query','/import']}
] as const;
export function VigiaAnalystTopbar({children}:{children?:ReactNode}){
 const pathname=usePathname();
 return <header className="vigia-analyst-topbar">
  <div className="vigia-analyst-identity"><b>Área de análise</b><small>Inteligência de reputação e comunicação</small></div>
  <nav className="vigia-analyst-tabs" aria-label="Acesso rápido aos módulos">
   {tabs.map(({href,label,icon:Icon,paths})=>{
    const active=paths.some(path=>pathname===path||pathname.startsWith(path+'/'));
    return <Link key={href} href={href} aria-current={active?'page':undefined}
     className={'vigia-analyst-tab'+(active?' is-active':'')}><Icon size={15} aria-hidden="true"/>{label}</Link>;
   })}
  </nav>
  <div className="vigia-analyst-actions"><VigiaAppearanceToggle/>{children}</div>
 </header>;
}
