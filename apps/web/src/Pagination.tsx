import { ChevronLeft, ChevronRight } from 'lucide-react';
import './pagination.css';

export type PageResult<T>={registros:T[];total:number;pagina:number;por_pagina:number};

export function Pagination({page,total,loading,disabled=false,onChange}:{page:number;total:number;loading:boolean;disabled?:boolean;onChange:(page:number)=>void}) {
  const pages=Math.max(1,Math.ceil(total/50));
  return <nav className="table-pagination" aria-label="Navegación de páginas">
    <span aria-live="polite">{loading?'Cargando…':disabled?'No se pudo cargar la página':'Página '+page+' de '+pages+' · '+total+' registros'}</span>
    <div className="button-group">
      <button className="ghost-button" disabled={loading||disabled||page<=1} onClick={()=>onChange(page-1)}><ChevronLeft size={16}/> Anterior</button>
      <button className="ghost-button" disabled={loading||disabled||page>=pages} onClick={()=>onChange(page+1)}>Siguiente <ChevronRight size={16}/></button>
    </div>
  </nav>;
}
