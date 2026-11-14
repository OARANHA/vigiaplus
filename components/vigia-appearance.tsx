'use client';
import {useEffect, useState} from 'react';
import {Moon, Sun} from 'lucide-react';

export type VigiaTheme = 'light'|'dark';
export const VIGIA_THEME_STORAGE_KEY = 'vigiaplus-dashboard-theme';
function readSavedTheme():VigiaTheme {
  try {
    const saved = window.localStorage.getItem(VIGIA_THEME_STORAGE_KEY);
    return saved==='light'||saved==='dark'?saved:'dark';
  } catch {return 'dark';}
}
export function useVigiaAppearance(){
  const [theme,setTheme] = useState<VigiaTheme>('dark');
  useEffect(()=>{
    // Both the sidebar and the topbar (and the Vpx shell) observe one preference.
    const sync=()=>{
      const current=readSavedTheme();
      setTheme(current);
      document.documentElement.dataset.vigiaTheme=current;
    };
    sync();
    window.addEventListener('storage',sync);
    window.addEventListener('vigia-theme-change',sync);
    return ()=>{
      window.removeEventListener('storage',sync);
      window.removeEventListener('vigia-theme-change',sync);
    };
  },[]);
  function toggle(){
    const next=readSavedTheme()==='light'?'dark':'light';
    setTheme(next);
    try {window.localStorage.setItem(VIGIA_THEME_STORAGE_KEY,next);}catch{}
    document.documentElement.dataset.vigiaTheme=next;
    window.dispatchEvent(new Event('vigia-theme-change'));
  }
  return {theme,toggle};
}
export function VigiaAppearanceToggle(){
  const {theme,toggle}=useVigiaAppearance();
  return (
    <button type="button" onClick={toggle} className="vigia-appearance-toggle"
      aria-label={theme==='dark'?'Ativar modo claro':'Ativar modo escuro'}
      title={theme==='dark'?'Modo claro':'Modo escuro'}
      aria-pressed={theme==='dark'}>
      {theme==='dark'?<Sun size={16} aria-hidden="true"/>:<Moon size={16} aria-hidden="true"/>}
      <span>{theme==='dark'?'Modo claro':'Modo escuro'}</span>
    </button>
  );
}
