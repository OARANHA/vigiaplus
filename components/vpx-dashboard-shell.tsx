'use client';
import Link from 'next/link';
import {useEffect,useState,type ReactNode} from 'react';
import {ChevronDown,LogOut,Moon,RadioTower,RefreshCw,Sun,UserRound} from 'lucide-react';

export type DashboardTab={id:string;label:string};
export function VigiaDashboardShell({role,tabs,activeTab,onTab,onLogout,onRefresh,children,extra}:{
 role:'cliente'|'proprietario';tabs:readonly DashboardTab[];activeTab:string;
 onTab:(id:string)=>void;onLogout:()=>void|Promise<void>;onRefresh:()=>void;
 children:ReactNode;extra?:ReactNode;
}){
 const [theme,setTheme]=useState<'light'|'dark'>('light');
 useEffect(()=>{try{const t=window.localStorage.getItem('vigiaplus-dashboard-theme');
   if(t==='light'||t==='dark')setTheme(t);}catch{}},[]);
 function toggle(){const t=theme==='light'?'dark':'light';setTheme(t);
   try{window.localStorage.setItem('vigiaplus-dashboard-theme',t);}catch{}}
 return <div className="vpx-app" data-vpx-theme={theme}>
 <div className="vpx-stage">
  <header className="vpx-topbar">
   <Link href={role==='proprietario'?'/console':'/portal'} className="vpx-brand" aria-label="VigiaPlus — início">
    <span className="vpx-brand-symbol"><RadioTower size={19}/></span>
    Vigia<span>Plus</span>
   </Link>
   <nav className="vpx-topnav" aria-label={role==='cliente'?'Navegação do cliente':'Navegação do proprietário'}>
    {tabs.map(t=><button type="button" key={t.id} className={'vpx-navpill'+(activeTab===t.id?' is-active':'')}
      aria-current={activeTab===t.id?'page':undefined} onClick={()=>onTab(t.id)}>{t.label}
      {t.id!=='panorama'&&t.id!=='inicio'&&<ChevronDown size={12}/>}</button>)}
   </nav>
   <div className="vpx-tools">
    <button type="button" className="vpx-iconbtn" onClick={onRefresh} aria-label="Atualizar dados" title="Atualizar dados"><RefreshCw size={17}/></button>
    <button type="button" className="vpx-iconbtn" onClick={toggle} aria-label={theme==='light'?'Ativar modo escuro':'Ativar modo claro'}
      aria-pressed={theme==='dark'} title={theme==='light'?'Modo escuro':'Modo claro'}>{theme==='light'?<Moon size={17}/>:<Sun size={17}/>}</button>
    <span className="vpx-divider"/>
    <span className="vpx-useravatar" title={role==='proprietario'?'Proprietário':'Cliente'}><UserRound size={17}/></span>
    <button type="button" className="vpx-iconbtn vpx-logout" onClick={onLogout} aria-label="Sair" title="Sair"><LogOut size={17}/></button>
   </div>
  </header>
  <div className="vpx-contextline"><span><span className="vpx-live"/> Inteligência de reputação e comunicação</span><div>{extra}</div></div>
  {children}
  <footer className="vpx-footer">VigiaPlus · Inteligência contextualizada e verificável <span>·</span> {role==='proprietario'?'Administração':'Área do cliente'}</footer>
 </div></div>;
}
const SEGMENTS=40;
function point(d:number){const a=d*Math.PI/180;return{x:180+Math.sin(a)*125,y:153-Math.cos(a)*125};}
function arcPath(start:number,end:number){const a=point(start),b=point(end);
 return 'M '+a.x.toFixed(2)+' '+a.y.toFixed(2)+' A 125 125 0 0 1 '+b.x.toFixed(2)+' '+b.y.toFixed(2);}
export function VigiaCoverageGauge({value,label,description,onAction,actionLabel}:{
 value:number|null;label:string;description:string;onAction:()=>void;actionLabel:string;
}){
 const pct=value===null||!Number.isFinite(value)?null:Math.min(100,Math.max(0,Math.round(value)));
 return <div className="vpx-gauge">
  <div className="vpx-gauge-visual">
   <svg viewBox="0 0 360 280" role="img" aria-label={label+': '+(pct===null?'sem dados':pct+'%')}>
    {Array.from({length:SEGMENTS},(_,i)=>{
      const step=260/SEGMENTS, start=-130+i*step+0.8, end=start+step-1.6;
      const active=pct!==null&&(i+0.5)/SEGMENTS<=pct/100;
      return <path key={i} d={arcPath(start,end)} fill="none" stroke={'hsl('+(4+106*i/39)+' 90% 55%)'}
        strokeWidth="15" strokeLinecap="round" opacity={pct===null?.28:active?1:.17}/>;
    })}
   </svg>
   <div className="vpx-gauge-center"><span>{label}</span><strong>{pct===null?'—':pct+'%'}</strong><small>{pct===null?'Aguardando dados':'Cobertura verificada'}</small></div>
  </div>
  <p>{description}</p>
  <button type="button" className="vpx-black-action" onClick={onAction}>{actionLabel}<span>↗</span></button>
 </div>;
}
export function VigiaStatTile({title,value,note,tone='lime',onClick}:{
 title:string;value:string|number;note:string;tone?:'lime'|'coral'|'yellow'|'blue';onClick?:()=>void;
}){
 const children=<><span className="vpx-tile-label">{title}</span>
  <span className="vpx-tile-value"><strong>{value}</strong><small className={'vpx-tag '+tone}>{note}</small></span></>;
 return onClick?<button type="button" className="vpx-stat-tile" onClick={onClick}>{children}<b className="vpx-tile-arrow">↗</b></button>
   :<div className="vpx-stat-tile">{children}</div>;
}
