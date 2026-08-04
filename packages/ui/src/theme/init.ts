import { STORAGE_KEYS } from './constants';

/**
 * Inline this in <head> (before any paint) so the saved theme, contrast, and text size
 * are applied to <html> immediately — no flash of the wrong size/theme on load.
 *
 *   <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
 */
export const themeInitScript = `(function(){try{
var d=document.documentElement;
var scale=localStorage.getItem(${JSON.stringify(STORAGE_KEYS.scale)})||'base';
var theme=localStorage.getItem(${JSON.stringify(STORAGE_KEYS.theme)})||'system';
var contrast=localStorage.getItem(${JSON.stringify(STORAGE_KEYS.contrast)})||'normal';
var dark=theme==='dark'||(theme==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);
d.setAttribute('data-theme',dark?'dark':'light');
d.setAttribute('data-contrast',contrast);
if(scale&&scale!=='base'){d.setAttribute('data-ui-scale',scale);}else{d.removeAttribute('data-ui-scale');}
}catch(e){}})();`;
