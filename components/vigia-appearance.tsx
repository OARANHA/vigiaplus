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
    const initial=readSavedTheme();
    setTheme(initial);
    // A root attribute shares the same semantics across both app shells.
    document.documentElement.dataset.vigiaTheme=initial;
  },[]);
  useEffect(()=>{
    document.documentElement.dataset.vigiaTheme=theme;
  },[theme]);
  function toggle(){
    const next=theme==='light'?'dark':'light';
    setTheme(next);
    try {window.localStorage.setItem(VIGIA_THEME_STORAGE_KEY,next);}catch{}
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
